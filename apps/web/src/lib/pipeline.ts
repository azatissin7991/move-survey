// Turns a finished recording into an inventory. Runs inside the web app:
// started right after Done (and after each late upload), continued by a cron
// every minute. Each step is short and saves its progress on the survey's
// PipelineRun, so the work survives function time limits and crashes.
//
//   1. transcribe narration (once)
//   2. analyze frames in order, a batch per step, carrying the draft forward
//   3. finalize: lines, boxes, totals with range, suggestions → review or auto-approve

import type { InventoryDraft } from "@move-survey/contracts";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { tenantSettings } from "./customer";
import { confidentEnough, draftToLines, suggestionsFor, totalsFor } from "./estimate";
import { chunkKey, getStorage, type Storage } from "./storage";
import { enqueueWebhook } from "./webhooks";
import { analyzeWithClaude, type Analyzer } from "./analysis/claude";
import { transcribeWithGemini, type Transcriber } from "./analysis/transcribe";

export type PipelineDeps = { analyze: Analyzer; transcribe: Transcriber; storage: Storage };

const BATCH_SIZE = 20; // frames per model request
const MAX_FRAMES = 240; // longer recordings are sampled evenly down to this
const LEASE_MS = 5 * 60_000;
const UPLOAD_GRACE_MS = 2 * 60 * 60_000; // after Done, wait this long for stragglers
const MAX_ATTEMPTS = 3;

type State = { transcribed: boolean; batch: number; draft: InventoryDraft };
const START: State = { transcribed: false, batch: 0, draft: { rooms: [], items: [] } };

const defaultDeps = (): PipelineDeps => ({ analyze: analyzeWithClaude, transcribe: transcribeWithGemini, storage: getStorage() });

export async function runPipeline(surveyId: string, deps: PipelineDeps = defaultDeps(), budgetMs = 240_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const run = await db.pipelineRun.upsert({ where: { surveyId }, create: { surveyId }, update: {} });
  if (run.status !== "RUNNING") return;

  const now = new Date();
  const leased = await db.pipelineRun.updateMany({
    where: { id: run.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (leased.count === 0) return; // another invocation is on it

  try {
    while (Date.now() < deadline && (await step(surveyId, deps)) === "progress");
  } finally {
    await db.pipelineRun.update({ where: { id: run.id }, data: { lockedUntil: null } });
  }
}

async function step(surveyId: string, deps: PipelineDeps): Promise<"progress" | "idle"> {
  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    include: { rooms: { orderBy: { sortOrder: "asc" } }, media: true, run: true, tenant: { select: { settings: true } } },
  });
  if (!survey?.run || survey.status !== "PROCESSING" || survey.run.status !== "RUNNING") return "idle";

  const uploading = survey.media.some((m) => m.kind !== "VIDEO" && m.status === "UPLOADING");
  const graceOver = !survey.finishedAt || Date.now() - survey.finishedAt.getTime() > UPLOAD_GRACE_MS;
  if (uploading && !graceOver) return "idle";

  const run = survey.run;
  const state: State = { ...START, ...(run.state as Partial<State>) };
  const save = (data: Prisma.PipelineRunUpdateInput) => db.pipelineRun.update({ where: { id: run.id }, data });

  try {
    if (!state.transcribed) {
      for (const audio of survey.media.filter((m) => m.kind === "AUDIO" && m.status === "COMPLETE")) {
        const bytes = await concatChunks(deps.storage, audio.storagePrefix, audio.chunkCount);
        const text = await deps.transcribe(bytes, audio.contentType);
        if (text) await db.surveyRoom.update({ where: { id: audio.roomId }, data: { transcript: text } });
      }
      await save({ state: { ...state, transcribed: true }, attempts: 0 });
      return "progress";
    }

    const frames = await orderedFrames(surveyId);
    const batch = frames.slice(state.batch * BATCH_SIZE, (state.batch + 1) * BATCH_SIZE);
    if (batch.length > 0) {
      const rooms = await db.surveyRoom.findMany({ where: { surveyId }, orderBy: { sortOrder: "asc" } });
      const result = await deps.analyze({
        frames: await Promise.all(
          batch.map(async (f) => ({ label: f.label, segment: f.segment, tMs: f.tMs, jpeg: await deps.storage.get(f.storageKey) })),
        ),
        draft: state.draft,
        transcripts: rooms.filter((r) => r.transcript).map((r) => ({ segment: r.label, text: r.transcript })),
        roomByRoom: tenantSettings(survey.tenant.settings).captureMode === "rooms",
      });
      const usage = run.usage as Record<string, number>;
      for (const [k, v] of Object.entries(result.usage)) usage[k] = (usage[k] ?? 0) + v;
      await save({ state: { ...state, batch: state.batch + 1, draft: result.draft }, servedModel: result.model, usage, attempts: 0 });
      return "progress";
    }

    await finalize(survey, state.draft, new Map(frames.map((f) => [f.label, f.id])));
    return "idle";
  } catch (e) {
    const attempts = run.attempts + 1;
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    if (attempts < MAX_ATTEMPTS) {
      await save({ attempts, error }); // the next cron tick retries
    } else {
      await db.$transaction(async (tx) => {
        await tx.pipelineRun.update({ where: { id: run.id }, data: { attempts, error, status: "FAILED" } });
        const failed = await tx.survey.update({ where: { id: surveyId }, data: { status: "FAILED" } });
        await enqueueWebhook(tx, failed, "survey.processing_failed");
      });
    }
    return "idle";
  }
}

type OrderedFrame = { id: string; label: string; segment: string; tMs: number; storageKey: string };

/** Frames in recording order (segment, then time), sampled down to MAX_FRAMES, labelled F1, F2, … */
async function orderedFrames(surveyId: string): Promise<OrderedFrame[]> {
  const rows = await db.frame.findMany({
    where: { surveyId },
    include: { room: { select: { sortOrder: true, label: true } } },
  });
  rows.sort((a, b) => a.room.sortOrder - b.room.sortOrder || a.tMs - b.tMs || a.id.localeCompare(b.id));
  const step = Math.max(1, rows.length / MAX_FRAMES);
  const picked = rows.length <= MAX_FRAMES ? rows : Array.from({ length: MAX_FRAMES }, (_, i) => rows[Math.floor(i * step)]!);
  return picked.map((f, i) => ({ id: f.id, label: `F${i + 1}`, segment: f.room.label, tMs: f.tMs, storageKey: f.storageKey }));
}

async function concatChunks(storage: Storage, prefix: string, count: number): Promise<Uint8Array> {
  const parts = await Promise.all(Array.from({ length: count }, (_, i) => storage.get(chunkKey(prefix, i))));
  return Buffer.concat(parts);
}

async function finalize(
  survey: { id: string; tenant: { settings: unknown } },
  draft: InventoryDraft,
  frameIds: Map<string, string>,
) {
  const lines = draftToLines(draft, frameIds);
  const coverageGaps = draft.rooms.flatMap((r) => r.coverageGaps.map((g) => `${r.label}: ${g}`));
  const gaps = coverageGaps.length;
  const totals = totalsFor(lines, gaps);
  const suggestions = suggestionsFor(lines, totals.cuFt);
  const auto = tenantSettings(survey.tenant.settings).autoApprove && confidentEnough(lines, gaps);

  await db.$transaction(async (tx) => {
    await tx.detection.deleteMany({ where: { surveyId: survey.id } });
    await tx.detection.createMany({ data: lines.map((l) => ({ ...l, surveyId: survey.id })) });
    const updated = await tx.survey.update({
      where: { id: survey.id },
      data: {
        totals,
        suggestions,
        coverageGaps,
        status: auto ? "APPROVED" : "READY_FOR_REVIEW",
        ...(auto ? { revision: { increment: 1 }, approvedAt: new Date() } : {}),
      },
    });
    await tx.pipelineRun.update({ where: { surveyId: survey.id }, data: { status: "DONE", error: "" } });
    await enqueueWebhook(tx, updated, auto ? "survey.approved" : "survey.ready_for_review");
  });
}

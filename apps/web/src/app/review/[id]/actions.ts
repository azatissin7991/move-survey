"use server";

// Reviewer actions. Every call re-checks the signed link. Edits reopen an
// approved survey until it is approved again; approval bumps the revision so
// the CRM picks up the new inventory.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { catalogItem, snapshotFor } from "@/lib/estimate";
import { clipChunks, recompute, reviewAllowed, type ReviewAuth } from "@/lib/review";
import { chunkKey, getStorage } from "@/lib/storage";
import { enqueueWebhook } from "@/lib/webhooks";

const EDITABLE = ["READY_FOR_REVIEW", "APPROVED"];

async function editableSurvey(auth: ReviewAuth) {
  if (!reviewAllowed(auth)) throw new Error("This review link has expired. Open it again from the CRM.");
  const survey = await db.survey.findUnique({ where: { id: auth.surveyId } });
  if (!survey || !EDITABLE.includes(survey.status)) throw new Error("This survey can't be edited now.");
  return survey;
}

/** After any edit: fresh totals, and an approved survey goes back to review. */
async function afterEdit(surveyId: string, coverageGaps: unknown) {
  const detections = await db.detection.findMany({ where: { surveyId } });
  await db.survey.update({
    where: { id: surveyId },
    data: { ...recompute(detections, (coverageGaps as string[]).length), status: "READY_FOR_REVIEW" },
  });
  revalidatePath(`/review/${surveyId}`);
}

const patchSchema = z.object({ quantity: z.number().int().min(1).max(999).optional(), moving: z.boolean().optional() });

export async function updateLine(auth: ReviewAuth, detectionId: string, patch: z.infer<typeof patchSchema>) {
  const survey = await editableSurvey(auth);
  const data = patchSchema.parse(patch);
  const before = await db.detection.findFirst({ where: { id: detectionId, surveyId: survey.id } });
  if (!before) throw new Error("Line not found");
  await db.$transaction([
    // A person checked it: no more doubt in the range.
    db.detection.update({ where: { id: detectionId }, data: { ...data, confidence: 1 } }),
    db.correction.create({
      data: {
        surveyId: survey.id,
        detectionId,
        actor: auth.user,
        before: { quantity: before.quantity, moving: before.moving },
        after: data,
      },
    }),
  ]);
  await afterEdit(survey.id, survey.coverageGaps);
}

const addSchema = z.object({
  catalogId: z.string(),
  roomLabel: z.string().min(1).max(60),
  quantity: z.number().int().min(1).max(999),
});

export async function addLine(auth: ReviewAuth, input: z.infer<typeof addSchema>) {
  const survey = await editableSurvey(auth);
  const { catalogId, roomLabel, quantity } = addSchema.parse(input);
  const item = catalogItem(catalogId);
  if (!item) throw new Error("Pick an item from the list.");
  const existing = await db.detection.findFirst({ where: { surveyId: survey.id, roomLabel } });
  const detection = await db.detection.create({
    data: {
      surveyId: survey.id,
      roomLabel,
      roomType: existing?.roomType ?? item.rooms[0] ?? "other",
      catalogItemId: item.id,
      quantity,
      confidence: 1,
      source: "ESTIMATOR",
      snapshot: snapshotFor(item),
    },
  });
  await db.correction.create({
    data: { surveyId: survey.id, detectionId: detection.id, actor: auth.user, after: { added: item.id, roomLabel, quantity } },
  });
  await afterEdit(survey.id, survey.coverageGaps);
}

export async function approve(auth: ReviewAuth) {
  const survey = await editableSurvey(auth);
  if (survey.status === "APPROVED") return; // nothing changed since the last approval
  await db.$transaction(async (tx) => {
    const updated = await tx.survey.update({
      where: { id: survey.id },
      data: { status: "APPROVED", approvedAt: new Date(), revision: { increment: 1 } },
    });
    await enqueueWebhook(tx, updated, "survey.approved");
  });
  revalidatePath(`/review/${survey.id}`);
}

export type Clip = { contentType: string; urls: string[]; seekSec: number };

/** The video around one evidence still, or null if there is none (not recorded, or deleted). */
export async function videoClip(auth: ReviewAuth, frameId: string): Promise<Clip | null> {
  if (!reviewAllowed(auth)) throw new Error("This review link has expired. Open it again from the CRM.");
  const frame = await db.frame.findFirst({ where: { id: frameId, surveyId: auth.surveyId } });
  if (!frame) return null;
  const video = await db.media.findFirst({ where: { roomId: frame.roomId, kind: "VIDEO", status: "COMPLETE", chunkCount: { gt: 0 } } });
  if (!video) return null;
  const { indices, seekSec } = clipChunks(video.chunkCount, (video.durationMs ?? 0) > 0, frame.tMs);
  const storage = getStorage();
  const urls = await Promise.all(indices.map((i) => storage.presignGet(chunkKey(video.storagePrefix, i), 600)));
  return { contentType: video.contentType, urls, seekSec };
}

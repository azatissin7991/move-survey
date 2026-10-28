// Signed, short-lived page links minted by the CRM through the API. Each
// carries the CRM user's name, so every edit is attributed:
//   /review/<id>  the estimator's review
//   /check/<id>   the crew's move-day checklist

import type { Detection } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { signValue, verifySignedValue } from "./crypto";
import { suggestionsFor, totalsFor, type Line } from "./estimate";

const LINK_TTL_MS = 12 * 60 * 60_000;

type Page = "review" | "check";
export type ReviewAuth = { surveyId: string; user: string; token: string };

const secret = () => {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("APP_SECRET is not set");
  return s;
};

function pageUrl(page: Page, surveyId: string, user: string): string {
  const token = signValue(secret(), `${page}:${surveyId}:${user}`, Date.now() + LINK_TTL_MS);
  const q = new URLSearchParams({ u: user, t: token });
  return `${process.env.APP_URL ?? "http://localhost:3100"}/${page}/${surveyId}?${q}`;
}

function pageAllowed(page: Page, { surveyId, user, token }: ReviewAuth): boolean {
  return !!user && !!token && verifySignedValue(secret(), `${page}:${surveyId}:${user}`, token);
}

export const reviewUrl = (surveyId: string, user: string) => pageUrl("review", surveyId, user);
export const reviewAllowed = (auth: ReviewAuth) => pageAllowed("review", auth);
export const checklistUrl = (surveyId: string, user: string) => pageUrl("check", surveyId, user);
export const checklistAllowed = (auth: ReviewAuth) => pageAllowed("check", auth);

/** Totals and suggestions recomputed from the current lines (after an edit). */
export function recompute(detections: Detection[], coverageGaps: number): Prisma.SurveyUpdateInput {
  const lines = detections as unknown as Line[];
  const totals = totalsFor(lines, coverageGaps);
  return { totals, suggestions: suggestionsFor(lines, totals.cuFt) };
}

const CHUNK_MS = 2000; // the recorder's timeslice (TIMESLICE_MS in recorder.tsx)
const CLIP_BEFORE = 4; // chunks before the moment
const CLIP_AFTER = 3; // and after: a ~16 s clip

/**
 * Which chunks to fetch to watch a recording around `tMs`. A recording's first
 * chunk carries the file header, so it always comes first and a few chunks
 * around the moment follow. An uploaded file is cut into byte slices, not
 * timed chunks, so it needs all of them.
 */
export function clipChunks(chunkCount: number, recorded: boolean, tMs: number): { indices: number[]; seekSec: number } {
  const seekSec = Math.max(0, tMs / 1000 - 3);
  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  if (!recorded) return { indices: range(0, chunkCount), seekSec };
  const k = Math.min(chunkCount - 1, Math.floor(tMs / CHUNK_MS));
  return { indices: [0, ...range(Math.max(1, k - CLIP_BEFORE), Math.min(chunkCount, k + CLIP_AFTER + 1))], seekSec };
}

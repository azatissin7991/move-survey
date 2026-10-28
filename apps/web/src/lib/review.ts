// The estimator's review link: signed, short-lived, and carrying the CRM
// user's name so every edit is attributed. Minted by the CRM through the API.

import type { Detection } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { signValue, verifySignedValue } from "./crypto";
import { suggestionsFor, totalsFor, type Line } from "./estimate";

const REVIEW_TTL_MS = 12 * 60 * 60_000;

export type ReviewAuth = { surveyId: string; user: string; token: string };

const secret = () => {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("APP_SECRET is not set");
  return s;
};

export function reviewUrl(surveyId: string, user: string): string {
  const token = signValue(secret(), `review:${surveyId}:${user}`, Date.now() + REVIEW_TTL_MS);
  const q = new URLSearchParams({ u: user, t: token });
  return `${process.env.APP_URL ?? "http://localhost:3100"}/review/${surveyId}?${q}`;
}

export function reviewAllowed({ surveyId, user, token }: ReviewAuth): boolean {
  return !!user && !!token && verifySignedValue(secret(), `review:${surveyId}:${user}`, token);
}

/** Totals and suggestions recomputed from the current lines (after an edit). */
export function recompute(detections: Detection[], coverageGaps: number): Prisma.SurveyUpdateInput {
  const lines = detections as unknown as Line[];
  const totals = totalsFor(lines, coverageGaps);
  return { totals, suggestions: suggestionsFor(lines, totals.cuFt) };
}

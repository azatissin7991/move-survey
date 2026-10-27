// Helpers for the customer-link endpoints (/api/s/<token>/...). The token is
// the customer's only credential, so every call re-checks it and the survey's
// state, and every room/media id is checked to belong to that survey.

import { z } from "zod";
import { ROOM_TYPES } from "@move-survey/catalog";
import { LANGUAGES, type SurveyStatus } from "@move-survey/contracts";
import { jsonError } from "./api-auth";
import { customerCanRecord } from "./state";
import { surveyForToken } from "./surveys";

export async function recordableSurvey(token: string) {
  const survey = await surveyForToken(token);
  if (!survey) return { response: jsonError(404, "This link has expired or doesn't exist.") };
  if (!customerCanRecord(survey.status as SurveyStatus)) {
    return { response: jsonError(409, "This survey is closed.") };
  }
  return { survey };
}

export const startRequestSchema = z.object({
  language: z.enum(LANGUAGES),
  consentMedia: z.boolean(),
  answers: z.object({
    homeType: z.string().max(40),
    bedrooms: z.number().int().min(0).max(20),
    selfPacking: z.enum(["yes", "no", "partly"]),
    packedBoxes: z.number().int().min(0).max(2000),
    notMoving: z.string().max(2000),
  }),
  rooms: z
    .array(z.object({ roomType: z.enum(ROOM_TYPES), label: z.string().min(1).max(60) }))
    .min(1)
    .max(40),
});

export const mediaRequestSchema = z.object({
  kind: z.enum(["VIDEO", "PHOTO"]),
  contentType: z
    .string()
    .regex(/^(video\/(mp4|webm|quicktime)|image\/(jpeg|png|heic|webp))(;.*)?$/, "Unsupported media type"),
});

export const MAX_CHUNKS = 1500; // ~50 min at 2 s chunks; real rooms are 1–3 min

export const chunkRequestSchema = z.object({ index: z.number().int().min(0).max(MAX_CHUNKS - 1) });

export const completeRequestSchema = z.object({
  chunkCount: z.number().int().min(1).max(MAX_CHUNKS),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  sizeBytes: z.number().int().min(1).max(4 * 1024 ** 3).optional(),
});

// Helpers for the capture-link endpoints (/api/s/<token>/...). The token is
// the only credential, so every call re-checks it and the survey's state, and
// every room/media id is checked to belong to that survey.

import { z } from "zod";
import { ROOM_TYPES } from "@move-survey/catalog";
import { LANGUAGES, type SurveyStatus } from "@move-survey/contracts";
import { jsonError } from "./api-auth";
import { rateLimited } from "./rate-limit";
import { canRecord, canUpload } from "./state";
import { surveyForToken } from "./surveys";

// A recording makes ~90 requests a minute (three streams of 2 s chunks); this
// leaves room for a backlog draining after the phone comes back online.
const REQUESTS_PER_MINUTE = 600;

/** The survey behind a link if `allowed(status)`, else an error response. */
export async function linkedSurvey(token: string, allowed: (s: SurveyStatus) => boolean) {
  if (await rateLimited(`s:${token}`, REQUESTS_PER_MINUTE)) return { response: jsonError(429, "Too many requests, slow down.") };
  const survey = await surveyForToken(token);
  if (!survey) return { response: jsonError(404, "This link has expired or doesn't exist.") };
  if (!allowed(survey.status as SurveyStatus)) return { response: jsonError(409, "This survey is closed.") };
  return { survey };
}

export const recordable = (token: string) => linkedSurvey(token, canRecord);
export const uploadable = (token: string) => linkedSurvey(token, canUpload);

export const startRequestSchema = z.object({
  language: z.enum(LANGUAGES),
  consentMedia: z.boolean(),
  packingSelf: z.boolean(),
});

export const segmentRequestSchema = z.object({
  // Only in room-by-room mode; a walk-through leaves rooms to the AI.
  roomType: z.enum(ROOM_TYPES).optional(),
  // Content type of each stream the phone will send for this segment.
  streams: z.object({
    VIDEO: z.string().regex(/^video\/(mp4|webm|quicktime)$/, "Unsupported video type").optional(),
    FRAMES: z.literal("image/jpeg"),
    AUDIO: z.string().regex(/^audio\/(mp4|webm)$/, "Unsupported audio type").optional(),
  }),
});

export const MAX_CHUNKS = 1500; // 50 min at 2 s chunks; a whole home is 5–15 min

// Recorded chunks are ~1 MB; uploaded files are sliced into 8 MB parts.
export const MAX_CHUNK_BYTES = 9 * 1024 * 1024;

export const chunkRequestSchema = z.object({
  index: z.number().int().min(0).max(MAX_CHUNKS - 1),
  // Signed into the upload URL, so storage refuses anything bigger.
  size: z.number().int().min(1).max(MAX_CHUNK_BYTES),
});

export const completeRequestSchema = z.object({
  chunkCount: z.number().int().min(0).max(MAX_CHUNKS), // 0: a very short segment kept no frames
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  sizeBytes: z.number().int().min(0).max(4 * 1024 ** 3).optional(),
  frameTimes: z.array(z.number().int().min(0)).max(MAX_CHUNKS).optional(), // FRAMES only
});

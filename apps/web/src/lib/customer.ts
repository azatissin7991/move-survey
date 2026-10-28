// Helpers for the capture-link endpoints (/api/s/<token>/...). The token is
// the only credential, so every call re-checks it and the survey's state, and
// every room/media id is checked to belong to that survey.

import { z } from "zod";
import { ROOM_TYPES } from "@move-survey/catalog";
import { CAPTURE_MODES, LANGUAGES, type SurveyStatus } from "@move-survey/contracts";
import { jsonError } from "./api-auth";
import { canRecord, canUpload } from "./state";
import { surveyForToken } from "./surveys";

/** The survey behind a link if `allowed(status)`, else an error response. */
export async function linkedSurvey(token: string, allowed: (s: SurveyStatus) => boolean) {
  const survey = await surveyForToken(token);
  if (!survey) return { response: jsonError(404, "This link has expired or doesn't exist.") };
  if (!allowed(survey.status as SurveyStatus)) return { response: jsonError(409, "This survey is closed.") };
  return { survey };
}

export const recordable = (token: string) => linkedSurvey(token, canRecord);
export const uploadable = (token: string) => linkedSurvey(token, canUpload);

/** Per-company switches, stored as JSON on the tenant. Bad values fall back to defaults. */
const tenantSettingsSchema = z.object({
  captureMode: z.enum(CAPTURE_MODES).catch("walkthrough"),
  // Confident surveys skip review and go straight to the CRM.
  autoApprove: z.boolean().catch(false),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
export function tenantSettings(settings: unknown): TenantSettings {
  return tenantSettingsSchema.parse(settings && typeof settings === "object" ? settings : {});
}

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

export const chunkRequestSchema = z.object({ index: z.number().int().min(0).max(MAX_CHUNKS - 1) });

export const completeRequestSchema = z.object({
  chunkCount: z.number().int().min(0).max(MAX_CHUNKS), // 0: a very short segment kept no frames
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  sizeBytes: z.number().int().min(0).max(4 * 1024 ** 3).optional(),
  frameTimes: z.array(z.number().int().min(0)).max(MAX_CHUNKS).optional(), // FRAMES only
});

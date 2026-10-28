// Survey and room lifecycle values shared by the web app, the worker and the
// CRM integration. The transition rules live in apps/web (lib/state.ts).

export const SURVEY_STATUSES = [
  "CREATED", // link minted, nobody has opened it
  "IN_PROGRESS", // someone is recording
  "PROCESSING", // recording finished; pipeline running
  "READY_FOR_REVIEW", // estimator's turn (skipped when auto-approved)
  "APPROVED", // final inventory published to the CRM
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const CAPTURE_MODES = ["walkthrough", "rooms"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

// VIDEO is kept for review playback; FRAMES (JPEG stills picked on the phone)
// and AUDIO (narration) are what the pipeline reads.
export const MEDIA_KINDS = ["VIDEO", "FRAMES", "AUDIO"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const DETECTION_SOURCES = ["AI", "ESTIMATOR"] as const;

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

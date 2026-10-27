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

// A room is one recorded segment: a whole walk-through, or one room in
// room-by-room mode. It exists from the moment its recording starts.
export const ROOM_STATUSES = [
  "UPLOADING",
  "UPLOADED", // footage complete, waiting for the pipeline
  "PROCESSING",
  "DONE",
  "FAILED", // pipeline gave up on this segment; the survey carries on
] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const CAPTURE_MODES = ["walkthrough", "rooms"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const PIPELINE_STAGES = ["ingest", "analyze", "reconcile", "measure", "finalize"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const DETECTION_STATUSES = ["PROPOSED", "ACCEPTED", "EDITED", "REJECTED", "MERGED"] as const;
export const DETECTION_SOURCES = ["AI", "ESTIMATOR"] as const;

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

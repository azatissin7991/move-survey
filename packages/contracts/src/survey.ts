// Survey and room lifecycle values shared by the web app, the worker and the
// CRM integration. The transition rules live in apps/web (lib/state.ts).

export const SURVEY_STATUSES = [
  "CREATED", // link minted, customer hasn't opened it
  "IN_PROGRESS", // customer is recording
  "PROCESSING", // customer finished; pipeline running
  "NEEDS_CUSTOMER", // waiting on customer confirmation / answers
  "READY_FOR_REVIEW", // estimator's turn
  "APPROVED", // final inventory published to the CRM
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const ROOM_STATUSES = [
  "PENDING", // on the checklist, nothing recorded
  "UPLOADING",
  "UPLOADED", // media complete, waiting for the pipeline
  "PROCESSING",
  "DONE",
  "NEEDS_RETAKE", // quality check failed; customer asked to re-record
  "FAILED", // pipeline gave up on this room; the survey carries on
  "SKIPPED",
] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const PIPELINE_STAGES = ["ingest", "analyze", "reconcile", "measure", "finalize"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const DETECTION_STATUSES = ["PROPOSED", "ACCEPTED", "EDITED", "REJECTED", "MERGED"] as const;
export const DETECTION_SOURCES = ["AI", "CUSTOMER", "ESTIMATOR"] as const;

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

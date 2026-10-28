// Survey state rules. Pure, so every edge case is unit-tested; the routes call
// these before writing and refuse anything they reject.

import type { SurveyStatus } from "@move-survey/contracts";

const SURVEY_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  CREATED: ["IN_PROGRESS", "CANCELLED", "EXPIRED"],
  IN_PROGRESS: ["PROCESSING", "CANCELLED", "EXPIRED"],
  PROCESSING: ["READY_FOR_REVIEW", "APPROVED", "FAILED", "CANCELLED"], // APPROVED = auto-approve
  READY_FOR_REVIEW: ["APPROVED", "CANCELLED"],
  APPROVED: ["READY_FOR_REVIEW", "CANCELLED"], // reopened for an estimator change
  CANCELLED: [],
  EXPIRED: ["IN_PROGRESS"], // office extended the link
  FAILED: ["PROCESSING", "CANCELLED"], // retried
};

export function canTransition(from: SurveyStatus, to: SurveyStatus): boolean {
  return SURVEY_TRANSITIONS[from].includes(to);
}

/** New recordings are accepted until the person recording taps Done. */
export const canRecord = (status: SurveyStatus) => status === "CREATED" || status === "IN_PROGRESS";

/** Uploads keep draining after Done: the phone may still be sending chunks. */
export const canUpload = (status: SurveyStatus) => canRecord(status) || status === "PROCESSING";

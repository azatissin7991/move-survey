// Survey and room state rules. Pure, so every edge case is unit-tested; the
// routes call these before writing and refuse anything they reject.

import type { RoomStatus, SurveyStatus } from "@move-survey/contracts";

const SURVEY_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  CREATED: ["IN_PROGRESS", "CANCELLED", "EXPIRED"],
  IN_PROGRESS: ["PROCESSING", "CANCELLED", "EXPIRED"],
  // Back to IN_PROGRESS when the customer re-records or is asked for more footage.
  PROCESSING: ["NEEDS_CUSTOMER", "READY_FOR_REVIEW", "IN_PROGRESS", "FAILED", "CANCELLED"],
  NEEDS_CUSTOMER: ["READY_FOR_REVIEW", "IN_PROGRESS", "PROCESSING", "CANCELLED", "EXPIRED"],
  READY_FOR_REVIEW: ["APPROVED", "IN_PROGRESS", "PROCESSING", "CANCELLED"],
  // Approval can be reopened for a revision (new footage, estimator change).
  APPROVED: ["READY_FOR_REVIEW", "IN_PROGRESS", "CANCELLED"],
  CANCELLED: [],
  EXPIRED: ["IN_PROGRESS"], // office extended the link
  FAILED: ["PROCESSING", "CANCELLED"], // retried
};

export function canTransition(from: SurveyStatus, to: SurveyStatus): boolean {
  return SURVEY_TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Survey can't go from ${from} to ${to}`);
  }
}

export function assertTransition(from: SurveyStatus, to: SurveyStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/** Statuses in which the customer may still record or re-record rooms. */
export function customerCanRecord(status: SurveyStatus): boolean {
  return ["CREATED", "IN_PROGRESS", "PROCESSING", "NEEDS_CUSTOMER", "READY_FOR_REVIEW"].includes(status);
}

/**
 * Whether a pipeline result for `resultRevision` of a room may be applied.
 * Anything produced from an older recording is stale and dropped.
 */
export function acceptsStageResult(roomRevision: number, resultRevision: number): boolean {
  return resultRevision === roomRevision;
}

const ROOM_DONE: RoomStatus[] = ["DONE", "FAILED", "SKIPPED"];

/**
 * After the customer taps Finish and rooms settle: the survey is ready for the
 * whole-house stages once every room is done, failed or skipped, and at least
 * one room produced something.
 */
export function readyToReconcile(rooms: { status: RoomStatus }[]): boolean {
  if (rooms.length === 0) return false;
  return rooms.every((r) => ROOM_DONE.includes(r.status)) && rooms.some((r) => r.status === "DONE");
}

/** Rooms the customer still owes footage for before Finish makes sense. */
export function roomsMissingFootage(rooms: { status: RoomStatus }[]): number {
  return rooms.filter((r) => r.status === "PENDING" || r.status === "NEEDS_RETAKE").length;
}

// Hand work to the Python worker. A PipelineRun row is written first, so a
// lost call is picked up by the stuck-run sweep instead of vanishing.

import type { PipelineStage } from "@move-survey/contracts";
import { db } from "./db";
import { signPayload } from "./crypto";

export async function enqueueRun(input: {
  surveyId: string;
  stage: PipelineStage;
  roomId?: string;
  roomRevision?: number;
}) {
  const run = await db.pipelineRun.create({
    data: {
      surveyId: input.surveyId,
      stage: input.stage,
      roomId: input.roomId ?? null,
      roomRevision: input.roomRevision ?? null,
    },
  });
  await kickWorker(run.id);
  return run;
}

/**
 * Tell the worker a run is waiting. Without WORKER_URL (local dev before the
 * worker exists) the run simply stays QUEUED.
 */
export async function kickWorker(runId: string): Promise<boolean> {
  const url = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!url || !secret) return false;
  const body = JSON.stringify({ runId });
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-survey-timestamp": String(timestamp),
        "x-survey-signature": signPayload(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

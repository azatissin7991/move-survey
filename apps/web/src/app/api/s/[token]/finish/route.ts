import { NextResponse } from "next/server";
import type { SurveyStatus } from "@move-survey/contracts";
import { jsonError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recordableSurvey } from "@/lib/customer";
import { canTransition } from "@/lib/state";

export const dynamic = "force-dynamic";

/**
 * Customer is done. Rooms never recorded are marked skipped; the survey moves
 * to PROCESSING and the pipeline picks up from the rooms already queued.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await recordableSurvey(token);
  if ("response" in found) return found.response;
  const { survey } = found;
  if (!survey.rooms.some((r) => !["PENDING", "SKIPPED"].includes(r.status))) {
    return jsonError(409, "Record at least one room first.");
  }
  if (survey.status === "PROCESSING") return NextResponse.json({ status: survey.status });
  if (!canTransition(survey.status as SurveyStatus, "PROCESSING")) {
    return jsonError(409, `Can't finish a ${survey.status} survey`);
  }
  await db.$transaction([
    db.surveyRoom.updateMany({ where: { surveyId: survey.id, status: "PENDING" }, data: { status: "SKIPPED" } }),
    db.survey.update({ where: { id: survey.id }, data: { status: "PROCESSING", finishedAt: new Date() } }),
  ]);
  return NextResponse.json({ status: "PROCESSING" });
}

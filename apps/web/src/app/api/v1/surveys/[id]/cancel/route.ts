import { NextResponse } from "next/server";
import type { SurveyStatus } from "@move-survey/contracts";
import { authenticate, jsonError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { canTransition } from "@/lib/state";
import { toSummary } from "@/lib/surveys";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const { id } = await params;
  const survey = await db.survey.findFirst({ where: { id, tenantId: tenant.id } });
  if (!survey) return jsonError(404, "Survey not found");
  if (survey.status === "CANCELLED") return NextResponse.json(toSummary(survey));
  if (!canTransition(survey.status as SurveyStatus, "CANCELLED")) {
    return jsonError(409, `A ${survey.status} survey can't be cancelled`);
  }
  const updated = await db.survey.update({ where: { id }, data: { status: "CANCELLED" } });
  return NextResponse.json(toSummary(updated));
}

import { NextResponse } from "next/server";
import { createSurveyRequestSchema } from "@move-survey/contracts";
import { authenticate, jsonError, parseBody } from "@/lib/api-auth";
import { createSurvey, toSummary } from "@/lib/surveys";

export const dynamic = "force-dynamic";

/** Create a survey for a CRM quote; returns the customer link to send. */
export async function POST(request: Request) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const body = await parseBody(request, createSurveyRequestSchema);
  if ("response" in body) return body.response;
  const survey = await createSurvey(tenant.id, body.data);
  return NextResponse.json(toSummary(survey), { status: 201 });
}

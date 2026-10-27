import { NextResponse } from "next/server";
import { authenticate, jsonError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { toSummary } from "@/lib/surveys";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const { id } = await params;
  const survey = await db.survey.findFirst({ where: { id, tenantId: tenant.id } });
  if (!survey) return jsonError(404, "Survey not found");
  return NextResponse.json(toSummary(survey));
}

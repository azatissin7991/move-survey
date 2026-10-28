import { NextResponse } from "next/server";
import { linkRequestSchema } from "@move-survey/contracts";
import { authenticate, jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { checklistUrl } from "@/lib/review";

export const dynamic = "force-dynamic";

/** A 12-hour move-day checklist link for one crew member, once there is an inventory. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const { id } = await params;
  const survey = await db.survey.findFirst({ where: { id, tenantId: tenant.id }, select: { id: true, totals: true } });
  if (!survey) return jsonError(404, "Survey not found");
  if (!survey.totals) return jsonError(409, "The inventory isn't ready yet");
  const body = await parseBody(request, linkRequestSchema);
  if ("response" in body) return body.response;
  return NextResponse.json({ url: checklistUrl(survey.id, body.data.userName) });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { reviewUrl } from "@/lib/review";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ userName: z.string().min(1).max(100) });

/** A 12-hour review link for one CRM user. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const { id } = await params;
  const survey = await db.survey.findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!survey) return jsonError(404, "Survey not found");
  const body = await parseBody(request, bodySchema);
  if ("response" in body) return body.response;
  return NextResponse.json({ url: reviewUrl(survey.id, body.data.userName) });
}

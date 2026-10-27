import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { outcomeRequestSchema } from "@move-survey/contracts";
import { authenticate, jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { actualCuFt } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Job actuals from the CRM after the move. Upsert: the CRM may resend. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const { id } = await params;
  const survey = await db.survey.findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!survey) return jsonError(404, "Survey not found");
  const body = await parseBody(request, outcomeRequestSchema);
  if ("response" in body) return body.response;

  const data = body.data as Prisma.InputJsonValue;
  const cuFt = actualCuFt(body.data);
  await db.outcome.upsert({
    where: { surveyId: id },
    create: { surveyId: id, data, actualCuFt: cuFt },
    update: { data, actualCuFt: cuFt },
  });
  return NextResponse.json({ ok: true, actualCuFt: cuFt });
}

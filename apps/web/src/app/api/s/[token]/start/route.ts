import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recordableSurvey, startRequestSchema } from "@/lib/customer";
import { enqueueWebhook } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/**
 * Customer finished the setup questions: save answers and the room checklist.
 * Callable again until recording starts, so the checklist can be edited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await recordableSurvey(token);
  if ("response" in found) return found.response;
  const { survey } = found;
  const body = await parseBody(request, startRequestSchema);
  if ("response" in body) return body.response;

  const recorded = survey.rooms.some((r) => r.status !== "PENDING");
  if (recorded) {
    return NextResponse.json({ error: "Rooms already have footage; add rooms one at a time instead." }, { status: 409 });
  }

  const first = survey.status === "CREATED";
  await db.$transaction(async (tx) => {
    await tx.surveyRoom.deleteMany({ where: { surveyId: survey.id } });
    await tx.surveyRoom.createMany({
      data: body.data.rooms.map((r, i) => ({ surveyId: survey.id, roomType: r.roomType, label: r.label, sortOrder: i })),
    });
    const updated = await tx.survey.update({
      where: { id: survey.id },
      data: {
        language: body.data.language,
        consentMedia: body.data.consentMedia,
        answers: body.data.answers as Prisma.InputJsonValue,
        ...(first ? { status: "IN_PROGRESS", startedAt: new Date() } : {}),
      },
    });
    if (first) await enqueueWebhook(tx, updated, "survey.started");
  });

  const rooms = await db.surveyRoom.findMany({ where: { surveyId: survey.id }, orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ rooms: rooms.map((r) => ({ id: r.id, roomType: r.roomType, label: r.label, status: r.status })) });
}

import { NextResponse } from "next/server";
import type { Language } from "@move-survey/contracts";
import { parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recordable, segmentRequestSchema } from "@/lib/customer";
import { DICTIONARIES } from "@/lib/i18n";
import { mediaPrefix } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Start recording a segment: the walk-through (or its next part after "Next
 * room"), or one room in room-by-room mode. Creates the room and its media.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await recordable(token);
  if ("response" in found) return found.response;
  const { survey } = found;
  const body = await parseBody(request, segmentRequestSchema);
  if ("response" in body) return body.response;
  const { kind, contentType, roomType } = body.data;

  const t = DICTIONARIES[survey.language as Language];
  const sameType = survey.rooms.filter((r) => roomType && r.roomType === roomType).length;
  const label = roomType
    ? sameType > 0 ? `${t.rooms[roomType]} ${sameType + 1}` : t.rooms[roomType]
    : t.part(survey.rooms.length + 1);

  const { room, media } = await db.$transaction(async (tx) => {
    const room = await tx.surveyRoom.create({
      data: { surveyId: survey.id, roomType: roomType ?? null, label, sortOrder: survey.rooms.length },
    });
    const media = await tx.media.create({
      data: { surveyId: survey.id, roomId: room.id, kind, contentType, storagePrefix: crypto.randomUUID() },
    });
    // The prefix needs the media id, which only exists after the insert.
    await tx.media.update({ where: { id: media.id }, data: { storagePrefix: mediaPrefix(survey.id, room.id, media.id) } });
    if (survey.status === "CREATED") {
      await tx.survey.update({ where: { id: survey.id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    }
    return { room, media };
  });

  return NextResponse.json({ roomId: room.id, mediaId: media.id, label }, { status: 201 });
}

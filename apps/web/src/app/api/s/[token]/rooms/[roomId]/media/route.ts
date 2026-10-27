import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { mediaRequestSchema, recordableSurvey } from "@/lib/customer";
import { mediaPrefix } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Start a new recording for a room. Bumps the room's revision, so anything
 * the pipeline is still doing for the previous recording becomes stale.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; roomId: string }> },
) {
  const { token, roomId } = await params;
  const found = await recordableSurvey(token);
  if ("response" in found) return found.response;
  const { survey } = found;
  const room = survey.rooms.find((r) => r.id === roomId);
  if (!room) return jsonError(404, "Room not found");
  const body = await parseBody(request, mediaRequestSchema);
  if ("response" in body) return body.response;

  const media = await db.$transaction(async (tx) => {
    const updated = await tx.surveyRoom.update({
      where: { id: room.id },
      data: { revision: { increment: 1 }, status: "UPLOADING", quality: Prisma.DbNull },
    });
    const created = await tx.media.create({
      data: {
        surveyId: survey.id,
        roomId: room.id,
        revision: updated.revision,
        kind: body.data.kind,
        contentType: body.data.contentType,
        storagePrefix: `pending-${crypto.randomUUID()}`,
      },
    });
    return tx.media.update({
      where: { id: created.id },
      data: { storagePrefix: mediaPrefix(survey.id, room.id, updated.revision, created.id) },
    });
  });

  return NextResponse.json({ mediaId: media.id, revision: media.revision }, { status: 201 });
}

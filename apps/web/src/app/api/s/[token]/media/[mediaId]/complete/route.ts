import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { completeRequestSchema, recordableSurvey } from "@/lib/customer";
import { enqueueRun } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * All chunks are uploaded. If this is still the room's latest recording, the
 * room is queued for ingest; an older recording is kept but never processed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; mediaId: string }> },
) {
  const { token, mediaId } = await params;
  const found = await recordableSurvey(token);
  if ("response" in found) return found.response;
  const media = await db.media.findFirst({
    where: { id: mediaId, surveyId: found.survey.id },
    include: { room: true },
  });
  if (!media) return jsonError(404, "Recording not found");
  const body = await parseBody(request, completeRequestSchema);
  if ("response" in body) return body.response;

  const current = media.revision === media.room.revision;
  await db.$transaction([
    db.media.update({
      where: { id: media.id },
      data: {
        status: "COMPLETE",
        chunkCount: body.data.chunkCount,
        durationMs: body.data.durationMs ?? null,
        sizeBytes: body.data.sizeBytes ?? null,
      },
    }),
    ...(current ? [db.surveyRoom.update({ where: { id: media.roomId }, data: { status: "UPLOADED" } })] : []),
  ]);
  if (current) {
    await enqueueRun({ surveyId: media.surveyId, stage: "ingest", roomId: media.roomId, roomRevision: media.revision });
  }
  return NextResponse.json({ ok: true, queued: current });
}

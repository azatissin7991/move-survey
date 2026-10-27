import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { completeRequestSchema, uploadable } from "@/lib/customer";
import { enqueueRun } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/** All chunks of a recording are uploaded: queue its segment for ingest. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; mediaId: string }> },
) {
  const { token, mediaId } = await params;
  const found = await uploadable(token);
  if ("response" in found) return found.response;
  const media = await db.media.findFirst({ where: { id: mediaId, surveyId: found.survey.id } });
  if (!media) return jsonError(404, "Recording not found");
  if (media.status === "COMPLETE") return NextResponse.json({ ok: true }); // the queue may retry
  const body = await parseBody(request, completeRequestSchema);
  if ("response" in body) return body.response;

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
    db.surveyRoom.update({ where: { id: media.roomId }, data: { status: "UPLOADED" } }),
  ]);
  await enqueueRun({ surveyId: media.surveyId, stage: "ingest", roomId: media.roomId });
  return NextResponse.json({ ok: true });
}

import { after, NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { completeRequestSchema, uploadable } from "@/lib/customer";
import { runPipeline } from "@/lib/pipeline";
import { chunkKey } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * All chunks of one stream are uploaded. Frames become Frame rows. If the
 * person already tapped Done, this may be the last upload the pipeline was
 * waiting for, so nudge it.
 */
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
  const { chunkCount, durationMs, sizeBytes, frameTimes } = body.data;

  await db.$transaction([
    db.media.update({
      where: { id: media.id },
      data: { status: "COMPLETE", chunkCount, durationMs: durationMs ?? null, sizeBytes: sizeBytes ?? null },
    }),
    ...(media.kind === "FRAMES"
      ? [
          db.frame.createMany({
            data: Array.from({ length: chunkCount }, (_, i) => ({
              surveyId: media.surveyId,
              mediaId: media.id,
              roomId: media.roomId,
              tMs: frameTimes?.[i] ?? 0,
              storageKey: chunkKey(media.storagePrefix, i),
            })),
          }),
        ]
      : []),
  ]);

  if (found.survey.status === "PROCESSING") after(() => runPipeline(media.surveyId));
  return NextResponse.json({ ok: true });
}

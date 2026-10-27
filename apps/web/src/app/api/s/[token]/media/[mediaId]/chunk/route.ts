import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { chunkRequestSchema, uploadable } from "@/lib/customer";
import { chunkKey, getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** A short-lived upload URL for one chunk of a recording. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; mediaId: string }> },
) {
  const { token, mediaId } = await params;
  const found = await uploadable(token);
  if ("response" in found) return found.response;
  const media = await db.media.findFirst({ where: { id: mediaId, surveyId: found.survey.id } });
  if (!media) return jsonError(404, "Recording not found");
  if (media.status !== "UPLOADING") return jsonError(409, "This recording is already complete");
  const body = await parseBody(request, chunkRequestSchema);
  if ("response" in body) return body.response;

  const url = await getStorage().presignPut(chunkKey(media.storagePrefix, body.data.index), media.contentType, 15 * 60);
  return NextResponse.json({ url });
}

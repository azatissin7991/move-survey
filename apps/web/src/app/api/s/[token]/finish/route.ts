import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recordable } from "@/lib/customer";
import { runPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The person tapped Done. Uploads may still be draining; the pipeline waits for them. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await recordable(token);
  if ("response" in found) return found.response;
  const { survey } = found;
  if (survey.rooms.length === 0) return jsonError(409, "Nothing has been recorded yet.");
  await db.survey.update({ where: { id: survey.id }, data: { status: "PROCESSING", finishedAt: new Date() } });
  after(() => runPipeline(survey.id));
  return NextResponse.json({ status: "PROCESSING" });
}

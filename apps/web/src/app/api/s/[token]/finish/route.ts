import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recordable } from "@/lib/customer";

export const dynamic = "force-dynamic";

/** The person tapped Done. Uploads may still be draining; that's fine. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await recordable(token);
  if ("response" in found) return found.response;
  const { survey } = found;
  if (survey.rooms.length === 0) return jsonError(409, "Nothing has been recorded yet.");
  await db.survey.update({ where: { id: survey.id }, data: { status: "PROCESSING", finishedAt: new Date() } });
  return NextResponse.json({ status: "PROCESSING" });
}

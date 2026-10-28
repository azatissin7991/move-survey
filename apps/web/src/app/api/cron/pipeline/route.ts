import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cronAuthorized } from "@/lib/api-auth";
import { runPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Every minute: continue any survey whose analysis is waiting and not leased. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const surveys = await db.survey.findMany({
    where: {
      status: "PROCESSING",
      OR: [{ run: null }, { run: { status: "RUNNING", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } }],
    },
    select: { id: true },
    orderBy: { finishedAt: "asc" },
    take: 5,
  });
  const deadline = Date.now() + 250_000;
  for (const s of surveys) {
    const left = deadline - Date.now();
    if (left < 30_000) break;
    await runPipeline(s.id, undefined, left - 20_000);
  }
  return NextResponse.json({ checked: surveys.length });
}

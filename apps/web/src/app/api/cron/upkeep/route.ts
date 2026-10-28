import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/api-auth";
import { runUpkeep } from "@/lib/upkeep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runUpkeep());
}

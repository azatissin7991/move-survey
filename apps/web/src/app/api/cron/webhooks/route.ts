import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/api-auth";
import { deliverDueWebhooks } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await deliverDueWebhooks());
}

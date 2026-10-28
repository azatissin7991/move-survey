import { NextResponse } from "next/server";
import type { Suggestions, Totals } from "@move-survey/contracts";
import { db } from "@/lib/db";
import { inventoryCsv, inventoryItems } from "@/lib/inventory";
import { reviewAllowed } from "@/lib/review";

export const dynamic = "force-dynamic";

/** CSV of the inventory as it stands, for the reviewer (approved or not). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(request.url).searchParams;
  if (!reviewAllowed({ surveyId: id, user: q.get("u") ?? "", token: q.get("t") ?? "" })) {
    return NextResponse.json({ error: "Link expired" }, { status: 403 });
  }
  const survey = await db.survey.findUnique({ where: { id }, include: { detections: true } });
  if (!survey?.totals) return NextResponse.json({ error: "Not ready" }, { status: 404 });
  const csv = inventoryCsv({
    surveyId: survey.id,
    revision: survey.revision,
    catalogVersion: survey.catalogVersion,
    items: inventoryItems(survey.detections),
    totals: survey.totals as Totals,
    suggestions: survey.suggestions as Suggestions,
  });
  return new NextResponse(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="inventory-${survey.externalRef}.csv"` },
  });
}

import { NextResponse } from "next/server";
import { authenticate, jsonError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { buildInventory, inventoryCsv } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/**
 * The approved inventory, as JSON (default) or `?format=csv`. Webhooks only
 * say "something changed"; the CRM calls this and applies the result if
 * `revision` is newer than its own.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const { id } = await params;
  const survey = await db.survey.findFirst({ where: { id, tenantId: tenant.id }, include: { detections: true } });
  if (!survey) return jsonError(404, "Survey not found");
  if (survey.status !== "APPROVED") {
    return jsonError(409, `Inventory is published once the survey is approved (now ${survey.status})`);
  }
  const inventory = buildInventory(survey);
  if (new URL(request.url).searchParams.get("format") === "csv") {
    return new NextResponse(inventoryCsv(inventory, survey.language === "ru" ? "ru" : "en"), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="inventory-${survey.externalRef}.csv"` },
    });
  }
  return NextResponse.json(inventory);
}

// Turn accepted detections into the published inventory, using the values
// frozen at finalize (or the survey's catalog version when none were frozen).

import type { Detection, Survey, SurveyRoom } from "@prisma/client";
import type { InventoryResponse, OutcomeRequest } from "@move-survey/contracts";
import type { Catalog, CatalogItem, RoomType } from "@move-survey/catalog";
import catalogJson from "@move-survey/catalog/dist/catalog.v1.json";

const catalog = catalogJson as unknown as Catalog;
const byId = new Map<string, CatalogItem>(catalog.items.map((i) => [i.id, i]));

/** What finalize stores on a detection so later catalog edits don't move it. */
export type ValueSnapshot = {
  name: { en: string; ru: string };
  cuFtEach: number;
  weightLbsEach: number;
  flags: InventoryResponse["items"][number]["flags"];
};

export function snapshotFor(catalogId: string): ValueSnapshot | null {
  const item = byId.get(catalogId);
  if (!item) return null;
  const flags: ValueSnapshot["flags"] = [];
  if (item.fragile) flags.push("fragile");
  if (item.disassembly !== "none") flags.push("disassembly");
  if (item.heavy) flags.push("heavy");
  if (item.crating) flags.push("crating");
  if (item.special) flags.push("special");
  return { name: item.name, cuFtEach: item.cuFt, weightLbsEach: item.estWeightLbs, flags };
}

export function buildInventory(
  survey: Survey & { rooms: SurveyRoom[]; detections: Detection[] },
): InventoryResponse {
  const rooms = new Map(survey.rooms.map((r) => [r.id, r]));
  const items: InventoryResponse["items"] = [];
  for (const d of survey.detections) {
    const snap =
      (d.valueSnapshot as ValueSnapshot | null) ?? (d.catalogItemId ? snapshotFor(d.catalogItemId) : null);
    if (!snap) continue; // a custom item never sized: finalize should not have accepted it
    const room = rooms.get(d.roomId);
    items.push({
      catalogId: d.catalogItemId,
      name: snap.name,
      roomType: (room?.roomType ?? "other") as RoomType,
      roomLabel: room?.label ?? "",
      quantity: d.quantity,
      cuFtEach: snap.cuFtEach,
      weightLbsEach: Math.round(snap.weightLbsEach),
      flags: snap.flags,
      notes: typeof (d.attributes as { note?: unknown })?.note === "string" ? (d.attributes as { note: string }).note : "",
    });
  }
  const isBox = (i: InventoryResponse["items"][number]) => i.catalogId?.startsWith("box-") ?? false;
  const totals = {
    cuFt: Math.round(items.reduce((s, i) => s + i.cuFtEach * i.quantity, 0) * 10) / 10,
    weightLbs: items.reduce((s, i) => s + i.weightLbsEach * i.quantity, 0),
    items: items.filter((i) => !isBox(i)).reduce((s, i) => s + i.quantity, 0),
    boxes: items.filter(isBox).reduce((s, i) => s + i.quantity, 0),
  };
  return { surveyId: survey.id, revision: survey.revision, catalogVersion: survey.catalogVersion, items, totals };
}

/** Actual loaded cu ft from a CRM outcome, or null without usable truck data. */
export function actualCuFt(o: Pick<OutcomeRequest, "trucks" | "extraTruckCuFt">): number | null {
  let total = 0;
  let any = false;
  for (const t of o.trucks) {
    if (t.capacityCuFt > 0) {
      total += (t.capacityCuFt * t.fillPct) / 100;
      any = true;
    }
  }
  if (o.extraTruckCuFt && o.extraTruckCuFt > 0) {
    total += o.extraTruckCuFt;
    any = true;
  }
  return any ? Math.round(total) : null;
}

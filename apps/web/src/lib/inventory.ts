// The published inventory: lines marked as moving, with the totals and
// suggestions saved at finalize or on approval.

import type { Detection, Survey } from "@prisma/client";
import type { InventoryItem, InventoryResponse, OutcomeRequest, Suggestions, Totals } from "@move-survey/contracts";
import type { RoomType } from "@move-survey/catalog";
import type { Snapshot } from "./estimate";

export function inventoryItems(detections: Detection[]): InventoryItem[] {
  return detections
    .filter((d) => d.moving)
    .map((d) => {
      const s = d.snapshot as Snapshot;
      return {
        catalogId: d.catalogItemId,
        name: s.name,
        roomType: d.roomType as RoomType,
        roomLabel: d.roomLabel,
        quantity: d.quantity,
        cuFtEach: s.cuFtEach,
        weightLbsEach: Math.round(s.weightLbsEach),
        flags: s.flags,
        notes: [d.estimated ? "estimated" : "", d.note].filter(Boolean).join("; "),
      };
    });
}

export function buildInventory(survey: Survey & { detections: Detection[] }): InventoryResponse {
  return {
    surveyId: survey.id,
    revision: survey.revision,
    catalogVersion: survey.catalogVersion,
    items: inventoryItems(survey.detections),
    totals: survey.totals as Totals,
    suggestions: survey.suggestions as Suggestions,
  };
}

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

/** Spreadsheet-friendly inventory: one row per line, then the totals. */
export function inventoryCsv(inv: InventoryResponse, language: "en" | "ru" = "en"): string {
  const rows: (string | number)[][] = [["Room", "Item", "Qty", "Cu ft each", "Cu ft", "Lbs each", "Flags", "Notes"]];
  for (const i of inv.items) {
    rows.push([i.roomLabel, i.name[language], i.quantity, i.cuFtEach, Math.round(i.cuFtEach * i.quantity * 10) / 10, i.weightLbsEach, i.flags.join(" "), i.notes]);
  }
  const t = inv.totals;
  rows.push([], ["Total", "", t.items + t.boxes, "", t.cuFt, t.weightLbs, "", `likely ${t.cuFtLow}–${t.cuFtHigh} cu ft`]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
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

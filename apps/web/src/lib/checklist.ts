// The crew's move-day checklist: the approved inventory with what was actually
// there. It is item-level truth for the accuracy checks (scripts/eval.ts).

import type { Detection } from "@prisma/client";
import { catalogItem, type Snapshot } from "./estimate";

export type ChecklistItem = {
  detectionId: string | null; // null: added by the crew
  catalogId: string | null;
  name: { en: string; ru: string };
  roomLabel: string;
  cuFtEach: number;
  surveyed: number; // the inventory's count
  quantity: number; // what the crew found
};
export type Checklist = { by: string; at: string; items: ChecklistItem[] };

export type ChecklistInput = {
  counts: Record<string, number>; // detection id → count found, where it differs
  added: { catalogId: string; roomLabel: string; quantity: number }[];
};

/** The saved checklist: every moving line with its count found, then the additions. */
export function buildChecklist(detections: Detection[], input: ChecklistInput, by: string, at = new Date()): Checklist {
  const items: ChecklistItem[] = detections
    .filter((d) => d.moving)
    .map((d) => {
      const s = d.snapshot as Snapshot;
      return {
        detectionId: d.id,
        catalogId: d.catalogItemId,
        name: s.name,
        roomLabel: d.roomLabel,
        cuFtEach: s.cuFtEach,
        surveyed: d.quantity,
        quantity: input.counts[d.id] ?? d.quantity,
      };
    });
  for (const a of input.added) {
    const item = catalogItem(a.catalogId);
    if (!item) continue;
    items.push({ detectionId: null, catalogId: item.id, name: item.name, roomLabel: a.roomLabel, cuFtEach: item.cuFt, surveyed: 0, quantity: a.quantity });
  }
  return { by, at: at.toISOString(), items };
}

// From the AI's draft to inventory lines, totals with a range, and crew/truck
// suggestions. Pure functions over the catalog, so the numbers are easy to
// test and to calibrate.

import type { InventoryDraft, InventoryItem, Suggestions, Totals } from "@move-survey/contracts";
import { customItemCuFt, estimateBoxes, type Catalog, type CatalogItem, type RoomType } from "@move-survey/catalog";
import catalogJson from "@move-survey/catalog/dist/catalog.v1.json";

export const catalog = catalogJson as unknown as Catalog;
const byId = new Map<string, CatalogItem>(catalog.items.map((i) => [i.id, i]));
export const catalogItem = (id: string) => byId.get(id);

/** Values frozen on a line, so later catalog edits never move a survey. */
export type Snapshot = {
  name: { en: string; ru: string };
  cuFtEach: number;
  weightLbsEach: number;
  flags: InventoryItem["flags"];
  disassemblyMin: number;
};

/** A line as the pipeline writes it (a Detection without ids and timestamps). */
export type Line = {
  roomLabel: string;
  roomType: RoomType;
  catalogItemId: string | null;
  customLabel: string | null;
  quantity: number;
  confidence: number;
  moving: boolean;
  estimated: boolean;
  frameIds: string[];
  note: string;
  snapshot: Snapshot;
};

// Size for something unrecognized and unmeasured: a mid-size piece of furniture.
const UNKNOWN_ITEM_CUFT = 10;

export function snapshotFor(item: CatalogItem): Snapshot {
  const flags: Snapshot["flags"] = [];
  if (item.fragile) flags.push("fragile");
  if (item.disassembly !== "none") flags.push("disassembly");
  if (item.heavy) flags.push("heavy");
  if (item.crating) flags.push("crating");
  if (item.special) flags.push("special");
  return {
    name: item.name,
    cuFtEach: item.cuFt,
    weightLbsEach: item.estWeightLbs,
    flags,
    disassemblyMin: item.disassembly === "required" ? (item.disassemblyMin ?? 0) : 0,
  };
}

export function customSnapshot(label: string, dims: { l: number; w: number; h: number } | null): Snapshot {
  const cuFt = dims ? customItemCuFt(dims, "irregular", catalog) : UNKNOWN_ITEM_CUFT;
  return {
    name: { en: label, ru: label },
    cuFtEach: cuFt,
    weightLbsEach: Math.round(cuFt * catalog.densityLbsPerCuFt),
    flags: [],
    disassemblyMin: 0,
  };
}

/**
 * Turn the AI's draft into lines. Frame labels ("F12") become frame ids via
 * `frameIds`. Packed boxes the camera can't see are estimated per room from
 * how full it looked, minus boxes already counted on camera.
 */
export function draftToLines(draft: InventoryDraft, frameIds: Map<string, string>): Line[] {
  const roomTypes = new Map(draft.rooms.map((r) => [r.label, r.roomType]));
  const lines: Line[] = draft.items.map((item) => {
    const known = item.catalogId ? byId.get(item.catalogId) : undefined;
    return {
      roomLabel: item.room,
      roomType: roomTypes.get(item.room) ?? "other",
      catalogItemId: known ? known.id : null,
      customLabel: known ? null : (item.customLabel ?? item.catalogId ?? "Item"),
      quantity: item.quantity,
      confidence: item.confidence,
      moving: !item.notMoving,
      estimated: false,
      frameIds: item.frameIds.map((f) => frameIds.get(f)).filter((f): f is string => !!f),
      note: item.note ?? "",
      snapshot: known ? snapshotFor(known) : customSnapshot(item.customLabel ?? item.catalogId ?? "Item", item.approxDims),
    };
  });

  for (const room of draft.rooms) {
    const counted: Record<string, number> = {};
    for (const l of lines) {
      if (l.roomLabel === room.label && l.moving && l.catalogItemId?.startsWith("box-")) {
        counted[l.catalogItemId] = (counted[l.catalogItemId] ?? 0) + l.quantity;
      }
    }
    for (const box of estimateBoxes(catalog.boxEstimates, room.roomType, room.fullness, "medium", counted)) {
      const item = byId.get(box.boxId);
      if (!item) continue;
      lines.push({
        roomLabel: room.label,
        roomType: room.roomType,
        catalogItemId: item.id,
        customLabel: null,
        quantity: box.quantity,
        confidence: 0.5,
        moving: true,
        estimated: true,
        frameIds: [],
        note: "",
        snapshot: snapshotFor(item),
      });
    }
  }
  return lines;
}

const BOX_SPREAD = 0.35; // estimated boxes: ±35%
const GAP_SPREAD = 0.05; // each unseen area adds 5% to the high end…
const MAX_GAP_SPREAD = 0.2; // …up to 20%

const round10 = (n: number) => Math.round(n / 10) * 10;
const isBox = (l: Pick<Line, "catalogItemId">) => l.catalogItemId?.startsWith("box-") ?? false;

/**
 * The ballpark. Each line's volume moves the range by how unsure the AI was
 * (1 − confidence); estimated boxes by ±35%; unseen areas push the top up.
 */
export function totalsFor(lines: Pick<Line, "catalogItemId" | "quantity" | "confidence" | "moving" | "estimated" | "snapshot">[], coverageGaps = 0): Totals {
  const moving = lines.filter((l) => l.moving);
  let cuFt = 0;
  let spread = 0;
  let weight = 0;
  for (const l of moving) {
    const v = l.snapshot.cuFtEach * l.quantity;
    cuFt += v;
    weight += l.snapshot.weightLbsEach * l.quantity;
    spread += v * (l.estimated ? BOX_SPREAD : 1 - l.confidence);
  }
  const gaps = cuFt * Math.min(MAX_GAP_SPREAD, coverageGaps * GAP_SPREAD);
  return {
    cuFt: Math.round(cuFt),
    cuFtLow: Math.max(0, round10(cuFt - spread)),
    cuFtHigh: round10(cuFt + spread + gaps),
    weightLbs: Math.round(weight),
    items: moving.filter((l) => !isBox(l)).reduce((s, l) => s + l.quantity, 0),
    boxes: moving.filter(isBox).reduce((s, l) => s + l.quantity, 0),
  };
}

const CUFT_PER_MOVER_HOUR = 40; // same rule of thumb the CRM uses
const TRUCK_CUFT = 1600; // a 26 ft truck, loaded with room to spare
const HEAVY_ITEM_HOURS = 0.25;

/** Suggested trucks, crew and labor hours for the office to apply (never automatic). */
export function suggestionsFor(lines: Pick<Line, "quantity" | "moving" | "snapshot">[], cuFt: number): Suggestions {
  const crew = cuFt < 400 ? 2 : cuFt < 1000 ? 3 : cuFt < 1800 ? 4 : 5;
  const moving = lines.filter((l) => l.moving);
  const disassemblyHours = moving.reduce((s, l) => s + l.snapshot.disassemblyMin * l.quantity, 0) / 60 / crew;
  const heavyHours = moving.filter((l) => l.snapshot.flags.includes("heavy")).reduce((s, l) => s + l.quantity, 0) * HEAVY_ITEM_HOURS;
  const hours = cuFt / (CUFT_PER_MOVER_HOUR * crew) + disassemblyHours + heavyHours;
  return {
    trucks: Math.max(1, Math.ceil(cuFt / TRUCK_CUFT)),
    crew,
    laborHours: Math.max(2, Math.round(hours * 2) / 2),
  };
}

const AUTO_APPROVE_MIN_CONFIDENCE = 0.8;
const AUTO_APPROVE_MAX_GAPS = 2;

/** Whether a survey is clear enough to skip review (when the company allows it). */
export function confidentEnough(lines: Pick<Line, "confidence" | "moving" | "estimated">[], coverageGaps: number): boolean {
  const seen = lines.filter((l) => l.moving && !l.estimated);
  if (seen.length === 0) return false;
  const mean = seen.reduce((s, l) => s + l.confidence, 0) / seen.length;
  return mean >= AUTO_APPROVE_MIN_CONFIDENCE && coverageGaps <= AUTO_APPROVE_MAX_GAPS;
}

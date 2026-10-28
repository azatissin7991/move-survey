import { describe, expect, it } from "vitest";
import type { InventoryDraft } from "@move-survey/contracts";
import { confidentEnough, draftToLines, suggestionsFor, totalsFor, type Line } from "./estimate";

const draft: InventoryDraft = {
  rooms: [
    { label: "Living room", roomType: "living_room", fullness: "sparse", coverageGaps: [] },
    { label: "Bedroom", roomType: "bedroom", fullness: "average", coverageGaps: ["closet not opened"] },
  ],
  items: [
    { catalogId: "sofa-3-seat", customLabel: null, room: "Living room", quantity: 1, confidence: 0.9, frameIds: ["F1", "F3"], notMoving: false, approxDims: null, note: null },
    { catalogId: "piano-upright", customLabel: null, room: "Living room", quantity: 1, confidence: 0.8, frameIds: ["F2"], notMoving: true, approxDims: null, note: "stays" },
    { catalogId: null, customLabel: "Massage chair", room: "Bedroom", quantity: 1, confidence: 0.6, frameIds: ["F9"], notMoving: false, approxDims: { l: 60, w: 30, h: 45 }, note: null },
    { catalogId: "box-medium-3.0", customLabel: null, room: "Bedroom", quantity: 3, confidence: 1, frameIds: ["F10"], notMoving: false, approxDims: null, note: null },
    { catalogId: "no-such-id", customLabel: null, room: "Hallway", quantity: 1, confidence: 0.5, frameIds: ["F99"], notMoving: false, approxDims: null, note: null },
  ],
};
const frames = new Map([["F1", "f-1"], ["F2", "f-2"], ["F3", "f-3"], ["F9", "f-9"], ["F10", "f-10"]]);

describe("draftToLines", () => {
  const lines = draftToLines(draft, frames);
  const byName = (n: string) => lines.find((l) => l.snapshot.name.en === n);

  it("freezes catalog values and maps frame labels to ids", () => {
    const sofa = byName("Sofa, 3-seat")!;
    expect(sofa.snapshot.cuFtEach).toBe(48);
    expect(sofa.frameIds).toEqual(["f-1", "f-3"]);
    expect(sofa.roomType).toBe("living_room");
  });

  it("keeps not-moving items, flagged", () => {
    expect(byName("Piano, upright")!.moving).toBe(false);
  });

  it("sizes custom items from their dimensions and unknown ids as custom", () => {
    // 60×30×45 in = 46.9 cu ft box × 0.95 → 44.5
    expect(byName("Massage chair")!.snapshot.cuFtEach).toBe(44.5);
    const unknown = byName("no-such-id")!;
    expect(unknown.catalogItemId).toBeNull();
    expect(unknown.roomType).toBe("other");
    expect(unknown.frameIds).toEqual([]);
  });

  it("estimates unseen boxes per room, minus the ones counted on camera", () => {
    const estimated = lines.filter((l) => l.estimated && l.roomLabel === "Bedroom");
    // average bedroom: 8 medium boxes, 3 already seen
    expect(estimated.find((l) => l.catalogItemId === "box-medium-3.0")?.quantity).toBe(5);
    expect(estimated.every((l) => l.confidence === 0.5)).toBe(true);
  });
});

const line = (cuFt: number, quantity = 1, confidence = 1, extra: Partial<Line> = {}) =>
  ({
    catalogItemId: "x",
    quantity,
    confidence,
    moving: true,
    estimated: false,
    snapshot: { name: { en: "x", ru: "x" }, cuFtEach: cuFt, weightLbsEach: cuFt * 7, flags: [], disassemblyMin: 0 },
    ...extra,
  }) as Line;

describe("totalsFor", () => {
  it("is exact when everything is certain", () => {
    expect(totalsFor([line(50), line(10, 2)])).toMatchObject({ cuFt: 70, cuFtLow: 70, cuFtHigh: 70, weightLbs: 490, items: 3 });
  });

  it("widens with doubt, estimated boxes and unseen areas", () => {
    const t = totalsFor([line(100, 1, 0.8), line(3, 10, 0.5, { catalogItemId: "box-medium-3.0", estimated: true })], 2);
    // 130 cu ft; spread 20 + 10.5; gaps +10% of 130
    expect(t).toMatchObject({ cuFt: 130, cuFtLow: 100, cuFtHigh: 170, items: 1, boxes: 10 });
  });

  it("ignores lines that aren't moving", () => {
    expect(totalsFor([line(50), line(70, 1, 1, { moving: false })]).cuFt).toBe(50);
  });
});

describe("suggestionsFor", () => {
  it("scales crew and trucks with volume and adds handling time", () => {
    expect(suggestionsFor([line(300)], 300)).toEqual({ trucks: 1, crew: 2, laborHours: 4 });
    const heavy = line(70, 1, 1, { snapshot: { name: { en: "p", ru: "p" }, cuFtEach: 70, weightLbsEach: 490, flags: ["heavy"], disassemblyMin: 0 } });
    // 1200 cu ft → crew 4, 7.5 h + 0.25 h heavy → 8
    expect(suggestionsFor([heavy], 1200)).toEqual({ trucks: 1, crew: 4, laborHours: 8 });
    expect(suggestionsFor([], 2000)).toMatchObject({ trucks: 2, crew: 5 });
  });
});

describe("confidentEnough", () => {
  it("needs high average confidence on seen items and few gaps", () => {
    expect(confidentEnough([line(1, 1, 0.9), line(1, 1, 0.8)], 0)).toBe(true);
    expect(confidentEnough([line(1, 1, 0.9), line(1, 1, 0.5)], 0)).toBe(false);
    expect(confidentEnough([line(1, 1, 0.95)], 3)).toBe(false);
    expect(confidentEnough([], 0)).toBe(false);
  });
});

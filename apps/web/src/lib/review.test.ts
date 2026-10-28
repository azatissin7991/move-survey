import { describe, expect, it } from "vitest";
import type { Detection } from "@prisma/client";
import { buildChecklist } from "./checklist";
import { clipChunks } from "./review";

describe("clipChunks", () => {
  it("takes the header chunk and a window around the moment of a recording", () => {
    expect(clipChunks(100, true, 61_000)).toEqual({ indices: [0, 26, 27, 28, 29, 30, 31, 32, 33], seekSec: 58 });
  });

  it("stays inside the recording at either end", () => {
    expect(clipChunks(10, true, 1_000).indices).toEqual([0, 1, 2, 3]);
    expect(clipChunks(10, true, 30_000).indices).toEqual([0, 5, 6, 7, 8, 9]);
  });

  it("needs a whole uploaded file", () => {
    expect(clipChunks(3, false, 40_000)).toEqual({ indices: [0, 1, 2], seekSec: 37 });
  });
});

describe("buildChecklist", () => {
  const line = (id: string, quantity: number, moving = true) =>
    ({
      id,
      catalogItemId: "dining-chair",
      roomLabel: "Dining room",
      quantity,
      moving,
      snapshot: { name: { en: "Dining chair", ru: "Стул" }, cuFtEach: 5, weightLbsEach: 35, flags: [], disassemblyMin: 0 },
    }) as unknown as Detection;

  it("keeps the inventory's counts unless the crew changed them, and adds what was missing", () => {
    const c = buildChecklist([line("a", 6), line("b", 1, false)], { counts: { a: 4 }, added: [{ catalogId: "sofa-3-seat", roomLabel: "Dining room", quantity: 1 }] }, "Ivan", new Date(0));
    expect(c.by).toBe("Ivan");
    expect(c.items.map((i) => [i.catalogId, i.surveyed, i.quantity])).toEqual([
      ["dining-chair", 6, 4],
      ["sofa-3-seat", 0, 1],
    ]);
  });

  it("ignores items that aren't in the catalog", () => {
    expect(buildChecklist([], { counts: {}, added: [{ catalogId: "nope", roomLabel: "X", quantity: 1 }] }, "Ivan").items).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { loadAndCompile, parseReferenceCsv } from "./build";
import { estimateBoxes } from "./boxes";

describe("the catalog data", () => {
  const { catalog, issues } = loadAndCompile();

  it("compiles with no errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("has every item named in both languages and sourced", () => {
    for (const item of catalog.items) {
      expect(item.name.en.length, item.id).toBeGreaterThan(0);
      expect(item.name.ru.length, item.id).toBeGreaterThan(0);
      expect(item.sources.length, item.id).toBeGreaterThan(0);
    }
  });

  it("covers the core household items", () => {
    const ids = new Set(catalog.items.map((i) => i.id));
    for (const id of ["sofa-3-seat", "mattress-queen", "dresser-small", "refrigerator-large", "box-medium-3.0", "piano-upright"]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("estimates boxes from the table", () => {
    const boxes = estimateBoxes(catalog.boxEstimates, "bedroom", "average", "large", { "box-wardrobe": 1 });
    expect(boxes).toContainEqual({ boxId: "box-medium-3.0", quantity: 11 });
    expect(boxes).toContainEqual({ boxId: "box-wardrobe", quantity: 2 });
  });
});

describe("parseReferenceCsv", () => {
  it("reads rows, skips comments and blanks", () => {
    const rows = parseReferenceCsv("catalogId,cuFt,weightLbs,ref\n# note\nsofa-3-seat,,250,\n\ndresser-small,30,,mil\n", "file.csv");
    expect(rows).toEqual([
      { catalogId: "sofa-3-seat", weightLbs: 250, ref: "file.csv" },
      { catalogId: "dresser-small", cuFt: 30, ref: "mil" },
    ]);
  });
});

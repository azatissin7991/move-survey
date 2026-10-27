import { describe, expect, it } from "vitest";
import { boundingBoxCuFt, checkCatalog, compileItem, customItemCuFt, estimatingWeight, variantForSize } from "./derive";
import { itemSourceSchema, type CatalogItem, type Settings } from "./schema";

const settings: Pick<Settings, "densityLbsPerCuFt" | "boxRatioBounds" | "referenceTolerance" | "sources" | "customLoadedFactor"> = {
  densityLbsPerCuFt: 7,
  boxRatioBounds: { boxy: [0.9, 1.9], irregular: [0.55, 1.3], soft: [0.6, 1.4], nestable: [0.25, 1.1], flat: [0.8, 3.5] },
  referenceTolerance: 0.25,
  sources: [{ id: "est-draft", kind: "estimate", title: "draft" }],
  customLoadedFactor: { boxy: 1.3, irregular: 0.95, soft: 0.9, nestable: 0.6, flat: 1.5 },
};

function item(overrides: Record<string, unknown>): CatalogItem {
  const parsed = itemSourceSchema.parse({
    id: "sofa-3-seat",
    category: "seating",
    rooms: ["living_room"],
    name: { en: "Sofa", ru: "Диван" },
    shape: "irregular",
    cuFt: 48,
    sources: [{ field: "all", ref: "est-draft" }],
    ...overrides,
  });
  return compileItem(parsed, settings);
}

describe("weights", () => {
  it("uses the density convention by default", () => {
    expect(estimatingWeight(48, 7)).toBe(336);
    const sofa = item({});
    expect(sofa.estWeightLbs).toBe(336);
    expect(sofa.weightBasis).toBe("density");
  });

  it("keeps an override with its note", () => {
    const safe = item({ id: "gun-safe", cuFt: 30, weightLbs: 650, weightNote: "steel" });
    expect(safe.estWeightLbs).toBe(650);
    expect(safe.weightBasis).toBe("override");
  });

  it("rejects an override without a note", () => {
    expect(() => item({ weightLbs: 650 })).toThrow(/weightNote/);
  });
});

describe("dimensions", () => {
  it("computes the bounding box from range midpoints", () => {
    expect(boundingBoxCuFt({ l: [18, 18], w: [18, 18], h: [16, 16] })).toBeCloseTo(3, 5);
  });

  it("prices a custom item by shape, to the half cubic foot", () => {
    // 84×36×34 in = 59.5 cu ft box; irregular factor 0.95 → 56.5
    expect(customItemCuFt({ l: 84, w: 36, h: 34 }, "irregular", settings)).toBe(56.5);
    expect(customItemCuFt({ l: 2, w: 2, h: 2 }, "boxy", settings)).toBe(0.5);
  });
});

describe("variantForSize", () => {
  const sofas = [
    item({ id: "sofa-loveseat", sizeGroup: "sofa", sizeRule: { dim: "l", max: 72 } }),
    item({ id: "sofa-3-seat", sizeGroup: "sofa", sizeRule: { dim: "l", min: 72, max: 92 } }),
    item({ id: "sofa-4-seat", sizeGroup: "sofa", sizeRule: { dim: "l", min: 92 } }),
  ];

  it("picks the variant whose range holds the measurement", () => {
    expect(variantForSize(sofas, "sofa", "l", 64)?.id).toBe("sofa-loveseat");
    expect(variantForSize(sofas, "sofa", "l", 72)?.id).toBe("sofa-3-seat");
    expect(variantForSize(sofas, "sofa", "l", 100)?.id).toBe("sofa-4-seat");
  });

  it("ignores a different dimension", () => {
    expect(variantForSize(sofas, "sofa", "w", 64)).toBeUndefined();
  });
});

describe("checkCatalog", () => {
  it("flags duplicates, unknown sources and unknown packing", () => {
    const issues = checkCatalog(
      [item({}), item({}), item({ id: "tv", sources: [{ field: "all", ref: "nope" }], packing: ["box-tv"] })],
      settings,
    );
    const messages = issues.map((i) => i.message);
    expect(messages).toContain("duplicate id");
    expect(messages).toContain('unknown source "nope"');
    expect(messages).toContain('unknown packing item "box-tv"');
  });

  it("flags overlapping size rules", () => {
    const issues = checkCatalog(
      [
        item({ id: "a", sizeGroup: "g", sizeRule: { dim: "l", max: 80 } }),
        item({ id: "b", sizeGroup: "g", sizeRule: { dim: "l", min: 72 } }),
      ],
      settings,
    );
    expect(issues.some((i) => i.level === "error" && /overlaps/.test(i.message))).toBe(true);
  });

  it("warns when cu ft is far from the bounding box", () => {
    const issues = checkCatalog([item({ dims: { l: [80, 80], w: [36, 36], h: [34, 34] }, cuFt: 10 })], settings);
    expect(issues.some((i) => i.level === "warning" && /bounding box/.test(i.message))).toBe(true);
  });

  it("warns when a reference table disagrees beyond tolerance", () => {
    const issues = checkCatalog([item({})], settings, [{ catalogId: "sofa-3-seat", weightLbs: 200, ref: "usmil" }]);
    expect(issues.some((i) => /differs 68% from usmil/.test(i.message))).toBe(true);
  });

  it("warns on an alias shared by two items", () => {
    const issues = checkCatalog(
      [item({ id: "a", aliases: { en: ["couch"] } }), item({ id: "b", aliases: { en: ["Couch"] } })],
      settings,
    );
    expect(issues.some((i) => /alias "Couch" also on a/.test(i.message))).toBe(true);
  });
});

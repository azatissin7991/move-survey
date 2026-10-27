// Pure rules that turn a hand-written item into the compiled form, plus the
// checks the build runs over the whole catalog. No file access here, so all of
// it is unit-tested.

import type { CatalogItem, Dims, ItemSource, Settings, Shape } from "./schema";

const CUBIC_INCHES_PER_FOOT = 1728;

const mid = ([lo, hi]: [number, number]) => (lo + hi) / 2;

/** Bounding box of the typical dimensions, in cubic feet. */
export function boundingBoxCuFt(dims: Dims): number {
  return (mid(dims.l) * mid(dims.w) * mid(dims.h)) / CUBIC_INCHES_PER_FOOT;
}

/** Estimating weight: the industry volume convention unless the item overrides it. */
export function estimatingWeight(cuFt: number, densityLbsPerCuFt: number): number {
  return Math.round(cuFt * densityLbsPerCuFt);
}

/**
 * Loaded cubic feet for something that is not in the catalog, from measured
 * outside dimensions in inches. Rounded to the half cubic foot.
 */
export function customItemCuFt(
  measured: { l: number; w: number; h: number },
  shape: Shape,
  settings: Pick<Settings, "customLoadedFactor">,
): number {
  const raw = (measured.l * measured.w * measured.h) / CUBIC_INCHES_PER_FOOT;
  return Math.max(0.5, Math.round(raw * settings.customLoadedFactor[shape] * 2) / 2);
}

export function compileItem(
  item: ItemSource,
  settings: Pick<Settings, "densityLbsPerCuFt">,
): CatalogItem {
  const { weightLbs, weightNote, ...rest } = item;
  return {
    ...rest,
    estWeightLbs: weightLbs ?? estimatingWeight(item.cuFt, settings.densityLbsPerCuFt),
    weightBasis: weightLbs === undefined ? "density" : "override",
    ...(weightNote ? { weightNote } : {}),
    ...(item.dims ? { boundingBoxCuFt: Math.round(boundingBoxCuFt(item.dims) * 10) / 10 } : {}),
  };
}

/** Pick the variant in a size group that a measured dimension falls into. */
export function variantForSize(
  items: CatalogItem[],
  sizeGroup: string,
  dim: "l" | "w" | "h" | "diag",
  inches: number,
): CatalogItem | undefined {
  return items.find(
    (i) =>
      i.sizeGroup === sizeGroup &&
      i.sizeRule?.dim === dim &&
      (i.sizeRule.min === undefined || inches >= i.sizeRule.min) &&
      (i.sizeRule.max === undefined || inches < i.sizeRule.max),
  );
}

export type Issue = { level: "error" | "warning"; itemId?: string; message: string };

export type ReferenceRow = { catalogId: string; cuFt?: number; weightLbs?: number; ref: string };

/** Whole-catalog checks. Errors stop the build; warnings go in the report. */
export function checkCatalog(
  items: CatalogItem[],
  settings: Pick<Settings, "boxRatioBounds" | "referenceTolerance" | "sources">,
  references: ReferenceRow[] = [],
): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const sourceIds = new Set(settings.sources.map((s) => s.id));

  for (const item of items) {
    if (ids.has(item.id)) issues.push({ level: "error", itemId: item.id, message: "duplicate id" });
    ids.add(item.id);
  }

  for (const item of items) {
    for (const s of item.sources) {
      if (!sourceIds.has(s.ref)) {
        issues.push({ level: "error", itemId: item.id, message: `unknown source "${s.ref}"` });
      }
    }
    if (item.sources.length === 0) {
      issues.push({ level: "error", itemId: item.id, message: "no source for its numbers" });
    }
    for (const p of item.packing) {
      if (!ids.has(p)) issues.push({ level: "error", itemId: item.id, message: `unknown packing item "${p}"` });
    }
    if (item.boundingBoxCuFt) {
      const [lo, hi] = settings.boxRatioBounds[item.shape];
      const ratio = item.cuFt / item.boundingBoxCuFt;
      if (ratio < lo || ratio > hi) {
        issues.push({
          level: "warning",
          itemId: item.id,
          message: `cuFt ${item.cuFt} is ${ratio.toFixed(2)}× its bounding box (${item.boundingBoxCuFt}); expected ${lo}–${hi} for ${item.shape}`,
        });
      }
    }
  }

  // Size rules inside a group must not overlap, or a measurement is ambiguous.
  const groups = new Map<string, CatalogItem[]>();
  for (const item of items) {
    if (item.sizeGroup && item.sizeRule) groups.set(item.sizeGroup, [...(groups.get(item.sizeGroup) ?? []), item]);
  }
  for (const [group, members] of groups) {
    const sorted = [...members].sort((a, b) => (a.sizeRule!.min ?? 0) - (b.sizeRule!.min ?? 0));
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1]!.sizeRule!;
      const cur = sorted[k]!.sizeRule!;
      if (prev.dim !== cur.dim) {
        issues.push({ level: "error", message: `size group "${group}" mixes dimensions` });
      } else if ((prev.max ?? Infinity) > (cur.min ?? 0)) {
        issues.push({ level: "error", message: `size group "${group}": ${sorted[k - 1]!.id} overlaps ${sorted[k]!.id}` });
      }
    }
  }

  // The same alias on two items makes matching ambiguous; worth a look, not fatal.
  for (const lang of ["en", "ru"] as const) {
    const seen = new Map<string, string>();
    for (const item of items) {
      for (const alias of item.aliases?.[lang] ?? []) {
        const key = alias.toLowerCase();
        const other = seen.get(key);
        if (other && other !== item.id) {
          issues.push({ level: "warning", itemId: item.id, message: `${lang} alias "${alias}" also on ${other}` });
        }
        seen.set(key, item.id);
      }
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  for (const ref of references) {
    const item = byId.get(ref.catalogId);
    if (!item) {
      issues.push({ level: "warning", message: `reference ${ref.ref} names unknown item "${ref.catalogId}"` });
      continue;
    }
    const compare = (label: string, ours: number, theirs: number | undefined) => {
      if (theirs === undefined) return;
      const diff = Math.abs(ours - theirs) / theirs;
      if (diff > settings.referenceTolerance) {
        issues.push({
          level: "warning",
          itemId: item.id,
          message: `${label} ${ours} differs ${(diff * 100).toFixed(0)}% from ${ref.ref} (${theirs})`,
        });
      }
    };
    compare("cuFt", item.cuFt, ref.cuFt);
    compare("weight", item.estWeightLbs, ref.weightLbs);
  }

  return issues;
}

// Shapes of the catalog as it is written by hand (data/*.yaml) and as it is
// compiled (dist/catalog.vN.json). The web app and the worker read only the
// compiled form; the source form exists so people can review it in a diff.

import { z } from "zod";

export const ROOM_TYPES = [
  "living_room",
  "family_room",
  "dining_room",
  "kitchen",
  "bedroom",
  "kids_room",
  "nursery",
  "office",
  "bathroom",
  "laundry",
  "hallway",
  "garage",
  "basement",
  "attic",
  "patio",
  "storage",
  "other",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const CATEGORIES = [
  "beds",
  "bedroom_storage",
  "seating",
  "tables",
  "storage_furniture",
  "electronics",
  "decor",
  "pianos_instruments",
  "appliances",
  "office",
  "kids",
  "outdoor",
  "garage_tools",
  "fitness",
  "misc",
  "boxes",
] as const;

// How an item's real footprint on the truck relates to its bounding box.
// Used for sanity checks and for pricing items that are not in the catalog.
export const SHAPES = ["boxy", "irregular", "soft", "nestable", "flat"] as const;
export type Shape = (typeof SHAPES)[number];

export const SPECIAL_HANDLING = [
  "piano",
  "safe",
  "pool_table",
  "aquarium",
  "appliance",
  "gym_equipment",
  "motorized",
  "artwork",
] as const;

export const SOURCE_KINDS = [
  "public_domain", // e.g. a government weight table
  "manufacturer", // spec sheets, retailer listings
  "industry_check", // published cube sheets: comparison only, never copied
  "estimate", // drafted, not yet backed by a citation
  "calibration", // derived from our own job outcomes
] as const;

const range = z
  .tuple([z.number().positive(), z.number().positive()])
  .refine(([lo, hi]) => lo <= hi, "range must be [min, max]");

/** Typical outside dimensions in inches, as [min, max] ranges. */
export const dimsSchema = z.strictObject({ l: range, w: range, h: range });
export type Dims = z.infer<typeof dimsSchema>;

const localized = z.strictObject({ en: z.string().min(1), ru: z.string().min(1) });

export const sizeRuleSchema = z
  .strictObject({
    dim: z.enum(["l", "w", "h", "diag"]),
    min: z.number().positive().optional(),
    max: z.number().positive().optional(),
  })
  .refine((r) => r.min !== undefined || r.max !== undefined, "sizeRule needs min or max");

export const sourceRefSchema = z.strictObject({
  field: z.enum(["cuFt", "weight", "dims", "all"]),
  ref: z.string().min(1),
  note: z.string().optional(),
});

export const itemSourceSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9.]+)*$/, "id must be a lowercase slug"),
    category: z.enum(CATEGORIES),
    rooms: z.array(z.enum(ROOM_TYPES)).min(1),
    name: localized,
    aliases: z
      .strictObject({ en: z.array(z.string()).optional(), ru: z.array(z.string()).optional() })
      .optional(),
    // How to tell this item apart from its neighbours in a photo.
    cues: z.string().optional(),
    dims: dimsSchema.optional(),
    shape: z.enum(SHAPES),
    // Space taken on the truck once padded and loaded.
    cuFt: z.number().positive(),
    // Only when the density rule is clearly wrong for this item; needs a note.
    weightLbs: z.number().int().positive().optional(),
    weightNote: z.string().optional(),
    sizeGroup: z.string().optional(),
    sizeRule: sizeRuleSchema.optional(),
    disassembly: z.enum(["none", "optional", "required"]).default("none"),
    disassemblyMin: z.number().int().nonnegative().optional(),
    fragile: z.boolean().default(false),
    // Real weight of 300 lb or more. Set by hand: the estimating weight below
    // is a volume convention and would flag every sofa.
    heavy: z.boolean().default(false),
    special: z.enum(SPECIAL_HANDLING).optional(),
    crating: z.boolean().default(false),
    packing: z.array(z.string()).default([]),
    sources: z.array(sourceRefSchema).default([]),
    review: z.enum(["draft", "reviewed", "signed_off"]).default("draft"),
  })
  .refine((i) => i.weightLbs === undefined || !!i.weightNote, {
    message: "weightLbs override needs a weightNote",
    path: ["weightNote"],
  })
  .refine((i) => i.sizeRule === undefined || !!i.sizeGroup, {
    message: "sizeRule needs a sizeGroup",
    path: ["sizeGroup"],
  });
export type ItemSource = z.infer<typeof itemSourceSchema>;

/** One data/items/*.yaml file. `defaultSources` applies to items that list none. */
export const itemFileSchema = z.strictObject({
  defaultSources: z.array(sourceRefSchema).default([]),
  items: z.array(z.unknown()).min(1),
});

export const sourceDefSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(SOURCE_KINDS),
  title: z.string().min(1),
  url: z.string().url().optional(),
  note: z.string().optional(),
});
export type SourceDef = z.infer<typeof sourceDefSchema>;

export const settingsSchema = z.strictObject({
  version: z.number().int().positive(),
  densityLbsPerCuFt: z.number().positive(),
  // Footprint / bounding box, for items priced from measured dimensions.
  customLoadedFactor: z.record(z.enum(SHAPES), z.number().positive()),
  // Acceptable cuFt / bounding-box ratio per shape; outside it the build warns.
  boxRatioBounds: z.record(z.enum(SHAPES), range),
  referenceTolerance: z.number().positive(),
  sources: z.array(sourceDefSchema).min(1),
});
export type Settings = z.infer<typeof settingsSchema>;

export const FULLNESS = ["sparse", "average", "full", "packed"] as const;
export type Fullness = (typeof FULLNESS)[number];
export const ROOM_SIZES = ["small", "medium", "large"] as const;
export type RoomSize = (typeof ROOM_SIZES)[number];

const boxCounts = z.record(z.string(), z.number().nonnegative());

export const boxEstimateSchema = z.strictObject({
  sizeMultiplier: z.record(z.enum(ROOM_SIZES), z.number().positive()),
  // Expected boxes for a medium room of each type at each fullness level.
  rooms: z.record(z.enum(ROOM_TYPES), z.record(z.enum(FULLNESS), boxCounts)),
  sources: z.array(sourceRefSchema).default([]),
});
export type BoxEstimates = z.infer<typeof boxEstimateSchema>;

export type CatalogItem = Omit<ItemSource, "weightLbs" | "weightNote"> & {
  estWeightLbs: number;
  weightBasis: "density" | "override";
  weightNote?: string;
  boundingBoxCuFt?: number;
};

export type Catalog = {
  version: number;
  densityLbsPerCuFt: number;
  customLoadedFactor: Settings["customLoadedFactor"];
  sources: SourceDef[];
  items: CatalogItem[];
  boxEstimates: BoxEstimates;
};

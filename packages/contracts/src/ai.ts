// What the AI stages must return. These schemas are sent to the model as the
// structured-output format (via JSON Schema) and re-validated on receipt, so
// the worker never trusts a shape it didn't ask for.

import { z } from "zod";
import { FULLNESS } from "@move-survey/catalog";

const confidence = z.number().min(0).max(1);

/** Where in the footage an item was seen. bbox is normalized [x, y, w, h]. */
export const evidenceSchema = z.object({
  frameId: z.string(),
  tMs: z.number().int().nonnegative(),
  bbox: z.array(z.number().min(0).max(1)).length(4).optional(),
});

export const approxDimsSchema = z.object({
  l: z.number().positive(),
  w: z.number().positive(),
  h: z.number().positive(),
  basis: z.string().describe("Which reference object the estimate leans on, e.g. 'door 80 in'"),
});

export const detectedItemSchema = z.object({
  catalogId: z.string().nullable().describe("Catalog item id, or null when nothing in the catalog fits"),
  customLabel: z.string().nullable().describe("Plain-English name when catalogId is null"),
  quantity: z.number().int().positive(),
  confidence,
  evidence: z.array(evidenceSchema).min(1),
  fragile: z.boolean(),
  needsDisassembly: z.boolean(),
  notGoingHint: z.boolean().describe("Narration or notes suggest it is not moving"),
  needsMeasurement: z.boolean().describe("Size decides the variant or price and couldn't be read reliably; the sizing stage takes it from here"),
  approxDims: approxDimsSchema.nullable(),
  note: z.string().nullable(),
});
export type DetectedItem = z.infer<typeof detectedItemSchema>;

/** Stage B output for one room. */
export const roomAnalysisSchema = z.object({
  items: z.array(detectedItemSchema),
  fullness: z.enum(FULLNESS),
  packedBoxesSeen: z.record(z.string(), z.number().int().nonnegative()),
  // Not asked of anyone: gaps widen the estimate's range instead.
  coverageGaps: z.array(z.string()).describe("Places not shown, e.g. 'closet not opened'"),
});
export type RoomAnalysis = z.infer<typeof roomAnalysisSchema>;

/** Stage C output: merges and drops across rooms. */
export const reconciliationSchema = z.object({
  merges: z.array(
    z.object({
      keep: z.object({ roomId: z.string(), itemIndex: z.number().int() }),
      drop: z.object({ roomId: z.string(), itemIndex: z.number().int() }),
      reason: z.string(),
    }),
  ),
  notMoving: z.array(z.object({ roomId: z.string(), itemIndex: z.number().int(), reason: z.string() })),
  warnings: z.array(z.string()),
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;

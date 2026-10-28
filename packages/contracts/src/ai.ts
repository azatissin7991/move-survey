// What the AI must return. Sent to the model as its structured-output format
// and re-validated on receipt, so the pipeline never trusts a shape it didn't
// ask for.
//
// The survey's frames are analyzed in order, a batch at a time, and every
// answer is the complete inventory so far. Carrying the list forward is what
// stops an item seen from two rooms, or twice in one walk-through, from being
// counted twice.

import { z } from "zod";
import { FULLNESS, ROOM_TYPES } from "@move-survey/catalog";

export const draftRoomSchema = z.object({
  label: z.string().describe("Short room name, unique in the home, e.g. 'Bedroom 2'"),
  roomType: z.enum(ROOM_TYPES),
  fullness: z.enum(FULLNESS).describe("How full closets, cabinets and shelves look: drives the packed-box estimate"),
  coverageGaps: z.array(z.string()).describe("Places not shown, e.g. 'closet not opened'"),
});

export const draftItemSchema = z.object({
  catalogId: z.string().nullable().describe("Catalog id, or null when nothing in the catalog fits"),
  customLabel: z.string().nullable().describe("Plain-English name when catalogId is null"),
  room: z.string().describe("label of the room it is in"),
  quantity: z.number().int().positive(),
  confidence: z.number().min(0).max(1).describe("How sure you are of the item, its variant and its count"),
  frameIds: z.array(z.string()).min(1).describe("Frames where it is clearly visible, best first"),
  notMoving: z.boolean().describe("Narration says it stays, or it is clearly a fixture"),
  approxDims: z
    .object({ l: z.number().positive(), w: z.number().positive(), h: z.number().positive() })
    .nullable()
    .describe("Outside size in inches, for items not in the catalog; null otherwise"),
  note: z.string().nullable().describe("Anything a mover should know, e.g. 'glass top', 'wall-mounted'"),
});
export type DraftItem = z.infer<typeof draftItemSchema>;

export const inventoryDraftSchema = z.object({
  rooms: z.array(draftRoomSchema),
  items: z.array(draftItemSchema),
});
export type InventoryDraft = z.infer<typeof inventoryDraftSchema>;

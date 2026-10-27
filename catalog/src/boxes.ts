// Expected packed boxes for a room, from the table in data/boxes.yaml.
// Stage E of the pipeline uses this when the video can't show what is inside
// closets and cabinets; calibration from job outcomes adjusts the table.

import type { BoxEstimates, Fullness, RoomSize, RoomType } from "./schema";

export type BoxCount = { boxId: string; quantity: number };

export function estimateBoxes(
  table: BoxEstimates,
  roomType: RoomType,
  fullness: Fullness,
  size: RoomSize = "medium",
  // Boxes the customer says are already packed and visible, which the AI has
  // counted as items, are subtracted so they aren't counted twice.
  alreadyCounted: Record<string, number> = {},
): BoxCount[] {
  const counts = table.rooms[roomType]?.[fullness] ?? {};
  const multiplier = table.sizeMultiplier[size];
  return Object.entries(counts)
    .map(([boxId, n]) => ({
      boxId,
      quantity: Math.max(0, Math.round(n * multiplier) - (alreadyCounted[boxId] ?? 0)),
    }))
    .filter((b) => b.quantity > 0);
}

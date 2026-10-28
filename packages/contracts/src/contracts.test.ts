import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSurveyRequestSchema, inventoryDraftSchema, webhookPayloadSchema } from "./index";

describe("contracts", () => {
  it("fills request defaults", () => {
    const parsed = createSurveyRequestSchema.parse({ externalRef: "q-42", customer: { name: "Ann" } });
    expect(parsed.customer.language).toBe("en");
    expect(parsed.expiresInDays).toBe(14);
    expect(parsed.move).toEqual({});
  });

  it("accepts a well-formed inventory draft", () => {
    const ok = inventoryDraftSchema.safeParse({
      rooms: [{ label: "Living room", roomType: "living_room", fullness: "average", coverageGaps: [] }],
      items: [
        {
          catalogId: "sofa-3-seat",
          customLabel: null,
          room: "Living room",
          quantity: 1,
          confidence: 0.9,
          frameIds: ["f1"],
          notMoving: false,
          approxDims: null,
          note: null,
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an item with no evidence", () => {
    const bad = inventoryDraftSchema.safeParse({
      rooms: [],
      items: [{ catalogId: "x", customLabel: null, room: "a", quantity: 1, confidence: 1, frameIds: [] }],
    });
    expect(bad.success).toBe(false);
  });

  it("exports JSON Schema", () => {
    const json = z.toJSONSchema(webhookPayloadSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toContain("revision");
  });
});

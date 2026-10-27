import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSurveyRequestSchema, roomAnalysisSchema, webhookPayloadSchema } from "./index";

describe("contracts", () => {
  it("fills request defaults", () => {
    const parsed = createSurveyRequestSchema.parse({ externalRef: "q-42", customer: { name: "Ann" } });
    expect(parsed.customer.language).toBe("en");
    expect(parsed.expiresInDays).toBe(14);
    expect(parsed.move).toEqual({});
  });

  it("accepts a well-formed room analysis", () => {
    const ok = roomAnalysisSchema.safeParse({
      items: [
        {
          catalogId: "sofa-3-seat",
          customLabel: null,
          quantity: 1,
          confidence: 0.9,
          evidence: [{ frameId: "f1", tMs: 1200 }],
          fragile: false,
          needsDisassembly: false,
          notGoingHint: false,
          needsMeasurement: false,
          approxDims: null,
          note: null,
        },
      ],
      fullness: "average",
      packedBoxesSeen: {},
      coverageGaps: [],
      questions: [],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an item with no evidence", () => {
    const bad = roomAnalysisSchema.safeParse({
      items: [{ catalogId: "x", customLabel: null, quantity: 1, confidence: 1, evidence: [] }],
      fullness: "average",
      packedBoxesSeen: {},
      coverageGaps: [],
      questions: [],
    });
    expect(bad.success).toBe(false);
  });

  it("exports JSON Schema", () => {
    const json = z.toJSONSchema(webhookPayloadSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toContain("revision");
  });
});

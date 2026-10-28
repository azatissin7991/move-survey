import { describe, expect, it } from "vitest";
import { formatSummary, score, summarize } from "./metrics";

describe("score", () => {
  const truth = [
    { catalogId: "sofa-3-seat", quantity: 1 },
    { catalogId: "dining-chair", quantity: 6 },
    { catalogId: "box-medium-3.0", quantity: 20 },
  ];

  it("matches items by id and count, leaving boxes out", () => {
    const s = score(
      [
        { catalogId: "sofa-3-seat", quantity: 1 },
        { catalogId: "dining-chair", quantity: 4 },
        { catalogId: "armchair", quantity: 1 },
        { catalogId: "box-medium-3.0", quantity: 5 },
      ],
      truth,
      { cuFt: 900, cuFtLow: 800, cuFtHigh: 1100 },
      1000,
    );
    expect(s.recall).toBeCloseTo(5 / 7);
    expect(s.precision).toBeCloseTo(5 / 6);
    expect(s.cuFtError).toBeCloseTo(-0.1);
    expect(s.inRange).toBe(true);
  });

  it("knows when the truth is outside the range", () => {
    expect(score([], truth, { cuFt: 500, cuFtLow: 450, cuFtHigh: 550 }, 1000).inRange).toBe(false);
  });
});

describe("summarize", () => {
  it("averages and counts homes within ±15%", () => {
    const s = summarize([
      { recall: 1, precision: 1, cuFtError: 0.1, inRange: true },
      { recall: 0.5, precision: 1, cuFtError: -0.3, inRange: false },
    ]);
    expect(s).toMatchObject({ n: 2, recall: 0.75, within15: 0.5, inRange: 0.5 });
    expect(s.meanError).toBeCloseTo(-0.1);
    expect(formatSummary(s)).toContain("within ±15%: 50%");
  });
});

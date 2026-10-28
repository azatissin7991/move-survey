// How close a survey came to the truth. Used by the eval runner (golden homes
// with a verified inventory) and the calibration report (job outcomes).

export type Counted = { catalogId: string; quantity: number };

export type Score = {
  recall: number; // share of true items (by count) the survey found
  precision: number; // share of surveyed items (by count) that were real
  cuFtError: number; // (estimate − truth) / truth; negative = under-estimate
  inRange: boolean; // the truth fell inside the stated range
};

const isBox = (id: string) => id.startsWith("box-");

function tally(lines: Counted[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (!isBox(l.catalogId)) m.set(l.catalogId, (m.get(l.catalogId) ?? 0) + l.quantity);
  return m;
}

/**
 * Item matching is by catalog id and count; boxes are left out of recall and
 * precision (they are estimated) but count in the volume.
 */
export function score(
  predicted: Counted[],
  truth: Counted[],
  totals: { cuFt: number; cuFtLow: number; cuFtHigh: number },
  truthCuFt: number,
): Score {
  const p = tally(predicted);
  const t = tally(truth);
  let matched = 0;
  for (const [id, n] of t) matched += Math.min(n, p.get(id) ?? 0);
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return {
    recall: sum(t) ? matched / sum(t) : 1,
    precision: sum(p) ? matched / sum(p) : 1,
    cuFtError: truthCuFt ? (totals.cuFt - truthCuFt) / truthCuFt : 0,
    inRange: truthCuFt >= totals.cuFtLow && truthCuFt <= totals.cuFtHigh,
  };
}

export type Summary = { n: number; recall: number; precision: number; meanError: number; meanAbsError: number; within15: number; inRange: number };

export function summarize(scores: Score[]): Summary {
  const n = scores.length;
  const mean = (f: (s: Score) => number) => (n ? scores.reduce((a, s) => a + f(s), 0) / n : 0);
  return {
    n,
    recall: mean((s) => s.recall),
    precision: mean((s) => s.precision),
    meanError: mean((s) => s.cuFtError),
    meanAbsError: mean((s) => Math.abs(s.cuFtError)),
    within15: mean((s) => (Math.abs(s.cuFtError) <= 0.15 ? 1 : 0)),
    inRange: mean((s) => (s.inRange ? 1 : 0)),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
export const formatSummary = (s: Summary) =>
  `${s.n} homes · recall ${pct(s.recall)} · precision ${pct(s.precision)} · volume bias ${s.meanError >= 0 ? "+" : ""}${pct(s.meanError)} · mean abs error ${pct(s.meanAbsError)} · within ±15%: ${pct(s.within15)} · truth in range: ${pct(s.inRange)}`;

// Estimates vs what was actually loaded, from the outcomes CRMs send back.
//
//   npx tsx scripts/calibration.ts [--since 2026-11-01]
//
// Truck fill is eyeballed (±10–15%), so read this as average bias across many
// jobs, not as one job's truth. Multi-trip jobs are left out (fill describes a
// single load). Use the bias to adjust the catalog and box table in a new
// catalog version.
//
// It also lists what the catalog missed: items the AI couldn't match, and
// items reviewers and crews had to add. Frequent ones are candidates for new
// catalog entries.

import type { OutcomeRequest, Totals } from "@move-survey/contracts";
import { Prisma } from "@prisma/client";
import type { Checklist } from "../src/lib/checklist";
import { db } from "../src/lib/db";
import { catalogItem } from "../src/lib/estimate";

async function main() {
  const i = process.argv.indexOf("--since");
  const since = i >= 0 ? new Date(process.argv[i + 1]!) : new Date(0);
  const outcomes = await db.outcome.findMany({
    where: { actualCuFt: { not: null }, receivedAt: { gte: since } },
    include: { survey: { select: { id: true, externalRef: true, totals: true } } },
  });

  const rows = outcomes
    .filter((o) => ((o.data as OutcomeRequest).trips ?? 1) <= 1 && o.survey.totals)
    .map((o) => {
      const t = o.survey.totals as Totals;
      const actual = o.actualCuFt!;
      return { ref: o.survey.externalRef, est: t.cuFt, low: t.cuFtLow, high: t.cuFtHigh, actual, error: (t.cuFt - actual) / actual };
    });
  await reportMisses(since);
  if (rows.length === 0) return console.log("No single-trip outcomes with truck fill yet.");

  for (const r of rows) {
    console.log(`${r.ref}: est ${r.est} (${r.low}–${r.high}) vs loaded ${r.actual} ft³ · ${(r.error * 100).toFixed(0)}%${r.actual < r.low || r.actual > r.high ? " · outside range" : ""}`);
  }
  const n = rows.length;
  const bias = rows.reduce((s, r) => s + r.error, 0) / n;
  const abs = rows.map((r) => Math.abs(r.error)).sort((a, b) => a - b);
  const inRange = rows.filter((r) => r.actual >= r.low && r.actual <= r.high).length / n;
  console.log(
    `\n${n} jobs · average bias ${bias >= 0 ? "+" : ""}${(bias * 100).toFixed(0)}% · median abs error ${(abs[Math.floor(n / 2)]! * 100).toFixed(0)}% · loaded volume inside range: ${(inRange * 100).toFixed(0)}%`,
  );
}

async function reportMisses(since: Date) {
  const counts = new Map<string, number>();
  const add = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);

  const custom = await db.detection.findMany({ where: { catalogItemId: null, createdAt: { gte: since } }, select: { customLabel: true } });
  for (const d of custom) add(`unmatched: ${(d.customLabel ?? "item").toLowerCase()}`);
  const added = await db.correction.findMany({ where: { createdAt: { gte: since } }, select: { after: true } });
  for (const c of added) {
    const id = (c.after as { added?: string } | null)?.added;
    if (id) add(`added by reviewer: ${catalogItem(id)?.name.en ?? id}`);
  }
  const checked = await db.survey.findMany({ where: { checklist: { not: Prisma.DbNull }, updatedAt: { gte: since } }, select: { checklist: true } });
  for (const s of checked) for (const i of (s.checklist as unknown as Checklist).items) if (i.surveyed === 0) add(`added by crew: ${i.name.en}`);

  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (top.length) console.log(`What the catalog or the AI missed (most frequent first):\n${top.map(([l, n]) => `  ${n} × ${l}`).join("\n")}\n`);
}

main().finally(() => db.$disconnect());

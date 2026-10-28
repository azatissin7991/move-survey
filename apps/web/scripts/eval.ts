// Score surveys against verified inventories.
//
//   npx tsx scripts/eval.ts [--split test|dev|move-day] [--rerun] [--min-in-range 0.8]
//
// Truth comes from two places:
//  - golden homes, eval/golden/*.json (see eval/golden/README.md), split dev/test;
//  - crew move-day checklists saved on surveys (split "move-day"): real jobs
//    no prompt was tuned on.
// With --rerun, each home's analysis runs again with the current prompt, model
// and catalog before scoring: the regression check for any change to those.
// Exits non-zero if --min-in-range is given and not met.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Totals } from "@move-survey/contracts";
import { Prisma } from "@prisma/client";
import type { Checklist } from "../src/lib/checklist";
import { db } from "../src/lib/db";
import { catalogItem } from "../src/lib/estimate";
import { formatSummary, score, summarize, type Counted } from "../src/lib/metrics";
import { runPipeline } from "../src/lib/pipeline";

type Golden = { surveyId: string; split: "dev" | "test"; truth: Counted[]; note?: string };
type Home = { surveyId: string; split: string; truth: Counted[]; truthCuFt: number };

const GOLDEN_DIR = path.resolve(process.cwd(), "../../eval/golden");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function rerun(surveyId: string) {
  await db.$transaction([
    db.pipelineRun.deleteMany({ where: { surveyId } }),
    db.detection.deleteMany({ where: { surveyId } }),
    db.survey.update({ where: { id: surveyId }, data: { status: "PROCESSING", totals: undefined } }),
  ]);
  for (let i = 0; i < 50; i++) {
    await runPipeline(surveyId);
    const s = await db.survey.findUniqueOrThrow({ where: { id: surveyId } });
    if (s.status !== "PROCESSING") return;
  }
}

async function main() {
  const split = arg("split");
  const minInRange = arg("min-in-range");
  const homes = (await loadHomes()).filter((g) => !split || g.split === split);
  if (homes.length === 0) return console.log(`No verified homes${split ? ` for split ${split}` : ""} (golden files in ${GOLDEN_DIR}, or crew checklists).`);

  const scores = [];
  for (const g of homes) {
    if (process.argv.includes("--rerun")) await rerun(g.surveyId);
    const survey = await db.survey.findUnique({ where: { id: g.surveyId }, include: { detections: true } });
    if (!survey?.totals) {
      console.log(`${g.surveyId}: no inventory yet, skipped`);
      continue;
    }
    const predicted = survey.detections
      .filter((d) => d.moving && d.catalogItemId)
      .map((d) => ({ catalogId: d.catalogItemId!, quantity: d.quantity }));
    const { truthCuFt } = g;
    const s = score(predicted, g.truth, survey.totals as Totals, truthCuFt);
    scores.push(s);
    const t = survey.totals as Totals;
    console.log(
      `${g.surveyId}: est ${t.cuFt} (${t.cuFtLow}–${t.cuFtHigh}) vs truth ${Math.round(truthCuFt)} ft³ · error ${(s.cuFtError * 100).toFixed(0)}% · recall ${(s.recall * 100).toFixed(0)}% · precision ${(s.precision * 100).toFixed(0)}%${s.inRange ? "" : " · OUT OF RANGE"}`,
    );
  }

  const summary = summarize(scores);
  console.log(`\n${formatSummary(summary)}`);
  if (minInRange && summary.inRange < Number(minInRange)) {
    console.error(`Truth in range ${summary.inRange.toFixed(2)} is below ${minInRange}`);
    process.exitCode = 1;
  }
}

async function loadHomes(): Promise<Home[]> {
  const golden: Home[] = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, f), "utf8")) as Golden)
    .map((g) => ({ ...g, truthCuFt: g.truth.reduce((sum, t) => sum + (catalogItem(t.catalogId)?.cuFt ?? 0) * t.quantity, 0) }));
  const goldenIds = new Set(golden.map((g) => g.surveyId));
  const checked = await db.survey.findMany({ where: { checklist: { not: Prisma.DbNull } }, select: { id: true, checklist: true } });
  const moveDay: Home[] = checked
    .filter((s) => !goldenIds.has(s.id))
    .map((s) => {
      const items = (s.checklist as unknown as Checklist).items;
      return {
        surveyId: s.id,
        split: "move-day",
        truth: items.filter((i) => i.catalogId && i.quantity > 0).map((i) => ({ catalogId: i.catalogId!, quantity: i.quantity })),
        truthCuFt: items.reduce((sum, i) => sum + i.cuFtEach * i.quantity, 0),
      };
    });
  return [...golden, ...moveDay];
}

main().finally(() => db.$disconnect());

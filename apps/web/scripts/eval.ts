// Score surveys against verified inventories ("golden homes").
//
//   npx tsx scripts/eval.ts [--split test] [--rerun] [--min-in-range 0.8]
//
// Golden files live in eval/golden/*.json (see eval/golden/README.md). With
// --rerun, each home's analysis runs again with the current prompt, model and
// catalog before scoring: the regression check for any change to those.
// Exits non-zero if --min-in-range is given and not met.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Totals } from "@move-survey/contracts";
import { db } from "../src/lib/db";
import { catalogItem } from "../src/lib/estimate";
import { formatSummary, score, summarize, type Counted } from "../src/lib/metrics";
import { runPipeline } from "../src/lib/pipeline";

type Golden = { surveyId: string; split: "dev" | "test"; truth: Counted[]; note?: string };

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
  const goldens: Golden[] = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, f), "utf8")) as Golden)
    .filter((g) => !split || g.split === split);
  if (goldens.length === 0) return console.log(`No golden homes in ${GOLDEN_DIR}${split ? ` for split ${split}` : ""}.`);

  const scores = [];
  for (const g of goldens) {
    if (process.argv.includes("--rerun")) await rerun(g.surveyId);
    const survey = await db.survey.findUnique({ where: { id: g.surveyId }, include: { detections: true } });
    if (!survey?.totals) {
      console.log(`${g.surveyId}: no inventory yet, skipped`);
      continue;
    }
    const predicted = survey.detections
      .filter((d) => d.moving && d.catalogItemId)
      .map((d) => ({ catalogId: d.catalogItemId!, quantity: d.quantity }));
    const truthCuFt = g.truth.reduce((sum, t) => sum + (catalogItem(t.catalogId)?.cuFt ?? 0) * t.quantity, 0);
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

main().finally(() => db.$disconnect());

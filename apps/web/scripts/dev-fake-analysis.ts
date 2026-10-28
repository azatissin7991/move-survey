// Run the real pipeline on a survey with a stand-in for Claude, for local
// development without an API key. Everything except the model call is real:
// leasing, batching, transcripts, finalize, boxes, range, webhooks.
//
//   npx tsx scripts/dev-fake-analysis.ts <surveyId>

import type { InventoryDraft } from "@move-survey/contracts";
import { runPipeline } from "../src/lib/pipeline";
import { getStorage } from "../src/lib/storage";
import { db } from "../src/lib/db";

async function main(surveyId: string) {
  await db.pipelineRun.updateMany({ where: { surveyId }, data: { lockedUntil: null, attempts: 0 } });

  await runPipeline(surveyId, {
    storage: getStorage(),
    transcribe: async () => "the piano stays",
    analyze: async ({ frames, draft }) => {
      const first = frames[0]!.label;
      const next: InventoryDraft = {
        rooms: [{ label: "Living room", roomType: "living_room", fullness: "average", coverageGaps: ["closet not opened"] }],
        items: [
          ...draft.items,
          ...(draft.items.length
            ? []
            : [
                { catalogId: "sofa-3-seat", customLabel: null, room: "Living room", quantity: 1, confidence: 0.9, frameIds: [first], notMoving: false, approxDims: null, note: null },
                { catalogId: "piano-upright", customLabel: null, room: "Living room", quantity: 1, confidence: 0.85, frameIds: [first], notMoving: true, approxDims: null, note: "customer says it stays" },
                { catalogId: "tv-medium", customLabel: null, room: "Living room", quantity: 1, confidence: 0.55, frameIds: [first], notMoving: false, approxDims: null, note: "wall-mounted" },
              ]),
        ],
      };
      return { draft: next, model: "fake", usage: { input: 0, output: 0 } };
    },
  });

  const survey = await db.survey.findUniqueOrThrow({ where: { id: surveyId }, include: { run: true } });
  console.log(JSON.stringify({ status: survey.status, totals: survey.totals, suggestions: survey.suggestions, run: survey.run?.status, error: survey.run?.error }, null, 2));
}

const id = process.argv[2];
if (!id) {
  console.error("Usage: tsx scripts/dev-fake-analysis.ts <surveyId>");
  process.exit(1);
}
main(id).finally(() => db.$disconnect());

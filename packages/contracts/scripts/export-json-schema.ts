// Write JSON Schema for the contracts to dist/, for the Python worker
// (datamodel-code-generator → pydantic) and for the model's output format.
//
//   npm run export-schemas -w @move-survey/contracts

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createSurveyRequestSchema,
  inventoryResponseSchema,
  outcomeRequestSchema,
  inventoryDraftSchema,
  webhookPayloadSchema,
} from "../src";

const schemas = {
  "inventory-draft": inventoryDraftSchema,
  "create-survey-request": createSurveyRequestSchema,
  "inventory-response": inventoryResponseSchema,
  "outcome-request": outcomeRequestSchema,
  "webhook-payload": webhookPayloadSchema,
};

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
mkdirSync(dist, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: "input" });
  writeFileSync(path.join(dist, `${name}.schema.json`), JSON.stringify(json, null, 2) + "\n");
}
console.log(`wrote ${Object.keys(schemas).length} schemas to dist/`);

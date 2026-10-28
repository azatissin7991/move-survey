// One batch of frames → the updated inventory draft, via Claude.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { inventoryDraftSchema, type InventoryDraft } from "@move-survey/contracts";
import { SYSTEM_PROMPT } from "./prompt";

export const MODEL = "claude-opus-5-5";

export type BatchFrame = { label: string; segment: string; tMs: number; jpeg: Uint8Array };

export type BatchInput = {
  frames: BatchFrame[];
  draft: InventoryDraft;
  transcripts: { segment: string; text: string }[];
  roomByRoom: boolean;
};

export type BatchResult = { draft: InventoryDraft; model: string; usage: Record<string, number> };

export type Analyzer = (input: BatchInput) => Promise<BatchResult>;

let client: Anthropic | undefined;

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export const analyzeWithClaude: Analyzer = async ({ frames, draft, transcripts, roomByRoom }) => {
  client ??= new Anthropic();

  const intro = [
    `Inventory so far:\n${JSON.stringify(draft)}`,
    transcripts.length ? `Narration:\n${transcripts.map((t) => `[${t.segment}] ${t.text}`).join("\n")}` : "",
    roomByRoom
      ? "Footage is recorded room by room; each frame is marked with its room."
      : "Footage is a walk-through; each frame is marked with the part of the recording it comes from.",
    `New frames (${frames.length}):`,
  ].filter(Boolean).join("\n\n");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: intro }];
  for (const f of frames) {
    content.push({ type: "text", text: `${f.label} — ${f.segment}, ${clock(f.tMs)}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(f.jpeg).toString("base64") } });
  }

  const message = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 32_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: zodOutputFormat(inventoryDraftSchema) },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    })
    .finalMessage();

  if (message.stop_reason === "refusal") throw new Error("The model declined this batch");
  if (message.stop_reason === "max_tokens") throw new Error("Inventory too long for one answer");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    draft: inventoryDraftSchema.parse(JSON.parse(text)),
    model: message.model,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
    },
  };
};

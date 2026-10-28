// Narration → text, so "the piano stays" reaches the model. Claude doesn't
// take audio, so this uses Gemini, as the CRM does for call recordings.
// Without GEMINI_API_KEY narration is skipped and the survey still works.

export type Transcriber = (audio: Uint8Array, contentType: string) => Promise<string>;

const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // inline limit; ~30 min of narration at 64 kbps

export const transcribeWithGemini: Transcriber = async (audio, contentType) => {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) return "";
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: "Transcribe the speech in this recording word for word, in the language spoken. Return only the transcript; return nothing if there is no speech." },
            { inline_data: { mime_type: contentType, data: Buffer.from(audio).toString("base64") } },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Transcription failed: HTTP ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
};

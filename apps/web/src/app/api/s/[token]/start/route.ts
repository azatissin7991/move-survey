import { NextResponse } from "next/server";
import { parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recordable, startRequestSchema } from "@/lib/customer";
import { enqueueWebhook } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** The person tapped Start: remember language, consent and the packing chip. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await recordable(token);
  if ("response" in found) return found.response;
  const { survey } = found;
  const body = await parseBody(request, startRequestSchema);
  if ("response" in body) return body.response;

  const first = survey.status === "CREATED";
  await db.$transaction(async (tx) => {
    const updated = await tx.survey.update({
      where: { id: survey.id },
      data: {
        language: body.data.language,
        consentMedia: body.data.consentMedia,
        answers: { packingSelf: body.data.packingSelf },
        ...(first ? { status: "IN_PROGRESS", startedAt: new Date() } : {}),
      },
    });
    if (first) await enqueueWebhook(tx, updated, "survey.started");
  });
  return NextResponse.json({ ok: true });
}

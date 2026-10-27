// Webhook outbox. Writes happen inside the same transaction as the state
// change that caused them; the cron route delivers them with backoff.

import type { Prisma } from "@prisma/client";
import type { WebhookPayload } from "@move-survey/contracts";
import { db } from "./db";
import { signPayload } from "./crypto";

export const MAX_ATTEMPTS = 8;

/** Minutes to wait before attempt n+1: 1, 2, 4, 8 … capped at 6 h. */
export function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1), 360);
}

export async function enqueueWebhook(
  tx: Prisma.TransactionClient,
  survey: { id: string; tenantId: string; externalRef: string; revision: number },
  event: WebhookPayload["event"],
): Promise<void> {
  const payload: WebhookPayload = {
    event,
    surveyId: survey.id,
    externalRef: survey.externalRef,
    revision: survey.revision,
    occurredAt: new Date().toISOString(),
  };
  await tx.webhookDelivery.create({ data: { tenantId: survey.tenantId, event, payload } });
}

/** Deliver due webhooks. Returns counts for the cron log. */
export async function deliverDueWebhooks(limit = 25, fetchImpl: typeof fetch = fetch) {
  const due = await db.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    include: { tenant: { select: { webhookUrl: true, webhookSecret: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });

  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    const attempts = d.attempts + 1;
    if (!d.tenant.webhookUrl) {
      // Nowhere to send; park it so it doesn't spin. The CRM can still poll.
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "FAILED", attempts, lastError: "Tenant has no webhook URL" },
      });
      failed++;
      continue;
    }
    const body = JSON.stringify(d.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    let error = "";
    try {
      const res = await fetchImpl(d.tenant.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-survey-timestamp": String(timestamp),
          "x-survey-signature": signPayload(d.tenant.webhookSecret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (!error) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "DELIVERED", attempts, deliveredAt: new Date(), lastError: "" },
      });
      delivered++;
    } else {
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: giveUp ? "FAILED" : "PENDING",
          attempts,
          lastError: error.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + backoffMinutes(attempts) * 60_000),
        },
      });
      failed++;
    }
  }
  return { delivered, failed, checked: due.length };
}

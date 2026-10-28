// Hourly housekeeping:
//  - a recording nobody finished (no Done for 6 h) is processed as it is;
//  - links that expired unused are closed;
//  - media past the company's retention window is deleted: video and narration
//    always, the stills too unless the customer allowed keeping them;
//  - old rate-limit counters are pruned.

import { db } from "./db";
import { getStorage, type Storage } from "./storage";
import { tenantSettings } from "./tenant";

const ABANDONED_MS = 6 * 60 * 60_000;
const MEDIA_PER_RUN = 100;

export async function runUpkeep(now = new Date(), storage: Storage = getStorage()) {
  const abandoned = await db.survey.updateMany({
    where: { status: "IN_PROGRESS", rooms: { some: {}, every: { createdAt: { lte: new Date(now.getTime() - ABANDONED_MS) } } } },
    data: { status: "PROCESSING", finishedAt: now },
  });
  const expired = await db.survey.updateMany({
    where: { status: { in: ["CREATED", "IN_PROGRESS"] }, expiresAt: { lt: now }, rooms: { none: {} } },
    data: { status: "EXPIRED" },
  });

  let deleted = 0;
  for (const tenant of await db.tenant.findMany({ select: { id: true, settings: true } })) {
    const cutoff = new Date(now.getTime() - tenantSettings(tenant.settings).retentionDays * 86_400_000);
    const media = await db.media.findMany({
      where: {
        status: { not: "DELETED" },
        survey: { tenantId: tenant.id, createdAt: { lt: cutoff } },
        OR: [{ kind: { not: "FRAMES" } }, { survey: { consentMedia: false } }],
      },
      take: MEDIA_PER_RUN - deleted,
    });
    for (const m of media) {
      await storage.deletePrefix(m.storagePrefix);
      await db.$transaction([
        db.frame.deleteMany({ where: { mediaId: m.id } }),
        db.media.update({ where: { id: m.id }, data: { status: "DELETED" } }),
      ]);
      deleted++;
    }
    if (deleted >= MEDIA_PER_RUN) break;
  }

  const pruned = await db.rateLimit.deleteMany({ where: { window: { lt: new Date(now.getTime() - 60 * 60_000) } } });
  return { abandoned: abandoned.count, expired: expired.count, mediaDeleted: deleted, rateLimitsPruned: pruned.count };
}

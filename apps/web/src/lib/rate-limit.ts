// Per-minute request caps for the public survey links, counted in Postgres so
// they hold across serverless instances. Old windows are pruned by the upkeep cron.

import { db } from "./db";

/** Counts this request; true once `key` has made more than `limit` this minute. */
export async function rateLimited(key: string, limit: number): Promise<boolean> {
  const window = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "window", "count") VALUES (${key}, ${window}, 1)
    ON CONFLICT ("key", "window") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  return (row?.count ?? 0) > limit;
}

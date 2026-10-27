// API v1 authentication and JSON helpers for route handlers.

import { NextResponse } from "next/server";
import type { z } from "zod";
import { db } from "./db";
import { apiKeyMatches, apiKeyPrefix } from "./crypto";

export type ApiTenant = { id: string; name: string; webhookUrl: string };

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ error, ...(details ? { details } : {}) }, { status });
}

/** The tenant behind `Authorization: Bearer msk_...`, or null. */
export async function authenticate(request: Request): Promise<ApiTenant | null> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const prefix = apiKeyPrefix(key);
  if (!prefix) return null;
  const row = await db.apiKey.findUnique({
    where: { prefix },
    include: { tenant: { select: { id: true, name: true, webhookUrl: true } } },
  });
  if (!row || row.revokedAt || !apiKeyMatches(key, row.hash)) return null;
  // Best effort; a failed timestamp update must not fail the request.
  db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return row.tenant;
}

/** Parse a JSON body against a schema; returns the data or an error response. */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: jsonError(400, "Body must be JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: jsonError(
        422,
        "Invalid request",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      ),
    };
  }
  return { data: parsed.data };
}

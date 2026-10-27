// Tokens, API keys and webhook signatures. Node crypto only.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Unguessable URL token (customer links, dev upload URLs). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------- API keys: msk_<prefix>_<secret> ----------

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString("hex");
  const key = `msk_${prefix}_${randomBytes(24).toString("base64url")}`;
  return { key, prefix, hash: sha256(key) };
}

/** Split a presented key into its lookup prefix, or null if it isn't one of ours. */
export function apiKeyPrefix(key: string): string | null {
  const m = /^msk_([0-9a-f]{12})_[A-Za-z0-9_-]{20,}$/.exec(key);
  return m ? m[1]! : null;
}

export function apiKeyMatches(key: string, storedHash: string): boolean {
  return safeEqualHex(sha256(key), storedHash);
}

// ---------- Webhook / callback signatures ----------

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** HMAC-SHA256 over `${timestamp}.${body}`, hex. */
export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  return safeEqualHex(signPayload(secret, timestamp, body), signature);
}

// ---------- Short-lived signed values (dev upload URLs) ----------

export function signValue(secret: string, value: string, expiresAt: number): string {
  return `${expiresAt}.${createHmac("sha256", secret).update(`${expiresAt}.${value}`).digest("base64url")}`;
}

export function verifySignedValue(secret: string, value: string, token: string, nowMs = Date.now()): boolean {
  const [exp, mac] = token.split(".");
  const expiresAt = Number(exp);
  if (!mac || !Number.isFinite(expiresAt) || expiresAt < nowMs) return false;
  const expected = createHmac("sha256", secret).update(`${expiresAt}.${value}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

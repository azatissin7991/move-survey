import { describe, expect, it } from "vitest";
import {
  apiKeyMatches,
  apiKeyPrefix,
  generateApiKey,
  signPayload,
  signValue,
  verifySignature,
  verifySignedValue,
} from "./crypto";
import { canRecord, canTransition, canUpload } from "./state";
import { tenantSettings } from "./customer";
import { backoffMinutes } from "./webhooks";
import { actualCuFt } from "./inventory";
import { chunkKey, isValidKey, mediaPrefix } from "./storage";

describe("state", () => {
  it("allows the main path, auto-approve and reopening", () => {
    expect(canTransition("CREATED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "READY_FOR_REVIEW")).toBe(true);
  });

  it("refuses leaving cancelled or approving unfinished recordings", () => {
    expect(canTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("IN_PROGRESS", "APPROVED")).toBe(false);
  });

  it("takes recordings until Done, uploads until processing ends", () => {
    expect(canRecord("IN_PROGRESS")).toBe(true);
    expect(canRecord("PROCESSING")).toBe(false);
    expect(canUpload("PROCESSING")).toBe(true);
    expect(canUpload("APPROVED")).toBe(false);
  });
});

describe("tenant settings", () => {
  it("defaults to a walk-through without auto-approve, and ignores junk", () => {
    expect(tenantSettings({})).toEqual({ captureMode: "walkthrough", autoApprove: false });
    expect(tenantSettings(null)).toEqual({ captureMode: "walkthrough", autoApprove: false });
    expect(tenantSettings({ captureMode: "rooms", autoApprove: true })).toEqual({ captureMode: "rooms", autoApprove: true });
    expect(tenantSettings({ captureMode: "nonsense", autoApprove: "yes" })).toEqual({ captureMode: "walkthrough", autoApprove: false });
  });
});

describe("crypto", () => {
  it("issues API keys that verify and expose their prefix", () => {
    const { key, prefix, hash } = generateApiKey();
    expect(apiKeyPrefix(key)).toBe(prefix);
    expect(apiKeyMatches(key, hash)).toBe(true);
    expect(apiKeyMatches(key + "x", hash)).toBe(false);
    expect(apiKeyPrefix("Bearer nonsense")).toBeNull();
  });

  it("verifies webhook signatures within the time window only", () => {
    const now = 1_800_000_000;
    const sig = signPayload("s3cret", now, '{"a":1}');
    expect(verifySignature("s3cret", now, '{"a":1}', sig, now + 10)).toBe(true);
    expect(verifySignature("s3cret", now, '{"a":2}', sig, now + 10)).toBe(false);
    expect(verifySignature("other", now, '{"a":1}', sig, now + 10)).toBe(false);
    expect(verifySignature("s3cret", now, '{"a":1}', sig, now + 301)).toBe(false);
    expect(verifySignature("s3cret", now, '{"a":1}', "zz", now)).toBe(false);
  });

  it("expires signed values", () => {
    const token = signValue("k", "put:a", 2_000);
    expect(verifySignedValue("k", "put:a", token, 1_000)).toBe(true);
    expect(verifySignedValue("k", "get:a", token, 1_000)).toBe(false);
    expect(verifySignedValue("k", "put:a", token, 3_000)).toBe(false);
  });
});

describe("storage keys", () => {
  it("lays chunks out under the survey and validates them", () => {
    const key = chunkKey(mediaPrefix("s1", "r1", "m1"), 7);
    expect(key).toBe("surveys/s1/rooms/r1/m1/chunk-00007");
    expect(isValidKey(key)).toBe(true);
    expect(isValidKey("surveys/../etc/passwd")).toBe(false);
  });
});

describe("webhooks", () => {
  it("backs off exponentially, capped at 6 hours", () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([1, 2, 4, 8]);
    expect(backoffMinutes(20)).toBe(360);
  });
});

describe("inventory", () => {
  it("computes actual cu ft from truck fill", () => {
    expect(actualCuFt({ trucks: [{ capacityCuFt: 1700, fillPct: 50 }], extraTruckCuFt: 300 })).toBe(1150);
    expect(actualCuFt({ trucks: [{ capacityCuFt: 0, fillPct: 50 }], extraTruckCuFt: null })).toBeNull();
  });
});

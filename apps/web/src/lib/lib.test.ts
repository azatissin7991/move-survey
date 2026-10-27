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
import { acceptsStageResult, assertTransition, canTransition, readyToReconcile, roomsMissingFootage } from "./state";
import { backoffMinutes } from "./webhooks";
import { actualCuFt, snapshotFor } from "./inventory";
import { chunkKey, isValidKey, mediaPrefix } from "./storage";

describe("state", () => {
  it("allows the main path and re-opening for footage", () => {
    expect(canTransition("CREATED", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "PROCESSING")).toBe(true);
    expect(canTransition("READY_FOR_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "IN_PROGRESS")).toBe(true);
  });

  it("refuses skipping review or leaving cancelled", () => {
    expect(canTransition("PROCESSING", "APPROVED")).toBe(false);
    expect(canTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
    expect(() => assertTransition("CREATED", "APPROVED")).toThrow(/CREATED to APPROVED/);
  });

  it("drops stage results from an older recording", () => {
    expect(acceptsStageResult(3, 3)).toBe(true);
    expect(acceptsStageResult(3, 2)).toBe(false);
  });

  it("reconciles once rooms settle and one has footage", () => {
    expect(readyToReconcile([{ status: "DONE" }, { status: "SKIPPED" }])).toBe(true);
    expect(readyToReconcile([{ status: "DONE" }, { status: "PROCESSING" }])).toBe(false);
    expect(readyToReconcile([{ status: "FAILED" }, { status: "SKIPPED" }])).toBe(false);
    expect(readyToReconcile([])).toBe(false);
    expect(roomsMissingFootage([{ status: "PENDING" }, { status: "NEEDS_RETAKE" }, { status: "DONE" }])).toBe(2);
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
    const key = chunkKey(mediaPrefix("s1", "r1", 2, "m1"), 7);
    expect(key).toBe("surveys/s1/rooms/r1/r2/m1/chunk-00007");
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
  it("snapshots catalog values with flags", () => {
    const piano = snapshotFor("piano-upright");
    expect(piano?.cuFtEach).toBe(70);
    expect(piano?.flags).toEqual(expect.arrayContaining(["heavy", "special"]));
    expect(snapshotFor("no-such-item")).toBeNull();
  });

  it("computes actual cu ft from truck fill", () => {
    expect(actualCuFt({ trucks: [{ capacityCuFt: 1700, fillPct: 50 }], extraTruckCuFt: 300 })).toBe(1150);
    expect(actualCuFt({ trucks: [{ capacityCuFt: 0, fillPct: 50 }], extraTruckCuFt: null })).toBeNull();
  });
});

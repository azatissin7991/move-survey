// Object storage behind one interface. Production uses Cloudflare R2 (S3 API)
// with presigned PUTs, so video never passes through our functions. Local dev
// writes files under .data/storage via a signed dev route that mimics a
// presigned URL.
//
// Keys are laid out per survey so retention can delete a whole survey prefix:
//   surveys/<surveyId>/rooms/<roomId>/<mediaId>/chunk-00000

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { signValue, verifySignedValue } from "./crypto";

export interface Storage {
  /** URL the browser PUTs one object to, valid for `ttlSeconds`. */
  presignPut(key: string, contentType: string, ttlSeconds: number): Promise<string>;
  /** Short-lived URL to read one object (review screen). */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  /** The object's bytes (pipeline). */
  get(key: string): Promise<Uint8Array>;
}

export function mediaPrefix(surveyId: string, roomId: string, mediaId: string): string {
  return `surveys/${surveyId}/rooms/${roomId}/${mediaId}`;
}

export function chunkKey(prefix: string, index: number): string {
  return `${prefix}/chunk-${String(index).padStart(5, "0")}`;
}

const KEY_PATTERN = /^surveys\/[A-Za-z0-9]+\/rooms\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/chunk-\d{5}$/;
export const isValidKey = (key: string) => KEY_PATTERN.test(key);

// ---------- local (dev) ----------

const LOCAL_ROOT = path.join(process.cwd(), ".data", "storage");

function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  return secret;
}

class LocalStorage implements Storage {
  async presignPut(key: string, _contentType: string, ttlSeconds: number) {
    const token = signValue(appSecret(), `put:${key}`, Date.now() + ttlSeconds * 1000);
    return `${process.env.APP_URL ?? ""}/api/dev-storage?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  }
  async presignGet(key: string, ttlSeconds: number) {
    const token = signValue(appSecret(), `get:${key}`, Date.now() + ttlSeconds * 1000);
    return `${process.env.APP_URL ?? ""}/api/dev-storage?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  }
  async get(key: string) {
    return new Uint8Array(await readFile(path.join(LOCAL_ROOT, key)));
  }
}

/** For the dev route: check the signed URL and read or write the file. */
export const localStorageFiles = {
  verify(mode: "put" | "get", key: string, token: string): boolean {
    return isValidKey(key) && verifySignedValue(appSecret(), `${mode}:${key}`, token);
  },
  async write(key: string, data: Uint8Array) {
    const file = path.join(LOCAL_ROOT, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },
  read(key: string) {
    return readFile(path.join(LOCAL_ROOT, key));
  },
};

// ---------- R2 ----------

class R2Storage implements Storage {
  private client: S3Client;
  private bucket: string;
  constructor() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
      throw new Error("R2 storage needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET");
    }
    this.bucket = R2_BUCKET;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
  }
  presignPut(key: string, contentType: string, ttlSeconds: number) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), {
      expiresIn: ttlSeconds,
    });
  }
  presignGet(key: string, ttlSeconds: number) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body!.transformToByteArray();
  }
}

let storage: Storage | undefined;
export function getStorage(): Storage {
  storage ??= process.env.STORAGE_DRIVER === "r2" ? new R2Storage() : new LocalStorage();
  return storage;
}

// Recording chunks go to IndexedDB first and upload from there, so nothing is
// lost when iOS suspends the page, the network drops, or the tab reloads.
// When a recording's last chunk is uploaded, the queue tells the server it is
// complete. Everything here runs in the browser.

const DB_NAME = "move-survey";
const DB_VERSION = 1;

type ChunkRow = { mediaId: string; index: number; token: string; blob: Blob };
// `times` holds each frame's position in the recording, for FRAMES media.
type MediaRow = { mediaId: string; token: string; total: number | null; durationMs: number; sizeBytes: number; times: number[] };

let dbPromise: Promise<IDBDatabase> | undefined;
function openDb(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: ["mediaId", "index"] });
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "mediaId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `HTTP ${res.status}`), { status: res.status });
  return data as T;
}

type Listener = (pending: number) => void;

/** A 4xx other than timeout / rate limit won't succeed on retry: drop the item. */
function permanent(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

class UploadQueue {
  private running = false;
  private listeners = new Set<Listener>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.kick());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.kick();
      });
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    this.pendingCount().then(fn).catch(() => {});
    return () => this.listeners.delete(fn);
  }

  private async notify() {
    const n = await this.pendingCount();
    for (const fn of this.listeners) fn(n);
  }

  pendingCount(): Promise<number> {
    return tx<number>("chunks", "readonly", (s) => s.count());
  }

  /** A new recording: remember it so a reload can still finish it. */
  async beginMedia(token: string, mediaId: string) {
    await tx("media", "readwrite", (s) => s.put({ mediaId, token, total: null, durationMs: 0, sizeBytes: 0, times: [] } satisfies MediaRow));
  }

  async addChunk(token: string, mediaId: string, index: number, blob: Blob, tMs?: number) {
    if (tMs !== undefined) {
      const row = await tx<MediaRow | undefined>("media", "readonly", (s) => s.get(mediaId));
      if (row) await tx("media", "readwrite", (s) => s.put({ ...row, times: [...row.times, tMs] }));
    }
    await tx("chunks", "readwrite", (s) => s.put({ mediaId, index, token, blob } satisfies ChunkRow));
    await this.notify();
    this.kick();
  }

  /** The recording ended: once its chunks are up, mark it complete. */
  async endMedia(mediaId: string, total: number, durationMs: number, sizeBytes: number) {
    const row = await tx<MediaRow | undefined>("media", "readonly", (s) => s.get(mediaId));
    if (!row) return;
    await tx("media", "readwrite", (s) => s.put({ ...row, total, durationMs, sizeBytes }));
    this.kick();
  }

  kick() {
    if (this.running) return;
    this.running = true;
    this.drain()
      .catch(() => {
        // Retry later; chunks stay safely in IndexedDB.
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.kick(), 5_000);
      })
      .finally(() => {
        this.running = false;
        this.notify().catch(() => {});
      });
  }

  private async drain() {
    for (;;) {
      const chunk = await tx<IDBCursorWithValue | null>("chunks", "readonly", (s) => s.openCursor()).then(
        (c) => (c ? (c.value as ChunkRow) : null),
      );
      if (!chunk) break;
      try {
        const { url } = await postJson<{ url: string }>(`/api/s/${chunk.token}/media/${chunk.mediaId}/chunk`, {
          index: chunk.index,
        });
        const put = await fetch(url, { method: "PUT", body: chunk.blob, headers: { "content-type": chunk.blob.type || "application/octet-stream" } });
        if (!put.ok) throw Object.assign(new Error(`upload HTTP ${put.status}`), { status: put.status });
      } catch (e) {
        // A recording the server no longer accepts (replaced, survey closed) is dropped.
        if (!permanent(e)) throw e;
      }
      await tx("chunks", "readwrite", (s) => s.delete([chunk.mediaId, chunk.index]));
      await this.notify();
    }
    await this.completeFinished();
  }

  private async completeFinished() {
    const all = await tx<MediaRow[]>("media", "readonly", (s) => s.getAll());
    for (const m of all) {
      if (m.total === null) continue;
      try {
        await postJson(`/api/s/${m.token}/media/${m.mediaId}/complete`, {
          chunkCount: m.total,
          durationMs: Math.round(m.durationMs),
          sizeBytes: m.sizeBytes,
          ...(m.times.length ? { frameTimes: m.times } : {}),
        });
      } catch (e) {
        if (!permanent(e)) throw e;
      }
      await tx("media", "readwrite", (s) => s.delete(m.mediaId));
    }
  }
}

let queue: UploadQueue | undefined;
export function uploadQueue(): UploadQueue {
  queue ??= new UploadQueue();
  return queue;
}

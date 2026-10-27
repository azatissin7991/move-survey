// Local stand-in for presigned R2 URLs. Refuses to run with any other driver.

import { NextResponse } from "next/server";
import { localStorageFiles } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_CHUNK_BYTES = 20 * 1024 * 1024;

function guard(request: Request, mode: "put" | "get") {
  if (process.env.STORAGE_DRIVER === "r2") return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!localStorageFiles.verify(mode, key, token)) {
    return { error: NextResponse.json({ error: "Bad or expired signature" }, { status: 403 }) };
  }
  return { key };
}

export async function PUT(request: Request) {
  const g = guard(request, "put");
  if ("error" in g) return g.error;
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Chunk size out of range" }, { status: 413 });
  }
  await localStorageFiles.write(g.key, data);
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: Request) {
  const g = guard(request, "get");
  if ("error" in g) return g.error;
  try {
    const data = await localStorageFiles.read(g.key);
    return new NextResponse(new Uint8Array(data), { headers: { "content-type": "application/octet-stream" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

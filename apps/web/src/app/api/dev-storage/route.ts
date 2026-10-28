// Local stand-in for presigned R2 URLs. Refuses to run with any other driver.

import { NextResponse } from "next/server";
import { localStorageFiles } from "@/lib/storage";

export const dynamic = "force-dynamic";

function guard(request: Request, mode: "put" | "get") {
  if (process.env.STORAGE_DRIVER === "r2") return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const token = url.searchParams.get("token") ?? "";
  // Uploads are signed for an exact size, like R2's signed Content-Length.
  const size = Number(url.searchParams.get("size"));
  const signed = mode === "put" ? `put:${key}:${size}` : `get:${key}`;
  if (!localStorageFiles.verify(signed, key, token)) {
    return { error: NextResponse.json({ error: "Bad or expired signature" }, { status: 403 }) };
  }
  return { key, size };
}

export async function PUT(request: Request) {
  const g = guard(request, "put");
  if ("error" in g) return g.error;
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength !== g.size) return NextResponse.json({ error: "Size doesn't match the signed size" }, { status: 403 });
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

"use client";

// Full-size evidence still, with the video around that moment on request. The
// clip's chunks are fetched straight from storage and joined in the browser.

import { useEffect, useState } from "react";
import type { ReviewAuth } from "@/lib/review";
import { videoClip } from "@/app/review/[id]/actions";

export type Evidence = { thumb: string; frameId: string };

export function EvidenceViewer({ auth, evidence, onClose }: { auth: ReviewAuth; evidence: Evidence; onClose: () => void }) {
  const [video, setVideo] = useState<{ src: string; seekSec: number } | null>(null);
  const [state, setState] = useState<"still" | "loading" | "none">("still");

  useEffect(() => () => (video ? URL.revokeObjectURL(video.src) : undefined), [video]);

  async function play() {
    setState("loading");
    try {
      const clip = await videoClip(auth, evidence.frameId);
      if (!clip) return setState("none");
      const parts = await Promise.all(clip.urls.map((u) => fetch(u).then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))));
      setVideo({ src: URL.createObjectURL(new Blob(parts, { type: clip.contentType })), seekSec: clip.seekSec });
    } catch {
      setState("none");
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-4" onClick={onClose}>
      <div className="max-h-[80vh] max-w-full" onClick={(e) => e.stopPropagation()}>
        {video ? (
          <video
            src={video.src}
            controls
            autoPlay
            muted
            playsInline
            className="max-h-[80vh] max-w-full rounded-lg"
            onLoadedMetadata={(e) => (e.currentTarget.currentTime = video.seekSec)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={evidence.thumb} alt="" className="max-h-[80vh] max-w-full rounded-lg" />
        )}
      </div>
      <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
        {!video && (
          <button type="button" disabled={state !== "still"} onClick={play} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">
            {state === "loading" ? "Loading video…" : state === "none" ? "No video for this part" : "▶ Play video here"}
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold text-white">Close</button>
      </div>
    </div>
  );
}

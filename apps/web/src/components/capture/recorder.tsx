"use client";

// One recording screen for the whole survey. A walk-through is a single
// recording; "Next room" just starts a new segment so rooms are easier to
// tell apart. Room-by-room mode asks which room before each segment. Every
// segment is a MediaRecorder emitting 2 s chunks into the upload queue.

import { useEffect, useRef, useState } from "react";
import type { RoomType } from "@move-survey/catalog";
import type { CaptureMode } from "@move-survey/contracts";
import type { Dict } from "@/lib/i18n";
import { postJson, uploadQueue } from "./upload-queue";

const TIMESLICE_MS = 2_000;
const FILE_CHUNK_BYTES = 8 * 1024 * 1024;
const MIME_CANDIDATES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];

type Phase = "ready" | "picking" | "recording" | "paused" | "error";
type Segment = { mediaId: string; index: number; bytes: number; startedAt: number };

const pickMime = () => MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;

export function Recorder({ token, mode, t, onDone }: { token: string; mode: CaptureMode; t: Dict; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentRef = useRef<Segment | null>(null);
  const stoppedRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [label, setLabel] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [nudge, setNudge] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true, // narration: "this stays", "closet is full of boxes"
      })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => !cancelled && setPhase("error"));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  // Once a second while recording: timer, and nudges for darkness and fast panning.
  useEffect(() => {
    if (phase !== "recording") return;
    const canvas = Object.assign(document.createElement("canvas"), { width: 32, height: 18 });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let previous: Float32Array | null = null;
    let dark = 0;
    let fast = 0;
    const id = setInterval(() => {
      setSeconds((s) => s + 1);
      if (!ctx || !videoRef.current) return;
      ctx.drawImage(videoRef.current, 0, 0, 32, 18);
      const px = ctx.getImageData(0, 0, 32, 18).data;
      const luma = new Float32Array(px.length / 4);
      for (let i = 0; i < luma.length; i++) luma[i] = 0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!;
      const mean = luma.reduce((a, b) => a + b, 0) / luma.length;
      const change = previous ? luma.reduce((a, v, i) => a + Math.abs(v - previous![i]!), 0) / luma.length : 0;
      previous = luma;
      dark = mean < 45 ? dark + 1 : 0;
      fast = change > 40 ? fast + 1 : 0;
      setNudge(dark >= 3 ? t.tooDark : fast >= 2 ? t.tooFast : "");
    }, 1_000);
    return () => clearInterval(id);
  }, [phase, t.tooDark, t.tooFast]);

  // iOS stops the camera when the page is hidden: close the segment cleanly.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && recorderRef.current?.state === "recording") {
        void stopSegment().then(() => setPhase("paused"));
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  });

  async function startSegment(roomType?: RoomType) {
    const stream = streamRef.current;
    const mime = pickMime();
    if (!stream || !mime) return setPhase("error");
    setBusy(true);
    try {
      const seg = await postJson<{ mediaId: string; label: string }>(`/api/s/${token}/segments`, {
        kind: "VIDEO",
        contentType: mime.split(";")[0],
        roomType,
      });
      const queue = uploadQueue();
      await queue.beginMedia(token, seg.mediaId);
      segmentRef.current = { mediaId: seg.mediaId, index: 0, bytes: 0, startedAt: Date.now() };
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000 });
      recorder.ondataavailable = (e) => {
        const s = segmentRef.current;
        if (!s || e.data.size === 0) return;
        s.bytes += e.data.size;
        void queue.addChunk(token, s.mediaId, s.index++, e.data);
      };
      // onstop fires after the last dataavailable, so the chunk count is final.
      recorder.onstop = () => {
        const s = segmentRef.current;
        if (s) void queue.endMedia(s.mediaId, s.index, Date.now() - s.startedAt, s.bytes);
        segmentRef.current = null;
        stoppedRef.current?.();
      };
      recorderRef.current = recorder;
      recorder.start(TIMESLICE_MS);
      setLabel(seg.label);
      setPhase("recording");
    } catch {
      setNudge(t.error);
    } finally {
      setBusy(false);
    }
  }

  function stopSegment(): Promise<void> {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return Promise.resolve();
    return new Promise((resolve) => {
      stoppedRef.current = resolve;
      recorder.stop();
    });
  }

  async function next() {
    await stopSegment();
    if (mode === "rooms") setPhase("picking");
    else await startSegment();
  }

  async function done() {
    setBusy(true);
    await stopSegment();
    onDone();
  }

  async function uploadFiles(files: FileList) {
    setBusy(true);
    try {
      const queue = uploadQueue();
      for (const file of Array.from(files)) {
        const seg = await postJson<{ mediaId: string }>(`/api/s/${token}/segments`, {
          kind: file.type.startsWith("image/") ? "PHOTO" : "VIDEO",
          contentType: file.type || "video/mp4",
        });
        await queue.beginMedia(token, seg.mediaId);
        let index = 0;
        for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
          await queue.addChunk(token, seg.mediaId, index++, file.slice(offset, offset + FILE_CHUNK_BYTES, file.type));
        }
        await queue.endMedia(seg.mediaId, index, 0, file.size);
      }
      onDone();
    } catch {
      setNudge(t.error);
      setBusy(false);
    }
  }

  // Rooms offered in room-by-room mode (storage units are their own surveys).
  const pickable = (Object.keys(t.rooms) as RoomType[]).filter((r) => r !== "storage" && r !== "other");
  const begin = () => (mode === "rooms" ? setPhase("picking") : startSegment());
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const pill = "rounded-full py-4 text-base font-bold disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3 text-sm">
        <span className="font-semibold">{phase === "recording" ? label : t.title}</span>
        {phase === "recording" && <span className="font-mono text-red-400">● {clock}</span>}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {phase === "ready" && (
          <ul className="absolute inset-x-4 bottom-4 space-y-1 rounded-xl bg-black/60 p-3 text-sm">
            {t.tips.map((tip) => <li key={tip}>• {tip}</li>)}
          </ul>
        )}
        {phase === "picking" && (
          <div className="absolute inset-0 flex flex-col justify-end bg-black/70 p-4">
            <p className="mb-3 text-center font-semibold">{t.whichRoom}</p>
            <div className="grid grid-cols-2 gap-2">
              {pickable.map((r) => (
                <button key={r} type="button" disabled={busy} onClick={() => startSegment(r)} className="rounded-xl bg-white/15 py-3 text-sm font-semibold">
                  {t.rooms[r]}
                </button>
              ))}
            </div>
          </div>
        )}
        {phase === "paused" && <p className="absolute inset-x-4 top-4 rounded-xl bg-black/70 p-3 text-center text-sm">{t.paused}</p>}
        {phase === "error" && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm">{t.cameraError}</p>}
        {nudge && <p className="absolute inset-x-4 top-4 rounded-xl bg-amber-400 p-3 text-center text-sm font-bold text-black">{nudge}</p>}
      </div>

      <div className="space-y-3 px-4 py-4">
        {(phase === "ready" || phase === "paused") && (
          <button type="button" onClick={begin} disabled={busy} className={`${pill} w-full bg-red-600`}>
            {phase === "paused" ? t.continueRecording : t.record}
          </button>
        )}
        {phase === "recording" && (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={next} disabled={busy} className={`${pill} border border-white/50`}>
              {t.nextRoom}
            </button>
            <button type="button" onClick={done} disabled={busy} className={`${pill} bg-white text-black`}>
              {t.done}
            </button>
          </div>
        )}
        {phase === "paused" && (
          <button type="button" onClick={done} disabled={busy} className={`${pill} w-full bg-white text-black`}>
            {t.done}
          </button>
        )}
        {phase !== "recording" && (
          <label className="block cursor-pointer text-center text-xs text-white/70 underline">
            {t.uploadInstead}
            <input
              type="file"
              accept="video/*,image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files?.length && void uploadFiles(e.target.files)}
            />
          </label>
        )}
      </div>
    </div>
  );
}

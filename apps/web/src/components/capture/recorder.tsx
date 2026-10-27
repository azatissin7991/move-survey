"use client";

// In-page camera recorder for one room. MediaRecorder emits a chunk every
// 2 seconds; each goes to the upload queue (IndexedDB first). The chunks
// concatenate back into one file on the server. Falls back to a file picker
// that splits a chosen video into the same chunks.

import { useEffect, useRef, useState } from "react";
import type { Dict } from "@/lib/i18n";
import { postJson, uploadQueue } from "./upload-queue";

const TIMESLICE_MS = 2_000;
const FILE_CHUNK_BYTES = 8 * 1024 * 1024;
const MIN_SECONDS = 20;
const MIME_CANDIDATES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

type Phase = "idle" | "recording" | "review" | "error";

export function Recorder({
  token,
  roomId,
  roomLabel,
  t,
  onDone,
}: {
  token: string;
  roomId: string;
  roomLabel: string;
  t: Dict;
  onDone: (recorded: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const session = useRef({ mediaId: "", index: 0, bytes: 0, startedAt: 0, darkSamples: 0, samples: 0 });
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  // Camera preview as soon as the screen opens.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
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

  // Timer and a rough brightness check, once a second while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 18;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const id = setInterval(() => {
      const s = session.current;
      setSeconds(Math.round((Date.now() - s.startedAt) / 1000));
      if (ctx && videoRef.current) {
        ctx.drawImage(videoRef.current, 0, 0, 32, 18);
        const px = ctx.getImageData(0, 0, 32, 18).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
        s.samples++;
        if (sum / (px.length / 4) < 45) s.darkSamples++;
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [phase]);

  // iOS kills the camera when the page is hidden; close the recording cleanly.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
        setMessage(t.interrupted);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [t.interrupted]);

  async function start() {
    const stream = streamRef.current;
    const mime = pickMime();
    if (!stream || !mime) return setPhase("error");
    setMessage("");
    setWarnings([]);
    try {
      const { mediaId } = await postJson<{ mediaId: string }>(`/api/s/${token}/rooms/${roomId}/media`, {
        kind: "VIDEO",
        contentType: mime.split(";")[0],
      });
      const queue = uploadQueue();
      await queue.beginMedia(token, mediaId);
      session.current = { mediaId, index: 0, bytes: 0, startedAt: Date.now(), darkSamples: 0, samples: 0 };
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000 });
      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        const s = session.current;
        s.bytes += e.data.size;
        void queue.addChunk(token, s.mediaId, s.index++, e.data);
      };
      rec.onstop = () => {
        const s = session.current;
        const durationMs = Date.now() - s.startedAt;
        // onstop fires after the final dataavailable, so the count is complete.
        void queue.endMedia(s.mediaId, s.index, durationMs, s.bytes);
        const w: string[] = [];
        if (durationMs < MIN_SECONDS * 1000) w.push(t.tooShort);
        if (s.samples > 0 && s.darkSamples / s.samples > 0.5) w.push(t.tooDark);
        setWarnings(w);
        setPhase("review");
      };
      recorderRef.current = rec;
      rec.start(TIMESLICE_MS);
      setSeconds(0);
      setPhase("recording");
    } catch {
      setMessage(t.error);
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function uploadFile(file: File) {
    try {
      const kind = file.type.startsWith("image/") ? "PHOTO" : "VIDEO";
      const { mediaId } = await postJson<{ mediaId: string }>(`/api/s/${token}/rooms/${roomId}/media`, {
        kind,
        contentType: file.type || "video/mp4",
      });
      const queue = uploadQueue();
      await queue.beginMedia(token, mediaId);
      let index = 0;
      for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
        await queue.addChunk(token, mediaId, index++, file.slice(offset, offset + FILE_CHUNK_BYTES, file.type));
      }
      await queue.endMedia(mediaId, index, 0, file.size);
      onDone(true);
    } catch {
      setMessage(t.error);
    }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(1, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3 text-sm">
        <button type="button" onClick={() => onDone(phase === "review")} className="font-semibold text-white/80" disabled={phase === "recording"}>
          ← {t.back}
        </button>
        <span className="font-bold">{roomLabel}</span>
        <span className={phase === "recording" ? "font-mono text-red-400" : "font-mono text-white/50"}>
          {mm}:{ss}
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {phase === "idle" && (
          <ul className="absolute inset-x-4 bottom-4 space-y-1 rounded-xl bg-black/60 p-3 text-xs">
            {t.tips.map((tip) => (
              <li key={tip}>• {tip}</li>
            ))}
          </ul>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm">{t.cameraError}</div>
        )}
      </div>

      <div className="space-y-3 px-4 py-4">
        {message && <p className="text-center text-xs text-amber-300">{message}</p>}
        {phase === "review" && warnings.map((w) => (
          <p key={w} className="text-center text-xs text-amber-300">{w}</p>
        ))}

        {phase === "idle" && (
          <button type="button" onClick={start} className="w-full rounded-full bg-red-600 py-4 text-base font-bold">
            {t.startRecording}
          </button>
        )}
        {phase === "recording" && (
          <button type="button" onClick={stop} className="w-full rounded-full bg-white py-4 text-base font-bold text-black">
            ■ {t.stopRecording}
          </button>
        )}
        {phase === "review" && (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setPhase("idle")} className="rounded-full border border-white/40 py-3 font-semibold">
              {t.rerecord}
            </button>
            <button type="button" onClick={() => onDone(true)} className="rounded-full bg-white py-3 font-bold text-black">
              {t.keep}
            </button>
          </div>
        )}

        {phase !== "recording" && (
          <label className="block cursor-pointer text-center text-xs text-white/70 underline">
            {t.uploadInstead}
            <input
              type="file"
              accept="video/*,image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

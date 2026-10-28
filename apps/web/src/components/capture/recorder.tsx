"use client";

// One recording screen for the whole survey. Each segment (the walk-through,
// a part after "Next room", or a room in room-by-room mode) records three
// streams into the upload queue:
//   VIDEO   2 s chunks, kept for the reviewer
//   FRAMES  sharp, distinct JPEG stills picked once a second: what the AI reads
//   AUDIO   the narration ("this stays"), transcribed for the AI

import { useEffect, useRef, useState } from "react";
import type { RoomType } from "@move-survey/catalog";
import type { CaptureMode } from "@move-survey/contracts";
import type { Dict } from "@/lib/i18n";
import { change, frameFromImageFile, framesFromVideoFile, MIN_CHANGE, MIN_SHARPNESS, probe, snapshot } from "./frames";
import { postJson, uploadQueue } from "./upload-queue";

const TIMESLICE_MS = 2_000;
const FILE_CHUNK_BYTES = 8 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
const AUDIO_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

type Phase = "ready" | "picking" | "recording" | "paused" | "error";
type Stream = { mediaId: string; index: number; bytes: number };
type Segment = { startedAt: number; video: Stream; frames: Stream; audio?: Stream };
type SegmentIds = { label: string; media: { VIDEO?: string; FRAMES: string; AUDIO?: string } };

const supported = (types: string[]) => types.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
const base = (mime: string) => mime.split(";")[0]!;
const stream = (mediaId: string): Stream => ({ mediaId, index: 0, bytes: 0 });

export function Recorder({ token, mode, t, onDone }: { token: string; mode: CaptureMode; t: Dict; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const recordersRef = useRef<MediaRecorder[]>([]);
  const segmentRef = useRef<Segment | null>(null);
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
        audio: true,
      })
      .then((camera) => {
        if (cancelled) return camera.getTracks().forEach((tr) => tr.stop());
        cameraRef.current = camera;
        if (videoRef.current) videoRef.current.srcObject = camera;
      })
      .catch(() => !cancelled && setPhase("error"));
    return () => {
      cancelled = true;
      cameraRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  // Once a second while recording: timer, nudges, and maybe a frame for the AI.
  useEffect(() => {
    if (phase !== "recording") return;
    const canvas = Object.assign(document.createElement("canvas"), { width: 160, height: 90 });
    let lastKept: Float32Array | null = null;
    let previous: Float32Array | null = null;
    let dark = 0;
    let fast = 0;
    const id = setInterval(async () => {
      setSeconds((s) => s + 1);
      const video = videoRef.current;
      const seg = segmentRef.current;
      if (!video || !seg) return;
      const p = probe(video, canvas);
      dark = p.brightness < 45 ? dark + 1 : 0;
      fast = previous && change(p.luma, previous) > 40 ? fast + 1 : 0;
      previous = p.luma;
      setNudge(dark >= 3 ? t.tooDark : fast >= 2 ? t.tooFast : "");

      if (p.sharpness < MIN_SHARPNESS || (lastKept && change(p.luma, lastKept) < MIN_CHANGE)) return;
      lastKept = p.luma;
      const blob = await snapshot(video);
      if (!blob || segmentRef.current !== seg) return;
      const tMs = Date.now() - seg.startedAt;
      seg.frames.bytes += blob.size;
      await uploadQueue().addChunk(token, seg.frames.mediaId, seg.frames.index++, blob, tMs);
    }, 1_000);
    return () => clearInterval(id);
  }, [phase, token, t.tooDark, t.tooFast]);

  // iOS stops the camera when the page is hidden: close the segment cleanly.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && segmentRef.current) void stopSegment().then(() => setPhase("paused"));
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  });

  function record(source: MediaStream, mimeType: string, target: Stream, bitsPerSecond: number): MediaRecorder {
    const recorder = new MediaRecorder(source, { mimeType, bitsPerSecond });
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      target.bytes += e.data.size;
      void uploadQueue().addChunk(token, target.mediaId, target.index++, e.data);
    };
    recorder.start(TIMESLICE_MS);
    return recorder;
  }

  async function startSegment(roomType?: RoomType) {
    const camera = cameraRef.current;
    const videoType = supported(VIDEO_TYPES);
    if (!camera || !videoType) return setPhase("error");
    const audioType = camera.getAudioTracks().length ? supported(AUDIO_TYPES) : null;
    setBusy(true);
    try {
      const ids = await postJson<SegmentIds>(`/api/s/${token}/segments`, {
        roomType,
        streams: { VIDEO: base(videoType), FRAMES: "image/jpeg", ...(audioType ? { AUDIO: base(audioType) } : {}) },
      });
      const queue = uploadQueue();
      for (const id of Object.values(ids.media)) await queue.beginMedia(token, id);
      const seg: Segment = {
        startedAt: Date.now(),
        video: stream(ids.media.VIDEO!),
        frames: stream(ids.media.FRAMES),
        audio: ids.media.AUDIO ? stream(ids.media.AUDIO) : undefined,
      };
      recordersRef.current = [record(camera, videoType, seg.video, 4_500_000)];
      if (audioType && seg.audio) {
        recordersRef.current.push(record(new MediaStream(camera.getAudioTracks()), audioType, seg.audio, 64_000));
      }
      segmentRef.current = seg;
      setLabel(ids.label);
      setPhase("recording");
    } catch {
      setNudge(t.error);
    } finally {
      setBusy(false);
    }
  }

  /** Stop the segment's recorders; resolves once their last chunks are queued. */
  async function stopSegment() {
    const seg = segmentRef.current;
    if (!seg) return;
    segmentRef.current = null;
    await Promise.all(
      recordersRef.current.map(
        (r) => new Promise<void>((resolve) => {
          if (r.state === "inactive") return resolve();
          r.addEventListener("stop", () => resolve(), { once: true });
          r.stop();
        }),
      ),
    );
    // A tick later, so the final dataavailable handlers have run.
    await new Promise((r) => setTimeout(r, 0));
    const queue = uploadQueue();
    const duration = Date.now() - seg.startedAt;
    for (const s of [seg.video, seg.frames, seg.audio]) {
      if (s) await queue.endMedia(s.mediaId, s.index, duration, s.bytes);
    }
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
        const isVideo = file.type.startsWith("video/");
        const ids = await postJson<SegmentIds>(`/api/s/${token}/segments`, {
          streams: { FRAMES: "image/jpeg", ...(isVideo ? { VIDEO: file.type } : {}) },
        });
        for (const id of Object.values(ids.media)) await queue.beginMedia(token, id);

        const frames = isVideo ? await framesFromVideoFile(file) : [{ blob: await frameFromImageFile(file), tMs: 0 }];
        let n = 0;
        for (const f of frames) if (f.blob) await queue.addChunk(token, ids.media.FRAMES, n++, f.blob, f.tMs);
        await queue.endMedia(ids.media.FRAMES, n, 0, 0);

        if (ids.media.VIDEO) {
          let index = 0;
          for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
            await queue.addChunk(token, ids.media.VIDEO, index++, file.slice(offset, offset + FILE_CHUNK_BYTES, file.type));
          }
          await queue.endMedia(ids.media.VIDEO, index, 0, file.size);
        }
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

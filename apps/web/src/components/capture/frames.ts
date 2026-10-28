// Still frames for the AI, picked on the phone: sharp, and different enough
// from the last one kept. Doing it here means the server never decodes video.

const LONG_EDGE = 1280;
const PROBE_W = 160;
const PROBE_H = 90;
export const MIN_SHARPNESS = 30; // Laplacian variance on the probe; below this is motion blur
export const MIN_CHANGE = 8; // mean luma difference from the last kept frame

export type Probe = { luma: Float32Array; brightness: number; sharpness: number };

const probeCanvas = () => Object.assign(document.createElement("canvas"), { width: PROBE_W, height: PROBE_H });

/** Brightness, sharpness and a tiny grayscale copy of what the camera sees now. */
export function probe(source: CanvasImageSource, canvas = probeCanvas()): Probe {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, PROBE_W, PROBE_H);
  const px = ctx.getImageData(0, 0, PROBE_W, PROBE_H).data;
  const luma = new Float32Array(PROBE_W * PROBE_H);
  for (let i = 0; i < luma.length; i++) luma[i] = 0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!;

  let sum = 0;
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < PROBE_H - 1; y++) {
    for (let x = 1; x < PROBE_W - 1; x++) {
      const i = y * PROBE_W + x;
      const lap = 4 * luma[i]! - luma[i - 1]! - luma[i + 1]! - luma[i - PROBE_W]! - luma[i + PROBE_W]!;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  for (const v of luma) sum += v;
  const mean = lapSum / n;
  return { luma, brightness: sum / luma.length, sharpness: lapSq / n - mean * mean };
}

export function change(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
  return d / a.length;
}

/** A JPEG of the source at up to 1280 px on the long edge. */
export function snapshot(source: HTMLVideoElement | ImageBitmap): Promise<Blob | null> {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!w || !h) return Promise.resolve(null);
  const scale = Math.min(1, LONG_EDGE / Math.max(w, h));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(w * scale), height: Math.round(h * scale) });
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

/** Frames from a video file the person picked instead of recording: one every 2 s. */
export async function framesFromVideoFile(file: File): Promise<{ blob: Blob; tMs: number }[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("unreadable video"));
    });
    const out: { blob: Blob; tMs: number }[] = [];
    let last: Float32Array | null = null;
    for (let t = 0.5; t < video.duration; t += 2) {
      video.currentTime = t;
      await new Promise((resolve) => (video.onseeked = resolve));
      const p = probe(video);
      if (last && change(p.luma, last) < MIN_CHANGE) continue;
      const blob = await snapshot(video);
      if (blob) out.push({ blob, tMs: Math.round(t * 1000) });
      last = p.luma;
    }
    return out;
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

/** A photo the person picked, resized like a recorded frame. */
export async function frameFromImageFile(file: File): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file);
  try {
    return await snapshot(bitmap);
  } finally {
    bitmap.close();
  }
}

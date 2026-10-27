"use client";

// The customer's survey flow: welcome → setup questions → room checklist with
// a recorder per room → finish. State that matters lives on the server; the
// page can be reloaded at any point and resumes at the room list.

import { useEffect, useMemo, useState } from "react";
import type { Language, RoomStatus } from "@move-survey/contracts";
import type { RoomType } from "@move-survey/catalog";
import { DICTIONARIES } from "@/lib/i18n";
import { Recorder } from "./recorder";
import { postJson, uploadQueue } from "./upload-queue";

export type CaptureRoom = { id: string; roomType: RoomType; label: string; status: RoomStatus };

type Step = "welcome" | "setup" | "rooms" | "done";

const EXTRA_ROOMS: RoomType[] = ["dining_room", "family_room", "office", "kids_room", "laundry", "hallway", "garage", "basement", "attic", "patio"];
const HOME_TYPES = ["apartment", "house", "townhouse", "condo", "storage", "office", "other"] as const;

const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const input = "w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-blue-600";
const primary = "w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-50";

export function CaptureApp({
  token,
  initialLanguage,
  initialRooms,
  finished,
}: {
  token: string;
  initialLanguage: Language;
  initialRooms: CaptureRoom[];
  finished: boolean;
}) {
  const [lang, setLang] = useState<Language>(initialLanguage);
  const t = DICTIONARIES[lang];
  const [step, setStep] = useState<Step>(finished ? "done" : initialRooms.length ? "rooms" : "welcome");
  const [rooms, setRooms] = useState<CaptureRoom[]>(initialRooms);
  const [recordingRoom, setRecordingRoom] = useState<CaptureRoom | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Setup answers
  const [consent, setConsent] = useState(false);
  const [homeType, setHomeType] = useState<(typeof HOME_TYPES)[number]>("house");
  const [bedrooms, setBedrooms] = useState(2);
  const [extras, setExtras] = useState<RoomType[]>([]);
  const [selfPacking, setSelfPacking] = useState<"yes" | "no" | "partly">("yes");
  const [packedBoxes, setPackedBoxes] = useState(0);
  const [notMoving, setNotMoving] = useState("");

  const inAppBrowser = useMemo(
    () => typeof navigator !== "undefined" && /FBAN|FBAV|Instagram|Line\/|GSA\/|; wv\)/.test(navigator.userAgent),
    [],
  );

  useEffect(() => uploadQueue().subscribe(setPending), []);

  // A recording finished uploading: mark its room uploaded locally.
  useEffect(() => {
    const onComplete = () => setRooms((rs) => rs.map((r) => (r.status === "UPLOADING" ? { ...r, status: "UPLOADED" } : r)));
    window.addEventListener("survey:media-complete", onComplete);
    return () => window.removeEventListener("survey:media-complete", onComplete);
  }, []);

  function plannedRooms(): { roomType: RoomType; label: string }[] {
    const list: { roomType: RoomType; label: string }[] = [
      { roomType: "living_room", label: t.rooms.living_room },
      { roomType: "kitchen", label: t.rooms.kitchen },
    ];
    for (let i = 1; i <= bedrooms; i++) {
      list.push({ roomType: "bedroom", label: bedrooms > 1 ? `${t.rooms.bedroom} ${i}` : t.rooms.bedroom });
    }
    list.push({ roomType: "bathroom", label: t.rooms.bathroom });
    for (const r of extras) list.push({ roomType: r, label: t.rooms[r] });
    if (homeType === "storage") return [{ roomType: "storage", label: t.rooms.storage }];
    return list;
  }

  async function submitSetup() {
    setBusy(true);
    setError("");
    try {
      const res = await postJson<{ rooms: CaptureRoom[] }>(`/api/s/${token}/start`, {
        language: lang,
        consentMedia: consent,
        answers: { homeType, bedrooms, selfPacking, packedBoxes, notMoving },
        rooms: plannedRooms(),
      });
      setRooms(res.rooms);
      setStep("rooms");
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/s/${token}/finish`, {});
      setStep("done");
    } catch (e) {
      setError((e as { status?: number }).status === 409 ? t.finishNeedsRoom : t.error);
    } finally {
      setBusy(false);
    }
  }

  const langToggle = (
    <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-xs font-semibold">
      {(["en", "ru"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={l === lang ? "rounded-full bg-white px-3 py-1 shadow-sm" : "px-3 py-1 text-slate-500"}
        >
          {l === "en" ? "English" : "Русский"}
        </button>
      ))}
    </div>
  );

  if (recordingRoom) {
    return (
      <Recorder
        token={token}
        roomId={recordingRoom.id}
        roomLabel={recordingRoom.label}
        t={t}
        onDone={(recorded) => {
          if (recorded) setRooms((rs) => rs.map((r) => (r.id === recordingRoom.id ? { ...r, status: "UPLOADING" } : r)));
          setRecordingRoom(null);
        }}
      />
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-slate-900">{t.title}</h1>
        {langToggle}
      </header>

      {inAppBrowser && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.inAppBrowser}</p>}
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {step === "welcome" && (
        <section className={`${card} space-y-4`}>
          <p className="text-slate-700">{t.intro}</p>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            {t.consent}
          </label>
          <p className="text-xs text-slate-500">{t.privacy}</p>
          <button type="button" className={primary} onClick={() => setStep("setup")}>
            {t.start}
          </button>
        </section>
      )}

      {step === "setup" && (
        <section className={`${card} space-y-4`}>
          <h2 className="font-bold text-slate-900">{t.setupTitle}</h2>
          <label className="block space-y-1 text-sm font-semibold text-slate-700">
            {t.homeType}
            <select className={input} value={homeType} onChange={(e) => setHomeType(e.target.value as typeof homeType)}>
              {HOME_TYPES.map((h) => (
                <option key={h} value={h}>
                  {t.homeTypes[h]}
                </option>
              ))}
            </select>
          </label>
          {homeType !== "storage" && (
            <>
              <label className="block space-y-1 text-sm font-semibold text-slate-700">
                {t.bedrooms}
                <input
                  className={input}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={12}
                  value={bedrooms}
                  onChange={(e) => setBedrooms(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
                />
              </label>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-slate-700">{t.extraRooms}</legend>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {EXTRA_ROOMS.map((r) => (
                    <label key={r} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={extras.includes(r)}
                        onChange={(e) => setExtras((xs) => (e.target.checked ? [...xs, r] : xs.filter((x) => x !== r)))}
                      />
                      {t.rooms[r]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-700">{t.selfPacking}</legend>
            {(["yes", "no", "partly"] as const).map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input type="radio" name="selfPacking" checked={selfPacking === o} onChange={() => setSelfPacking(o)} />
                {t.selfPackingOptions[o]}
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1 text-sm font-semibold text-slate-700">
            {t.packedBoxes}
            <input
              className={input}
              type="number"
              inputMode="numeric"
              min={0}
              value={packedBoxes}
              onChange={(e) => setPackedBoxes(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <label className="block space-y-1 text-sm font-semibold text-slate-700">
            {t.notMoving}
            <textarea
              className={input}
              rows={2}
              placeholder={t.notMovingPlaceholder}
              value={notMoving}
              onChange={(e) => setNotMoving(e.target.value)}
            />
          </label>
          <button type="button" className={primary} onClick={submitSetup} disabled={busy}>
            {t.continue}
          </button>
        </section>
      )}

      {step === "rooms" && (
        <section className="space-y-3">
          <div>
            <h2 className="font-bold text-slate-900">{t.roomsTitle}</h2>
            <p className="text-sm text-slate-600">{t.roomsHint}</p>
          </div>
          <ul className="space-y-2">
            {rooms.map((r) => {
              const recorded = !["PENDING", "NEEDS_RETAKE", "FAILED"].includes(r.status);
              return (
                <li key={r.id} className={`${card} flex items-center justify-between gap-3`}>
                  <div>
                    <p className="font-semibold text-slate-900">{r.label}</p>
                    <p className={recorded ? "text-xs text-emerald-700" : "text-xs text-slate-500"}>{t.status[r.status]}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRecordingRoom(r)}
                    className={recorded ? "rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold" : "rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white"}
                  >
                    {recorded ? t.rerecord : `● ${t.record}`}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-center text-xs text-slate-500">{pending > 0 ? t.uploading(pending) : t.allUploaded}</p>
          <button type="button" className={primary} onClick={finish} disabled={busy}>
            {t.finish}
          </button>
        </section>
      )}

      {step === "done" && (
        <section className={`${card} space-y-2 text-center`}>
          <h2 className="text-lg font-bold text-slate-900">{t.doneTitle}</h2>
          <p className="text-slate-700">{t.doneBody}</p>
          {pending > 0 && <p className="text-xs text-slate-500">{t.uploading(pending)}</p>}
        </section>
      )}
    </main>
  );
}

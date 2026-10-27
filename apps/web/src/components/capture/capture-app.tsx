"use client";

// The capture flow: one welcome card → the recording screen → done. Works the
// same for a customer at home and a foreman on site. Nothing to fill in.

import { useEffect, useMemo, useState } from "react";
import type { CaptureMode, Language } from "@move-survey/contracts";
import { DICTIONARIES } from "@/lib/i18n";
import { Recorder } from "./recorder";
import { postJson, uploadQueue } from "./upload-queue";

type Step = "welcome" | "recording" | "done";

export function CaptureApp({
  token,
  mode,
  initialLanguage,
  started,
  finished,
}: {
  token: string;
  mode: CaptureMode;
  initialLanguage: Language;
  started: boolean;
  finished: boolean;
}) {
  const [lang, setLang] = useState<Language>(initialLanguage);
  const t = DICTIONARIES[lang];
  const [step, setStep] = useState<Step>(finished ? "done" : "welcome");
  const [packingSelf, setPackingSelf] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");

  const inAppBrowser = useMemo(
    () => typeof navigator !== "undefined" && /FBAN|FBAV|Instagram|Line\/|GSA\/|; wv\)/.test(navigator.userAgent),
    [],
  );
  useEffect(() => uploadQueue().subscribe(setPending), []);

  async function start() {
    setError("");
    try {
      await postJson(`/api/s/${token}/start`, { language: lang, consentMedia: consent, packingSelf });
      setStep("recording");
    } catch {
      setError(t.error);
    }
  }

  async function finish() {
    try {
      await postJson(`/api/s/${token}/finish`, {});
    } catch {
      // Nothing recorded, or already finished: either way the done screen is right.
    }
    setStep("done");
  }

  if (step === "recording") return <Recorder token={token} mode={mode} t={t} onDone={finish} />;

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold">{t.title}</h1>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-xs font-semibold">
          {(["en", "ru"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={l === lang ? "rounded-full bg-white px-3 py-1 shadow-sm" : "px-3 py-1 text-slate-500"}>
              {l === "en" ? "English" : "Русский"}
            </button>
          ))}
        </div>
      </header>

      {inAppBrowser && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t.inAppBrowser}</p>}
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {step === "welcome" ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-slate-700">{mode === "rooms" ? t.introRooms : t.intro}</p>
          <button
            type="button"
            onClick={() => setPackingSelf((v) => !v)}
            className={packingSelf ? "rounded-full border border-blue-600 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700" : "rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-700"}
          >
            {packingSelf ? "✓ " : ""}{t.packingSelf}
          </button>
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            {t.consent}
          </label>
          <p className="text-xs text-slate-500">{t.privacy}</p>
          <button type="button" onClick={start} className="w-full rounded-xl bg-blue-600 py-4 text-lg font-bold text-white">
            {started ? t.continueRecording : t.start}
          </button>
        </section>
      ) : (
        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <h2 className="text-lg font-bold">{t.doneTitle}</h2>
          <p className="text-slate-700">{t.doneBody}</p>
          <p className="text-xs text-slate-500">{pending > 0 ? t.uploading(pending) : t.allUploaded}</p>
        </section>
      )}
    </main>
  );
}

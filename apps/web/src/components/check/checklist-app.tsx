"use client";

// The crew's move-day checklist, made for a phone on the truck ramp: every
// line starts at the inventory's count, so only differences need a tap.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Language } from "@move-survey/contracts";
import { DICTIONARIES } from "@/lib/i18n";
import type { ReviewAuth } from "@/lib/review";
import { saveChecklist } from "@/app/check/[id]/actions";

type Name = { en: string; ru: string };
export type CheckLine = { id: string; room: string; name: Name; surveyed: number; quantity: number };
type Added = { catalogId: string; roomLabel: string; quantity: number };

export function ChecklistApp({
  auth,
  initialLanguage,
  lines,
  added: initialAdded,
  saved,
  catalog,
}: {
  auth: ReviewAuth;
  initialLanguage: Language;
  lines: CheckLine[];
  added: Added[];
  saved: { by: string; at: string } | null;
  catalog: { id: string; name: Name }[];
}) {
  const router = useRouter();
  const [lang, setLang] = useState(initialLanguage);
  const t = DICTIONARIES[lang];
  const [counts, setCounts] = useState(() => Object.fromEntries(lines.map((l) => [l.id, l.quantity])));
  const [added, setAdded] = useState(initialAdded);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const rooms = useMemo(() => [...new Set(lines.map((l) => l.room))], [lines]);
  const names = useMemo(() => new Map(catalog.map((c) => [c.id, c.name])), [catalog]);

  const set = (id: string, n: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, n) }));

  function save() {
    // Only counts that differ from the inventory are sent.
    const changed = Object.fromEntries(lines.filter((l) => counts[l.id] !== l.surveyed).map((l) => [l.id, counts[l.id]!]));
    startTransition(async () => {
      setError("");
      try {
        await saveChecklist(auth, { counts: changed, added });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : t.error);
      }
    });
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pb-32 pt-6">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold">{t.checkTitle}</h1>
          <p className="text-sm text-slate-600">{t.checkIntro}</p>
        </div>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-xs font-semibold">
          {(["en", "ru"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={l === lang ? "rounded-full bg-white px-3 py-1 shadow-sm" : "px-3 py-1 text-slate-500"}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {rooms.map((room) => (
        <section key={room} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-bold">{room}</h2>
          <ul className="divide-y divide-slate-100">
            {lines.filter((l) => l.room === room).map((l) => (
              <Row key={l.id} name={l.name[lang]} hint={t.checkListed(l.surveyed)} count={counts[l.id]!} changed={counts[l.id] !== l.surveyed} onChange={(n) => set(l.id, n)} />
            ))}
            {added.map((a, i) =>
              a.roomLabel === room ? (
                <Row
                  key={`a${i}`}
                  name={names.get(a.catalogId)?.[lang] ?? a.catalogId}
                  hint={t.checkAdded}
                  count={a.quantity}
                  changed
                  onChange={(n) => setAdded((list) => (n < 1 ? list.filter((_, j) => j !== i) : list.map((x, j) => (j === i ? { ...x, quantity: n } : x))))}
                />
              ) : null,
            )}
          </ul>
        </section>
      ))}

      <AddMissing rooms={rooms} catalog={catalog} lang={lang} t={t} onAdd={(a) => setAdded((list) => [...list, a])} />

      <footer className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md space-y-1">
          <button type="button" disabled={pending} onClick={save} className="w-full rounded-xl bg-blue-600 py-3 text-lg font-bold text-white disabled:opacity-50">
            {t.checkSave}
          </button>
          {saved && <p className="text-center text-xs text-slate-500">✓ {t.checkSaved(saved.by, new Date(saved.at).toLocaleString(lang === "ru" ? "ru-RU" : "en-US"))}</p>}
        </div>
      </footer>
    </main>
  );
}

function Row({ name, hint, count, changed, onChange }: { name: string; hint: string; count: number; changed: boolean; onChange: (n: number) => void }) {
  return (
    <li className={`flex items-center gap-3 px-4 py-2 ${changed ? "bg-amber-50" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${count === 0 ? "text-slate-400 line-through" : ""}`}>{name}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <button type="button" onClick={() => onChange(count - 1)} disabled={count === 0} className="h-10 w-10 rounded-full border text-xl leading-none disabled:opacity-30">−</button>
      <span className="w-8 text-center text-base font-bold">{count}</span>
      <button type="button" onClick={() => onChange(count + 1)} className="h-10 w-10 rounded-full border text-xl leading-none">+</button>
    </li>
  );
}

function AddMissing({
  rooms,
  catalog,
  lang,
  t,
  onAdd,
}: {
  rooms: string[];
  catalog: { id: string; name: Name }[];
  lang: Language;
  t: (typeof DICTIONARIES)[Language];
  onAdd: (a: Added) => void;
}) {
  const [name, setName] = useState("");
  const [room, setRoom] = useState(rooms[0] ?? "");
  const match = catalog.find((c) => c.name[lang].toLowerCase() === name.trim().toLowerCase());
  const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm";
  return (
    <form
      className="flex flex-wrap gap-2 rounded-2xl border border-dashed border-slate-300 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!match || !room) return;
        onAdd({ catalogId: match.id, roomLabel: room, quantity: 1 });
        setName("");
      }}
    >
      <input list="check-items" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.checkAdd} className={`${field} w-full`} />
      <datalist id="check-items">
        {catalog.map((c) => <option key={c.id} value={c.name[lang]} />)}
      </datalist>
      <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label={t.checkRoom} className={`${field} min-w-0 flex-1`}>
        {rooms.map((r) => <option key={r}>{r}</option>)}
      </select>
      <button type="submit" disabled={!match || !room} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-30">{t.checkAddButton}</button>
    </form>
  );
}

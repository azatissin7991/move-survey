"use client";

// The estimator's screen: the inventory by room, the ballpark with its range,
// and one Approve button. Editing is there but optional.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Suggestions, Totals } from "@move-survey/contracts";
import type { ReviewAuth } from "@/lib/review";
import { addLine, approve, updateLine } from "@/app/review/[id]/actions";
import { EvidenceViewer, type Evidence } from "./evidence-viewer";

export type ReviewLine = {
  id: string;
  room: string;
  name: string;
  quantity: number;
  cuFtEach: number;
  moving: boolean;
  estimated: boolean;
  confidence: number;
  note: string;
  flags: string[];
  thumb: string | null;
  frameId: string | null;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function ReviewApp({
  auth,
  customerName,
  status,
  lines,
  totals,
  suggestions,
  coverageGaps,
  catalog,
}: {
  auth: ReviewAuth;
  customerName: string;
  status: string;
  lines: ReviewLine[];
  totals: Totals;
  suggestions: Suggestions;
  coverageGaps: string[];
  catalog: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<Evidence | null>(null);
  const rooms = useMemo(() => [...new Set(lines.map((l) => l.room))], [lines]);
  const query = new URLSearchParams({ u: auth.user, t: auth.token }).toString();
  const approved = status === "APPROVED";

  const act = (fn: () => Promise<void>) =>
    startTransition(async () => {
      setError("");
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });

  return (
    <main className="mx-auto max-w-3xl px-4 pb-40 pt-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold">Inventory{customerName ? ` — ${customerName}` : ""}</h1>
          <p className="text-sm text-slate-500">{approved ? "Approved and sent to the CRM" : "Check anything flagged, then approve"}</p>
        </div>
        <nav className="flex gap-3 text-sm font-semibold text-blue-700">
          <a href={`/review/${auth.surveyId}/csv?${query}`}>CSV</a>
          <a href={`/review/${auth.surveyId}/print?${query}`} target="_blank">Print / PDF</a>
        </nav>
      </header>

      {error && <p className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {coverageGaps.length > 0 && (
        <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Not shown on video: {coverageGaps.join("; ")}. The range allows for it.</p>
      )}

      {rooms.map((room) => (
        <section key={room} className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-bold">{room}</h2>
          <ul>
            {lines.filter((l) => l.room === room).map((l) => (
              <li key={l.id} className={`flex items-center gap-3 px-4 py-2 ${l.moving ? "" : "opacity-40"}`}>
                {l.thumb && l.frameId ? (
                  <button type="button" onClick={() => setZoom({ thumb: l.thumb!, frameId: l.frameId! })} className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.thumb} alt="" className="h-12 w-16 rounded object-cover" />
                  </button>
                ) : (
                  <span className="h-12 w-16 shrink-0 rounded bg-slate-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {l.name}
                    {l.confidence < 0.6 && !l.estimated && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">check</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {[l.estimated && "estimated", `${fmt(Math.round(l.cuFtEach * l.quantity))} ft³`, ...l.flags, l.note].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={pending || l.quantity <= 1} onClick={() => act(() => updateLine(auth, l.id, { quantity: l.quantity - 1 }))} className="h-8 w-8 rounded-full border text-lg leading-none disabled:opacity-30">−</button>
                  <span className="w-8 text-center text-sm font-bold">{l.quantity}</span>
                  <button type="button" disabled={pending} onClick={() => act(() => updateLine(auth, l.id, { quantity: l.quantity + 1 }))} className="h-8 w-8 rounded-full border text-lg leading-none">+</button>
                </div>
                <button type="button" disabled={pending} onClick={() => act(() => updateLine(auth, l.id, { moving: !l.moving }))} className="w-20 text-xs font-semibold text-slate-600 underline">
                  {l.moving ? "Not moving" : "Moving"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <AddItem rooms={rooms} catalog={catalog} disabled={pending} onAdd={(input) => act(() => addLine(auth, input))} />

      <footer className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="text-lg font-extrabold">
              ≈ {fmt(totals.cuFt)} ft³ <span className="text-sm font-semibold text-slate-500">likely {fmt(totals.cuFtLow)}–{fmt(totals.cuFtHigh)}</span>
            </p>
            <p className="text-slate-600">
              {fmt(totals.weightLbs)} lb · {totals.items} items · {totals.boxes} boxes · suggest {suggestions.crew} movers, {suggestions.trucks} truck{suggestions.trucks > 1 ? "s" : ""}, {suggestions.laborHours} h
            </p>
          </div>
          <button type="button" disabled={pending || approved} onClick={() => act(() => approve(auth))} className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white disabled:opacity-50">
            {approved ? "Approved ✓" : "Approve"}
          </button>
        </div>
      </footer>

      {zoom && <EvidenceViewer key={zoom.frameId} auth={auth} evidence={zoom} onClose={() => setZoom(null)} />}
    </main>
  );
}

function AddItem({
  rooms,
  catalog,
  disabled,
  onAdd,
}: {
  rooms: string[];
  catalog: { id: string; name: string }[];
  disabled: boolean;
  onAdd: (input: { catalogId: string; roomLabel: string; quantity: number }) => void;
}) {
  const [name, setName] = useState("");
  const [room, setRoom] = useState(rooms[0] ?? "");
  const [quantity, setQuantity] = useState(1);
  const match = catalog.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-slate-300 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!match || !room) return;
        onAdd({ catalogId: match.id, roomLabel: room, quantity });
        setName("");
        setQuantity(1);
      }}
    >
      <input list="catalog-items" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add an item…" className={`${field} min-w-48 flex-1`} />
      <datalist id="catalog-items">
        {catalog.map((c) => <option key={c.id} value={c.name} />)}
      </datalist>
      <input list="room-names" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Room" className={`${field} w-36`} />
      <datalist id="room-names">
        {rooms.map((r) => <option key={r} value={r} />)}
      </datalist>
      <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className={`${field} w-16`} />
      <button type="submit" disabled={disabled || !match || !room} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-30">Add</button>
    </form>
  );
}

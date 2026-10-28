// What the customer sees on their link once the inventory is approved, if the
// company turned it on: the list by room and the ballpark. Read-only; changes
// go through the moving company.

import type { InventoryItem, Language, Totals } from "@move-survey/contracts";
import type { Dict } from "@/lib/i18n";

export function CustomerSummary({ items, totals, language, t }: { items: InventoryItem[]; totals: Totals; language: Language; t: Dict }) {
  const fmt = (n: number) => n.toLocaleString(language === "ru" ? "ru-RU" : "en-US");
  const rooms = [...new Set(items.map((i) => i.roomLabel))];
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-extrabold">{t.summaryTitle}</h1>
        <p className="text-sm text-slate-600">{t.summaryBody}</p>
      </header>
      <section className="rounded-2xl bg-blue-50 p-4">
        <p className="text-lg font-bold">{t.summaryVolume(fmt(totals.cuFt), fmt(totals.cuFtLow), fmt(totals.cuFtHigh))}</p>
        <p className="text-sm text-slate-600">{t.summaryCounts(totals.items, totals.boxes)}</p>
      </section>
      {rooms.map((room) => (
        <section key={room} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-bold">{room}</h2>
          <ul className="divide-y divide-slate-100">
            {items.filter((i) => i.roomLabel === room).map((i, n) => (
              <li key={n} className="flex justify-between px-4 py-2 text-sm">
                <span>{i.name[language]}</span>
                <span className="font-semibold">× {i.quantity}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-center text-xs text-slate-500">{t.summaryContact}</p>
    </main>
  );
}

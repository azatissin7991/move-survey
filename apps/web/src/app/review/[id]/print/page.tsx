// Printable inventory: the browser's "Save as PDF" turns it into the PDF.

import type { Metadata } from "next";
import type { Suggestions, Totals } from "@move-survey/contracts";
import { db } from "@/lib/db";
import { inventoryItems } from "@/lib/inventory";
import { reviewAllowed } from "@/lib/review";
import { PrintButton } from "@/components/review/print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventory", robots: { index: false, follow: false } };

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ u?: string; t?: string }>;
}) {
  const { id } = await params;
  const { u = "", t = "" } = await searchParams;
  if (!reviewAllowed({ surveyId: id, user: u, token: t })) return <p className="p-8">This link has expired.</p>;
  const survey = await db.survey.findUnique({ where: { id }, include: { detections: true } });
  if (!survey?.totals) return <p className="p-8">Not ready yet.</p>;

  const items = inventoryItems(survey.detections);
  const totals = survey.totals as Totals;
  const suggestions = survey.suggestions as Suggestions;
  const rooms = [...new Set(items.map((i) => i.roomLabel))];
  const customer = (survey.customer as { name?: string }).name ?? "";

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-sm text-black print:p-0">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Moving inventory</h1>
          <p>{customer} · ref {survey.externalRef} · {survey.updatedAt.toLocaleDateString("en-US")}</p>
        </div>
        <PrintButton />
      </div>
      {rooms.map((room) => (
        <table key={room} className="mb-4 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-1">{room}</th>
              <th className="w-12 text-right">Qty</th>
              <th className="w-20 text-right">Cu ft</th>
              <th className="w-40 pl-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.filter((i) => i.roomLabel === room).map((i, n) => (
              <tr key={n} className="border-b border-slate-300">
                <td className="py-1">{i.name.en}</td>
                <td className="text-right">{i.quantity}</td>
                <td className="text-right">{Math.round(i.cuFtEach * i.quantity)}</td>
                <td className="pl-3 text-xs">{[...i.flags, i.notes].filter(Boolean).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="mt-6 text-base font-bold">
        Total ≈ {totals.cuFt.toLocaleString("en-US")} cu ft (likely {totals.cuFtLow.toLocaleString("en-US")}–{totals.cuFtHigh.toLocaleString("en-US")}) · {totals.weightLbs.toLocaleString("en-US")} lb
      </p>
      <p>{totals.items} items, {totals.boxes} boxes · suggested {suggestions.crew} movers, {suggestions.trucks} truck(s), {suggestions.laborHours} hours</p>
      <p className="mt-2 text-xs text-slate-600">Estimate from a video survey. Volumes are approximate.</p>
    </main>
  );
}

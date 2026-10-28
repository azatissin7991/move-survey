"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg border px-3 py-1.5 text-sm font-semibold print:hidden">
      Print / Save as PDF
    </button>
  );
}

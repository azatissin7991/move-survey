import type { Metadata } from "next";
import type { Language } from "@move-survey/contracts";
import { db } from "@/lib/db";
import { catalog, type Snapshot } from "@/lib/estimate";
import type { Checklist } from "@/lib/checklist";
import { checklistAllowed } from "@/lib/review";
import { ChecklistApp, type CheckLine } from "@/components/check/checklist-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Move-day checklist", robots: { index: false, follow: false } };

export default async function ChecklistPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ u?: string; t?: string }>;
}) {
  const { id } = await params;
  const { u = "", t = "" } = await searchParams;
  const auth = { surveyId: id, user: u, token: t };
  if (!checklistAllowed(auth)) return <Notice text="This link has expired. Open it again from the CRM." />;

  const survey = await db.survey.findUnique({
    where: { id },
    include: { detections: { where: { moving: true }, orderBy: [{ roomLabel: "asc" }, { createdAt: "asc" }] } },
  });
  if (!survey?.totals) return <Notice text="There's no inventory to check yet." />;

  const saved = survey.checklist as Checklist | null;
  const found = new Map(saved?.items.filter((i) => i.detectionId).map((i) => [i.detectionId!, i.quantity]));
  const lines: CheckLine[] = survey.detections.map((d) => ({
    id: d.id,
    room: d.roomLabel,
    name: (d.snapshot as Snapshot).name,
    surveyed: d.quantity,
    quantity: found.get(d.id) ?? d.quantity,
  }));

  return (
    <ChecklistApp
      auth={auth}
      initialLanguage={survey.language as Language}
      lines={lines}
      added={(saved?.items ?? []).filter((i) => !i.detectionId && i.catalogId).map((i) => ({ catalogId: i.catalogId!, roomLabel: i.roomLabel, quantity: i.quantity }))}
      saved={saved ? { by: saved.by, at: saved.at } : null}
      catalog={catalog.items.map((i) => ({ id: i.id, name: i.name }))}
    />
  );
}

function Notice({ text }: { text: string }) {
  return <main className="mx-auto max-w-md px-4 py-16 text-center text-slate-700">{text}</main>;
}

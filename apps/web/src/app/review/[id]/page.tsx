import type { Metadata } from "next";
import type { Suggestions, Totals } from "@move-survey/contracts";
import { db } from "@/lib/db";
import { catalog, type Snapshot } from "@/lib/estimate";
import { reviewAllowed } from "@/lib/review";
import { getStorage } from "@/lib/storage";
import { ReviewApp, type ReviewLine } from "@/components/review/review-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventory review", robots: { index: false, follow: false } };

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ u?: string; t?: string }>;
}) {
  const { id } = await params;
  const { u = "", t = "" } = await searchParams;
  const auth = { surveyId: id, user: u, token: t };
  if (!reviewAllowed(auth)) return <Notice text="This review link has expired. Open it again from the CRM." />;

  const survey = await db.survey.findUnique({
    where: { id },
    include: { detections: { orderBy: [{ roomLabel: "asc" }, { estimated: "asc" }, { createdAt: "asc" }] } },
  });
  if (!survey) return <Notice text="Survey not found." />;
  if (!survey.totals) return <Notice text={`The inventory isn't ready yet (${survey.status.toLowerCase().replaceAll("_", " ")}).`} />;

  // One thumbnail per line: its best frame.
  const firstFrames = survey.detections.map((d) => (d.frameIds as string[])[0]).filter((f): f is string => !!f);
  const frames = await db.frame.findMany({ where: { id: { in: firstFrames } }, select: { id: true, storageKey: true } });
  const storage = getStorage();
  const thumbs = new Map(await Promise.all(frames.map(async (f) => [f.id, await storage.presignGet(f.storageKey, 3600)] as const)));

  const lines: ReviewLine[] = survey.detections.map((d) => {
    const s = d.snapshot as Snapshot;
    return {
      id: d.id,
      room: d.roomLabel,
      name: s.name.en,
      quantity: d.quantity,
      cuFtEach: s.cuFtEach,
      moving: d.moving,
      estimated: d.estimated,
      confidence: d.confidence,
      note: d.note,
      flags: s.flags,
      thumb: thumbs.get((d.frameIds as string[])[0] ?? "") ?? null,
    };
  });

  return (
    <ReviewApp
      auth={auth}
      customerName={(survey.customer as { name?: string }).name ?? ""}
      status={survey.status}
      lines={lines}
      totals={survey.totals as Totals}
      suggestions={survey.suggestions as Suggestions}
      coverageGaps={survey.coverageGaps as string[]}
      catalog={catalog.items.map((i) => ({ id: i.id, name: i.name.en }))}
    />
  );
}

function Notice({ text }: { text: string }) {
  return <main className="mx-auto max-w-md px-4 py-16 text-center text-slate-700">{text}</main>;
}

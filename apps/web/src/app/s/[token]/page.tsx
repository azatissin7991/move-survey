import type { Metadata } from "next";
import type { Language, Totals } from "@move-survey/contracts";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/tenant";
import { DICTIONARIES } from "@/lib/i18n";
import { inventoryItems } from "@/lib/inventory";
import { CaptureApp } from "@/components/capture/capture-app";
import { CustomerSummary } from "@/components/capture/customer-summary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video survey", robots: { index: false, follow: false } };

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const survey = await db.survey.findUnique({
    where: { publicToken: token },
    include: { tenant: { select: { settings: true } }, detections: { orderBy: { createdAt: "asc" } } },
  });
  const t = DICTIONARIES[(survey?.language ?? "en") as Language];

  if (!survey || survey.expiresAt < new Date() || ["CANCELLED", "EXPIRED", "FAILED"].includes(survey.status)) {
    return <Notice text={t.expired} />;
  }
  const settings = tenantSettings(survey.tenant.settings);
  if (survey.status === "APPROVED") {
    if (!settings.customerSummary || !survey.totals) return <Notice text={t.closed} />;
    const language = survey.language as Language;
    return <CustomerSummary items={inventoryItems(survey.detections)} totals={survey.totals as Totals} language={language} t={t} />;
  }

  return (
    <CaptureApp
      token={token}
      mode={settings.captureMode}
      initialLanguage={survey.language as Language}
      started={survey.status === "IN_PROGRESS"}
      finished={survey.finishedAt !== null}
    />
  );
}

function Notice({ text }: { text: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center text-slate-700">
      <p>{text}</p>
    </main>
  );
}

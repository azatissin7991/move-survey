import type { Metadata } from "next";
import type { Language } from "@move-survey/contracts";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/customer";
import { DICTIONARIES } from "@/lib/i18n";
import { CaptureApp } from "@/components/capture/capture-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video survey", robots: { index: false, follow: false } };

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const survey = await db.survey.findUnique({
    where: { publicToken: token },
    include: { tenant: { select: { settings: true } } },
  });
  const t = DICTIONARIES[(survey?.language ?? "en") as Language];

  if (!survey || survey.expiresAt < new Date() || ["CANCELLED", "EXPIRED", "FAILED"].includes(survey.status)) {
    return <Notice text={t.expired} />;
  }
  if (survey.status === "APPROVED") return <Notice text={t.closed} />;

  return (
    <CaptureApp
      token={token}
      mode={tenantSettings(survey.tenant.settings).captureMode}
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

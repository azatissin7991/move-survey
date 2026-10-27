import type { Metadata } from "next";
import type { Language, RoomStatus } from "@move-survey/contracts";
import type { RoomType } from "@move-survey/catalog";
import { db } from "@/lib/db";
import { DICTIONARIES } from "@/lib/i18n";
import { CaptureApp } from "@/components/capture/capture-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Video survey", robots: { index: false, follow: false } };

export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const survey = await db.survey.findUnique({
    where: { publicToken: token },
    include: { rooms: { orderBy: { sortOrder: "asc" } } },
  });
  const language = (survey?.language ?? "en") as Language;
  const t = DICTIONARIES[language];

  const usable = survey && survey.expiresAt > new Date() && !["CANCELLED", "EXPIRED", "FAILED"].includes(survey.status);
  if (!usable) {
    return <Notice text={t.expired} />;
  }
  if (survey.status === "APPROVED") return <Notice text={t.closed} />;

  return (
    <CaptureApp
      token={token}
      initialLanguage={language}
      initialRooms={survey.rooms.map((r) => ({
        id: r.id,
        roomType: r.roomType as RoomType,
        label: r.label,
        status: r.status as RoomStatus,
      }))}
      finished={survey.finishedAt !== null && survey.status !== "IN_PROGRESS"}
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

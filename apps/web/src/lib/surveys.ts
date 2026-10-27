// Survey creation and the shapes the API returns.

import type { Prisma, Survey } from "@prisma/client";
import type { CreateSurveyRequest, SurveyStatus, SurveySummary } from "@move-survey/contracts";
import catalog from "@move-survey/catalog/dist/catalog.v1.json";
import { db } from "./db";
import { generateToken } from "./crypto";

export const CATALOG_VERSION: number = catalog.version;

export function customerUrl(token: string): string {
  return `${process.env.APP_URL ?? "http://localhost:3100"}/s/${token}`;
}

export async function createSurvey(tenantId: string, req: CreateSurveyRequest): Promise<Survey> {
  return db.survey.create({
    data: {
      tenantId,
      externalRef: req.externalRef,
      publicToken: generateToken(32),
      language: req.customer.language,
      customer: req.customer as Prisma.InputJsonValue,
      move: req.move as Prisma.InputJsonValue,
      catalogVersion: CATALOG_VERSION,
      expiresAt: new Date(Date.now() + req.expiresInDays * 86_400_000),
    },
  });
}

export function toSummary(survey: Survey): SurveySummary {
  return {
    id: survey.id,
    externalRef: survey.externalRef,
    status: survey.status as SurveyStatus,
    revision: survey.revision,
    customerUrl: customerUrl(survey.publicToken),
    expiresAt: survey.expiresAt.toISOString(),
    totals: (survey.totals as SurveySummary["totals"]) ?? null,
  };
}

/** A survey the customer link may still act on, or null (unknown, expired, closed). */
export async function surveyForToken(token: string) {
  const survey = await db.survey.findUnique({
    where: { publicToken: token },
    include: { rooms: { orderBy: { sortOrder: "asc" } } },
  });
  if (!survey) return null;
  if (survey.expiresAt < new Date() || ["CANCELLED", "EXPIRED"].includes(survey.status)) return null;
  return survey;
}

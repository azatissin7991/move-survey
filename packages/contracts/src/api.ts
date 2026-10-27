// Public REST API v1 and webhook payloads: the contract with the CRM.
// Breaking changes go in a new version; additive fields are fine.

import { z } from "zod";
import { ROOM_TYPES } from "@move-survey/catalog";
import { LANGUAGES, SURVEY_STATUSES } from "./survey";

export const createSurveyRequestSchema = z.object({
  externalRef: z.string().min(1).max(200).describe("The CRM's id for this quote/job"),
  customer: z.object({
    name: z.string().min(1).max(200),
    phone: z.string().max(40).optional(),
    email: z.string().email().optional(),
    language: z.enum(LANGUAGES).default("en"),
  }),
  move: z
    .object({
      homeType: z.enum(["apartment", "house", "townhouse", "condo", "storage", "office", "other"]).optional(),
      bedrooms: z.number().int().min(0).max(20).optional(),
      originAddress: z.string().max(500).optional(),
      moveDate: z.string().date().optional(),
    })
    .default({}),
  expiresInDays: z.number().int().min(1).max(60).default(14),
});
export type CreateSurveyRequest = z.infer<typeof createSurveyRequestSchema>;

export const surveySummarySchema = z.object({
  id: z.string(),
  externalRef: z.string(),
  status: z.enum(SURVEY_STATUSES),
  revision: z.number().int(),
  customerUrl: z.string().url(),
  expiresAt: z.string(),
  totals: z
    .object({ cuFt: z.number(), weightLbs: z.number(), items: z.number().int(), boxes: z.number().int() })
    .nullable(),
});
export type SurveySummary = z.infer<typeof surveySummarySchema>;

export const inventoryItemSchema = z.object({
  catalogId: z.string().nullable(),
  name: z.object({ en: z.string(), ru: z.string() }),
  roomType: z.enum(ROOM_TYPES),
  roomLabel: z.string(),
  quantity: z.number().int().positive(),
  cuFtEach: z.number().positive(),
  weightLbsEach: z.number().int().positive(),
  flags: z.array(z.enum(["fragile", "disassembly", "heavy", "crating", "special"])),
  notes: z.string(),
});

export const inventoryResponseSchema = z.object({
  surveyId: z.string(),
  revision: z.number().int(),
  catalogVersion: z.number().int(),
  items: z.array(inventoryItemSchema),
  totals: z.object({ cuFt: z.number(), weightLbs: z.number(), items: z.number().int(), boxes: z.number().int() }),
});
export type InventoryResponse = z.infer<typeof inventoryResponseSchema>;

export const outcomeRequestSchema = z.object({
  trucks: z.array(z.object({ capacityCuFt: z.number().int().nonnegative(), fillPct: z.number().int().min(0).max(100) })),
  extraTruckCuFt: z.number().int().nonnegative().nullable(),
  trips: z.number().int().positive().nullable(),
  boxCount: z.number().int().nonnegative().nullable(),
  actualWorkHours: z.number().nonnegative().nullable(),
  crewSize: z.number().int().positive().nullable(),
  serviceType: z.string().max(40),
  weighTicketLbs: z.number().int().positive().nullable(),
});
export type OutcomeRequest = z.infer<typeof outcomeRequestSchema>;

export const WEBHOOK_EVENTS = [
  "survey.started",
  "survey.processing_failed",
  "survey.ready_for_review",
  "survey.customer_confirmed",
  "survey.approved",
] as const;

/** Webhooks are deliberately thin: the CRM fetches the inventory itself. */
export const webhookPayloadSchema = z.object({
  event: z.enum(WEBHOOK_EVENTS),
  surveyId: z.string(),
  externalRef: z.string(),
  revision: z.number().int(),
  occurredAt: z.string(),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

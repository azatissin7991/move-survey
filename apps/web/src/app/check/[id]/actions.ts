"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildChecklist } from "@/lib/checklist";
import { checklistAllowed, type ReviewAuth } from "@/lib/review";

const inputSchema = z.object({
  counts: z.record(z.string(), z.number().int().min(0).max(999)),
  added: z.array(z.object({ catalogId: z.string(), roomLabel: z.string().min(1).max(60), quantity: z.number().int().min(1).max(999) })).max(200),
});

/** Save (or replace) the crew's checklist. */
export async function saveChecklist(auth: ReviewAuth, input: z.infer<typeof inputSchema>) {
  if (!checklistAllowed(auth)) throw new Error("This link has expired. Open it again from the CRM.");
  const data = inputSchema.parse(input);
  const survey = await db.survey.findUnique({ where: { id: auth.surveyId }, include: { detections: { orderBy: { createdAt: "asc" } } } });
  if (!survey?.totals) throw new Error("There's no inventory to check yet.");
  const checklist = buildChecklist(survey.detections, data, auth.user);
  await db.survey.update({ where: { id: survey.id }, data: { checklist: checklist as unknown as Prisma.InputJsonValue } });
  revalidatePath(`/check/${survey.id}`);
}

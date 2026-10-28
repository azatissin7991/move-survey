import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { settingsUpdateSchema, type SettingsResponse } from "@move-survey/contracts";
import { authenticate, jsonError, parseBody } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const response = (t: { name: string; webhookUrl: string; settings: unknown }): SettingsResponse => ({
  name: t.name,
  webhookUrl: t.webhookUrl,
  settings: tenantSettings(t.settings),
});

/** The company's settings, so the CRM can show them on its own settings page. */
export async function GET(request: Request) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  return NextResponse.json(response(await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })));
}

/** Change some settings; anything left out stays as it is. */
export async function PATCH(request: Request) {
  const tenant = await authenticate(request);
  if (!tenant) return jsonError(401, "Invalid or missing API key");
  const body = await parseBody(request, settingsUpdateSchema);
  if ("response" in body) return body.response;
  const current = await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
  const updated = await db.tenant.update({
    where: { id: tenant.id },
    data: {
      webhookUrl: body.data.webhookUrl ?? current.webhookUrl,
      settings: { ...tenantSettings(current.settings), ...body.data.settings } as Prisma.InputJsonValue,
    },
  });
  return NextResponse.json(response(updated));
}

// Per-company settings, stored as JSON on the tenant. Reads never fail: a
// missing or bad value falls back to its default.

import { z } from "zod";
import { TENANT_DEFAULTS, tenantSettingsSchema, type TenantSettings } from "@move-survey/contracts";

const shape = tenantSettingsSchema.shape;
const lenient = z.object({
  captureMode: shape.captureMode.catch(TENANT_DEFAULTS.captureMode),
  autoApprove: shape.autoApprove.catch(TENANT_DEFAULTS.autoApprove),
  customerSummary: shape.customerSummary.catch(TENANT_DEFAULTS.customerSummary),
  retentionDays: shape.retentionDays.catch(TENANT_DEFAULTS.retentionDays),
});

export function tenantSettings(settings: unknown): TenantSettings {
  return lenient.parse(settings && typeof settings === "object" ? settings : {});
}

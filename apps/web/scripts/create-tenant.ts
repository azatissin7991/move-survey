// Create a tenant (one per moving company / CRM deployment) and its first API
// key. The key and webhook secret print once; put them in the CRM's env as
// SURVEY_API_KEY and SURVEY_WEBHOOK_SECRET.
//
//   npm run tenant:create -w @move-survey/web -- "Prime Moving" prime-moving https://crm.example.com/api/webhooks/survey

import { PrismaClient } from "@prisma/client";
import { generateApiKey, generateToken } from "../src/lib/crypto";

async function main() {
  const [name, slug, webhookUrl = ""] = process.argv.slice(2);
  if (!name || !slug || !/^[a-z0-9-]+$/.test(slug)) {
    console.error('Usage: tenant:create "<name>" <slug> [webhookUrl]');
    process.exit(1);
  }
  const db = new PrismaClient();
  const webhookSecret = generateToken(32);
  const tenant = await db.tenant.create({ data: { name, slug, webhookUrl, webhookSecret } });
  const { key, prefix, hash } = generateApiKey();
  await db.apiKey.create({ data: { tenantId: tenant.id, name: "default", prefix, hash } });
  await db.$disconnect();

  console.log(`Tenant ${tenant.name} (${tenant.id})`);
  console.log(`SURVEY_API_KEY=${key}`);
  console.log(`SURVEY_WEBHOOK_SECRET=${webhookSecret}`);
  console.log("These are shown once. Store them in the CRM deployment's environment.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

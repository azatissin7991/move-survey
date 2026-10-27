# move-survey

AI video inventory survey for moving companies. The customer records each
room from a link, and the service produces an inventory (items, cu ft, weight,
boxes, special handling) that an estimator reviews and pushes into the CRM.

Status: **phase 1 in progress.** Customers can record and upload; the AI
pipeline, the review screen and the CRM integration come next.

| Folder | What | State |
| --- | --- | --- |
| `catalog/` | item catalog, build/validate, box estimates — see [CATALOG.md](catalog/CATALOG.md) | v1 draft, 175 items |
| `packages/contracts/` | shared zod schemas (API, webhooks, AI output) → JSON Schema in `dist/` | done for phase 1 |
| `apps/web/` | Next.js: customer capture, API v1, webhook outbox | capture + API working locally |
| `worker/` | Python on Modal: ingest, Claude analysis, sizing | not started |
| `eval/` | golden set, runner, metrics | not started |

## Run locally

Needs Node 22 and a local Postgres.

```bash
npm install
cp apps/web/.env.example apps/web/.env      # set DATABASE_URL, APP_SECRET
createdb move_survey
npm run db:migrate -w @move-survey/web
npm run tenant:create -w @move-survey/web -- "Dev company" dev-company
npm run dev                                  # http://localhost:3100
```

`tenant:create` prints an API key once. Create a survey with it:

```bash
curl -X POST localhost:3100/api/v1/surveys \
  -H "authorization: Bearer <key>" -H "content-type: application/json" \
  -d '{"externalRef":"quote-1","customer":{"name":"Ann","language":"en"}}'
```

Open the returned `customerUrl` on a phone (the camera needs HTTPS or
localhost; use a tunnel such as `cloudflared` to test on a real device).

## How uploads work

The recorder emits a chunk every 2 seconds. Each chunk is saved to the
phone's IndexedDB first, then uploaded to its own object
(`surveys/<id>/rooms/<room>/r<revision>/<media>/chunk-NNNNN`) through a
presigned URL: R2 in production, a signed local route in dev. Chunks
concatenate back into one file in the worker. A page reload, lost signal or
iOS suspending the tab doesn't lose footage; the queue resumes when the page
is visible again. Recording a room again bumps its revision, and pipeline
results for an older revision are dropped.

```bash
npm test          # all workspaces
npm run typecheck
```

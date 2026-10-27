# move-survey

AI video inventory survey for moving companies. The customer records each
room from a link, and the service produces an inventory (items, cu ft, weight,
boxes, special handling) that an estimator reviews and pushes into the CRM.

Status: **phase 1 in progress.** Recording and upload work; the AI pipeline,
the review screen and the CRM integration come next.

Design rule: near zero effort for whoever records (customer, helper or
foreman) and whoever reviews. Open the link, tap Start, walk through, tap
Done. Nobody measures or answers questions; where the AI is unsure the
estimate's range widens instead.

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

## How capture works

By default the whole home is one walk-through; "Next room" just starts a new
segment so rooms are easier to tell apart, and the AI works out which room is
which. A company can switch to room-by-room mode (`captureMode: "rooms"` in
the tenant's `settings`), which asks "Which room?" before each segment.

Each segment is a MediaRecorder emitting a chunk every 2 seconds. Chunks go
to the phone's IndexedDB first, then upload to their own objects
(`surveys/<id>/rooms/<segment>/<media>/chunk-NNNNN`) through presigned URLs:
R2 in production, a signed local route in dev. They concatenate back into one
file in the worker. A reload, lost signal or iOS suspending the tab doesn't
lose footage; uploads resume when the page is visible again, including after
Done.

```bash
npm test          # all workspaces
npm run typecheck
```

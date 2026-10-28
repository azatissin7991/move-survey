# move-survey

AI video inventory survey for moving companies. Whoever records (customer,
helper or foreman) opens a link, taps Start, walks through the home, taps
Done. AI turns the footage into an inventory with a ballpark range and
suggested crew, trucks and hours; an estimator approves it in one tap (or it
auto-approves) and it lands on the CRM quote.

Design rule: near zero effort for whoever records and whoever reviews. Nobody
measures or answers questions; where the AI is unsure, the estimate's range
widens instead.

| Folder | What |
| --- | --- |
| `catalog/` | our item catalog (EN/RU names, sizes, variants, handling flags), box-estimate table, build and checks. See [CATALOG.md](catalog/CATALOG.md). v1: 175 draft items. |
| `packages/contracts/` | shared zod schemas: API, webhooks, the AI's output format. JSON Schema in `dist/`. |
| `apps/web/` | the service: capture page, AI pipeline, review screen, API v1, webhooks, crons. |
| `eval/golden/` | verified inventories of real homes for accuracy checks. See its README. |

## How it works

1. **CRM** creates a survey (`POST /api/v1/surveys`) and sends the link.
2. **Capture** (`/s/<token>`, EN/RU). One walk-through by default; "Next room"
   starts a new segment. Room-by-room mode is a per-company setting. Each
   segment records three streams into IndexedDB and uploads them in the
   background through presigned URLs:
   - video, kept for the reviewer;
   - sharp, distinct JPEG stills picked on the phone, which is what the AI reads;
   - narration audio ("the piano stays").
   Uploads survive lock screens and reloads, and keep going after Done.
3. **Pipeline** (`src/lib/pipeline.ts`, runs inside the app). It starts after
   Done, waits for the uploads, and is continued by a cron every minute; each
   step saves its progress.
   - **Narration:** transcribed by Gemini (optional).
   - **Frames:** sent to Claude (`claude-opus-5-5`, structured output) in
     batches of 20, in recording order, carrying the inventory found so far. That
     is what keeps an item seen twice from being counted twice.
   - **Finalize** (`src/lib/estimate.ts`):
     - catalog values are frozen on each line;
     - custom items are sized from their dimensions;
     - unseen packed boxes are estimated per room from how full it looked;
     - totals get a range from the model's confidence, estimated boxes and
       unseen areas;
     - crew, trucks and hours are suggested.
4. **Review** (`/review/<id>`, a 12-hour signed link minted by the CRM): one
   tap to approve; optional quantity, not-moving and add-item edits (each one is
   logged as a correction); CSV; printable page for PDF. With `autoApprove` in
   the tenant settings, confident surveys skip review.
5. **CRM** gets a thin signed webhook, fetches `/inventory` and applies it.
   After the move it sends the crew's load report back (`PUT /outcome`).

## Run locally

Needs Node 22 and Postgres.

```bash
npm install
cp apps/web/.env.example apps/web/.env      # DATABASE_URL, APP_SECRET; ANTHROPIC_API_KEY for real analysis
createdb move_survey
npm run db:migrate -w @move-survey/web
npm run tenant:create -w @move-survey/web -- "Dev company" dev-company http://localhost:3000/api/webhooks/survey
npm run dev                                  # http://localhost:3100
```

`tenant:create` prints the API key and webhook secret once; they go in the
CRM's `SURVEY_API_KEY` and `SURVEY_WEBHOOK_SECRET`. The camera needs HTTPS or
localhost. To test on a phone, use a tunnel such as `cloudflared`.

Without an API key, `npx tsx scripts/dev-fake-analysis.ts <surveyId>` (in
`apps/web`) runs the real pipeline with a stand-in for Claude.

## Accuracy

```bash
cd apps/web
npx tsx scripts/eval.ts --split test            # score golden homes
npx tsx scripts/eval.ts --split test --rerun    # re-analyze first (after a prompt/model/catalog change)
npx tsx scripts/calibration.ts                  # estimates vs loaded truck volume from CRM outcomes
```

## Deploy (Vercel)

- **Project:** one Vercel project for `apps/web`, with Neon Postgres (`DATABASE_URL` pooled, `DIRECT_URL` direct).
- **Storage:** a private Cloudflare R2 bucket (`STORAGE_DRIVER=r2` plus the `R2_*` vars). Its CORS must allow PUT from the app's origin and expose `ETag`.
- **Secrets:** `APP_URL`, `APP_SECRET`, `ANTHROPIC_API_KEY`, optionally `GEMINI_API_KEY`, and `CRON_SECRET`.
- **Crons** (`apps/web/vercel.json`): `/api/cron/pipeline` and `/api/cron/webhooks` every minute, which needs the Pro plan.
- **Companies:** one tenant per company, created with `tenant:create`. Settings JSON on the tenant: `{ "captureMode": "walkthrough" | "rooms", "autoApprove": true | false }`.

```bash
npm test          # all workspaces
npm run typecheck
```

# move-survey

AI video inventory survey for moving companies. The customer records each
room from a link, and the service produces an inventory (items, cu ft, weight,
boxes, special handling) that an estimator reviews and pushes into the CRM.

Status: **phase 0**. The catalog is built; the web app, worker and eval harness
come next.

| Folder | What | State |
| --- | --- | --- |
| `catalog/` | item catalog, build/validate, box estimates — see [CATALOG.md](catalog/CATALOG.md) | v1 draft, 175 items |
| `apps/web/` | Next.js: capture, review, API, webhooks | not started |
| `worker/` | Python on Modal: ingest, Claude analysis, sizing | not started |
| `packages/contracts/` | shared zod schemas → JSON Schema → pydantic | not started |
| `eval/` | golden set, runner, metrics | not started |

```bash
npm install
npm run catalog:build
npm test
```

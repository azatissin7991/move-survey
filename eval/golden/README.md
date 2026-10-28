# Golden homes

Real surveys with a verified inventory, used to measure accuracy and to catch
regressions when the prompt, model or catalog changes.

One JSON file per home:

```json
{
  "surveyId": "cm…",
  "split": "dev",
  "note": "3-bed house, Portland, recorded by foreman",
  "truth": [
    { "catalogId": "sofa-3-seat", "quantity": 1 },
    { "catalogId": "box-medium-3.0", "quantity": 24 }
  ]
}
```

- `truth` is the inventory as actually moved: the estimator's checked list,
  corrected by the crew after the move. Use catalog ids (`catalog/data/items`).
- Put about a third of the homes in `"split": "test"` and never tune prompts
  against them; tune on `dev`, report `test`.
- Run from `apps/web`:
  `npx tsx scripts/eval.ts --split test` (score current results), or add
  `--rerun` to analyze again with the current setup (uses the API).

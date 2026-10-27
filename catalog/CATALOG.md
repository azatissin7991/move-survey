# Item catalog

The survey's AI picks items from this catalog instead of guessing volumes, so
its accuracy sets the ceiling for every estimate. It is separate from the CRM's
own cube sheet, and the CRM receives survey items as snapshots.

## Layout

| Path | What |
| --- | --- |
| `data/catalog.yaml` | version, weight rule, shape factors, sources registry |
| `data/items/*.yaml` | items, one file per area |
| `data/boxes.yaml` | expected boxes per room type × fullness |
| `data/references/*.csv` | outside tables we compare against (never copied) |
| `dist/catalog.vN.json` | compiled catalog read by the web app and the worker |
| `dist/REPORT.md` | counts, review status, warnings |

```bash
npm run build -w catalog   # validate + write dist/
npm run check -w catalog   # validate only (CI)
npm test -w catalog
```

## Rules

- **Volume** (`cuFt`) is loaded, padded space on the truck, not the item's box.
  Typical outside dimensions (`dims`, inches, `[min, max]`) let the build sanity-check it
  against `boxRatioBounds` for the item's `shape`.
- **Weight** is an *estimating* weight: `cuFt × 7` (industry convention) unless
  `weightLbs` overrides it with a `weightNote`. Override only when the rule is
  clearly wrong (mattresses, appliances, safes, iron, dense boxes).
- **Heavy** (`heavy: true`) means a real weight of 300 lb or more. It is set by hand,
  because estimating weights would flag every sofa.
- **Size variants** share a `sizeGroup`. Each has a `sizeRule` on one dimension
  (`l`, `w`, `h` or `diag`); ranges are `[min, max)` and must not overlap.
  Stage D and "please measure" answers use them to pick the variant.
- **Packing** lists materials an item needs (TV carton, mirror carton). It never
  adds volume; boxes count as items only when the customer has already packed them.
- **Items not in the catalog** are priced from measured dims with
  `customLoadedFactor[shape]` (`customItemCuFt`).
- **Names and aliases** come in English and Russian. They drive AI matching and
  customer search, so an alias shared by two items is a warning.

## Sources and review

Every number needs a source from the registry in `catalog.yaml`. v1 is drafted
(`est-draft`, kind `estimate`) and **all 175 items are `review: draft`**.
To sign off an item:

1. Check it against a real source: the USTRANSCOM weight estimator (see
   `data/references/README.md`), manufacturer specs, or our own job outcomes.
2. Replace or add `sources` entries that point at that source (add it to the
   registry first if it is new).
3. Set `review: reviewed` (checked) or `signed_off` (approved for production).

Published industry cube sheets may be added as references for comparison, but
their values are never copied in.

## Versioning

Bump `version` in `catalog.yaml` for any change to item values. Each survey
stores the version it used, and its detections snapshot their values, so a new
version never changes a past survey. The calibration loop proposes changes as
a normal reviewed diff.

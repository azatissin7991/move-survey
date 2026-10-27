# Reference tables

Each `*.csv` here is compared against the catalog on every build. Items that
differ by more than `referenceTolerance` (catalog.yaml) show up as warnings in
`dist/REPORT.md`. References are for checking our numbers, never copied in.

Columns: `catalogId,cuFt,weightLbs,ref`. Either number may be blank. Lines
starting with `#` are ignored.

## To add the US military weight estimator

1. Download the spreadsheet from the USTRANSCOM weight estimator page
   (https://www.business.ustranscom.mil/dp3/weightestimator.cfm) in a browser.
2. For each row that matches a catalog item, add a line to
   `usmil-weight-estimator.csv` with our `catalogId` and their weight.
3. Run `npm run build -w catalog` and review the warnings.
4. Where you accept their number, add
   `{ field: weight, ref: usmil-weight-estimator }` to the item's `sources`.

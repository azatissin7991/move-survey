// Compile data/ into dist/catalog.vN.json and dist/REPORT.md.
//
//   npm run build -w catalog          write dist/
//   npm run check -w catalog          validate only; exit 1 on errors
//
// The output has no timestamp so a rebuild with unchanged data is a no-op diff.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  boxEstimateSchema,
  itemFileSchema,
  itemSourceSchema,
  settingsSchema,
  type Catalog,
  type CatalogItem,
  type ItemSource,
} from "./schema";
import { checkCatalog, compileItem, type Issue, type ReferenceRow } from "./derive";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");

function readYaml(file: string): unknown {
  return parse(readFileSync(file, "utf8"));
}

function formatZod(file: string, where: string, error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((i) => `${file} ${where} ${i.path.join(".")}: ${i.message}`).join("\n");
}

/** Minimal CSV: header row, comma-separated, no quoted commas. */
export function parseReferenceCsv(text: string, fileRef: string): ReferenceRow[] {
  const [header, ...lines] = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (!header) return [];
  const cols = header.split(",").map((c) => c.trim());
  const at = (row: string[], name: string) => {
    const v = row[cols.indexOf(name)]?.trim();
    return v ? v : undefined;
  };
  return lines.map((line) => {
    const row = line.split(",");
    const cuFt = at(row, "cuFt");
    const weight = at(row, "weightLbs");
    return {
      catalogId: at(row, "catalogId") ?? "",
      ...(cuFt ? { cuFt: Number(cuFt) } : {}),
      ...(weight ? { weightLbs: Number(weight) } : {}),
      ref: at(row, "ref") ?? fileRef,
    };
  });
}

export function loadAndCompile(dir = dataDir): { catalog: Catalog; issues: Issue[] } {
  const settings = settingsSchema.parse(readYaml(path.join(dir, "catalog.yaml")));

  const sources: ItemSource[] = [];
  const parseErrors: string[] = [];
  const itemDir = path.join(dir, "items");
  for (const file of readdirSync(itemDir).filter((f) => f.endsWith(".yaml")).sort()) {
    const parsedFile = itemFileSchema.safeParse(readYaml(path.join(itemDir, file)));
    if (!parsedFile.success) {
      parseErrors.push(formatZod(file, "", parsedFile.error));
      continue;
    }
    parsedFile.data.items.forEach((raw, index) => {
      const parsed = itemSourceSchema.safeParse(raw);
      if (!parsed.success) {
        const id = (raw as { id?: string })?.id ?? `#${index}`;
        parseErrors.push(formatZod(file, id, parsed.error));
        return;
      }
      const item = parsed.data;
      if (item.sources.length === 0) item.sources = parsedFile.data.defaultSources;
      sources.push(item);
    });
  }
  if (parseErrors.length) throw new Error(`Catalog data is invalid:\n${parseErrors.join("\n")}`);

  const boxEstimates = boxEstimateSchema.parse(readYaml(path.join(dir, "boxes.yaml")));

  const references: ReferenceRow[] = [];
  const refDir = path.join(dir, "references");
  if (existsSync(refDir)) {
    for (const file of readdirSync(refDir).filter((f) => f.endsWith(".csv"))) {
      references.push(...parseReferenceCsv(readFileSync(path.join(refDir, file), "utf8"), file));
    }
  }

  const items: CatalogItem[] = sources.map((s) => compileItem(s, settings));
  const issues = checkCatalog(items, settings, references);

  const knownIds = new Set(items.map((i) => i.id));
  for (const [room, levels] of Object.entries(boxEstimates.rooms)) {
    for (const counts of Object.values(levels)) {
      for (const boxId of Object.keys(counts)) {
        if (!knownIds.has(boxId)) issues.push({ level: "error", message: `boxes.yaml ${room}: unknown box "${boxId}"` });
      }
    }
  }

  return {
    catalog: {
      version: settings.version,
      densityLbsPerCuFt: settings.densityLbsPerCuFt,
      customLoadedFactor: settings.customLoadedFactor,
      sources: settings.sources,
      items,
      boxEstimates,
    },
    issues,
  };
}

export function renderReport(catalog: Catalog, issues: Issue[]): string {
  const count = (pred: (i: CatalogItem) => boolean) => catalog.items.filter(pred).length;
  const byCategory = new Map<string, number>();
  for (const i of catalog.items) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);
  const sourceKind = new Map(catalog.sources.map((s) => [s.id, s.kind]));
  const estimateOnly = count((i) => i.sources.every((s) => sourceKind.get(s.ref) === "estimate"));

  const lines = [
    `# Catalog v${catalog.version} — build report`,
    "",
    `Items: **${catalog.items.length}** · signed off: ${count((i) => i.review === "signed_off")} · reviewed: ${count((i) => i.review === "reviewed")} · draft: ${count((i) => i.review === "draft")}`,
    `Backed only by estimates (need a citation): **${estimateOnly}**`,
    `Weight overrides: ${count((i) => i.weightBasis === "override")} · heavy: ${count((i) => i.heavy)} · special handling: ${count((i) => !!i.special)}`,
    "",
    "## Items per category",
    "",
    ...[...byCategory].map(([c, n]) => `- ${c}: ${n}`),
    "",
    `## Issues (${issues.length})`,
    "",
    ...(issues.length
      ? issues.map((i) => `- **${i.level}**${i.itemId ? ` \`${i.itemId}\`` : ""}: ${i.message}`)
      : ["None."]),
    "",
  ];
  return lines.join("\n");
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { catalog, issues } = loadAndCompile();
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.length - errors.length;

  for (const i of issues) console.log(`${i.level.toUpperCase()} ${i.itemId ?? ""} ${i.message}`);
  console.log(`${catalog.items.length} items, ${errors.length} errors, ${warnings} warnings`);
  if (errors.length) process.exit(1);
  if (checkOnly) return;

  const dist = path.join(root, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, `catalog.v${catalog.version}.json`), JSON.stringify(catalog, null, 2) + "\n");
  writeFileSync(path.join(dist, "REPORT.md"), renderReport(catalog, issues));
  console.log(`wrote dist/catalog.v${catalog.version}.json and dist/REPORT.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();

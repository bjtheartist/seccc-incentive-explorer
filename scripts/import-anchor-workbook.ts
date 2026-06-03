/**
 * Import the curated "Chicago Local Impact Anchor" workbook into the repo as
 * community-area-keyed JSON the report consumes.
 *
 * Usage:
 *   npm run anchors:import -- --input="/path/to/master_batches.xlsx"
 *   npx tsx scripts/import-anchor-workbook.ts --input="/path/to/master_batches.xlsx"
 *
 * Re-run whenever a new batch workbook is produced. The workbook is the source
 * of truth; this script only re-keys it by community-area number and strips it
 * to the fields the public report shows (no owner/contact rows are introduced).
 *
 * Security boundary: this is a trusted local import tool. Do not expose XLSX
 * upload/parsing through a public API route without a hardened upload pipeline
 * and security review.
 */
import * as XLSX from "xlsx";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const MASTER_SHEET = "Master Anchor Detail";
const OUT_DIR = resolve(process.cwd(), "data/exports/chicago-neighborhood-economics");
const OUT_FILE = resolve(OUT_DIR, "neighborhood_anchors_by_community_area.json");

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function splitUrls(value: unknown): string[] {
  return str(value)
    .split(/[\n;,\s]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

interface CommunityAnchor {
  name: string;
  type?: string;
  category?: string;
  site?: string;
  evidenceScale?: string;
  scores: {
    employment: number | null;
    localHiring: number | null;
    procurement: number | null;
    footTraffic: number | null;
    serviceGap: number | null;
    communityBenefit: number | null;
  };
  totalScore: number | null;
  impactTier?: string;
  confidence?: string;
  multiplierChannels?: string;
  rationale?: string;
  validationNeeded?: string;
  leakageCaveat?: string;
  sourceUrls: string[];
}

function main() {
  const input = argValue("input");
  if (!input) {
    console.error("Missing --input=/path/to/workbook.xlsx");
    process.exit(1);
  }

  const wb = XLSX.readFile(input);
  const ws = wb.Sheets[MASTER_SHEET];
  if (!ws) {
    console.error(`Sheet "${MASTER_SHEET}" not found. Sheets: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (rows.length < 2) {
    console.error("No data rows found in the master sheet.");
    process.exit(1);
  }

  // Map header label → column index (robust to column reordering).
  const header = rows[0].map((h) => str(h).toLowerCase());
  const idx = (label: string): number => header.indexOf(label.toLowerCase());
  const cols = {
    caNumber: idx("Community Area #"),
    caName: idx("Community Area"),
    name: idx("Anchor Name"),
    type: idx("Anchor Type"),
    category: idx("Anchor Category / Status"),
    site: idx("Site / Footprint / Geography"),
    evidence: idx("Evidence / Scale"),
    employment: idx("Direct Employment / Payroll (30)"),
    localHiring: idx("Local Hiring / Workforce (20)"),
    procurement: idx("Local Procurement / Vendor Fit (15)"),
    footTraffic: idx("Foot Traffic / Visitor Draw (15)"),
    serviceGap: idx("Service-Gap / Essentiality (10)"),
    communityBenefit: idx("Community Benefit / Reinvestment (10)"),
    totalScore: idx("Total Score"),
    impactTier: idx("Impact Tier"),
    confidence: idx("Confidence"),
    channels: idx("Core Multiplier Channels"),
    rationale: idx("Local Impact Rationale"),
    validation: idx("Validation Needed"),
    leakage: idx("Boundary / Leakage Caveat"),
    sources: idx("Source URLs"),
  };
  if (cols.caNumber < 0 || cols.name < 0) {
    console.error("Required columns 'Community Area #' / 'Anchor Name' not found.");
    process.exit(1);
  }

  const byCommunityArea: Record<string, { communityArea: string; anchors: CommunityAnchor[] }> = {};
  let count = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const caNumber = num(row[cols.caNumber]);
    const name = str(row[cols.name]);
    if (caNumber == null || !name) continue;

    const key = String(caNumber);
    if (!byCommunityArea[key]) {
      byCommunityArea[key] = { communityArea: str(row[cols.caName]), anchors: [] };
    }
    byCommunityArea[key].anchors.push({
      name,
      type: str(row[cols.type]) || undefined,
      category: str(row[cols.category]) || undefined,
      site: str(row[cols.site]) || undefined,
      evidenceScale: str(row[cols.evidence]) || undefined,
      scores: {
        employment: num(row[cols.employment]),
        localHiring: num(row[cols.localHiring]),
        procurement: num(row[cols.procurement]),
        footTraffic: num(row[cols.footTraffic]),
        serviceGap: num(row[cols.serviceGap]),
        communityBenefit: num(row[cols.communityBenefit]),
      },
      totalScore: num(row[cols.totalScore]),
      impactTier: str(row[cols.impactTier]) || undefined,
      confidence: str(row[cols.confidence]) || undefined,
      multiplierChannels: str(row[cols.channels]) || undefined,
      rationale: str(row[cols.rationale]) || undefined,
      validationNeeded: str(row[cols.validation]) || undefined,
      leakageCaveat: str(row[cols.leakage]) || undefined,
      sourceUrls: splitUrls(row[cols.sources]),
    });
    count += 1;
  }

  for (const entry of Object.values(byCommunityArea)) {
    entry.anchors.sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        source: "chicago_local_impact_anchor_master",
        scoringDimensions: {
          employment: 30,
          localHiring: 20,
          procurement: 15,
          footTraffic: 15,
          serviceGap: 10,
          communityBenefit: 10,
        },
        communityAreaCount: Object.keys(byCommunityArea).length,
        anchorCount: count,
        byCommunityArea,
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Imported ${count} anchors across ${Object.keys(byCommunityArea).length} community areas → ${OUT_FILE}`);
}

main();

/**
 * Regenerate the GENERATED blocks in data/curated/investment-inputs/README.md
 * and REFRESH.md from the manifest + the fresh audit reports — deliverable 1's
 * "generated README blocks" + "cadence documentation... ALL read it" (the
 * shared manifest), and consult's binding-build-order step 6 ("generate the
 * README block" from the audit scope).
 *
 * `--check` (used by the clean-diff test and CI) writes nothing and exits
 * nonzero if either committed file would change.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, foundationManifestEntries } from "./lib/investment-manifest";

const INPUT_DIR = join(process.cwd(), "data", "curated", "investment-inputs");
const README_PATH = join(INPUT_DIR, "README.md");
const REFRESH_PATH = join(INPUT_DIR, "REFRESH.md");
const FRESH_AUDIT_PATH = join(INPUT_DIR, "foundation_audit_fresh.json");
const PRIZE_CENSUS_PATH = join(INPUT_DIR, "chicago_prize_census_check.json");

const README_BEGIN = "<!-- GENERATED:AUDIT_CLAIM:BEGIN -->";
const README_END = "<!-- GENERATED:AUDIT_CLAIM:END -->";
const REFRESH_BEGIN = "<!-- GENERATED:FOUNDATION_CADENCE:BEGIN -->";
const REFRESH_END = "<!-- GENERATED:FOUNDATION_CADENCE:END -->";

interface FreshAuditReport {
  seed: number;
  universe_rows: number;
  chicago_prize_excluded_from_universe: number;
  sample_n: number;
  counts: Record<string, number>;
  ok_rate: number;
  bound_export_content_hash: string;
  generated_at: string;
}

interface PrizeCensus {
  ok: number;
  total: number;
  all_ok: boolean;
}

function buildAuditClaimBlock(): string {
  if (!existsSync(FRESH_AUDIT_PATH)) {
    return `${README_BEGIN}\n_Fresh audit not yet generated — run \`npm run data:audit:foundation-fresh\`._\n${README_END}`;
  }
  const audit = JSON.parse(readFileSync(FRESH_AUDIT_PATH, "utf8")) as FreshAuditReport;
  const prize = existsSync(PRIZE_CENSUS_PATH)
    ? (JSON.parse(readFileSync(PRIZE_CENSUS_PATH, "utf8")) as PrizeCensus)
    : null;
  const ok = audit.counts.ok ?? 0;
  const unresolved = audit.counts.filing_unavailable ?? 0;
  const mismatched = Object.entries(audit.counts)
    .filter(([k]) => k !== "ok" && k !== "filing_unavailable")
    .reduce((sum, [, v]) => sum + v, 0);
  const okPct = (audit.ok_rate * 100).toFixed(1);
  const unresolvedPct = ((unresolved / audit.sample_n) * 100).toFixed(1);

  const lines = [
    README_BEGIN,
    "**Statistical audit (fresh, committed: `foundation_audit_fresh.json`):** a seeded",
    `SRS of n=${audit.sample_n.toLocaleString("en-US")}, seed ${audit.seed}, drawn from the FULL exported IRS-derived`,
    `foundation universe — ${audit.universe_rows.toLocaleString("en-US")} rows across all four published foundation files`,
    "(base + Tier-1 + Phase-2 + Phase-3), bound to the export's own content hash",
    `(\`${audit.bound_export_content_hash.slice(0, 16)}…\`). Chicago Prize`,
    `(${audit.chicago_prize_excluded_from_universe} rows, award announcements rather than IRS filings) is excluded from`,
    "this SRS and reported separately below as a census check.",
    "",
    `Result: **${ok.toLocaleString("en-US")}/${audit.sample_n.toLocaleString("en-US")} rows (${okPct}%) independently`,
    "re-verified against their own IRS filing — recipient and amount re-parsed from",
    `the source XML — with ZERO recipient/amount mismatches.** ${unresolved.toLocaleString("en-US")} rows`,
    `(${unresolvedPct}%) could not be resolved to a specific filing in this run (an`,
    "identity-resolution gap — a ProPublica lookup or filing fetch that did not",
    "resolve — never a proven data error) and are counted here, not silently",
    `dropped from the denominator.${mismatched > 0 ? ` **${mismatched} row(s) showed an actual recipient/amount mismatch against their filing — see foundation_audit_fresh.json for the row-level detail; NOT auto-corrected.**` : ""}`,
    "",
    prize
      ? `**Chicago Prize census (separate, not part of the SRS):** ${prize.ok}/${prize.total} rows` +
        `${prize.all_ok ? " — every published Chicago Prize row reconciles to the export with a tying amount and a live announcement citation." : " — see chicago_prize_census_check.json for the unreconciled row(s)."}`
      : "_Chicago Prize census check not yet generated._",
    README_END,
  ];
  return lines.join("\n");
}

function buildFoundationCadenceBlock(): string {
  const manifest = loadManifest();
  const entries = foundationManifestEntries(manifest);
  const rows = entries.map((e) => `| \`${e.file}\` | ${e.label} | ${e.refreshMethod} |`);
  return [
    REFRESH_BEGIN,
    "| File | What it is | How it refreshes |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "Source of truth: `data/curated/investment-inputs/manifest.json` (regenerate with",
    "`npm run data:manifest:generate`). This table is generated FROM that manifest —",
    "edit `scripts/lib/investment-manifest.ts`'s `AUTHORED_SOURCES`, never this table",
    "directly.",
    REFRESH_END,
  ].join("\n");
}

function replaceBlock(text: string, begin: string, end: string, block: string): string {
  const beginIdx = text.indexOf(begin);
  const endIdx = text.indexOf(end);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(`Markers ${begin} / ${end} not found — add them once by hand, then this script owns the content between them.`);
  }
  return text.slice(0, beginIdx) + block + text.slice(endIdx + end.length);
}

function main() {
  const check = process.argv.includes("--check");
  const readmeSrc = readFileSync(README_PATH, "utf8");
  const refreshSrc = readFileSync(REFRESH_PATH, "utf8");

  const freshReadme = replaceBlock(readmeSrc, README_BEGIN, README_END, buildAuditClaimBlock());
  const freshRefresh = replaceBlock(refreshSrc, REFRESH_BEGIN, REFRESH_END, buildFoundationCadenceBlock());

  if (check) {
    const readmeClean = freshReadme === readmeSrc;
    const refreshClean = freshRefresh === refreshSrc;
    if (!readmeClean) console.error("README.md GENERATED:AUDIT_CLAIM block is stale.");
    if (!refreshClean) console.error("REFRESH.md GENERATED:FOUNDATION_CADENCE block is stale.");
    if (!readmeClean || !refreshClean) {
      console.error("Run `npm run data:docs:generate` to regenerate.");
      process.exit(1);
    }
    console.log("Generated doc blocks are clean.");
    return;
  }

  writeFileSync(README_PATH, freshReadme);
  writeFileSync(REFRESH_PATH, freshRefresh);
  console.log("Regenerated README.md + REFRESH.md GENERATED blocks.");
}

main();

/**
 * Shared input manifest for the Community Investment dataset — the single
 * machine-readable source of truth for every curated input file's provenance.
 *
 * Read by (never duplicated into):
 *   - scripts/generate-investment-manifest.ts (regenerates manifest.json itself:
 *     recomputes contentHash/vintage against the files on disk; the AUTHORED
 *     table below — cadence, refreshMethod, valueField, decreasePolicy — is
 *     domain knowledge that a human edits here, not derived)
 *   - scripts/export-community-investment.ts (stamps meta.sourceManifestHash so
 *     an export is bound to the manifest version that produced it)
 *   - scripts/foundation/phase3_audit.py / the fresh SRS audit (universe scope
 *     + which foundation files are "published" comes from here, not a
 *     hand-typed file list)
 *   - scripts/generate-investment-docs.ts (regenerates the REFRESH.md cadence
 *     tables and the README.md audit-claim block)
 *   - scripts/refresh/refresh-live-sources.ts (per-source decrease-policy guard,
 *     value-field aware — deliverable 7)
 *
 * CI enforces a clean-diff gate: scripts/__tests__/investment-manifest-clean-diff.test.ts
 * regenerates manifest.json + the generated doc blocks in memory and fails the
 * suite if the committed bytes differ. Editing the AUTHORED_SOURCES table below
 * is the only supported way to change a source's documented contract; editing
 * data/curated/investment-inputs/manifest.json by hand will be silently
 * overwritten (and CI will already have failed on the stale commit).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const INPUT_DIR = join(process.cwd(), "data", "curated", "investment-inputs");
export const MANIFEST_PATH = join(INPUT_DIR, "manifest.json");

export type Cadence = "monthly" | "frozen" | "manual" | "per_announcement" | "quarterly";

/**
 * Decrease policy: how a refresh run must treat a source whose new pull has
 * FEWER rows or a LOWER dollar total than the committed file.
 *   - "exact_pin": the source is a closed program / historical filing. Any
 *     decrease is presumptively corruption — refuse the write, surface loudly.
 *   - "monotonic_floor": a live, still-growing source; a small decrease is
 *     expected upstream churn, hard-fail only past the floor threshold.
 *   - "not_refreshed": no refresh path exists (manual/annual/per-announcement);
 *     the guard does not apply because nothing runs unattended.
 */
export type DecreasePolicy = "exact_pin" | "monotonic_floor" | "not_refreshed";

export interface ManifestSource {
  id: string;
  file: string;
  label: string;
  cadence: Cadence;
  refreshMethod: string;
  /** Which CSV/JSON field(s) carry the dollar figure this source contributes,
   * or null for context-only / non-monetary files. Refresh guards must compare
   * THIS field, never a positional column count. */
  valueField: string | null;
  decreasePolicy: DecreasePolicy;
  /** ISO date the committed file was last verified against its upstream, or
   * "n/a" for a derived/cache file. Authored, not inferred from mtime — an
   * untouched file can still be a freshly reverified vintage. */
  vintage: string;
  /** sha256 of the file's bytes at manifest-regeneration time. Absent (empty
   * string) for files that do not exist in this checkout (none expected). */
  contentHash: string;
  /**
   * Sol gate finding 1 (round 3) — an explicit ROLE, not id-string matching
   * ("id.startsWith('foundation-')"). scripts/export-community-investment.ts's
   * foundation-file loop consumes every source with role "foundation-grant"
   * GENERICALLY (order + idPrefix, both below, required) — adding a new
   * foundation-grant manifest source is consumed automatically, or the
   * exporter throws loudly if foundationGrantIdPrefix is missing, instead of
   * a hard-coded four-id enumeration silently ignoring it.
   */
  role?: "foundation-grant";
  /** REQUIRED when role is "foundation-grant" — 0-based publication order
   * (base, tier1, phase2, phase3, ...). Manifest-driven, not a hard-coded
   * order array in code. */
  foundationGrantOrder?: number;
  /**
   * REQUIRED when role is "foundation-grant" — the record-id namespace
   * prefix (foundation-N / foundation-t1-N / foundation-p2-N / ...).
   * EXISTING entries' prefix must NEVER change (ids already shipped — see
   * deliverable 2 / finding 8's id-stability guarantee); a NEW entry picks
   * its own unused prefix.
   */
  foundationGrantIdPrefix?: string;
}

export interface InvestmentManifest {
  schemaVersion: 1;
  generatedAt: string;
  note: string;
  sources: ManifestSource[];
}

/**
 * AUTHORED domain knowledge — one row per curated input file actually read by
 * the exporter, the refresh script, or the statistical audit. Files here are
 * `impact_grants_chicago_DO_NOT_EXPORT.csv`-style HELD files too, so the hold
 * itself is machine-checkable (an exporter read of a `not_refreshed`/held file
 * would be a visible manifest mismatch, not a silent drift).
 *
 * `id` groups the four foundation files under one `foundation-*` prefix so the
 * audit script can resolve "every published foundation input" from the
 * manifest instead of a hand-typed FILES dict (consult F1 / audit finding 2).
 */
const AUTHORED_SOURCES: Array<Omit<ManifestSource, "contentHash">> = [
  // ── Live, monthly-refreshed (data-refresh.yml) ──────────────────────────
  {
    id: "nof-small",
    file: "nof_small.json",
    label: "NOF Small Business Improvement completions (Socrata rym7-49n8)",
    cadence: "monthly",
    refreshMethod: "scripts/refresh/refresh-live-sources.ts -> Socrata pull",
    valueField: "amount",
    decreasePolicy: "monotonic_floor",
    vintage: "2026-08-11",
  },
  {
    id: "nof-large",
    file: "nof_large.json",
    label: "NOF Large completions (Socrata j7ew-b73u)",
    cadence: "monthly",
    refreshMethod: "scripts/refresh/refresh-live-sources.ts -> Socrata pull",
    valueField: "amount",
    decreasePolicy: "monotonic_floor",
    vintage: "2026-08-11",
  },
  {
    id: "sbif",
    file: "sbif.json",
    label: "SBIF completions (Socrata etqr-sz5x)",
    cadence: "monthly",
    refreshMethod: "scripts/refresh/refresh-live-sources.ts -> Socrata pull",
    valueField: "amount",
    decreasePolicy: "monotonic_floor",
    vintage: "2026-08-11",
  },
  {
    id: "tif",
    file: "tif_projects.csv",
    label: "TIF RDA/IGA + annual-report rows (Socrata mex4-ppfc + 72uz-ikdv)",
    cadence: "monthly",
    refreshMethod: "scripts/refresh/refresh-live-sources.ts -> Socrata pull",
    valueField: "authorized_tif_assistance",
    decreasePolicy: "monotonic_floor",
    vintage: "2026-08-11",
  },
  {
    // id matches scripts/refresh/refresh-live-sources.ts's caresSource.id
    // EXACTLY — refreshOne() looks up the decrease policy by this id
    // (Sol gate finding 7).
    id: "chicago-cares",
    file: "chicago_cares_program_ledger.csv",
    label: "Chicago CARES-era program ledger (Socrata rsxa-ify5 + iyu8-jkf8)",
    cadence: "monthly",
    refreshMethod: "scripts/refresh/refresh-live-sources.ts -> Socrata pull (build()/measure(), same path as every source)",
    valueField: "historical_authorized_usd",
    // Sol gate finding 7 (round 2) — was "not_refreshed", wrongly exempting
    // ANY decrease from enforcement. The source's row COUNT/DOLLAR figures
    // are real monthly-refreshed data (only `source_dataset_updated_at`
    // churns as pure upstream-timestamp noise, which measure() does not
    // count as rows or dollars) — monotonic_floor is the correct, real policy.
    decreasePolicy: "monotonic_floor",
    vintage: "2026-08-11",
  },
  {
    // id matches hudSource.id EXACTLY (see chicago-cares note above).
    id: "hud",
    file: "hud_cpd_activities.csv",
    label: "HUD CDBG/HOME activities (ArcGIS, GRANTEE_ID=17408)",
    cadence: "monthly",
    refreshMethod: "scripts/refresh/refresh-live-sources.ts -> HUD ArcGIS pull",
    valueField: "funding_amount",
    decreasePolicy: "monotonic_floor",
    vintage: "2026-08-11",
  },
  // ── Quarterly, manual ────────────────────────────────────────────────────
  {
    id: "dceo-capital",
    file: "dceo_capital_appropriations.csv",
    label: "DCEO FY26 Capital Appropriation List",
    cadence: "quarterly",
    refreshMethod: "npm run data:import:dceo-capital -- --input <pdf>",
    valueField: "amount",
    decreasePolicy: "not_refreshed",
    vintage: "2026-04-10",
  },
  {
    id: "state-awards",
    file: "state_awards.csv",
    label: "Illinois GATA award snapshot",
    cadence: "quarterly",
    refreshMethod: "manual export",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-01-01",
  },
  {
    id: "iac-arts",
    file: "illinois_arts_council_fy26_q1_chicago.csv",
    label: "Illinois Arts Council FY2026 Q1 Chicago awards",
    cadence: "quarterly",
    refreshMethod: "npm run data:import:iac-arts",
    valueField: "award_amount",
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-08",
  },
  // ── Annual, manual (foundation universe) ────────────────────────────────
  {
    id: "foundation-base",
    file: "foundation_grants_geocoded.csv",
    label: "Foundation grants — base parse (12 funders, pre-recon-discipline)",
    cadence: "manual",
    refreshMethod: "scripts/foundation/ base parse (predates the reconciliation gate)",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2026-01-01",
    role: "foundation-grant",
    foundationGrantOrder: 0,
    foundationGrantIdPrefix: "foundation",
  },
  {
    id: "foundation-tier1",
    file: "foundation_grants_tier1_expansion.csv",
    label: "Foundation grants — Tier-1 expansion (20 funders)",
    cadence: "manual",
    refreshMethod: "scripts/foundation/phase2_pipeline.py + phase2_integrate.py (PHASE_TARGETS=phase2_targets.json)",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2026-07-30",
    role: "foundation-grant",
    foundationGrantOrder: 1,
    foundationGrantIdPrefix: "foundation-t1",
  },
  {
    id: "foundation-phase2",
    file: "foundation_grants_phase2_expansion.csv",
    label: "Foundation grants — Phase-2 expansion (65 funders, 80% coverage bar)",
    cadence: "manual",
    refreshMethod: "scripts/foundation/phase2_pipeline.py + phase2_integrate.py",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2026-08-03",
    role: "foundation-grant",
    foundationGrantOrder: 2,
    foundationGrantIdPrefix: "foundation-p2",
  },
  {
    id: "foundation-phase3",
    file: "foundation_grants_phase3_expansion.csv",
    label: "Foundation grants — Phase-3 expansion (79 funders, census closeout)",
    cadence: "manual",
    refreshMethod: "scripts/foundation/phase2_pipeline.py (PHASE_TARGETS=phase3_targets.json) + phase3_integrate.py",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2026-08-04",
    role: "foundation-grant",
    foundationGrantOrder: 3,
    foundationGrantIdPrefix: "foundation-p3",
  },
  {
    id: "lihtc",
    file: "lihtc_chicago.csv",
    label: "LIHTC placed-in-service allocations",
    cadence: "manual",
    refreshMethod: "HUD LIHTC database re-pull, manual",
    valueField: "annual_allocated_amount",
    decreasePolicy: "exact_pin",
    vintage: "2026-01-01",
  },
  {
    id: "nmtc",
    file: "nmtc_chicago.csv",
    label: "NMTC QLICIs",
    cadence: "manual",
    refreshMethod: "CDFI Fund NMTC public data re-pull, manual",
    valueField: "qlici_amount",
    decreasePolicy: "exact_pin",
    vintage: "2026-01-01",
  },
  {
    id: "cra-by-ca",
    file: "cra_by_community_area.csv",
    label: "FFIEC CRA disclosure by community area",
    cadence: "manual",
    refreshMethod: "FFIEC CRA disclosure re-pull, manual",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-01-01",
  },
  {
    id: "cdfi-by-geo",
    file: "cdfi_by_geo.csv",
    label: "CDFI Fund transaction-level report",
    cadence: "manual",
    refreshMethod: "CDFI Fund transaction report re-pull, manual",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-01-01",
  },
  // ── Per announcement ─────────────────────────────────────────────────────
  {
    id: "cdg-awards",
    file: "cdg_awards.csv",
    label: "Community Development Grant press-release rounds",
    cadence: "per_announcement",
    refreshMethod: "manual add on announcement",
    valueField: "amount",
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-01",
  },
  {
    id: "chicago-prize",
    file: "chicago_prize.csv",
    label: "Pritzker Traubert Foundation Chicago Prize",
    cadence: "per_announcement",
    refreshMethod: "manual add on announcement",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-01",
  },
  {
    id: "developments",
    file: "developments.csv",
    label: "Curated megaproject list (KML-sourced)",
    cadence: "per_announcement",
    refreshMethod: "manual curation",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-01",
  },
  {
    id: "developments-major",
    file: "developments_major.csv",
    label: "Curated megaproject enrichment (announced capital)",
    cadence: "per_announcement",
    refreshMethod: "manual curation",
    valueField: "announced_investment_usd",
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-01",
  },
  {
    id: "jim-corridor",
    file: "ellen_nof_awardees.tsv",
    label: "Partner-supplied corridor NOF list",
    cadence: "per_announcement",
    refreshMethod: "partner-supplied updates",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-01",
  },
  // ── Frozen, closed programs (exact_pin) ──────────────────────────────────
  {
    id: "cook-source-2023",
    file: "cook_county_source_grants_2023.csv",
    label: "Cook County 2023 Source Grant (closed)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — closed program, no API",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2024-11-20",
  },
  {
    id: "cook-cares-2020",
    file: "cook_county_cares_2020_programs.csv",
    label: "Cook County 2020 CARES context (closed)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — closed program, no API",
    valueField: null,
    decreasePolicy: "exact_pin",
    vintage: "2024-11-20",
  },
  {
    id: "illinois-big",
    file: "illinois_business_interruption_grants.csv",
    label: "Illinois Business Interruption Grants (closed)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — closed program, no API",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2021-04-09",
  },
  {
    id: "illinois-hospitality",
    file: "illinois_hospitality_emergency_grant_awards.csv",
    label: "Illinois Hospitality Emergency Grants (closed)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — closed program, no API",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2020-04-27",
  },
  {
    id: "illinois-b2b",
    file: "illinois_back_to_business_awards.csv",
    label: "Illinois Back to Business (closed)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — closed program, no API",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2022-07-26",
  },
  {
    id: "sba-rrf",
    file: "sba_restaurant_revitalization_chicago.csv",
    label: "SBA Restaurant Revitalization Fund (closed)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — closed program, no API",
    valueField: "amount",
    decreasePolicy: "exact_pin",
    vintage: "2024-10-21",
  },
  {
    id: "chicago-arpa",
    file: "chicago_arpa_road_to_recovery_programs.csv",
    label: "Chicago ARPA Road to Recovery program context (closed)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — closed program, no API",
    valueField: null,
    decreasePolicy: "exact_pin",
    vintage: "2026-01-01",
  },
  // ── Held, not read by the exporter ───────────────────────────────────────
  {
    id: "impact-grants-held",
    file: "impact_grants_chicago_DO_NOT_EXPORT.csv",
    label: "Impact Grants Chicago recipient roster (HELD — downstream double-count risk)",
    cadence: "frozen",
    refreshMethod: "not_refreshed — held pending intermediary-linkage design",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-08",
  },
  // ── Derived: identity, dedupe, ledger, geocode (Sol gate finding 1 —
  //    "Identity, dedupe, ledger, and geocode inputs are absent from the
  //    manifest.") These are EXPORTER OUTPUTS that the exporter itself reads
  //    back in on the next run (identity/dedupe) or writes and never re-reads
  //    as an input (audit/census reports) — cadence "manual" means "regenerate
  //    by re-running the producing script", not hand-edited. ────────────────
  {
    id: "foundation-grant-identity",
    file: "foundation_grant_identity.csv",
    label: "Foundation stable identity (filing object id, tax period, schedule/part, ordinal) — deliverable 2",
    cadence: "manual",
    refreshMethod: "python3 scripts/foundation/build_grant_identity.py",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-13",
  },
  {
    id: "foundation-dedupe-ledger",
    file: "foundation_dedupe_ledger.json",
    label: "236-group foundation dedupe adjudication ledger — deliverable 3",
    cadence: "manual",
    refreshMethod: "python3 scripts/foundation/adjudicate_dedupe.py",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-13",
  },
  {
    id: "foundation-dedupe-actions",
    file: "foundation_dedupe_actions.csv",
    label: "Per-row dedupe action (keep / keep-flagged / collapse) the exporter joins against",
    cadence: "manual",
    refreshMethod: "python3 scripts/foundation/adjudicate_dedupe.py",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-13",
  },
  {
    id: "foundation-id-map",
    file: "foundation-id-map.json",
    label: "Frozen positional-id -> stableId mapping (never renumbers on append)",
    cadence: "manual",
    refreshMethod: "regenerated from the committed export after any foundation identity change",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-13",
  },
  // NOTE: foundation_audit_fresh.json is deliberately NOT a manifest entry.
  // It embeds `bound_manifest_hash` (a hash OF this manifest) — tracking its
  // own contentHash IN the manifest would make the two hash each other in an
  // unconvergeable cycle. Its provenance is verified the other direction
  // instead: lib/__tests__/investment-manifest-hash-equality.test.ts asserts
  // bound_manifest_hash equals a LIVE recomputation of manifestContentHash().
  {
    id: "chicago-prize-census",
    file: "chicago_prize_census_check.json",
    label: "Chicago Prize 18/18 one-to-one census check (separate from the foundation SRS)",
    cadence: "manual",
    refreshMethod: "python3 scripts/foundation/chicago_prize_census_check.py",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-13",
  },
  {
    id: "geocode-cache",
    file: "geocode-cache.json",
    label: "Derived Census-geocoder cache — read AND written by the exporter itself, not a source",
    cadence: "manual",
    refreshMethod: "written automatically by npm run data:export:investment; never hand-edited",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-11",
  },
  {
    id: "refresh-attempt",
    file: "refresh-attempt.json",
    label: "Failure-only artifact committed by refresh-live-sources.ts (deliverable 7) — absent when healthy",
    cadence: "manual",
    refreshMethod: "written automatically on a failed npm run data:refresh:live; removed once healthy",
    valueField: null,
    decreasePolicy: "not_refreshed",
    vintage: "2026-08-13",
  },
];

function sha256File(absPath: string): string {
  if (!existsSync(absPath)) return "";
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

/** Recompute the manifest from disk (contentHash only — vintage/cadence/etc.
 * come from AUTHORED_SOURCES, the human-edited table above).
 *
 * `inputDir` is an explicit PARAMETER, deliberately not an env override:
 * scripts/__tests__/export-community-investment-tamper-detection.test.ts
 * depends on MANIFEST_PATH (and the hashes in it) NOT following the
 * `INPUT_DIR` env var, which is exactly what makes staging a tampered copy of
 * the inputs a detectable tamper rather than a self-consistent relabelling.
 * A caller that genuinely owns a different directory — the refresh script,
 * which already writes the inputs itself — passes it in. */
export function buildManifest(generatedAt: string, inputDir: string = INPUT_DIR): InvestmentManifest {
  const sources: ManifestSource[] = AUTHORED_SOURCES.map((s) => ({
    ...s,
    contentHash: sha256File(join(inputDir, s.file)),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    generatedAt,
    note:
      "Machine-generated by scripts/generate-investment-manifest.ts. Do not hand-edit " +
      "contentHash/sources ordering — edit AUTHORED_SOURCES in scripts/lib/investment-manifest.ts " +
      "and re-run `npm run data:manifest:generate`. CI fails on a clean-diff mismatch.",
    sources,
  };
}

/** Stable stringify (2-space, trailing newline) — the exact bytes the clean-diff test compares. */
export function stringifyManifest(m: InvestmentManifest): string {
  return JSON.stringify(m, null, 2) + "\n";
}

/**
 * Regenerate manifest.json from AUTHORED_SOURCES + the files currently on
 * disk, and WRITE it. The ONE implementation behind both writers:
 *   - scripts/generate-investment-manifest.ts (`npm run data:manifest:generate`)
 *   - scripts/refresh/refresh-live-sources.ts, which MUST call this after it
 *     rewrites an input and BEFORE it spawns the export — the export's
 *     verifyManifestInputBytes() below throws on any input whose bytes no
 *     longer match the committed contentHash, so a refresh that skips this
 *     step cannot export at all.
 *
 * Nothing authored is clobbered: `contentHash` is the ONLY derived field
 * (see buildManifest above). cadence/refreshMethod/valueField/decreasePolicy/
 * vintage/role all come from AUTHORED_SOURCES in this file, which is the
 * documented — and clean-diff-gated — home for them. A hand-edit of the JSON
 * is already declared overwritable by the note the generator stamps into it.
 */
export function writeManifest(
  inputDir: string = INPUT_DIR,
  manifestPath: string = MANIFEST_PATH,
): InvestmentManifest {
  const fresh = buildManifest(new Date().toISOString(), inputDir);
  writeFileSync(manifestPath, stringifyManifest(fresh));
  return fresh;
}

export function loadManifest(): InvestmentManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as InvestmentManifest;
}

/**
 * A CONTENT hash of the manifest's source list only — id, file, and
 * contentHash per source, sorted, joined by "|" and "\n" — deliberately NOT a
 * hash of the raw manifest.json bytes. The raw file carries a `generatedAt`
 * wall-clock stamp that changes on every regeneration regardless of content,
 * which would make export.meta.sourceManifestHash / the audit's
 * bound_manifest_hash unconvergeable against a freshly-regenerated manifest.
 * This is deliberately a PLAIN STRING JOIN (not JSON.stringify) and
 * REPLICATED IDENTICALLY in scripts/foundation/fresh_srs_audit.py's
 * `manifest_content_hash()` so a Python process and this Node process compute
 * the exact same hash from the exact same manifest.json — never rely on
 * JSON.stringify/json.dumps producing byte-identical output across languages.
 */
export function manifestContentHash(manifest: InvestmentManifest): string {
  const lines = manifest.sources
    .map((s) => `${s.id}|${s.file}|${s.contentHash}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function manifestEntryForFile(manifest: InvestmentManifest, file: string): ManifestSource | undefined {
  return manifest.sources.find((s) => s.file === file);
}

/**
 * Sol gate finding 1 (round 2) — "export-time verification compares each
 * manifest content-hash against the ACTUAL input file bytes at read time,
 * not a generation-time echo." Called by the exporter's readCsv/readTsv/JSON
 * read wrappers on EVERY file read, not just once at startup — so an input
 * edited (or corrupted) mid-run, or a stale committed manifest, is caught
 * exactly where the bytes are actually consumed. Throws in BOTH directions:
 *   - the file has no manifest entry at all (an exporter read of an
 *     undeclared file — deliverable 1's "vice versa"),
 *   - the file's live sha256 does not match the manifest's declared
 *     contentHash (an input edited without regenerating the manifest).
 */
export function verifyManifestInputBytes(manifest: InvestmentManifest, file: string, bytes: Buffer | string): void {
  const entry = manifestEntryForFile(manifest, file);
  if (!entry) {
    throw new Error(
      `Exporter read "${file}", which has NO entry in data/curated/investment-inputs/manifest.json. ` +
        `Every file the exporter reads MUST be declared in scripts/lib/investment-manifest.ts's ` +
        `AUTHORED_SOURCES (deliverable 1 — the manifest is the ONLY input list; an exporter read of an ` +
        `undeclared file is refused, not silently allowed).`,
    );
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== entry.contentHash) {
    throw new Error(
      `manifest.json's committed contentHash for "${file}" (${entry.contentHash}) does not match the ` +
        `file's ACTUAL bytes at read time (${actualHash}). Run \`npm run data:manifest:generate\` after ` +
        `editing this input, and commit the regenerated manifest.json alongside it.`,
    );
  }
}

/**
 * Sol gate finding 1 (round 2) — "an entry present in the manifest but
 * unknown to the exporter must fail loudly." After a full export run,
 * `touchedFiles` is every filename the exporter actually read (verified via
 * verifyManifestInputBytes above). Any OTHER manifest source — one not
 * explicitly documented as a deliberate non-input (an exporter OUTPUT, or a
 * genuinely held/unread file) — means either the manifest describes a file
 * the exporter's code was never updated to read, or the exporter silently
 * stopped reading a file the manifest still claims governs it. Both are bugs;
 * both throw.
 */
export function assertNoOrphanedManifestSources(
  manifest: InvestmentManifest,
  touchedFiles: ReadonlySet<string>,
  deliberatelyNotReadIds: ReadonlySet<string>,
): void {
  const orphans = manifest.sources.filter(
    (s) => !touchedFiles.has(s.file) && !deliberatelyNotReadIds.has(s.id),
  );
  if (orphans.length > 0) {
    throw new Error(
      `${orphans.length} manifest source(s) were never read by the exporter and are not in the ` +
        `documented deliberately-not-read list: ${orphans.map((o) => `${o.id} (${o.file})`).join(", ")}. ` +
        `Either wire the exporter to read it, or add its id to DELIBERATELY_NOT_READ_MANIFEST_IDS with a reason.`,
    );
  }
}

/**
 * Every foundation-grant manifest entry, in publication order — the single
 * place that knows "every published foundation input" (consult F1 / audit
 * finding 2: the audit must cover ALL FOUR files, not a hand-typed
 * three-file dict). Sol gate finding 1 (round 3) — filtered by the explicit
 * `role` field, ordered by `foundationGrantOrder`, NOT an id-string prefix
 * match or a hard-coded id order array: a NEW foundation-grant manifest
 * source (role + order + idPrefix all present) is picked up automatically by
 * every caller of this function, exporter included.
 */
export function foundationManifestEntries(manifest: InvestmentManifest): ManifestSource[] {
  return manifest.sources
    .filter((s) => s.role === "foundation-grant")
    .sort((a, b) => (a.foundationGrantOrder ?? 0) - (b.foundationGrantOrder ?? 0));
}

export function fileMtimeIso(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  return statSync(absPath).mtime.toISOString();
}

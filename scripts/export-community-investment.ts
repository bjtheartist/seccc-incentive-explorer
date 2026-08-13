#!/usr/bin/env npx tsx
/**
 * Merge the Community Investment inputs into the single admin-only export
 * data/private/community-investment.json — the data source for the (admin-gated)
 * Community Investment map layer, served only through /api/owner-file/investment
 * and NEVER moved under public/ (see data/private/README.md).
 *
 * Sibling in spirit to scripts/export-owner-clusters-geo.ts and
 * scripts/export-tif-briefs.ts: pure geometry/composition lives in
 * lib/community-investment.ts; this script does the file IO, the source-specific
 * row->record mapping, the Census geocoding of city-grant addresses that lack
 * coordinates, and the cross-source dedupe, then writes the committed JSON.
 *
 * Inputs (committed under data/curated/investment-inputs/, read from there by default):
 *   nof_small.json / nof_large.json / sbif.json  — Socrata completion rows
 *   cdg_awards.csv                               — CDG award rounds 2022–2026
 *   foundation_grants_geocoded.csv               — 990 grants w/ lat/lng + locType
 *   foundation_grants_tier1_expansion.csv        — SAME schema, 20 more funders (Tier 1)
 *   developments.csv                             — major development projects
 *   ellen_nof_awardees.tsv                       — Jim's 38 partner-reported NOF corridor awards
 *
 * Honesty rails (mirror the TIF doctrine):
 *   • IRON RULE — no derived received/available/remaining/unspent figure ever;
 *     enforced structurally by buildCommunityInvestmentExport().
 *   • Every amount is a real awarded/reported number or null — never coerced to 0.
 *   • Deterministic: records are emitted in stable input order; the geocode
 *     cache makes re-runs reproducible; generatedAt is the only wall-clock value.
 *   • A row that cannot be placed (geocode failed AND no coordinates) is never
 *     plotted at 0,0 or guessed. It is HELD CITYWIDE — unplotted, but with its
 *     dollars still in the export and counted in meta.citywideCount. A partner
 *     row is dropped only when exact normalized project name and address, exact
 *     amount, and official approval year confirm that an official NOF/SBIF input
 *     already carries the same award, or an explicit source-pair reconciliation
 *     matches both current inputs.
 *
 * Usage:
 *   npx tsx scripts/export-community-investment.ts            # repo inputs (default)
 *   INPUT_DIR=/some/dir npx tsx scripts/export-community-investment.ts
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoBannedFigureKeys,
  buildCommunityInvestmentExport,
  dedupeInvestmentRecords,
  INVESTMENT_STATUSES,
  normalizeAddressForDedupe,
  normalizeRecipientForDedupe,
  SOURCE_FUNDER_TYPE,
  type CommunityInvestmentRecord,
  type CommunityInvestmentRecordDraft,
  type InvestmentGeometry,
  type InvestmentStatus,
  type LocationReason,
} from "../lib/community-investment";
import { governmentFundingPurposeForRecord } from "../lib/government-funding-purpose";
import { assignCommunityArea, loadCommunityAreaPolygons } from "../lib/community-area-stamp";
import {
  describesMultipleProjectSites,
  hasHighConfidenceChicagoDceoLocation,
} from "../lib/dceo-capital-appropriations";
import {
  DCEO_FUNDING_LIFECYCLE_POLICY,
  DCEO_FUNDING_LIFECYCLE_STAGES,
} from "../lib/dceo-funding-lifecycle";
import {
  IAC_SOURCE_DATA_URL,
  IAC_SOURCE_PAGE,
  IAC_SOURCE_VERSION,
  parseCuratedIllinoisArtsCouncilAwards,
} from "../lib/illinois-arts-council";
import {
  RECOVERY_INVESTMENT_SOURCE_METADATA,
  type RecoveryInvestmentSourceId,
} from "../lib/recovery-investment";
import { foundationManifestEntries, loadManifest, manifestContentHash } from "./lib/investment-manifest";

// ── Paths ────────────────────────────────────────────────────────────────────

// Canonical inputs live IN the repo (committed under data/curated/investment-inputs/;
// public-record data only, kept out of public/ so they are never web-served) so a
// regen never depends on the ephemeral session scratchpad. INPUT_DIR overrides the
// default for a one-off run against a different input set; the geocode cache is read
// AND written back within the same input dir so a cached re-run stays fully offline
// and deterministic. Provenance for each file is in PROVENANCE_LABELS below.
const REPO_INPUT_DIR = join(process.cwd(), "data", "curated", "investment-inputs");
const INPUT_DIR = process.env.INPUT_DIR || REPO_INPUT_DIR;
const GEOCODE_CACHE_PATH = join(INPUT_DIR, "geocode-cache.json");
const OUT_PATH = join(process.cwd(), "data", "private", "community-investment.json");
/** Coordinate-less capital CONTEXT (per-district TIF series, CRA/CDFI, state awards). */
const CONTEXT_OUT_PATH = join(process.cwd(), "data", "private", "capital-context.json");
/** Sol gate finding 3 — record-level, source-keyed exclusion ledger sibling. */
const EXCLUSION_LEDGER_OUT_PATH = join(process.cwd(), "data", "private", "investment-exclusion-ledger.json");
/** Committed City of Chicago Community Area boundaries (dataset igwz-8jzy). */
const CA_GEOJSON_PATH = join(process.cwd(), "public", "data", "community-areas.geojson");
const ZIP_GEOJSON_PATH = join(process.cwd(), "public", "data", "chicago-zip-boundaries.geojson");

/**
 * The two private-foundation grant files. They share ONE schema and ONE mapper
 * (mapFoundations) — the split is provenance, not semantics:
 *
 *   • foundation_grants_geocoded.csv — the original 11-funder 990-PF parse.
 *   • foundation_grants_tier1_expansion.csv — the Tier-1 expansion: 20 further
 *     Chicago private funders, every filing reconciliation-gated before a row
 *     was allowed out (see data/curated/investment-inputs/README.md).
 *
 * Their funder-name sets MUST be disjoint — a name in both files would double-
 * count that funder's dollars — so the export asserts it (assertDisjointFoundationFunders)
 * rather than trusting the two parses to have stayed apart.
 *
 * Deliberately NOT read here: foundation_grants_tier1_quarantined_DO_NOT_EXPORT.csv.
 * Those rows are grant-SCHEDULE aggregates ("SEE ATTACHED DETAIL") with no public
 * itemization; they are committed for provenance only and must never reach a record.
 */
// Sol gate finding 1 (BLOCKER) — "The manifest does not drive exporter or
// audit scope." The four foundation file names are no longer hard-coded here:
// they come from data/curated/investment-inputs/manifest.json (via
// foundationManifestEntries, the SAME function scripts/generate-investment-docs.ts
// and the fresh audit both key off), by manifest id in the fixed publication
// order base -> tier1 -> phase2 -> phase3. Adding a Phase-4 file with NO
// manifest entry throws here instead of silently never being read; removing
// one from the manifest throws instead of silently leaving a stale filename.
const investmentManifest = loadManifest();
const foundationManifestFiles = foundationManifestEntries(investmentManifest);
function foundationFile(id: string): string {
  const entry = foundationManifestFiles.find((e: { id: string }) => e.id === id);
  if (!entry) {
    throw new Error(
      `Manifest is missing a foundation source entry with id "${id}" — every foundation input ` +
        `file the exporter reads MUST be authored in scripts/lib/investment-manifest.ts's ` +
        `AUTHORED_SOURCES (deliverable 1 — the manifest is the ONLY input list).`,
    );
  }
  return entry.file;
}
const FOUNDATION_GRANTS_FILE = foundationFile("foundation-base");
const FOUNDATION_TIER1_FILE = foundationFile("foundation-tier1");
const FOUNDATION_PHASE2_FILE = foundationFile("foundation-phase2");
const FOUNDATION_PHASE3_FILE = foundationFile("foundation-phase3");

/**
 * Deliverable 2/3 sidecars — built by scripts/foundation/build_grant_identity.py
 * and scripts/foundation/adjudicate_dedupe.py, joined here by (file, raw CSV row
 * index, 0-based, INCLUDING placeholder rows). Identity/dedupe resolution needs
 * live IRS-filing XML fetches, so it runs as a separate Python pass rather than
 * inline in this exporter — see data/curated/investment-inputs/README.md.
 */
const FOUNDATION_IDENTITY_FILE = "foundation_grant_identity.csv";
const FOUNDATION_DEDUPE_ACTIONS_FILE = "foundation_dedupe_actions.csv";

interface FoundationIdentity {
  filingObjectId: string | null;
  taxPeriodBegin: string | null;
  taxPeriodEnd: string | null;
  amendedReturn: boolean | null;
  schedulePart: string | null;
  sourceRowOrdinal: number | null;
  stableId: string | null;
  resolved: boolean;
}

type FoundationDedupeAction = "keep" | "keep-flagged" | "collapse";

function loadFoundationIdentity(): Map<string, FoundationIdentity> {
  const path = join(INPUT_DIR, FOUNDATION_IDENTITY_FILE);
  const map = new Map<string, FoundationIdentity>();
  if (!existsSync(path)) return map;
  for (const r of readCsv(FOUNDATION_IDENTITY_FILE)) {
    const key = `${r.file}#${r.raw_idx}`;
    const resolved = r.identity_status === "resolved_verified";
    map.set(key, {
      filingObjectId: nullableStr(r.filing_object_id),
      taxPeriodBegin: nullableStr(r.tax_period_begin),
      taxPeriodEnd: nullableStr(r.tax_period_end),
      amendedReturn: r.amended ? r.amended === "Y" : null,
      schedulePart: nullableStr(r.schedule_part),
      sourceRowOrdinal: r.source_row_ordinal !== "" ? Number(r.source_row_ordinal) : null,
      stableId: nullableStr(r.stable_id),
      resolved,
    });
  }
  return map;
}

function loadFoundationDedupeActions(): Map<string, { action: FoundationDedupeAction; flag: string | null }> {
  const path = join(INPUT_DIR, FOUNDATION_DEDUPE_ACTIONS_FILE);
  const map = new Map<string, { action: FoundationDedupeAction; flag: string | null }>();
  if (!existsSync(path)) return map;
  for (const r of readCsv(FOUNDATION_DEDUPE_ACTIONS_FILE)) {
    const key = `${r.file}#${r.raw_idx}`;
    map.set(key, { action: r.action as FoundationDedupeAction, flag: nullableStr(r.flag) });
  }
  return map;
}

const NOF_PROGRAM = "Neighborhood Opportunity Fund (City of Chicago)";
const SBIF_PROGRAM = "Small Business Improvement Fund (City of Chicago)";
const CDG_PROGRAM = "Community Development Grant (City of Chicago)";
const DEVELOPMENT_FUNDER = "Private development";
const COOK_SOURCE_PROGRAM = "Cook County 2023 Source Grant";
const ILLINOIS_BIG_PROGRAM = "Illinois Business Interruption Grants Program";
const ILLINOIS_HOSPITALITY_PROGRAM = "Illinois Hospitality Emergency Grant Program";
const ILLINOIS_B2B_PROGRAM = "Illinois Back to Business Grant Program";
const SBA_RRF_PROGRAM = "U.S. Small Business Administration Restaurant Revitalization Fund";
const DCEO_CAPITAL_FUNDER = "Illinois Department of Commerce and Economic Opportunity";
const DCEO_CAPITAL_SOURCE_PAGE =
  "https://dceo.illinois.gov/aboutdceo/grantopportunities/capitalgrants.html";

const PROVENANCE_LABELS = [
  "City of Chicago Neighborhood Opportunity Fund — grant completions (Chicago Data Portal / Socrata)",
  "City of Chicago Small Business Improvement Fund — grant completions (Chicago Data Portal / Socrata)",
  "City of Chicago Community Development Grant — award rounds 2022–2026 (curated published award announcements; per-row source links retained)",
  "Private-foundation grants parsed from IRS 990-PF / 990 filings (ProPublica), geocoded to recipient address",
  "Private-foundation grants — Tier-1 expansion: 20 additional Chicago private funders parsed from IRS 990-PF e-file XML, every filing reconciled row-sum-to-Part-I-line-3a before release; funders whose filings publish only a grant-schedule aggregate are quarantined, never counted",
  "Private-foundation grants — Phase-2 expansion to the 80% capacity-coverage bar: 65 further Chicago private funders parsed from IRS 990-PF e-file XML under the same reconciliation gate (row sum ties the filing's own printed total within $1); a post-parse review pass additionally quarantined filings whose recipient addresses are the filer's own office",
  "Private-foundation grants — Phase-3 expansion: the census's needs_review remainder (79 further publishing funders) parsed and reconciled under the same gate; review pass held bookkeeping-label rows, DAF self-transfers, and filer-address-artifact filings; every published foundation row is additionally covered by the committed n=2,401 statistical audit (zero errors observed)",
  "Major development projects — Ellen's Developments map (Google My Maps)",
  "Major private developments — verified/discovered megaprojects w/ announced capital (press coverage, developer filings)",
  "Chicago Prize — Pritzker Traubert Foundation ($10M community-transformation awards + finalist planning grants)",
  "Neighborhood Opportunity Fund corridor award list 2017–2020 — Jim's South Shore partner list (partner-reported; confirmed official duplicates removed)",
  "City of Chicago TIF-funded RDA/IGA projects (Socrata mex4-ppfc) — council-authorized TIF assistance ceilings (authorizedAmount, capitalClass tif_subsidy)",
  "HUD CDBG/HOME activities administered by the City of Chicago — committed federal program allocations (authorizedAmount, capitalClass federal_program)",
  "Low-Income Housing Tax Credit allocations (HUD LIHTC database) — tax-credit capital (creditAmount, capitalClass tax_credit)",
  "New Markets Tax Credit QLICIs (CDFI Fund Public Data Release incl. FY2022) — tax-credit capital, community-area stamped from the 2020 census-tract centroid (creditAmount, capitalClass tax_credit)",
  "Cook County 2023 Source Grant recipient list — completed/disbursed historical awards, mapped only as ZIP aggregates because the source publishes no street addresses",
  "Illinois Business Interruption Grants recipient list (DCEO, source version 2021-04-09) — closed historical CARES grants, mapped only as ZIP aggregates because the source publishes no street addresses",
  "Illinois Hospitality Emergency Grant awardee list (DCEO, dated 2020-04-27) — closed historical state grants held unplotted at municipality precision because the source publishes no ZIP or street address",
  "Illinois Back to Business recipient list (DCEO, dated 2022-07-26) — historical ARPA grants, mapped only as ZIP aggregates because the source publishes no street addresses",
  "SBA Restaurant Revitalization Fund FOIA dataset (source version 2024-10-21) — closed historical ARPA grants; Chicago addresses geocoded only when they resolve inside official city boundaries",
  "City of Chicago ARPA Road to Recovery Program Details + Grants Summary — citywide program-level historical reporting, never treated as recipient awards or active incentive dollars",
  "Illinois DCEO FY26 Capital Appropriation Listings (quarterly PDF created 2026-04-10) — source-published appropriation balances, not active opportunities or confirmed GATA award payments",
  "Address geocoding: U.S. Census Bureau Geocoder (Public_AR_Current benchmark)",
  "Community-area assignment: City of Chicago Community Area boundaries (Chicago Data Portal dataset igwz-8jzy), point-in-polygon",
];

// ── Small parse helpers ──────────────────────────────────────────────────────

/** Parse a dollar string to a finite number, else null (never coerce to 0). */
function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Four-digit year from a leading YYYY-... date string, else null. */
function yearOfDate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const y = Number(String(raw).slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/** The first 20xx year embedded in a round label ("May 2023" -> 2023), else null. */
function yearOfRound(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/** A blank-safe trim -> string|null. */
function nullableStr(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  return t === "" ? null : t;
}

/** Split a whitespace-joined link blob into unique http(s) URLs. */
function parseLinks(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const tok of String(raw).split(/\s+/)) {
    const t = tok.trim();
    if (/^https?:\/\//i.test(t)) seen.add(t);
  }
  return [...seen];
}

/** Build the validated record-level recovery extension shared by the historical
 * recipient datasets. The source-reported amount stays here rather than in
 * amountAwarded, keeping closed recovery programs out of ordinary grant totals. */
function historicalRecoveryRecord(
  sourceId: Extract<
    RecoveryInvestmentSourceId,
    | "cook-source-2023"
    | "illinois-big"
    | "illinois-hospitality-emergency"
    | "illinois-b2b"
    | "sba-rrf"
  >,
  value: number,
): NonNullable<CommunityInvestmentRecord["recovery"]> {
  const source = RECOVERY_INVESTMENT_SOURCE_METADATA[sourceId];
  return {
    sourceId,
    historicalAmount: {
      value,
      currency: "USD",
      assistanceType: source.assistanceType,
    },
  };
}

// ── Minimal CSV/TSV reader (quoted fields, embedded newlines) ─────────────────

/** Parse delimited text into row objects keyed by the header row. Handles
 * double-quoted fields, escaped quotes ("") and newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; handled by the \n branch
    } else {
      field += c;
    }
  }
  // flush trailing field/row (files may not end in newline)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0].trim() === "") continue; // skip blank line
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? "";
    out.push(obj);
  }
  return out;
}

function readCsv(file: string): Record<string, string>[] {
  return parseDelimited(readFileSync(join(INPUT_DIR, file), "utf8"), ",");
}
function readTsv(file: string): Record<string, string>[] {
  return parseDelimited(readFileSync(join(INPUT_DIR, file), "utf8"), "\t");
}

// ── Census geocoder (cached) ─────────────────────────────────────────────────

interface GeoResult {
  lat: number;
  lng: number;
}

type GeocodeCache = Record<string, GeoResult>;

function loadGeocodeCache(): GeocodeCache {
  try {
    if (existsSync(GEOCODE_CACHE_PATH)) {
      const parsed = JSON.parse(readFileSync(GEOCODE_CACHE_PATH, "utf8"));
      if (parsed && typeof parsed === "object") return parsed as GeocodeCache;
    }
  } catch {
    /* fall through to empty cache */
  }
  return {};
}

function saveGeocodeCache(cache: GeocodeCache): void {
  writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** One-address Census lookup with 3-attempt backoff. Returns null on no match
 * or repeated transient failure (best-effort free gov service, no SLA). */
/**
 * Both benchmarks are the same authoritative Census TIGER service; they differ
 * only in address-range vintage. Public_AR_Current returns an empty match for
 * verified-real Chicago addresses that Public_AR_Census2020 resolves —
 * measured 2026-08-10: "7112 S Yates Blvd", "4100 S Packers Ave",
 * "1400 W 46th St", "3800 W 26th St" and "6701 W Forest Preserve Ave" all
 * return zero matches on Current and exact matches on Census2020. Pinning
 * Current alone was why $16.1M of recovered CDG awards shipped with citywide
 * geometry despite carrying street addresses. Current is still tried first so
 * newer construction keeps resolving.
 */
const CENSUS_BENCHMARKS = ["Public_AR_Current", "Public_AR_Census2020"] as const;

async function censusGeocode(query: string): Promise<GeoResult | null> {
  for (const benchmark of CENSUS_BENCHMARKS) {
    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.searchParams.set("address", query);
    url.searchParams.set("benchmark", benchmark);
    url.searchParams.set("format", "json");
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as {
          result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> };
        };
        const match = data.result?.addressMatches?.[0];
        const coords = match?.coordinates;
        if (coords && Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
          return { lat: coords.y, lng: coords.x };
        }
        break; // valid response, no match under THIS benchmark — try the next one
      } catch {
        if (attempt < 3) await sleep(400 * attempt);
      }
    }
  }
  return null;
}

/**
 * Resolve a batch of unique address queries, reusing (and extending) the
 * on-disk cache. Only successful matches are cached, so a re-run retries the
 * misses. Runs with small concurrency to stay polite to the free service.
 */
async function geocodeBatch(queries: string[], cache: GeocodeCache): Promise<Map<string, GeoResult | null>> {
  const unique = [...new Set(queries)];
  const result = new Map<string, GeoResult | null>();
  const pending = unique.filter((q) => {
    if (cache[q]) {
      result.set(q, cache[q]);
      return false;
    }
    return true;
  });

  console.log(`  geocoding ${pending.length} new address(es) (${unique.length - pending.length} cached)…`);

  const CONCURRENCY = 4;
  let cursor = 0;
  let sinceSave = 0;
  async function worker() {
    while (cursor < pending.length) {
      const q = pending[cursor++];
      const hit = await censusGeocode(q);
      result.set(q, hit);
      if (hit) {
        cache[q] = hit;
        if (++sinceSave >= 20) {
          saveGeocodeCache(cache);
          sinceSave = 0;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  saveGeocodeCache(cache);
  return result;
}

function point(lat: number, lng: number): InvestmentGeometry {
  return { kind: "point", lat, lng };
}

// ── Community-area point-in-polygon stamping ─────────────────────────────────

/**
 * Point-in-polygon stamp EVERY point record with its Chicago community area,
 * overwriting whatever the source supplied so all records key off the canonical
 * 77-name set (the Socrata `community_area` field is inconsistent — 100+ distinct
 * spellings/neighborhoods — and the foundation/CDG/development/corridor points
 * carry none at all). A point outside every CA (lake, inter-CA gap, edge geocode)
 * keeps NO communityArea and is counted. Citywide-geometry records are never
 * touched. The polygon load + per-point assignment live in
 * lib/community-area-stamp.ts (pure + unit-tested). Mutates in place; returns the
 * inside/outside tallies. Deterministic.
 */
function stampCommunityAreas(
  records: CommunityInvestmentRecord[],
  polygons: ReturnType<typeof loadCommunityAreaPolygons>,
): { inside: number; outside: number } {
  let inside = 0;
  let outside = 0;
  for (const r of records) {
    if (r.geometry.kind !== "point") continue; // citywide records never get a CA
    const match = assignCommunityArea(r.geometry.lng, r.geometry.lat, polygons);
    if (match) {
      r.communityArea = match;
      inside++;
    } else {
      delete r.communityArea; // outside every CA → keep none (never guess)
      outside++;
    }
  }
  return { inside, outside };
}

// ── Source mappers ───────────────────────────────────────────────────────────

/** Assemble a Socrata address from its component columns. */
function socrataAddress(r: Record<string, unknown>): string | null {
  const num = nullableStr(r.address_number as string);
  const high = nullableStr(r.address_number_high as string);
  const numPart = num ? (high ? `${num}-${high}` : num) : null;
  const parts = [
    numPart,
    nullableStr(r.street_direction as string),
    nullableStr(r.street_name as string),
    nullableStr(r.street_type as string),
  ].filter(Boolean);
  const addr = parts.join(" ").replace(/\s+/g, " ").trim();
  return addr || null;
}

interface SocrataRow {
  project_name?: string;
  applicant_name?: string;
  address_number?: string;
  address_number_high?: string;
  street_direction?: string;
  street_name?: string;
  street_type?: string;
  community_area?: string;
  approval_date?: string;
  completion_date?: string;
  project_description?: string;
  incentive_amount?: string;
  location?: { type?: string; coordinates?: [number, number] };
}

interface SocrataDrops {
  preWindow: number;
  noCoords: number;
}

export interface OfficialAwardDuplicateFact {
  recipient: string;
  amountAwarded: number;
  approvalYear: number;
  address?: string | null;
}

interface PartnerNofConfirmedAliasRule {
  partnerRecipient: string;
  partnerAddress: string;
  partnerAwardYear: number;
  officialRecipient: string;
  officialAddress: string;
  officialApprovalYear: number;
  amountAwarded: number;
}

/**
 * Explicit cross-source identity reconciliations for partner rows whose public
 * name, address, or award year differs from the official NOF record.
 * Each rule is inert unless both the current partner input and the current
 * official source still contain the stated names, amount, and years. This is a
 * bounded source-pair table, not fuzzy name, address, or proximity dedupe.
 */
export const PARTNER_NOF_CONFIRMED_ALIAS_RULES: readonly PartnerNofConfirmedAliasRule[] = [
  {
    partnerRecipient: "South Shore Brew",
    partnerAddress: "7101 S. Yates Blvd.",
    partnerAwardYear: 2017,
    officialRecipient: "South Shore Brew",
    officialAddress: "1745 E 71st St",
    officialApprovalYear: 2017,
    amountAwarded: 98420.24,
  },
  {
    partnerRecipient: "Original Soul Vegetarian",
    partnerAddress: "203 E. 75th St.",
    partnerAwardYear: 2017,
    officialRecipient: "Original Soul Vegetarian (OSV, LLP)",
    officialAddress: "203 E 75th St",
    officialApprovalYear: 2017,
    amountAwarded: 250000,
  },
  {
    partnerRecipient: "The Quarry Event Center",
    partnerAddress: "2423 E. 75th St.",
    partnerAwardYear: 2017,
    officialRecipient: "The Quarry (Real Community Investment Group)",
    officialAddress: "2423 E 75th St",
    officialApprovalYear: 2017,
    amountAwarded: 32850,
  },
  {
    partnerRecipient: "Mikkey's Retro Grill",
    partnerAddress: "8126 S. Stony Island Ave.",
    partnerAwardYear: 2017,
    officialRecipient: "Legacy, etc",
    officialAddress: "8126 S Stony Island Av",
    officialApprovalYear: 2017,
    amountAwarded: 139058.77,
  },
  {
    partnerRecipient: "Essential Elements - Chicago",
    partnerAddress: "1640 E. 87th St.",
    partnerAwardYear: 2017,
    officialRecipient: "Essential Elements",
    officialAddress: "1640 E 87th St",
    officialApprovalYear: 2018,
    amountAwarded: 20868.38,
  },
  {
    partnerRecipient: "Nipsey's Restaurant & Bar",
    partnerAddress: "9156 S. Stony Island Ave.",
    partnerAwardYear: 2019,
    officialRecipient: "Nipsey's Restaurant and Bar",
    officialAddress: "9156 S Stony Island Av",
    officialApprovalYear: 2019,
    amountAwarded: 250000,
  },
  {
    partnerRecipient: "Huddle House Diner",
    partnerAddress: "9401 S. Stony Island Ave.",
    partnerAwardYear: 2019,
    officialRecipient: "Huddle House",
    officialAddress: "9421 S Stony Island Ave",
    officialApprovalYear: 2021,
    amountAwarded: 1100000,
  },
];

/** Build from official source facts only. These decide whether a partner row is
 * already represented when normalized project name and address, exact amount,
 * and approval year agree. Completion year is deliberately excluded because it
 * is not an award year. */
export function buildOfficialAwardDuplicateFacts(
  rows: readonly SocrataRow[],
  minYear: number,
): OfficialAwardDuplicateFact[] {
  const facts: OfficialAwardDuplicateFact[] = [];
  for (const row of rows) {
    const approvalYear = yearOfDate(row.approval_date);
    if (approvalYear == null || approvalYear < minYear) {
      continue;
    }
    const amountAwarded = parseAmount(row.incentive_amount);
    const recipient = nullableStr(row.project_name) || nullableStr(row.applicant_name);
    if (recipient && amountAwarded != null) {
      facts.push({
        recipient,
        amountAwarded,
        approvalYear,
        address: socrataAddress(row as Record<string, unknown>),
      });
    }
  }
  return facts;
}

/**
 * Map Socrata NOF/SBIF rows. A row with a real completion_date ships as a
 * "completed" record; a row with NO completion_date but a valid approval_date
 * ships as an "awarded" record (year taken from the approval), so large awarded-
 * but-not-yet-completed grants (e.g. Huddle House $1.1M) are no longer silently
 * lost. A row with neither date is kept with year=null. Rows are dropped only
 * when their (completion or approval) year predates `minYear`, or when they
 * carry no usable coordinates — both counted in `drops`.
 */
function mapSocrata(
  rows: SocrataRow[],
  source: "nof-small" | "nof-large" | "sbif",
  funderName: string,
  minYear: number,
): { records: CommunityInvestmentRecordDraft[]; drops: SocrataDrops } {
  const out: CommunityInvestmentRecordDraft[] = [];
  const drops: SocrataDrops = { preWindow: 0, noCoords: 0 };
  let idx = 0;
  for (const r of rows) {
    const completionYear = yearOfDate(r.completion_date);
    const approvalYear = yearOfDate(r.approval_date);
    const effectiveYear = completionYear ?? approvalYear;
    // Drop only rows dated BEFORE the inclusion window; an undated row (year
    // null) is kept rather than guessed.
    if (effectiveYear != null && effectiveYear < minYear) {
      drops.preWindow++;
      continue;
    }
    const coords = r.location?.coordinates;
    if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) {
      drops.noCoords++;
      continue;
    }
    const recipient = nullableStr(r.project_name) || nullableStr(r.applicant_name) || "(unnamed)";
    const communityArea = nullableStr(r.community_area);
    const completed = completionYear != null;
    out.push({
      id: `${source}-${idx++}`,
      source,
      funderType: SOURCE_FUNDER_TYPE[source],
      funderName,
      recipient,
      capitalClass: "grant",
      amountAwarded: parseAmount(r.incentive_amount),
      logLine: nullableStr(r.project_description),
      year: effectiveYear ?? null,
      geometry: point(coords[1], coords[0]),
      address: socrataAddress(r as Record<string, unknown>),
      ...(communityArea ? { communityArea } : {}),
      status: completed ? "completed" : "awarded",
      recordDate: nullableStr(r.completion_date) ?? nullableStr(r.approval_date),
      recordProvenance: "official",
      links: [],
    });
  }
  return { records: out, drops };
}

/**
 * Chicago bounding box for the foundation geocode sanity check. A sited grant
 * whose recipient address geocodes outside this box (e.g. a University of
 * Illinois recipient in Champaign, or a far-suburban shelter) is held citywide
 * rather than plotted as a Chicago neighborhood dot — a bad geocode is not a
 * bad grant, so the dollars still count. Bounds per the task spec (~the city
 * envelope, generous at the edges).
 */
const CHICAGO_BOUNDS = { minLat: 41.6, maxLat: 42.1, minLng: -87.95, maxLng: -87.5 };

function inChicagoBounds(lat: number, lng: number): boolean {
  return (
    lat >= CHICAGO_BOUNDS.minLat &&
    lat <= CHICAGO_BOUNDS.maxLat &&
    lng >= CHICAGO_BOUNDS.minLng &&
    lng <= CHICAGO_BOUNDS.maxLng
  );
}

/**
 * Filers point at an attachment instead of listing a grantee in several
 * interchangeable ways. Matching only the first phrase leaves the others live:
 * the Tier-1 quarantine file carries two Anthony Pritzker Fam Foundation rows
 * ($19,775,200 and $18,799,294) whose recipient reads "SEE STATEMENT" — the exact
 * same grant-schedule aggregate as "SEE ATTACHED", which the narrower test let
 * through. The whole family is rejected, so the shape is caught regardless of
 * which wording a filer's software emits.
 *
 * The unitemized-RECIPIENT family is the same shape without the word "see" —
 * a pool where the GRANTEE should be: Coleman's "Matching Gifts - Details
 * Available upon request", Field's "10 INDIVIDUALS - DETAILS UPON REQUEST" and
 * "OTHER CONTRIBUTIONS", Grand Victoria's "MISCELLANEOUS GRANTS". The
 * upon-request wording matches with or without "available"; the bare aggregate
 * nouns must be the ENTIRE recipient, so a real organization whose name merely
 * contains "other"/"various" can never be swallowed. This family tests the
 * recipient field ALONE — in the ADDRESS field "available upon request" means
 * the opposite: a real named grantee whose street address is withheld (Deering
 * McCormick files 107 real grants that way, $5.9M to the Art Institute et al.),
 * which is an honest citywide row, not a placeholder.
 */
const FOUNDATION_ATTACHMENT_PLACEHOLDER_RE =
  /\bsee\s+(attach\w*|statement|schedule|exhibit|list|below|note)\b/i;
const FOUNDATION_UNITEMIZED_RECIPIENT_RE =
  /\b(details?\s+)?(available\s+)?upon\s+request\b|^\s*(miscellaneous|other|various|sundry)\s+(grants?|contributions?|donations?)\s*$/i;

/** Placeholder rows the 990 parser captured as a whole grant-SCHEDULE aggregate
 * rather than a single grant: a recipient/address that points at an attachment
 * ("SEE ATTACHED", "SEE STATEMENT", "SEE SCHEDULE"…), or a 99999-style filler
 * zip/address. Rejected so a $120M "grant to SEE ATTACHED" never counts as a real
 * award. Applied identically to EVERY foundation input file. */
export function isPlaceholderFoundationRow(r: Record<string, string>): boolean {
  const recipient = (r.recipient || "").trim();
  const addr1 = (r.address_line1 || "").trim();
  const zip = (r.zip || "").trim();
  return (
    FOUNDATION_ATTACHMENT_PLACEHOLDER_RE.test(recipient) ||
    FOUNDATION_ATTACHMENT_PLACEHOLDER_RE.test(addr1) ||
    FOUNDATION_UNITEMIZED_RECIPIENT_RE.test(recipient) ||
    /^9{5}$/.test(zip) ||
    /^9{5}$/.test(addr1)
  );
}

export interface FoundationStats {
  citywideFallback: number;
  droppedPlaceholder: number;
  /** Sol gate finding 3 — the exclusion ledger needs dollars, not just a
   * count, for every true-excluded category, including placeholder rows. */
  droppedPlaceholderDollars: number;
  outOfBoundsGeocodes: number;
  negativeAmountsNulled: number;
  /** Deliverable 3 — rows dropped by the 236-group dedupe adjudication (proven
   * extractor duplication; see foundation_dedupe_ledger.json). */
  dedupeCollapsed: number;
  dedupeCollapsedDollars: number;
  /** Deliverable 2 — rows whose identity resolved to a verified filing vs. a
   * fingerprint-only fallback id (see foundation_grant_identity.csv). */
  identityResolved: number;
  identityUnresolved: number;
}

/** Sum two foundation-file tallies so the meta counters describe EVERY foundation
 * input, not just the first file. Splitting the input without summing here would
 * silently under-report the drops (a placeholder rejected in the second file would
 * vanish from `meta.droppedPlaceholder` and from the audit trail). */
export function mergeFoundationStats(a: FoundationStats, b: FoundationStats): FoundationStats {
  return {
    citywideFallback: a.citywideFallback + b.citywideFallback,
    droppedPlaceholder: a.droppedPlaceholder + b.droppedPlaceholder,
    droppedPlaceholderDollars: a.droppedPlaceholderDollars + b.droppedPlaceholderDollars,
    outOfBoundsGeocodes: a.outOfBoundsGeocodes + b.outOfBoundsGeocodes,
    negativeAmountsNulled: a.negativeAmountsNulled + b.negativeAmountsNulled,
    dedupeCollapsed: a.dedupeCollapsed + b.dedupeCollapsed,
    dedupeCollapsedDollars: a.dedupeCollapsedDollars + b.dedupeCollapsedDollars,
    identityResolved: a.identityResolved + b.identityResolved,
    identityUnresolved: a.identityUnresolved + b.identityUnresolved,
  };
}

/**
 * Fail LOUDLY if two foundation grant files claim the same funder. The files are
 * separate PARSES, not separate slices of one funder list, so an overlap means the
 * same 990-PF grants were counted twice — an invisible inflation of the awarded
 * headline that no downstream test would attribute to its cause.
 *
 * Name equality is exact and case-insensitive on trimmed text, matching the way
 * funderName is carried through to the export: names stay EXACTLY as the CSV has
 * them. "Pritzker Traubert Foundation", "Pritzker Family Foundation", "Pritzker
 * Foundation", and "Anthony Pritzker Fam Foundation" are four DIFFERENT filers with
 * four different EINs — never normalize a shared surname into a collision.
 */
export function assertDisjointFoundationFunders(
  a: { file: string; rows: Record<string, string>[] },
  b: { file: string; rows: Record<string, string>[] },
): void {
  const namesOf = (rows: Record<string, string>[]) =>
    new Map(
      rows
        .map((r) => (r.foundation || "").trim())
        .filter(Boolean)
        .map((name) => [name.toLowerCase(), name] as const),
    );
  const aNames = namesOf(a.rows);
  const shared: string[] = [];
  for (const [key, name] of namesOf(b.rows)) {
    if (aNames.has(key)) shared.push(name);
  }
  if (shared.length > 0) {
    throw new Error(
      `Foundation funder collision between ${a.file} and ${b.file}: ` +
        `${shared.sort().join(", ")}. The same funder's grants would be counted twice — ` +
        `resolve the overlap in the input files, never by renaming a funder here.`,
    );
  }
}

/**
 * Map foundation grant rows — geometry from locType (intermediary -> citywide).
 *
 * `idPrefix` keeps each input file's ids in their own namespace, so adding a
 * second foundation file cannot collide with (or renumber) the first file's
 * already-published record ids.
 */
export function mapFoundations(
  rows: Record<string, string>[],
  idPrefix = "foundation",
  rawFileName?: string,
  identity?: Map<string, FoundationIdentity>,
  dedupeActions?: Map<string, { action: FoundationDedupeAction; flag: string | null }>,
): {
  records: CommunityInvestmentRecordDraft[];
  stats: FoundationStats;
} {
  const out: CommunityInvestmentRecordDraft[] = [];
  const stats: FoundationStats = {
    citywideFallback: 0,
    droppedPlaceholder: 0,
    droppedPlaceholderDollars: 0,
    outOfBoundsGeocodes: 0,
    negativeAmountsNulled: 0,
    dedupeCollapsed: 0,
    dedupeCollapsedDollars: 0,
    identityResolved: 0,
    identityUnresolved: 0,
  };
  let idx = 0;
  let rawIdx = -1;
  for (const r of rows) {
    rawIdx++;
    const joinKey = rawFileName ? `${rawFileName}#${rawIdx}` : "";
    const action = dedupeActions?.get(joinKey);
    if (action?.action === "collapse") {
      // Deliverable 3 — the 236-group dedupe adjudication proved (by direct
      // filing inspection) that this specific row is an extractor duplicate:
      // the filing itself does not carry as many matching grant nodes as the
      // CSV does. Dropped here, never reaching a record, and counted.
      stats.dedupeCollapsed++;
      stats.dedupeCollapsedDollars += parseAmount(r.amount) ?? 0;
      continue;
    }
    if (isPlaceholderFoundationRow(r)) {
      stats.droppedPlaceholder++;
      stats.droppedPlaceholderDollars += parseAmount(r.amount) ?? 0;
      continue;
    }
    let geometry: InvestmentGeometry;
    // Deliverable 3 (Sol gate finding 3) — every citywide record carries an
    // explicit locationReason, never a bare unexplained hold. Foundation has
    // three distinct citywide paths, each a DIFFERENT claim:
    //   • locType intermediary_or_citywide: the row is legitimately citywide by
    //     the SOURCE's own design (the recipient is an intermediary, not a
    //     site) — "source_unlocated", not a failure of any kind.
    //   • a real geocode attempt returned coordinates outside Chicago —
    //     "geocode_failed" (an out-of-Chicago hit for that attempt, per the
    //     taxonomy's own definition).
    //   • no usable coordinate at all (blank/zero lat-lng) — also
    //     "geocode_failed" (nothing resolved for that attempt).
    let locationReason: LocationReason | null;
    if (r.locType === "intermediary_or_citywide") {
      geometry = { kind: "citywide" };
      locationReason = "source_unlocated";
    } else {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        if (inChicagoBounds(lat, lng)) {
          geometry = point(lat, lng);
          locationReason = null;
        } else {
          geometry = { kind: "citywide" }; // out-of-Chicago geocode -> honest citywide, never a misplaced dot
          locationReason = "geocode_failed";
          stats.outOfBoundsGeocodes++;
        }
      } else {
        geometry = { kind: "citywide" }; // sited row with unusable coords -> honest citywide, not 0,0
        locationReason = "geocode_failed";
        stats.citywideFallback++;
      }
    }
    // A negative "amount awarded" (a 990 correction / return-of-grant) is
    // semantically impossible for a grant — null it (keep the record) so it never
    // quietly reduces the awarded total.
    let amountAwarded = parseAmount(r.amount);
    if (amountAwarded != null && amountAwarded < 0) {
      amountAwarded = null;
      stats.negativeAmountsNulled++;
    }
    const addr = [r.address_line1, r.city, r.state, r.zip].map((s) => (s || "").trim()).filter(Boolean).join(", ");
    const ident = identity?.get(joinKey);
    if (ident?.resolved) stats.identityResolved++;
    else stats.identityUnresolved++;
    out.push({
      id: `${idPrefix}-${idx++}`,
      source: "foundation",
      funderType: SOURCE_FUNDER_TYPE.foundation,
      funderName: nullableStr(r.foundation) || "(unnamed foundation)",
      recipient: nullableStr(r.recipient) || "(unnamed recipient)",
      capitalClass: "grant",
      amountAwarded,
      logLine: nullableStr(r.purpose),
      year: Number.isInteger(Number(r.tax_year)) ? Number(r.tax_year) : null,
      geometry,
      address: addr || null,
      status: "awarded",
      recordDate: null,
      links: [],
      locationReason,
      filingObjectId: ident?.filingObjectId ?? null,
      taxPeriodBegin: ident?.taxPeriodBegin ?? null,
      taxPeriodEnd: ident?.taxPeriodEnd ?? null,
      amendedReturn: ident?.amendedReturn ?? null,
      schedulePart: ident?.schedulePart ?? null,
      sourceRowOrdinal: ident?.sourceRowOrdinal ?? null,
      stableId: ident?.stableId ?? null,
      dedupeFlag: action?.action === "keep-flagged" ? action.flag : null,
    });
  }
  return { records: out, stats };
}

// ── Major private developments (developments_major.csv) ──────────────────────

const PRIZE_FUNDER = "Pritzker Traubert Foundation — Chicago Prize";

/**
 * EXPLICIT join from a VERIFIED megadev row (developments_major.csv `name`) to
 * its Ellen-KML row (developments.csv `name`). Hand-built — no fuzzy matching —
 * so a rename on either side fails loudly (validated in main). The KML row
 * supplies the plottable coordinates; the megadev row supplies the enrichment
 * (announced capital, status, lead developers, log line, links). Note the two
 * deliberate KML misspellings preserved verbatim ("Microelectonics", "Interent").
 */
const MEGADEV_KML_JOIN: Record<string, string> = {
  "1901 Project (United Center campus)": "1901 Project",
  "The 78 (Related Midwest)": "The 78",
  "Bronzeville Lakefront (former Michael Reese Hospital site)": "Bronzeville Lakefront",
  "Illinois Quantum and Microelectronics Park / PsiQuantum campus (South Works, 8080 S DuSable Lake Shore)":
    "Illinois Quantum and Microelectonics Park",
  "Lincoln Yards (northern parcel now rebranded 'Foundry Park')": "Lincoln Yards",
  "One Central (Landmark Development)": "One Central",
  "The River District (700 W Chicago)": "The River District",
  "Riverline (South Loop river)": "Riverline",
  "Southbank (Lendlease)": "Southbank",
  "Lakeshore East (Magellan)": "Lakeshore East",
  "Chicago Bears Stadium Proposal (formerly lakefront/Arlington Heights, now Hammond, IN)":
    "Chicago Bears Stadium Proposal",
  "White Sox South Loop Ballpark Proposal at The 78": "White Sox Deck Park Proposal",
  "43 Green (Bronzeville Equitable Transit-Oriented Development, 43rd/Calumet-Prairie)": "43 Green",
  "Bally's Chicago Permanent Casino (River West)": "Bally's Casino",
  "Chase Tower Renovation (JPMorgan Chase Chicago HQ)": "Chase Tower Redevelopment",
  "Inherent L3C modular homes (Humboldt Park / Cook County pilot)": "Interent L3C",
  "James R. Thompson Center redevelopment (Google Chicago HQ)": "James R. Thompson Center",
  "Obama Presidential Center (Jackson Park)": "Obama Presidential Center",
  "Pullman hotel (Hampton by Hilton, 111th St./Doty Ave.)": "Pullman Hotel",
  "SouthBridge (former Harold Ickes Homes, 23rd/State)": "South Bridge",
  "LaSalle Street Reimagined (program overall)": "La Salle Reimagined Zone",
  "111 W Monroe conversion (The Monroe)": "111 W Monroe St",
  "208 S LaSalle conversion": "208 S La Salle St",
  "30 N LaSalle conversion": "30 N La Salle St",
  "79 W Monroe conversion (The Bellwether Residences)": "79 W Monroe St",
  "135 S. LaSalle Street (Field Building) Conversion": "135 S La Salle St",
  "105 W. Adams Street (Clark Adams / Bankers Building) Conversion": "105 W Adams St",
};

type DiscoveredGeo =
  | { kind: "geocode"; address: string }
  | { kind: "point"; lat: number; lng: number }
  | { kind: "citywide" };

/**
 * Geometry resolution for the DISCOVERED megadev rows (no KML coordinates):
 * geocode a well-known street address (Census geocoder, cached), sit AT another
 * project's known point (the Fire stadium is inside The 78's footprint), or hold
 * citywide (Advocate's multi-site South Side investment). Every discovered row
 * MUST appear here (validated in main).
 */
const MEGADEV_DISCOVERED_GEO: Record<string, DiscoveredGeo> = {
  // A privately-financed stadium physically inside The 78 site — placed at The
  // 78's KML coordinates; its $650M is a SUBSET of The 78's $7B (announced null).
  "Chicago Fire FC Stadium at The 78": { kind: "point", lat: 41.8640724, lng: -87.6320745 },
  "400 Lake Shore Drive": { kind: "geocode", address: "400 N Lake Shore Dr" },
  "Halsted Landing (Onni Group, Goose Island)": { kind: "geocode", address: "901 N Halsted St" },
  "Halsted Pointe (Onni Group, Goose Island)": { kind: "geocode", address: "1000 N Halsted St" },
  "Advocate Health Care South Side Investment / New South Works Hospital": { kind: "citywide" },
  "Northwestern Memorial Hospital New Patient/Cancer Tower (Streeterville)": {
    kind: "geocode",
    address: "250 E Superior St",
  },
  "Ogden Commons (North Lawndale)": { kind: "geocode", address: "2653 W Ogden Ave" },
  "Salesforce Tower Chicago (Wolf Point South)": { kind: "geocode", address: "333 W Wolf Point Plaza" },
  "One Chicago": { kind: "geocode", address: "1 W Chicago Ave" },
  "1000M": { kind: "geocode", address: "1000 S Michigan Ave" },
  "Fulton Labs (Trammell Crow life-sciences campus)": { kind: "geocode", address: "400 N Aberdeen St" },
  "Bank of America Tower (110 North Wacker)": { kind: "geocode", address: "110 N Wacker Dr" },
};

/**
 * Megadev rows whose announced figure is a SUBSET of another project's already-
 * counted total — kept on the map for context, but announcedInvestment=null and
 * counted in meta.subsetExcluded so nothing double-counts.
 */
const MEGADEV_SUBSET_NAMES = new Set<string>(["Chicago Fire FC Stadium at The 78"]);

/**
 * private_led=False rows we retain despite the flag: state-initiated public-
 * private partnerships that are nonetheless ANCHORED by a private developer with
 * a large private minimum investment (IQMP/PsiQuantum: a $1.09B+ PsiQuantum
 * commitment on the South Works campus). We model private development; a
 * genuinely public-infrastructure False row would be dropped and counted in
 * meta.privateLedExcluded instead. No such pure-public row exists in the 39.
 */
const MEGADEV_PRIVATE_LED_KEEP = new Set<string>([
  "Illinois Quantum and Microelectronics Park / PsiQuantum campus (South Works, 8080 S DuSable Lake Shore)",
]);

/** True when a megadev row is NOT private-led AND is not one we explicitly keep
 * (i.e. genuinely public infrastructure) — dropped from this private-development
 * model and counted in meta.privateLedExcluded. */
function isDroppableNonPrivate(mega: Record<string, string>): boolean {
  const priv = (mega.private_led || "").trim().toLowerCase();
  if (priv === "true") return false;
  return !MEGADEV_PRIVATE_LED_KEEP.has((mega.name || "").trim());
}

/** Map a status_2026 string to the enum (identity for valid values; the CSV only
 * ever carries valid members). An unexpected value degrades to "announced". */
function mapStatus2026(raw: string | null | undefined): InvestmentStatus {
  const s = (raw || "").trim();
  return (INVESTMENT_STATUSES as readonly string[]).includes(s) ? (s as InvestmentStatus) : "announced";
}

/** Truncate a lead-developers blob to a sensible funderName length on a word
 * boundary (the raw field can run several sentences). Falls back to the generic
 * private-development label when blank. */
function truncateFunder(raw: string | null | undefined, max = 120): string {
  const t = (raw || "").trim();
  if (t === "") return DEVELOPMENT_FUNDER;
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, "").trim() + "…";
}

/**
 * Build the enriched logLine: log_line, then public_subsidy_note when present,
 * then (for a subset row) the explicit "not counted separately" note — space-
 * joined and trimmed. Never fabricates text; every piece is a real source field
 * (or the fixed subset caveat).
 */
function enrichedLogLine(mega: Record<string, string>, isSubset: boolean): string | null {
  const parts: (string | null)[] = [nullableStr(mega.log_line), nullableStr(mega.public_subsidy_note)];
  if (isSubset) parts.push("$650M within The 78 total — not counted separately");
  const joined = parts.filter(Boolean).join(" ").trim();
  return joined || null;
}

/** Assemble one enriched development record from a megadev row + resolved geometry. */
function enrichedDevelopmentRecord(
  mega: Record<string, string>,
  geometry: InvestmentGeometry,
  id: string,
  address: string | null,
  locationReason: LocationReason | null = null,
): CommunityInvestmentRecordDraft {
  const name = (mega.name || "").trim();
  const isSubset = MEGADEV_SUBSET_NAMES.has(name);
  const priceTag = parseAmount(mega.announced_investment_usd);
  const year = Number.isInteger(Number(mega.year_announced)) ? Number(mega.year_announced) : null;
  return {
    id,
    source: "development",
    funderType: SOURCE_FUNDER_TYPE.development,
    funderName: truncateFunder(mega.lead_developers),
    recipient: name || "(unnamed project)",
    capitalClass: "grant",
    // amountAwarded is ALWAYS null for a development — a private project cost is
    // NOT a grant awarded to anyone; the announced figure lives in its own field.
    amountAwarded: null,
    announcedInvestment: isSubset ? null : priceTag, // subset → null (already inside another total)
    logLine: enrichedLogLine(mega, isSubset),
    year,
    geometry,
    address,
    status: mapStatus2026(mega.status_2026),
    recordDate: null,
    links: parseLinks(mega.source_urls),
    locationReason,
  };
}

interface DevelopmentBuild {
  records: CommunityInvestmentRecordDraft[];
  stats: {
    enrichedVerified: number;
    discoveredAdded: number;
    discoveredCitywide: number;
    subsetExcluded: number;
    privateLedExcluded: number;
    droppedNoCoords: number;
  };
}

/**
 * Build the development records: REPLACE each Ellen-KML row that matches a
 * verified megadev row (via MEGADEV_KML_JOIN) with an enriched record keyed on
 * the KML coordinates; keep the ~68 unmatched KML rows on their current behavior;
 * then APPEND the discovered megadev rows (geocoded / citywide / at-another-site).
 * `discoveredGeo` carries the pre-resolved geometry for every geocoded discovered
 * row. Deterministic — KML input order preserved, discovered rows appended in
 * CSV order.
 */
function mapDevelopments(
  kmlRows: Record<string, string>[],
  verifiedByKmlName: Map<string, Record<string, string>>,
  discoveredRows: Record<string, string>[],
  discoveredGeo: Map<string, InvestmentGeometry>,
  droppedKmlNames: Set<string>,
): DevelopmentBuild {
  const out: CommunityInvestmentRecordDraft[] = [];
  const stats: DevelopmentBuild["stats"] = {
    enrichedVerified: 0,
    discoveredAdded: 0,
    discoveredCitywide: 0,
    subsetExcluded: 0,
    privateLedExcluded: 0,
    droppedNoCoords: 0,
  };
  let idx = 0;

  for (const r of kmlRows) {
    const name = (r.name || "").trim();
    // A KML row whose matching megadev was dropped as non-private (public infra)
    // is itself dropped — we do not model it.
    if (droppedKmlNames.has(name)) continue;

    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // KML rows all carry coords

    const mega = verifiedByKmlName.get(name);
    if (mega) {
      const record = enrichedDevelopmentRecord(mega, point(lat, lng), `development-${idx++}`, null);
      out.push(record);
      stats.enrichedVerified++;
      if (record.announcedInvestment === null && MEGADEV_SUBSET_NAMES.has((mega.name || "").trim())) {
        stats.subsetExcluded++;
      }
      continue;
    }

    // Unmatched KML row → unchanged legacy behavior (announced/proposed, no
    // announced figure, no year).
    const status = (r.category || "").trim() === "Proposed Projects" ? "proposed" : "announced";
    const logLine = nullableStr(r.description) || nullableStr(r.amount_text);
    out.push({
      id: `development-${idx++}`,
      source: "development",
      funderType: SOURCE_FUNDER_TYPE.development,
      funderName: DEVELOPMENT_FUNDER,
      recipient: name || "(unnamed project)",
      capitalClass: "grant",
      amountAwarded: null, // amount_text is unparsed prose ("$7 billion"); kept in logLine, never coerced
      announcedInvestment: null, // legacy KML rows carry no verified announced figure
      logLine,
      year: null, // legacy developments carry no reliable single year
      geometry: point(lat, lng),
      address: null,
      status,
      recordDate: null,
      links: parseLinks(r.link),
    });
  }

  // Append the discovered megadev rows.
  for (const mega of discoveredRows) {
    const name = (mega.name || "").trim();
    if (isDroppableNonPrivate(mega)) {
      stats.privateLedExcluded++;
      continue;
    }
    const geoSpec = MEGADEV_DISCOVERED_GEO[name];
    let geometry: InvestmentGeometry;
    let address: string | null = null;
    let locationReason: LocationReason | null = null;
    if (geoSpec?.kind === "point") {
      geometry = point(geoSpec.lat, geoSpec.lng);
    } else if (geoSpec?.kind === "geocode") {
      const hit = discoveredGeo.get(name);
      if (hit) {
        geometry = hit;
        address = geoSpec.address;
      } else {
        geometry = { kind: "citywide" }; // ungeocodable → honest citywide, never a misplaced dot
        locationReason = "geocode_failed";
        stats.discoveredCitywide++;
      }
    } else {
      geometry = { kind: "citywide" }; // explicit citywide (multi-site)
      locationReason = "source_unlocated";
      stats.discoveredCitywide++;
    }
    const record = enrichedDevelopmentRecord(mega, geometry, `development-disc-${idx++}`, address, locationReason);
    out.push(record);
    stats.discoveredAdded++;
    if (record.announcedInvestment === null && MEGADEV_SUBSET_NAMES.has(name)) stats.subsetExcluded++;
  }

  return { records: out, stats };
}

/**
 * Map the 18 Chicago Prize rows (Pritzker Traubert Foundation). Filed under the
 * `foundation` source / philanthropic funderType, so they roll into the awarded
 * totals (the $10M winners + finalist planning grants). Sited rows plot at their
 * point; finalist rows without a site are held citywide. A blank amount → null
 * (never coerced to 0). recordProvenance "official". These never collide with the
 * government-only dedupe (foundation rows are never dedupe-eligible).
 */
function mapChicagoPrize(rows: Record<string, string>[]): CommunityInvestmentRecordDraft[] {
  const out: CommunityInvestmentRecordDraft[] = [];
  let idx = 0;
  for (const r of rows) {
    let geometry: InvestmentGeometry;
    let locationReason: LocationReason | null = null;
    if ((r.locType || "").trim() === "sited") {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
      geometry = hasCoords ? point(lat, lng) : { kind: "citywide" };
      if (!hasCoords) locationReason = "geocode_failed";
    } else {
      // A finalist round with no confirmed site (planning-stage, per-organization
      // grants rather than one funded project) — legitimately citywide by the
      // source's own design, not a geocoding failure.
      geometry = { kind: "citywide" };
      locationReason = "source_unlocated";
    }
    const purpose = nullableStr(r.purpose);
    const orgs = nullableStr(r.recipient_orgs);
    const logLine = [purpose, orgs].filter(Boolean).join(" — ") || null;
    out.push({
      id: `prize-${idx++}`,
      source: "foundation",
      funderType: SOURCE_FUNDER_TYPE.foundation,
      funderName: PRIZE_FUNDER,
      recipient: nullableStr(r.initiative) || "(unnamed initiative)",
      capitalClass: "grant",
      amountAwarded: parseAmount(r.amount),
      announcedInvestment: null,
      logLine,
      year: Number.isInteger(Number(r.award_year)) ? Number(r.award_year) : null,
      geometry,
      address: nullableStr(r.address),
      status: "awarded",
      recordDate: null,
      recordProvenance: "official",
      links: parseLinks(r.source_url),
      locationReason,
    });
  }
  return out;
}

/**
 * Fail LOUDLY if the hand-built megadev join tables and the CSV drift apart:
 * every verified row must have a MEGADEV_KML_JOIN entry pointing at a real KML
 * row, and every discovered row must have a MEGADEV_DISCOVERED_GEO entry. This is
 * the "no fuzzy magic" guarantee — a rename on either side aborts the export
 * rather than silently dropping (or mis-joining) a $-billions project.
 */
function validateMegadevJoins(
  verifiedMega: Record<string, string>[],
  discoveredMega: Record<string, string>[],
  kmlRows: Record<string, string>[],
): void {
  const kmlNames = new Set(kmlRows.map((r) => (r.name || "").trim()));
  const problems: string[] = [];

  for (const mega of verifiedMega) {
    const name = (mega.name || "").trim();
    const kmlName = MEGADEV_KML_JOIN[name];
    if (!kmlName) problems.push(`verified megadev "${name}" has no MEGADEV_KML_JOIN entry`);
    else if (!kmlNames.has(kmlName)) problems.push(`join target "${kmlName}" (for "${name}") is not a KML row`);
  }
  // Every join key must correspond to an actual verified row (no stale entries).
  const verifiedNames = new Set(verifiedMega.map((r) => (r.name || "").trim()));
  for (const key of Object.keys(MEGADEV_KML_JOIN)) {
    if (!verifiedNames.has(key)) problems.push(`MEGADEV_KML_JOIN key "${key}" matches no verified megadev row`);
  }
  for (const mega of discoveredMega) {
    const name = (mega.name || "").trim();
    if (!MEGADEV_DISCOVERED_GEO[name]) problems.push(`discovered megadev "${name}" has no MEGADEV_DISCOVERED_GEO entry`);
  }

  if (problems.length > 0) {
    throw new Error(`Megadev join validation failed:\n  - ${problems.join("\n  - ")}`);
  }
}

// ── Capital-spine sources: TIF / HUD CDBG-HOME / LIHTC / NMTC ─────────────────

const TIF_FUNDER = "Tax Increment Financing (City of Chicago)";
const HUD_FUNDER = "HUD CDBG/HOME via City of Chicago";
const LIHTC_FUNDER = "Low-Income Housing Tax Credit (IHDA / HUD)";
const NMTC_FUNDER = "New Markets Tax Credit (CDFI Fund via CDEs)";

/** Parse a 4-digit calendar year, rejecting the HUD 8888/9999 placeholder codes
 * and anything that is not a real 4-digit year — returns null (never a guess). */
function cleanYear(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  if (y === 8888 || y === 9999) return null; // HUD placeholder sentinels
  if (y < 1900 || y > 2100) return null;
  return y;
}

/** True when a raw date string parses to a moment at/earlier than `asOf`. */
function dateIsPast(raw: string | null | undefined, asOf: Date): boolean {
  if (!raw) return false;
  const t = Date.parse(String(raw).slice(0, 10));
  return Number.isFinite(t) && t <= asOf.getTime();
}

interface TifDrops {
  /** No longer a drop path (consult Q5) — kept at 0 for interface stability;
   * a future TRUE exclusion (e.g. proven non-Chicago TIF district) would
   * increment this. */
  noCoords: number;
  /** Rows retained as unplotted Chicago-program records because the source
   * publishes no coordinates for them (locationReason "source_unlocated"). */
  heldUnlocated: number;
}

/**
 * Map the TIF RDA/IGA point rows (dataset === "rda-iga") to `tif`-source records.
 * capitalClass "tif_subsidy"; the council-AUTHORIZED assistance ceiling lands in
 * authorizedAmount (amountAwarded stays null — a TIF ceiling is not a grant to a
 * business). total_project_cost is context in the logLine only, NEVER a summed
 * money field. Status: "completed" once a Certificate of Completion (COC) issued,
 * else "awarded" (CDC-approved). A row with real coordinates becomes a point; a
 * row with none is RETAINED (never dropped, consult Q5) as an unplotted citywide
 * record — its Chicago scope is already established by the source's own
 * rda-iga selection criterion, so a coordinate gap is not grounds to erase real
 * authorized dollars. Deterministic.
 */
function mapTif(rows: Record<string, string>[]): { records: CommunityInvestmentRecordDraft[]; drops: TifDrops } {
  // Sol gate finding 8 — the id NUMBERING must be IDENTICAL to the pre-held-rows
  // baseline for every record that already existed. `idx` therefore increments
  // ONLY on the exact condition that used to gate `push` at all (hasCoords) — a
  // held (no-coords) row NEVER consumes a `tif-N` slot and NEVER shifts a later
  // row's id. Held rows are collected separately and get their own
  // never-renumbering `tif-held-N` namespace, APPENDED after every point record
  // — never interleaved into the original sequence.
  const out: CommunityInvestmentRecordDraft[] = [];
  const held: CommunityInvestmentRecordDraft[] = [];
  const drops: TifDrops = { noCoords: 0, heldUnlocated: 0 };
  let idx = 0;
  let heldIdx = 0;
  for (const r of rows) {
    if ((r.dataset || "").trim() !== "rda-iga") continue; // annual-report rows are context, not records
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
    if (!hasCoords) drops.heldUnlocated++;
    const district = nullableStr(r.tif_district);
    const totalCost = parseAmount(r.total_project_cost);
    const statusText = nullableStr(r.status_text);
    const logParts = [
      district ? `TIF district: ${district}` : null,
      totalCost != null ? `Total project cost $${Math.round(totalCost).toLocaleString("en-US")}` : null,
      statusText,
    ].filter(Boolean);
    const record: CommunityInvestmentRecordDraft = {
      id: hasCoords ? `tif-${idx++}` : `tif-held-${heldIdx++}`,
      source: "tif",
      funderType: SOURCE_FUNDER_TYPE.tif,
      funderName: TIF_FUNDER,
      recipient: nullableStr(r.project_name) || nullableStr(r.recipient_or_developer) || "(unnamed project)",
      capitalClass: "tif_subsidy",
      amountAwarded: null, // a TIF ceiling is not a grant awarded to a business
      authorizedAmount: parseAmount(r.authorized_tif_assistance),
      logLine: logParts.length ? logParts.join(" · ") : null,
      year: cleanYear(r.approval_or_report_year),
      geometry: hasCoords ? point(lat, lng) : { kind: "citywide" },
      address: nullableStr(r.address),
      status: /COC issued/i.test(statusText || "") ? "completed" : "awarded",
      recordDate: null,
      recordProvenance: "official",
      links: [],
      locationReason: hasCoords ? null : "source_unlocated",
    };
    if (hasCoords) out.push(record);
    else held.push(record);
  }
  return { records: [...out, ...held], drops };
}

interface HudDrops {
  /** TRUE exclusions only: a row with NO usable coordinate at all (nothing to
   * classify as an administrative address vs. a Chicago site). Rare/zero in the
   * current input; kept as a real drop because there is no location claim of
   * ANY kind to retain. */
  outOfBbox: number;
  /** Rows RETAINED (consult Q5) because they carry a REAL coordinate that
   * resolves to a non-Chicago administrative/suburban/out-of-state address —
   * Chicago-administered (GRANTEE_ID=17408), location-unresolved. EXCLUDED from
   * sited + community-area totals (citywide geometry is never point-stamped)
   * but never deleted — the federal allocation is still real. */
  heldAdministrativeOutsideCity: number;
}

/**
 * Map the geocoded HUD CDBG/HOME activity rows to `cdbg-home`-source records.
 * capitalClass "federal_program"; funding_amount is a COMMITTED FEDERAL PROGRAM
 * ALLOCATION, not a discretionary grant award to a named business — it lands in
 * authorizedAmount, NOT amountAwarded (which stays null). Status is "completed"
 * once the activity's completion_date is in the past, else "awarded". A row with
 * NO coordinate at all is a true drop (nothing to plot OR retain with a location
 * claim). A row whose real coordinate falls OUTSIDE the Chicago bounding box is
 * RETAINED as an unplotted citywide record — Chicago-administered (the source is
 * already filtered to GRANTEE_ID=17408, the City of Chicago), location-unresolved
 * (consult Q5) — never silently deleted, never plotted at the misleading
 * suburban/foreign point either. Deterministic.
 */
function mapHud(
  rows: Record<string, string>[],
  asOf: Date,
): { records: CommunityInvestmentRecordDraft[]; drops: HudDrops } {
  // Sol gate finding 8 — same append-only discipline as mapTif: `idx` increments
  // ONLY on the exact old gating condition (inBounds), so every previously
  // existing `cdbg-home-N` id is reproduced exactly. Held (administrative
  // outside-city) rows get their own `cdbg-home-held-N` namespace, appended
  // after every point record.
  const out: CommunityInvestmentRecordDraft[] = [];
  const held: CommunityInvestmentRecordDraft[] = [];
  const drops: HudDrops = { outOfBbox: 0, heldAdministrativeOutsideCity: 0 };
  let idx = 0;
  let heldIdx = 0;
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
    if (!hasCoords) {
      drops.outOfBbox++; // no usable coord at all → nothing to retain, true exclusion
      continue;
    }
    const inBounds = inChicagoBounds(lat, lng);
    if (!inBounds) drops.heldAdministrativeOutsideCity++;
    const program = (r.program || "").trim().toUpperCase();
    const objective = nullableStr(r.national_objective);
    const group = nullableStr(r.activity_group);
    const logParts = [program ? `${program} activity` : null, group, objective].filter(Boolean);
    const record: CommunityInvestmentRecordDraft = {
      id: inBounds ? `cdbg-home-${idx++}` : `cdbg-home-held-${heldIdx++}`,
      source: "cdbg-home",
      funderType: SOURCE_FUNDER_TYPE["cdbg-home"],
      funderName: HUD_FUNDER,
      recipient: nullableStr(r.activity_name) || "(unnamed activity)",
      capitalClass: "federal_program",
      amountAwarded: null, // program funding, not a grant award to a business
      authorizedAmount: parseAmount(r.funding_amount),
      logLine: logParts.length ? logParts.join(" · ") : null,
      year: yearOfDate(r.completion_date),
      geometry: inBounds ? point(lat, lng) : { kind: "citywide" },
      address: nullableStr(r.address),
      status: dateIsPast(r.completion_date, asOf) ? "completed" : "awarded",
      recordDate: nullableStr(r.completion_date),
      recordProvenance: "official",
      links: [],
      locationReason: inBounds ? null : "administrative_address_outside_city",
    };
    if (inBounds) out.push(record);
    else held.push(record);
  }
  return { records: [...out, ...held], drops };
}

interface LihtcDrops {
  /** No longer a drop path (consult Q5) — kept at 0 for interface stability. */
  noCoords: number;
  /** Rows retained as unplotted Chicago-program records because the source
   * publishes no coordinates for them (locationReason "source_unlocated"). */
  heldUnlocated: number;
}

/**
 * Map the LIHTC rows to `lihtc`-source records. capitalClass "tax_credit"; the
 * annual_allocated_amount (often blank → null, never coerced) lands in
 * creditAmount. Year from allocation_year (HUD 8888/9999 sentinels → null).
 * Status "completed" once placed in service, else "awarded". A row with real
 * coordinates becomes a point; a row with none is RETAINED (never dropped,
 * consult Q5) as an unplotted citywide record with provenance — the Chicago
 * selection criterion that put it in this curated file is retained even when
 * the coordinate is not. Deterministic.
 */
function mapLihtc(rows: Record<string, string>[]): { records: CommunityInvestmentRecordDraft[]; drops: LihtcDrops } {
  // Sol gate finding 8 — same append-only discipline as mapTif/mapHud.
  const out: CommunityInvestmentRecordDraft[] = [];
  const held: CommunityInvestmentRecordDraft[] = [];
  const drops: LihtcDrops = { noCoords: 0, heldUnlocated: 0 };
  let idx = 0;
  let heldIdx = 0;
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
    if (!hasCoords) drops.heldUnlocated++;
    const placed = cleanYear(r.placed_in_service_year);
    const units = nullableStr(r.units_total);
    const lowInc = nullableStr(r.units_low_income);
    // Sol gate finding 3 — retain the source's OWN identifier (hud_id) and its
    // own explanatory text for a held row's Chicago-selection provenance
    // (coord_source, e.g. "missing_no_usable_address") verbatim.
    const hudId = nullableStr(r.hud_id);
    const coordSource = nullableStr(r.coord_source);
    const logParts = [
      units ? `${units} units` : null,
      lowInc ? `${lowInc} low-income` : null,
      placed != null ? `placed in service ${placed}` : null,
      !hasCoords && coordSource ? `source coordinate status: ${coordSource}` : null,
    ].filter(Boolean);
    const record: CommunityInvestmentRecordDraft = {
      id: hasCoords ? `lihtc-${idx++}` : `lihtc-held-${heldIdx++}`,
      source: "lihtc",
      funderType: SOURCE_FUNDER_TYPE.lihtc,
      funderName: LIHTC_FUNDER,
      recipient: nullableStr(r.project_name) || "(unnamed project)",
      capitalClass: "tax_credit",
      amountAwarded: null,
      creditAmount: parseAmount(r.annual_allocated_amount),
      logLine: logParts.length ? logParts.join(" · ") : null,
      year: cleanYear(r.allocation_year),
      geometry: hasCoords ? point(lat, lng) : { kind: "citywide" },
      address: nullableStr(r.address),
      status: placed != null ? "completed" : "awarded",
      recordDate: null,
      recordProvenance: "official",
      links: [],
      locationReason: hasCoords ? null : "source_unlocated",
      sourceRecordId: hudId,
      sourceLocationProvenance: coordSource,
    };
    if (hasCoords) out.push(record);
    else held.push(record);
  }
  return { records: [...out, ...held], drops };
}

interface NmtcStamp {
  stamped: number;
  unstamped: number;
}

/**
 * Map the NMTC rows to `nmtc`-source records. The public NMTC file carries NO
 * street address, so every record is CITYWIDE geometry and NEVER plots. But each
 * row DOES carry its project's 2020 census tract, whose gazetteer centroid we
 * point-in-polygon against the SAME community-area boundaries used for the point
 * records (assignCommunityArea) to stamp a communityArea — so the record still
 * appears in that community's credit-capital analysis list without ever being
 * drawn at the tract centroid (which is not the project's real location).
 * capitalClass "tax_credit"; project_qlici_amount lands in creditAmount. A row
 * whose tract has no centroid is kept citywide with NO communityArea (counted).
 * Deterministic.
 */
function mapNmtc(
  rows: Record<string, string>[],
  polygons: ReturnType<typeof loadCommunityAreaPolygons>,
): { records: CommunityInvestmentRecord[]; stamp: NmtcStamp } {
  const out: CommunityInvestmentRecord[] = [];
  const stamp: NmtcStamp = { stamped: 0, unstamped: 0 };
  let idx = 0;
  for (const r of rows) {
    const clat = Number(r.tract_centroid_lat);
    const clng = Number(r.tract_centroid_lng);
    let communityArea: string | null = null;
    if (Number.isFinite(clat) && Number.isFinite(clng) && (clat !== 0 || clng !== 0)) {
      communityArea = assignCommunityArea(clng, clat, polygons);
    }
    if (communityArea) stamp.stamped++;
    else stamp.unstamped++;
    const cde = nullableStr(r.cde_name);
    const purpose = nullableStr(r.purpose_text);
    const cost = parseAmount(r.estimated_total_project_cost);
    const logParts = [
      cde ? `CDE: ${cde}` : null,
      purpose,
      cost != null ? `Estimated total project cost $${Math.round(cost).toLocaleString("en-US")}` : null,
    ].filter(Boolean);
    out.push({
      id: `nmtc-${idx++}`,
      source: "nmtc",
      funderType: SOURCE_FUNDER_TYPE.nmtc,
      governmentFundingPurpose: governmentFundingPurposeForRecord({
        source: "nmtc",
        funderType: SOURCE_FUNDER_TYPE.nmtc,
        sourcePurposeText: purpose,
      }),
      funderName: NMTC_FUNDER,
      recipient: cde || "(unnamed CDE project)",
      capitalClass: "tax_credit",
      amountAwarded: null,
      creditAmount: parseAmount(r.project_qlici_amount),
      logLine: logParts.length ? logParts.join(" · ") : null,
      year: cleanYear(r.year),
      // Citywide — the public file has no street address; NEVER plotted. The
      // communityArea below is stamped from the 2020 tract centroid for analysis.
      geometry: { kind: "citywide" },
      address: null,
      ...(communityArea ? { communityArea } : {}),
      status: "awarded",
      recordDate: null,
      recordProvenance: "official",
      links: [],
      // Structurally citywide (the source never publishes a street address for
      // any NMTC QLICI) — never a geocode failure, always "source_unlocated".
      locationReason: "source_unlocated",
    });
  }
  return { records: out, stamp };
}

// ── Historical county awards + state capital appropriations ─────────────────

const COOK_SOURCE_PDF_URL =
  "https://cookcountysmallbiz.org/wp-content/uploads/2024/11/2023-Source-Grant-Awardee-List-a.o-11.20.24_.pdf";
const DCEO_CAPITAL_PDF_URL =
  "https://dceo.illinois.gov/content/dam/soi/en/web/dceo/aboutdceo/grantopportunities/documents/dceo-cap-approp-list.pdf";

function normalizeFiveDigitZip(raw: string | null | undefined): string | null {
  const match = String(raw ?? "").match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

function loadChicagoZipCodes(): Set<string> {
  const parsed = JSON.parse(readFileSync(ZIP_GEOJSON_PATH, "utf8")) as {
    features?: Array<{ properties?: { zip?: unknown } }>;
  };
  const zips = new Set<string>();
  for (const feature of parsed.features ?? []) {
    const zip = normalizeFiveDigitZip(String(feature.properties?.zip ?? ""));
    if (zip) zips.add(zip);
  }
  if (zips.size < 50) {
    throw new Error(`Chicago ZIP boundary source is incomplete (${zips.size} ZIPs).`);
  }
  return zips;
}

function mapCookSourceGrants(
  rows: Record<string, string>[],
  chicagoZipCodes: ReadonlySet<string>,
): {
  records: CommunityInvestmentRecordDraft[];
  chicagoRecords: number;
  outsideChicagoRecords: number;
} {
  const records: CommunityInvestmentRecordDraft[] = [];
  let outsideChicagoRecords = 0;
  for (const row of rows) {
    const zip = normalizeFiveDigitZip(row.zip);
    const municipality = nullableStr(row.municipality);
    const isChicago = municipality?.toUpperCase() === "CHICAGO";
    if (!zip || !isChicago || !chicagoZipCodes.has(zip)) {
      outsideChicagoRecords += 1;
      continue;
    }
    const amount = parseAmount(row.award_amount_usd);
    if (amount == null || amount < 0) {
      throw new Error(`Cook County Source Grant row has an invalid award amount for ${row.awardee_name}.`);
    }
    const recipient = nullableStr(row.awardee_name) || "(unnamed awardee)";
    const id = `cook-source-2023-${records.length}`;
    records.push({
      id,
      source: "cook-source-2023",
      funderType: SOURCE_FUNDER_TYPE["cook-source-2023"],
      funderName: COOK_SOURCE_PROGRAM,
      recipient,
      capitalClass: "grant",
      amountAwarded: null,
      logLine:
        "Historical 2023 small-business recovery award. Cook County reports the program was fully disbursed by February 2024.",
      year: 2023,
      // The official recipient list publishes ZIP, not a street address. Never
      // invent a point: the client joins this to an official ZIP polygon and
      // exposes only aggregate counts/dollars.
      geometry: { kind: "zip_area", zip },
      address: null,
      postalCode: zip,
      status: "disbursed",
      recordDate: null,
      recordProvenance: "official",
      links: [nullableStr(row.source_url) || COOK_SOURCE_PDF_URL],
      recovery: historicalRecoveryRecord("cook-source-2023", amount),
    });
  }
  return {
    records,
    chicagoRecords: records.length,
    outsideChicagoRecords,
  };
}

function mapIllinoisBusinessInterruptionGrants(
  rows: Record<string, string>[],
  chicagoZipCodes: ReadonlySet<string>,
): {
  records: CommunityInvestmentRecordDraft[];
  chicagoRecords: number;
  outsideChicagoRecords: number;
} {
  const records: CommunityInvestmentRecordDraft[] = [];
  let outsideChicagoRecords = 0;
  for (const row of rows) {
    const zip = normalizeFiveDigitZip(row.zip);
    const isChicago =
      nullableStr(row.city)?.toUpperCase() === "CHICAGO" &&
      nullableStr(row.county)?.toUpperCase() === "COOK";
    if (!zip || !isChicago || !chicagoZipCodes.has(zip)) {
      outsideChicagoRecords += 1;
      continue;
    }

    const amount = parseAmount(row.grant_amount_usd);
    if (amount == null || amount < 0) {
      throw new Error(
        `Illinois BIG row has an invalid historical grant amount for ${row.legal_business_name}.`,
      );
    }
    const legalName = nullableStr(row.legal_business_name);
    const dba = nullableStr(row.dba);
    const recipient = dba || legalName || "(unnamed awardee)";
    const sourceRow = nullableStr(row.source_row_number) || String(records.length + 1);
    records.push({
      id: `illinois-big-${sourceRow}`,
      source: "illinois-big",
      funderType: SOURCE_FUNDER_TYPE["illinois-big"],
      funderName: ILLINOIS_BIG_PROGRAM,
      recipient,
      capitalClass: "grant",
      amountAwarded: null,
      logLine: [
        dba && legalName && dba.toUpperCase() !== legalName.toUpperCase()
          ? `Legal business: ${legalName}`
          : null,
        nullableStr(row.round),
        "Historical CARES-funded grant from a closed program",
      ]
        .filter(Boolean)
        .join(" · "),
      year: 2020,
      geometry: { kind: "zip_area", zip },
      address: null,
      postalCode: zip,
      status: "disbursed",
      recordDate: null,
      recordProvenance: "official",
      links: [
        nullableStr(row.source_url) ??
          RECOVERY_INVESTMENT_SOURCE_METADATA["illinois-big"].canonicalSourceUrl,
      ],
      recovery: historicalRecoveryRecord("illinois-big", amount),
    });
  }
  return {
    records,
    chicagoRecords: records.length,
    outsideChicagoRecords,
  };
}

function mapIllinoisHospitalityEmergencyGrants(
  rows: Record<string, string>[],
): {
  records: CommunityInvestmentRecordDraft[];
  chicagoRecords: number;
  outsideChicagoRecords: number;
} {
  const records: CommunityInvestmentRecordDraft[] = [];
  let outsideChicagoRecords = 0;
  for (const row of rows) {
    const isChicago =
      nullableStr(row.published_municipality)?.toUpperCase() === "CHICAGO" &&
      nullableStr(row.county)?.toUpperCase() === "COOK";
    if (!isChicago) {
      outsideChicagoRecords += 1;
      continue;
    }

    const amount = parseAmount(row.historical_grant_amount_usd);
    if (amount == null || amount < 0) {
      throw new Error(
        `Illinois Hospitality row has an invalid historical grant amount for ${row.legal_business_name}.`,
      );
    }
    const legalName = nullableStr(row.legal_business_name);
    const dba = nullableStr(row.dba);
    const recipient = dba || legalName || "(unnamed awardee)";
    records.push({
      id: `illinois-hospitality-emergency-${records.length}`,
      source: "illinois-hospitality-emergency",
      funderType: SOURCE_FUNDER_TYPE["illinois-hospitality-emergency"],
      funderName: ILLINOIS_HOSPITALITY_PROGRAM,
      recipient,
      capitalClass: "grant",
      amountAwarded: null,
      logLine: [
        dba && legalName && dba.toUpperCase() !== legalName.toUpperCase()
          ? `Legal business: ${legalName}`
          : null,
        "Historical state emergency grant from a closed program",
      ]
        .filter(Boolean)
        .join(" · "),
      year: 2020,
      // The official list publishes only city and county. An administrator
      // address, guessed ZIP, or downtown centroid would all be misleading.
      geometry: { kind: "citywide" },
      address: null,
      status: "disbursed",
      recordDate: null,
      recordProvenance: "official",
      // The source never publishes a street address or ZIP for this program —
      // structurally unlocated, never a geocode failure.
      locationReason: "source_unlocated",
      links: [
        nullableStr(row.source_url) ??
          RECOVERY_INVESTMENT_SOURCE_METADATA["illinois-hospitality-emergency"]
            .canonicalSourceUrl,
      ],
      recovery: historicalRecoveryRecord(
        "illinois-hospitality-emergency",
        amount,
      ),
    });
  }
  return {
    records,
    chicagoRecords: records.length,
    outsideChicagoRecords,
  };
}

function mapIllinoisBackToBusiness(
  rows: Record<string, string>[],
  chicagoZipCodes: ReadonlySet<string>,
): {
  records: CommunityInvestmentRecordDraft[];
  chicagoRecords: number;
  outsideChicagoRecords: number;
} {
  const records: CommunityInvestmentRecordDraft[] = [];
  let outsideChicagoRecords = 0;
  for (const row of rows) {
    const zip = normalizeFiveDigitZip(row.zip);
    const isChicago =
      nullableStr(row.city)?.toUpperCase() === "CHICAGO" &&
      nullableStr(row.county)?.toUpperCase() === "COOK";
    if (!zip || !isChicago || !chicagoZipCodes.has(zip)) {
      outsideChicagoRecords += 1;
      continue;
    }

    const amount = parseAmount(row.award_amount_usd);
    if (amount == null || amount < 0) {
      throw new Error(
        `Illinois Back to Business row has an invalid historical award amount for ${row.legal_business_name}.`,
      );
    }
    const legalName = nullableStr(row.legal_business_name);
    const dba = nullableStr(row.dba);
    const recipient = dba || legalName || "(unnamed awardee)";
    const id = `illinois-b2b-${records.length}`;
    const sourceLink =
      nullableStr(row.source_url) ??
      RECOVERY_INVESTMENT_SOURCE_METADATA["illinois-b2b"].canonicalSourceUrl;
    records.push({
      id,
      source: "illinois-b2b",
      funderType: SOURCE_FUNDER_TYPE["illinois-b2b"],
      funderName: ILLINOIS_B2B_PROGRAM,
      recipient,
      capitalClass: "grant",
      amountAwarded: null,
      logLine:
        dba && legalName && dba.toUpperCase() !== legalName.toUpperCase()
          ? `Legal business: ${legalName}. Historical ARPA-funded grant; not an active opportunity.`
          : "Historical ARPA-funded grant; not an active opportunity.",
      year: 2022,
      geometry: { kind: "zip_area", zip },
      address: null,
      postalCode: zip,
      status: "disbursed",
      recordDate: null,
      recordProvenance: "official",
      links: [sourceLink],
      recovery: historicalRecoveryRecord("illinois-b2b", amount),
    });
  }
  return {
    records,
    chicagoRecords: records.length,
    outsideChicagoRecords,
  };
}

interface SbaRrfMapResult {
  records: CommunityInvestmentRecordDraft[];
  pointRecords: number;
  citywideRecords: number;
  addressGeocodeMisses: number;
  addressOutOfBounds: number;
}

function sbaRrfGeocodeQuery(row: Record<string, string>): string | null {
  const address = nullableStr(row.published_street_address);
  if (!address) return null;
  const zip = normalizeFiveDigitZip(row.published_zip);
  return [address, "Chicago", "IL", zip].filter(Boolean).join(", ");
}

function mapSbaRestaurantRevitalization(
  rows: Record<string, string>[],
  geocodes: ReadonlyMap<string, { lat: number; lng: number } | null>,
  chicagoPolygons: ReturnType<typeof loadCommunityAreaPolygons>,
): SbaRrfMapResult {
  const records: CommunityInvestmentRecordDraft[] = [];
  let pointRecords = 0;
  let addressGeocodeMisses = 0;
  let addressOutOfBounds = 0;

  for (const row of rows) {
    const amount = parseAmount(row.grant_amount_usd);
    if (amount == null || amount < 0) {
      throw new Error(
        `SBA RRF row has an invalid historical grant amount for ${row.record_id || row.legal_business_name}.`,
      );
    }
    const address = nullableStr(row.published_street_address);
    const query = sbaRrfGeocodeQuery(row);
    const rawHit = query ? geocodes.get(query) ?? null : null;
    const inside =
      rawHit && assignCommunityArea(rawHit.lng, rawHit.lat, chicagoPolygons)
        ? rawHit
        : null;
    if (query && !rawHit) addressGeocodeMisses += 1;
    if (rawHit && !inside) addressOutOfBounds += 1;

    const geometry: InvestmentGeometry = inside
      ? point(inside.lat, inside.lng)
      : { kind: "citywide" };
    if (geometry.kind === "point") pointRecords += 1;
    // No published address to even attempt a geocode -> source_unlocated; a
    // published address that missed or resolved outside Chicago -> geocode_failed.
    const locationReason: LocationReason | null = inside ? null : address ? "geocode_failed" : "source_unlocated";

    const legalName = nullableStr(row.legal_business_name);
    const dba = nullableStr(row.dba_trade_name);
    const recipient = dba || legalName || "(unnamed restaurant)";
    const id = nullableStr(row.record_id) || `sba-rrf-${records.length}`;
    const sourceLinks = [
      nullableStr(row.source_url) ??
        RECOVERY_INVESTMENT_SOURCE_METADATA["sba-rrf"].canonicalSourceUrl,
      nullableStr(row.source_download_url),
    ].filter((value): value is string => Boolean(value));
    const purposeLabels = [
      ["grant_purp_cons_outdoor_seating", "outdoor seating"],
      ["grant_purpose_debt", "business debt"],
      ["grant_purpose_food", "food"],
      ["grant_purpose_operations", "operations"],
      ["grant_purpose_payroll", "payroll"],
      ["grant_purpose_rent", "rent"],
      ["grant_purpose_supplies", "supplies"],
      ["grant_purpose_utility", "utilities"],
    ]
      .filter(([field]) => row[field] === "Y")
      .map(([, label]) => label);
    records.push({
      id,
      source: "sba-rrf",
      funderType: SOURCE_FUNDER_TYPE["sba-rrf"],
      funderName: SBA_RRF_PROGRAM,
      recipient,
      capitalClass: "grant",
      amountAwarded: null,
      logLine: [
        dba && legalName && dba.toUpperCase() !== legalName.toUpperCase()
          ? `Legal business: ${legalName}`
          : null,
        purposeLabels.length ? `Published uses: ${purposeLabels.join(", ")}` : null,
        "Closed historical ARPA program; not a current funding opportunity",
      ]
        .filter(Boolean)
        .join(" · "),
      year: yearOfDate(row.approval_date) ?? 2021,
      geometry,
      address,
      postalCode: normalizeFiveDigitZip(row.published_zip) ?? undefined,
      status: "disbursed",
      recordDate: nullableStr(row.approval_date),
      recordProvenance: "official",
      links: [...new Set(sourceLinks)],
      recovery: historicalRecoveryRecord("sba-rrf", amount),
      locationReason,
    });
  }

  return {
    records,
    pointRecords,
    citywideRecords: records.length - pointRecords,
    addressGeocodeMisses,
    addressOutOfBounds,
  };
}

const DCEO_EXPLICIT_ADDRESS_RE =
  /\b\d{1,6}(?:-\d{1,6})?\s+(?:(?:NORTH|SOUTH|EAST|WEST|N|S|E|W)\.?\s+)?(?:[A-Z0-9][A-Z0-9.'’/-]*\s+){0,7}(?:STREET|ST|AVENUE|AVE|BOULEVARD|BLVD|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|PARKWAY|PKWY|HIGHWAY|HWY|TERRACE|TER|CIRCLE|CIR|WAY)\b/gi;
function isHighConfidenceChicagoDceoRow(row: Record<string, string>): boolean {
  return hasHighConfidenceChicagoDceoLocation({
    lineName: row.line_name || "",
    originalDescription: row.original_description || "",
  });
}

function sourceLiteralDceoAddresses(description: string): string[] {
  const matches = description.match(DCEO_EXPLICIT_ADDRESS_RE) ?? [];
  return [...new Set(matches.map((match) => match.replace(/\s+/g, " ").trim().toUpperCase()))];
}

interface DceoCandidate {
  row: Record<string, string>;
  safeAddress: string | null;
  multiSite: boolean;
}

function selectChicagoDceoCandidates(rows: Record<string, string>[]): DceoCandidate[] {
  const candidates: DceoCandidate[] = [];
  for (const row of rows) {
    if (!isHighConfidenceChicagoDceoRow(row)) continue;
    const addresses = sourceLiteralDceoAddresses(row.original_description || "");
    const explicitlyVarious = /\b(?:VARIOUS LOCATIONS|MULTIPLE LOCATIONS|MULTI-SITE)\b/i.test(
      row.original_description || "",
    );
    // Two house numbers sharing one street suffix ("6808 O 6816 S HALSTED ST",
    // "4111/4113 N PULASKI AVE") collapse to a SINGLE regex match, so the match
    // count alone fails open and the row would plot as one confident point.
    // describesMultipleProjectSites catches that shape explicitly.
    const multipleHouseNumbers = describesMultipleProjectSites(row.original_description || "");
    const multiSite = explicitlyVarious || multipleHouseNumbers || addresses.length > 1;
    const parsedAddress = nullableStr(row.explicit_project_address);
    candidates.push({
      row,
      safeAddress: !multiSite && addresses.length === 1 && parsedAddress ? parsedAddress : null,
      multiSite,
    });
  }
  return candidates;
}

function conciseDceoDescription(raw: string): string | null {
  const text = nullableStr(raw);
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ");
  return normalized.length <= 320 ? normalized : `${normalized.slice(0, 317).trimEnd()}...`;
}

function mapDceoCapital(
  candidates: readonly DceoCandidate[],
  geocodes: ReadonlyMap<string, { lat: number; lng: number } | null>,
  queryForAddress: (address: string) => string,
  chicagoPolygons: ReturnType<typeof loadCommunityAreaPolygons>,
): {
  records: CommunityInvestmentRecordDraft[];
  pointRecords: number;
  citywideRecords: number;
  addressGeocodeMisses: number;
  addressOutOfBounds: number;
  multiSiteHeldCitywide: number;
} {
  const records: CommunityInvestmentRecordDraft[] = [];
  let pointRecords = 0;
  let addressGeocodeMisses = 0;
  let addressOutOfBounds = 0;
  let multiSiteHeldCitywide = 0;
  for (const candidate of candidates) {
    const { row, safeAddress, multiSite } = candidate;
    const rawHit = safeAddress ? geocodes.get(queryForAddress(safeAddress)) : null;
    const hit =
      rawHit && assignCommunityArea(rawHit.lng, rawHit.lat, chicagoPolygons)
        ? rawHit
        : null;
    if (safeAddress && !rawHit) addressGeocodeMisses += 1;
    if (rawHit && !hit) {
      // A source-literal address that resolves outside the official city
      // polygons is a bad GEOCODE, not a bad appropriation — the row already
      // cleared hasHighConfidenceChicagoDceoLocation on the source's own
      // evidence. Hold it citywide (unplotted) exactly like the foundation
      // path does, so the appropriation and its dollars stay in the export and
      // stay auditable. Deleting the record instead made a real $250,000 state
      // appropriation vanish with nothing but a counter to explain it, and made
      // dceoChicagoRecords silently non-deterministic across geocoder refreshes.
      addressOutOfBounds += 1;
    }
    if (multiSite) multiSiteHeldCitywide += 1;
    const geometry: InvestmentGeometry = hit ? point(hit.lat, hit.lng) : { kind: "citywide" };
    if (geometry.kind === "point") pointRecords += 1;
    // Multi-site describes more than one location -> source_unlocated (no
    // single point the source itself resolves to); a published address that
    // missed or resolved outside Chicago -> geocode_failed; no address at all
    // (should not occur post-selection, but never left unlabeled) -> source_unlocated.
    const locationReason: LocationReason | null = hit
      ? null
      : multiSite
        ? "source_unlocated"
        : safeAddress
          ? "geocode_failed"
          : "source_unlocated";
    const lineType = row.line_type === "line_item" ? "Line-item appropriation" : "Lump-sum appropriation record";
    const description = conciseDceoDescription(row.original_description);
    const sourceLinks = [nullableStr(row.source_url) || DCEO_CAPITAL_PDF_URL, DCEO_CAPITAL_SOURCE_PAGE];
    const publishedBalance = parseAmount(row.appropriated_amount);
    if (publishedBalance == null) {
      throw new Error(`DCEO capital row has an invalid published amount for ${row.line_name}.`);
    }
    records.push({
      id: `dceo-capital-${records.length}`,
      source: "dceo-capital",
      funderType: SOURCE_FUNDER_TYPE["dceo-capital"],
      funderName: DCEO_CAPITAL_FUNDER,
      recipient: nullableStr(row.line_name) || "(unnamed appropriation line)",
      capitalClass: "state_appropriation",
      amountAwarded: null,
      publishedBalance,
      logLine: [lineType, description].filter(Boolean).join(" · "),
      year: 2026,
      geometry,
      address: safeAddress,
      postalCode: normalizeFiveDigitZip(row.original_description) ?? undefined,
      status: "appropriated",
      recordDate: null,
      recordProvenance: "official",
      links: [...new Set(sourceLinks)],
      locationReason,
    });
  }
  return {
    records,
    pointRecords,
    citywideRecords: records.length - pointRecords,
    addressGeocodeMisses,
    addressOutOfBounds,
    multiSiteHeldCitywide,
  };
}

/**
 * Map the CDG award rounds. A row whose address geocodes becomes a plotted
 * point; a row whose address does NOT geocode — or that publishes no street
 * address at all — is HELD CITYWIDE, exactly like the DCEO and foundation
 * paths above, never dropped.
 *
 * Dropping was the original behaviour and it deleted real, published award
 * dollars: 11 rows / $16,258,316, including the June-2026 round's largest
 * single grant ($5,000,000 to "Floreciendo: La Villita / Erie House Community
 * Center", whose address column carries the city's own "South Lawndale (Little
 * Village) -- exact street address not published") and a $4,870,000 February
 * 2023 grocery award at 13016 S. Rhodes Ave. that the Census geocoder simply
 * could not match. The only trace was one global meta.droppedNoGeocode integer
 * with no source and no dollar figure, so the published headline read as if
 * that money had never been awarded. Held citywide, the award keeps its amount,
 * address text and provenance, is counted in meta.citywideCount and in the
 * legend's "N citywide records not included (no point location)" note, and is
 * still never plotted at a guessed location.
 *
 * Safe against double counting because CDG is the sole source of these awards;
 * none of the held rows has an address+amount twin anywhere in the export.
 */
export function mapCdgAwards(
  rows: readonly Record<string, string>[],
  geocodes: ReadonlyMap<string, GeoResult | null>,
  queryForAddress: (address: string) => string,
): {
  records: CommunityInvestmentRecordDraft[];
  pointRecords: number;
  citywideRecords: number;
  /** Published CDG addresses that returned no Census geocoder match. */
  addressGeocodeMisses: number;
  /** Awarded dollars on the rows held citywide — the figure the old drop hid. */
  heldCitywideDollars: number;
} {
  const records: CommunityInvestmentRecordDraft[] = [];
  let pointRecords = 0;
  let addressGeocodeMisses = 0;
  let heldCitywideDollars = 0;
  for (const r of rows) {
    const addr = nullableStr(r.address);
    // First candidate with a cached/live hit wins; candidate order is the
    // published text first, so a variant can never shadow an exact match.
    let hit: GeoResult | null = null;
    if (addr) {
      for (const q of cdgQueryCandidates(addr, queryForAddress)) {
        const candidateHit = geocodes.get(q);
        if (candidateHit) {
          hit = candidateHit;
          break;
        }
      }
    }
    if (addr && !hit) addressGeocodeMisses += 1;
    const geometry: InvestmentGeometry = hit ? point(hit.lat, hit.lng) : { kind: "citywide" };
    if (geometry.kind === "point") pointRecords += 1;
    const amountAwarded = parseAmount(r.amount);
    if (!hit && amountAwarded != null) heldCitywideDollars += amountAwarded;
    // A published address that failed to geocode is "geocode_failed"; a row
    // with NO address column at all (only a community-area label) is
    // "source_unlocated" — the City never published a site to attempt.
    const locationReason: LocationReason | null = hit ? null : addr ? "geocode_failed" : "source_unlocated";
    records.push({
      id: `cdg-${records.length}`,
      source: "cdg",
      funderType: SOURCE_FUNDER_TYPE.cdg,
      funderName: CDG_PROGRAM,
      recipient: nullableStr(r.recipient) || "(unnamed recipient)",
      capitalClass: "grant",
      amountAwarded,
      logLine: nullableStr(r.log_line),
      year: yearOfRound(r.round),
      geometry,
      address: addr,
      locationReason,
      // A row the City published WITHOUT a street address can still publish
      // its community area in the address column ("South Lawndale (Little
      // Village) -- exact street address not published"). Stamping the CA from
      // that text is the source's own claim, not an inference — without it the
      // June-2026 round's two largest grants ($8.9M) appeared on no area page.
      communityArea:
        !hit && addr ? sourcePublishedCommunityArea(addr) ?? undefined : undefined,
      status: "awarded",
      recordDate: null, // CDG rounds carry only a round label, no per-record date
      links: parseLinks(r.source_url),
    });
  }
  return {
    records,
    pointRecords,
    citywideRecords: records.length - pointRecords,
    addressGeocodeMisses,
    heldCitywideDollars,
  };
}

/**
 * Ordered geocode queries for one published CDG address — the published text
 * verbatim first, then deterministic normalizations of it:
 *   • periods stripped ("13016 S. Rhodes Ave." → "13016 S Rhodes Ave")
 *   • a leading street-number range collapsed to its first number
 *     ("2640-46 W Madison St" → "2640 W Madison St")
 *   • a slash compound split into its component addresses
 *     ("8700 S Ashland/1607 W 87th" → both halves, each a complete published
 *     address of the same site)
 * Every variant is a mechanical rewrite of text the City itself published —
 * no street name, suffix, or number is ever invented — and the record's
 * `address` field always keeps the original text. The Census geocoder rejects
 * all three shapes verbatim, which is how a $250,000 award at a real published
 * address stayed off the map.
 */
export function cdgQueryCandidates(
  address: string,
  queryForAddress: (address: string) => string,
): string[] {
  const variants: string[] = [address];
  const noPeriods = address.replace(/\./g, "");
  variants.push(noPeriods);
  variants.push(noPeriods.replace(/^(\d+)-\d+\s/, "$1 "));
  if (noPeriods.includes("/")) {
    for (const part of noPeriods.split("/")) {
      if (part.trim()) variants.push(part.trim());
    }
  }
  return [...new Set(variants.map((v) => queryForAddress(v.trim())))];
}

/**
 * The community area the source itself published in lieu of a street address.
 * Matches only the exporter's own held-row convention ("<area name>
 * (<colloquial name>)? -- exact street address not published") and returns the
 * official community-area name with any parenthetical stripped. Anything else
 * returns null — this never infers an area from a street address or recipient
 * name.
 */
export function sourcePublishedCommunityArea(addressText: string): string | null {
  const m = addressText.match(
    /^([A-Za-z][A-Za-z .'-]*?)\s*(?:\([^)]*\))?\s*--\s*exact street address not published\s*$/,
  );
  return m ? m[1].trim() : null;
}

export interface PartnerNofMapResult {
  records: CommunityInvestmentRecordDraft[];
  pointRecords: number;
  citywideRecords: number;
  addressGeocodeMisses: number;
  heldCitywideDollars: number;
  confirmedDuplicateRows: number;
  reconciliation: PartnerNofReconciliationOutcome[];
}

export type PartnerNofReconciliationOutcome =
  | {
      outcome: "accepted";
      inputIndex: number;
      recipient: string;
      amountAwarded: number | null;
      awardYear: number | null;
    }
  | {
      outcome: "confirmed-duplicate";
      inputIndex: number;
      recipient: string;
      amountAwarded: number;
      awardYear: number;
      officialRecipient: string;
      officialApprovalYear: number;
      matchBasis: "exact_name_amount_approval_year_address" | "confirmed_source_pair";
    };

/**
 * Map the partner-maintained South Shore NOF list without using geometry as a
 * dedupe prerequisite. A row is a confirmed duplicate when normalized project
 * name and address, exact amount, and partner-published award year match the
 * approval year on an official NOF/SBIF source row, or when an explicit
 * source-pair rule above is present and both current inputs still match that
 * rule. Every other row is accepted: a geocode hit
 * becomes a point; a miss remains citywide with its published address, amount,
 * and partner provenance intact.
 */
export function mapPartnerNofAwards(
  rows: readonly Record<string, string>[],
  geocodes: ReadonlyMap<string, GeoResult | null>,
  queryForAddress: (address: string) => string,
  officialAwards: readonly OfficialAwardDuplicateFact[],
): PartnerNofMapResult {
  const records: CommunityInvestmentRecordDraft[] = [];
  let pointRecords = 0;
  let addressGeocodeMisses = 0;
  let heldCitywideDollars = 0;
  let confirmedDuplicateRows = 0;
  const reconciliation: PartnerNofReconciliationOutcome[] = [];

  for (const [inputIndex, row] of rows.entries()) {
    const recipient = nullableStr(row.Project) || "(unnamed project)";
    const amountAwarded = parseAmount(row["Award Amount"]);
    const publishedYear = Number(row["Year Awarded"]);
    const year = Number.isInteger(publishedYear) ? publishedYear : null;
    const normalizedRecipient = normalizeRecipientForDedupe(recipient);
    const normalizedAddress = normalizeAddressForDedupe(nullableStr(row.Address));
    const exactOfficialMatch =
      amountAwarded != null &&
      year != null &&
      normalizedRecipient !== "" &&
      normalizedAddress !== "" &&
      officialAwards.find(
        (official) =>
          official.amountAwarded === amountAwarded &&
          official.approvalYear === year &&
          normalizeRecipientForDedupe(official.recipient) === normalizedRecipient &&
          normalizeAddressForDedupe(official.address) === normalizedAddress,
      );
    const aliasRule =
      amountAwarded != null && year != null
        ? PARTNER_NOF_CONFIRMED_ALIAS_RULES.find(
            (rule) =>
              normalizeRecipientForDedupe(rule.partnerRecipient) === normalizedRecipient &&
              normalizeAddressForDedupe(rule.partnerAddress) === normalizedAddress &&
              rule.partnerAwardYear === year &&
              rule.amountAwarded === amountAwarded,
          )
        : undefined;
    const aliasOfficialMatch = aliasRule
      ? officialAwards.find(
          (official) =>
            official.amountAwarded === aliasRule.amountAwarded &&
            official.approvalYear === aliasRule.officialApprovalYear &&
            normalizeRecipientForDedupe(official.recipient) ===
              normalizeRecipientForDedupe(aliasRule.officialRecipient) &&
            normalizeAddressForDedupe(official.address) ===
              normalizeAddressForDedupe(aliasRule.officialAddress),
        )
      : undefined;
    const officialMatch = exactOfficialMatch || aliasOfficialMatch;
    if (officialMatch && amountAwarded != null && year != null) {
      confirmedDuplicateRows += 1;
      reconciliation.push({
        outcome: "confirmed-duplicate",
        inputIndex,
        recipient,
        amountAwarded,
        awardYear: year,
        officialRecipient: officialMatch.recipient,
        officialApprovalYear: officialMatch.approvalYear,
        matchBasis: exactOfficialMatch
          ? "exact_name_amount_approval_year_address"
          : "confirmed_source_pair",
      });
      continue;
    }

    reconciliation.push({
      outcome: "accepted",
      inputIndex,
      recipient,
      amountAwarded,
      awardYear: year,
    });

    const address = nullableStr(row.Address);
    const hit = address ? geocodes.get(queryForAddress(address)) : null;
    if (address && !hit) addressGeocodeMisses += 1;
    const geometry: InvestmentGeometry = hit ? point(hit.lat, hit.lng) : { kind: "citywide" };
    if (geometry.kind === "point") {
      pointRecords += 1;
    } else if (amountAwarded != null) {
      heldCitywideDollars += amountAwarded;
    }
    const locationReason: LocationReason | null = hit ? null : address ? "geocode_failed" : "source_unlocated";

    records.push({
      id: `nof-small-corridor-${records.length}`,
      source: "nof-small",
      funderType: SOURCE_FUNDER_TYPE["nof-small"],
      funderName: NOF_PROGRAM,
      recipient,
      capitalClass: "grant",
      amountAwarded,
      logLine: null,
      year,
      geometry,
      locationReason,
      address,
      status: "awarded",
      recordDate: null,
      recordProvenance: "partner-list",
      links: [],
    });
  }

  return {
    records,
    pointRecords,
    citywideRecords: records.length - pointRecords,
    addressGeocodeMisses,
    heldCitywideDollars,
    confirmedDuplicateRows,
    reconciliation,
  };
}

// ── Capital context (TIF series, lending, and coordinate-less awards) ─────────

/**
 * Build data/private/capital-context.json — the coordinate-less capital SIGNALS
 * that would bloat the map with 12k+ un-plottable rows if modeled as records.
 * Each series keeps DISTINCT money concepts in DISTINCT fields and never derives a
 * received/available/remaining/unspent figure (banned-figure rail applies here
 * too). Consumed by the analysis pages as CONTEXT beside the plotted records.
 */
function buildCapitalContext(generatedAt: string): unknown {
  // 1) Per-TIF-district annual-report series (public-funds-to-completion +
  //    private-funds-to-completion). These are cumulative-to-completion figures
  //    reported each year, so they are exposed as a per-year series and a
  //    latest-report-year snapshot — NEVER summed across years (that would double
  //    count) and the public/private figures are NEVER summed together.
  const tifRows = readCsv("tif_projects.csv").filter((r) => (r.dataset || "").trim() === "annual-report");
  const tifByDistrict = new Map<
    string,
    Map<number, { cityReportedExpenditure: number; announcedPrivateLeverage: number; projectCount: number }>
  >();
  for (const r of tifRows) {
    const district = nullableStr(r.tif_district) || "(unattributed)";
    const year = cleanYear(r.approval_or_report_year);
    if (year == null) continue;
    const exp = parseAmount(r.city_reported_expenditure) ?? 0;
    const lev = parseAmount(r.announced_private_leverage) ?? 0;
    const byYear = tifByDistrict.get(district) ?? new Map();
    const acc = byYear.get(year) ?? { cityReportedExpenditure: 0, announcedPrivateLeverage: 0, projectCount: 0 };
    acc.cityReportedExpenditure += exp;
    acc.announcedPrivateLeverage += lev;
    acc.projectCount += 1;
    byYear.set(year, acc);
    tifByDistrict.set(district, byYear);
  }
  const tifDistricts = [...tifByDistrict.entries()]
    .map(([district, byYear]) => {
      const series = [...byYear.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, v]) => ({ year, ...v }));
      const latest = series[series.length - 1];
      return {
        district,
        series,
        latestReportYear: latest?.year ?? null,
        latestCityReportedExpenditure: latest?.cityReportedExpenditure ?? 0,
        latestAnnouncedPrivateLeverage: latest?.announcedPrivateLeverage ?? 0,
      };
    })
    .sort((a, b) => b.latestCityReportedExpenditure - a.latestCityReportedExpenditure || a.district.localeCompare(b.district));

  // 2) Per-community-area CRA small-business lending series (originations).
  const craRows = readCsv("cra_by_community_area.csv");
  const craByCa = new Map<string, Array<{ year: number; smallBusinessLoanCount: number; smallBusinessLoanDollars: number }>>();
  for (const r of craRows) {
    const ca = nullableStr(r.community_area);
    const year = cleanYear(r.year);
    if (!ca || year == null) continue;
    const list = craByCa.get(ca) ?? [];
    list.push({
      year,
      smallBusinessLoanCount: parseAmount(r.sb_loan_count) ?? 0,
      smallBusinessLoanDollars: parseAmount(r.sb_loan_dollars) ?? 0,
    });
    craByCa.set(ca, list);
  }
  const craByCommunityArea = [...craByCa.entries()]
    .map(([communityArea, series]) => ({ communityArea, series: series.sort((a, b) => a.year - b.year) }))
    .sort((a, b) => a.communityArea.localeCompare(b.communityArea));

  // 3) CDFI transaction series by geography.
  const cdfiRows = readCsv("cdfi_by_geo.csv");
  const cdfiByGeo = new Map<
    string,
    { geographyLevel: string; series: Array<{ year: number; transactionCount: number; dollars: number; instrumentMixText: string | null; transactionsMissingAmount: number }> }
  >();
  for (const r of cdfiRows) {
    const geo = nullableStr(r.geography);
    const year = cleanYear(r.year);
    if (!geo || year == null) continue;
    const key = `${geo}|${(r.geography_level || "").trim()}`;
    const entry = cdfiByGeo.get(key) ?? { geographyLevel: (r.geography_level || "").trim(), series: [] };
    entry.series.push({
      year,
      transactionCount: parseAmount(r.transaction_count) ?? 0,
      dollars: parseAmount(r.dollars) ?? 0,
      instrumentMixText: nullableStr(r.instrument_mix_text),
      transactionsMissingAmount: parseAmount(r.transactions_missing_amount) ?? 0,
    });
    cdfiByGeo.set(key, entry);
  }
  const cdfi = [...cdfiByGeo.entries()]
    .map(([key, v]) => ({
      geography: key.split("|")[0],
      geographyLevel: v.geographyLevel,
      series: v.series.sort((a, b) => a.year - b.year),
    }))
    .sort((a, b) => a.geographyLevel.localeCompare(b.geographyLevel) || a.geography.localeCompare(b.geography));

  // 4) Illinois Arts Council FY2026 Q1 awards. The official table publishes
  //    city and region but no street address, ZIP, coordinates, or official
  //    award id. These records stay in an admin-only citywide table and never
  //    enter mapped/community totals or a current-funding claim.
  const illinoisArtsCouncilRecords = parseCuratedIllinoisArtsCouncilAwards(
    readCsv("illinois_arts_council_fy26_q1_chicago.csv"),
  );
  const sourceCheckedDates = new Set(
    illinoisArtsCouncilRecords.map((record) => record.sourceCheckedAt),
  );
  if (sourceCheckedDates.size !== 1) {
    throw new Error("Illinois Arts Council rows do not share one source review date.");
  }
  const illinoisArtsCouncilAwards = {
    fundingPurpose: "arts" as const,
    fiscalYear: 2026,
    sourceVersion: IAC_SOURCE_VERSION,
    sourceCheckedAt: [...sourceCheckedDates][0],
    sourcePageUrl: IAC_SOURCE_PAGE,
    sourceDataUrl: IAC_SOURCE_DATA_URL,
    recordCount: illinoisArtsCouncilRecords.length,
    recordIdMeaning:
      "Snapshot-local key generated from the official table row number; the source publishes no award id.",
    amountMeaning:
      "Historical Illinois Arts Council award amount; not current eligibility, proof of payment, or an estimate of funds a user could receive.",
    geographyMeaning:
      "Source-published city and region only. No address, ZIP, coordinate, community area, or map point is inferred.",
    coverage: {
      capture: "complete_published",
      mapDetail: "aggregate_only",
      refresh: "awaiting_publication",
      review: "complete_published",
    },
    records: illinoisArtsCouncilRecords,
  };

  // 5) Illinois state-award (GATA/CSFA) SFY2027 snapshot — AWARD amounts, NOT
  //    payments; the chicago_likely flag is name-based (high precision, LOW
  //    recall). Both caveats travel with the summary.
  const stateRows = readCsv("state_awards.csv").filter((r) => (r.chicago_likely || "").trim().toLowerCase() === "true");
  const byGrantee = new Map<string, { awardDollars: number; awardCount: number }>();
  let stateTotalAwardDollars = 0;
  const distinctAwardIds = new Set<string>();
  for (const r of stateRows) {
    const grantee = nullableStr(r.grantee_name) || "(unnamed grantee)";
    const amt = parseAmount(r.award_amount) ?? 0;
    stateTotalAwardDollars += amt;
    const id = nullableStr(r.award_id);
    if (id) distinctAwardIds.add(id);
    const acc = byGrantee.get(grantee) ?? { awardDollars: 0, awardCount: 0 };
    acc.awardDollars += amt;
    acc.awardCount += 1;
    byGrantee.set(grantee, acc);
  }
  const topGrantees = [...byGrantee.entries()]
    .map(([grantee, v]) => ({ grantee, ...v }))
    .sort((a, b) => b.awardDollars - a.awardDollars || a.grantee.localeCompare(b.grantee))
    .slice(0, 25);
  const stateAwards = {
    fiscalYear: 2027,
    amountMeaning:
      "award/agreement amount the State obligated — NOT money paid, received, or spent by the grantee",
    snapshotCaveat:
      "SFY2027 currently-active award pipeline (2026-07-01..2027-06-30); a multi-year award appears in each year it is active, so years must not be naively summed. chicago_likely is a NAME-BASED flag (high precision, low recall) — 'false' does not mean 'not Chicago'.",
    chicagoLikelyAwardCount: stateRows.length,
    chicagoLikelyDistinctGrantees: byGrantee.size,
    chicagoLikelyDistinctAwardIds: distinctAwardIds.size,
    chicagoLikelyTotalAwardDollars: stateTotalAwardDollars,
    topGrantees,
  };

  // 6) City of Chicago ARPA Road to Recovery program ledger. This is program-
  // level, citywide historical context: no recipient names, no map points, no
  // single summed headline, and no claim that a reported allocation is an
  // incentive a current project can access.
  const chicagoArpaRows = readCsv("chicago_arpa_road_to_recovery_programs.csv");
  const chicagoArpaPrograms = chicagoArpaRows.map((row) => ({
    costCenter: nullableStr(row.cost_center),
    programName: nullableStr(row.program_name),
    administeringDepartment: nullableStr(row.administering_department),
    departmentAcronym: nullableStr(row.department_acronym),
    policyPillar: nullableStr(row.policy_pillar),
    historicalAllocated: parseAmount(row.historical_amount_allocated_usd),
    historicalObligated: parseAmount(row.historical_amount_obligated_usd),
    historicalExpended: parseAmount(row.historical_amount_expended_usd),
    recordGranularity: nullableStr(row.record_granularity),
    geographicScope: nullableStr(row.geographic_scope),
    financialContext: nullableStr(row.financial_context),
    isRecipientLevelAward:
      nullableStr(row.is_recipient_level_award)?.toLowerCase() === "true",
    isActiveIncentiveDollars:
      nullableStr(row.is_active_incentive_dollars)?.toLowerCase() === "true",
    programDetailsSourceUrl: nullableStr(row.program_details_source_url),
    grantsSummarySourceUrl: nullableStr(row.grants_summary_source_url),
    programDetailsAsOf: nullableStr(row.program_details_as_of),
    grantsSummaryAsOf: nullableStr(row.grants_summary_as_of),
  }));
  const chicagoArpaRecovery = {
    classification: RECOVERY_INVESTMENT_SOURCE_METADATA["chicago-arpa-program"],
    note:
      "Citywide historical program reporting. Financial stages remain separate, null means the summary table had no matching row, and no value is presented as an active site incentive.",
    programs: chicagoArpaPrograms,
  };

  // 7) Bounded Chicago CARES-era program, administrator, and accounting
  // records. These remain citywide context. Contract revisions are already
  // canonicalized by the importer and no administrator address is retained.
  const chicagoCaresProgramLedger = {
    note:
      "Closed historical citywide context. Program authorizations, administrator contracts, budgets, encumbrances, and expenditures remain separate stages and are never treated as business-recipient awards.",
    records: readCsv("chicago_cares_program_ledger.csv").map((row) => ({
      recordId: nullableStr(row.record_id),
      programId: nullableStr(row.program_id),
      programName: nullableStr(row.program_name),
      recordKind: nullableStr(row.record_kind),
      assistanceType: nullableStr(row.assistance_type),
      fundingClassification: nullableStr(row.funding_classification),
      programStatus: nullableStr(row.program_status),
      administratorName: nullableStr(row.administrator_name),
      administeringDepartment: nullableStr(row.administering_department),
      historicalAuthorized: parseAmount(row.historical_authorized_usd),
      historicalBudgeted: parseAmount(row.historical_budgeted_usd),
      historicalEncumbered: parseAmount(row.historical_encumbered_usd),
      historicalExpended: parseAmount(row.historical_expended_usd),
      financialStageNote: nullableStr(row.financial_stage_note),
      recordGranularity: nullableStr(row.record_granularity),
      geographicScope: nullableStr(row.geographic_scope),
      isBusinessRecipient:
        nullableStr(row.is_business_recipient)?.toLowerCase() === "true",
      isMappableBusinessLocation:
        nullableStr(row.is_mappable_business_location)?.toLowerCase() ===
        "true",
      isActiveIncentiveDollars:
        nullableStr(row.is_active_incentive_dollars)?.toLowerCase() === "true",
      addressUsePolicy: nullableStr(row.address_use_policy),
      financialAggregationPolicy: nullableStr(
        row.financial_aggregation_policy,
      ),
      sourceAuthority: nullableStr(row.source_authority),
      sourceDatasetId: nullableStr(row.source_dataset_id),
      sourceRecordIds: (nullableStr(row.source_record_ids) ?? "")
        .split("|")
        .filter(Boolean),
      sourceUrl: nullableStr(row.source_url),
      sourceQueryUrl: nullableStr(row.source_query_url),
      sourceAsOf: nullableStr(row.source_as_of),
      sourceDatasetUpdatedAt: nullableStr(row.source_dataset_updated_at),
      specificationNumber: nullableStr(row.specification_number),
      contractNumbers: (nullableStr(row.contract_numbers) ?? "")
        .split("|")
        .filter(Boolean),
      sourceRevisionCount: parseAmount(row.source_revision_count),
      latestRevisionNumber: parseAmount(row.latest_revision_number),
      grantProjectCode: nullableStr(row.grant_project_code),
      fundCode: nullableStr(row.fund_code),
      parentCostCenterCode: nullableStr(row.parent_cost_center_code),
      alnCode: nullableStr(row.aln_code),
      periodStart: nullableStr(row.period_start),
      periodEnd: nullableStr(row.period_end),
    })),
  };

  // 8) Cook County's 2020 CARES recovery ledger. The source's direct relief
  // programs were suburban-only, so these rows are explicit Chicago exclusions,
  // not map records. The $77M umbrella context and three child outcomes are
  // non-additive and retain separate amount fields.
  const cookCountyCares2020 = {
    note:
      "Closed historical Cook County context. Award eligibility was suburban-only; City of Chicago businesses and residents were excluded. The portfolio amount and child outcomes must never be added together.",
    programs: readCsv("cook_county_cares_2020_programs.csv").map((row) => ({
      recordOrder: parseAmount(row.record_order),
      recordId: nullableStr(row.record_id),
      parentRecordId: nullableStr(row.parent_record_id),
      recordKind: nullableStr(row.record_kind),
      programName: nullableStr(row.program_name),
      assistanceType: nullableStr(row.assistance_type),
      recipientCategory: nullableStr(row.recipient_category),
      recipientCount: parseAmount(row.recipient_count),
      historicalPortfolioAmount: parseAmount(
        row.historical_portfolio_amount_usd,
      ),
      historicalDirectRecipientAmount: parseAmount(
        row.historical_direct_recipient_amount_usd,
      ),
      sourceReportedAmountLabel: nullableStr(row.source_reported_amount_label),
      amountRollupPolicy: nullableStr(row.amount_rollup_policy),
      reliefEra: nullableStr(row.relief_era),
      fundingSource: nullableStr(row.funding_source),
      programStatus: nullableStr(row.program_status),
      geographicEligibility: nullableStr(row.geographic_eligibility),
      cityOfChicagoAwardEligible:
        nullableStr(row.city_of_chicago_award_eligible)?.toLowerCase() ===
        "true",
      cityOfChicagoExclusionReason: nullableStr(
        row.city_of_chicago_exclusion_reason,
      ),
      mappable: nullableStr(row.mappable)?.toLowerCase() === "true",
      isRecipientLevelRecord:
        nullableStr(row.is_recipient_level_record)?.toLowerCase() === "true",
      sourceReportUrl: nullableStr(row.source_report_url),
      sourceContextUrl: nullableStr(row.source_context_url),
      eligibilitySourceUrl: nullableStr(row.eligibility_source_url),
      sourceVersion: nullableStr(row.source_version),
      sourcePage: parseAmount(row.source_page),
      recordNote: nullableStr(row.record_note),
    })),
  };

  return {
    generatedAt,
    meta: {
      note:
        "Coordinate-less capital CONTEXT beside the plotted Community Investment records. Every dollar is a real published figure or 0 where the source publishes 0; distinct money concepts stay in distinct fields and are never summed across concepts or (for cumulative series) across years.",
      sources: [
        "City of Chicago TIF Annual Report — Projects (Socrata 72uz-ikdv): public- and private-funds-to-completion per project-year",
        "FFIEC CRA Aggregate Table A1-1 small-business loan ORIGINATIONS, Cook County tracts → community areas (2022–2024)",
        "CDFI transaction aggregates by geography (2021–2022)",
        "Illinois GATA/CSFA active award pipeline SFY2027 (award amounts, not payments)",
        "Illinois Arts Council FY2026 Q1 Grant Summaries — source-published Chicago applicants and historical award amounts, citywide only because no address or ZIP is published",
        "DCEO Capital Appropriation List + Grant Tracker definitions — appropriation, executed award, and disbursement kept as separate lifecycle stages",
        "City of Chicago ARPA Road to Recovery Program Details (m9g9-cj96) and Grants Summary (9yp3-9pdz)",
        "City of Chicago Contracts (rsxa-ify5) + Mid-Year Grants (iyu8-jkf8) — bounded CARES-era program, administrator, and accounting records with revisions canonicalized",
        "Cook County 2020 Community Recovery Initiative impact report — suburban-only CARES program outcomes and explicit City of Chicago exclusion context",
      ],
    },
    tifDistricts,
    craByCommunityArea,
    cdfi,
    illinoisArtsCouncilAwards,
    dceoFundingLifecycle: {
      stages: DCEO_FUNDING_LIFECYCLE_STAGES,
      policy: DCEO_FUNDING_LIFECYCLE_POLICY,
    },
    stateAwards,
    chicagoArpaRecovery,
    chicagoCaresProgramLedger,
    cookCountyCares2020,
  };
}

// ── Exclusion ledger (Sol gate finding 3) ────────────────────────────────────

interface ExclusionLedgerRetainedGroup {
  source: string;
  locationReason: string;
  count: number;
  dollars: number;
  evidence: string;
  recordIds: string[];
}

interface ExclusionLedgerTrueExclusion {
  source: string;
  reason: string;
  count: number;
  dollars: number | null;
  evidence: string;
}

/**
 * Deliverable 4 / Sol gate finding 3 — "commit a record-level, source-keyed
 * exclusion ledger (reason, evidence, count, dollars)." Two tiers:
 *   - `retained`: every record that IS in the export but carries a
 *     locationReason (unplotted/held) — grouped by (source, reason), each
 *     group listing every member record id so the ledger is auditable down
 *     to the actual row, not just an aggregate count.
 *   - `trueExclusions`: rows that never became a record at all (a true drop),
 *     grouped by (source, reason) from the run's own drop counters — no
 *     record ids exist for these by definition, but the count/dollars/
 *     evidence are never silently absent.
 */
function buildExclusionLedger(
  records: readonly CommunityInvestmentRecord[],
  trueExclusions: ExclusionLedgerTrueExclusion[],
  generatedAt: string,
  exportContentHash: string,
): {
  generatedAt: string;
  boundExportContentHash: string;
  retained: ExclusionLedgerRetainedGroup[];
  trueExclusions: ExclusionLedgerTrueExclusion[];
} {
  const groups = new Map<string, ExclusionLedgerRetainedGroup>();
  for (const r of records) {
    if (!r.locationReason) continue;
    const key = `${r.source}|${r.locationReason}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        source: r.source,
        locationReason: r.locationReason,
        count: 0,
        dollars: 0,
        evidence: LOCATION_REASON_EVIDENCE[r.locationReason] ?? "",
        recordIds: [],
      };
      groups.set(key, group);
    }
    group.count += 1;
    group.dollars += r.amountAwarded ?? r.authorizedAmount ?? r.creditAmount ?? r.publishedBalance ?? 0;
    group.recordIds.push(r.id);
  }
  return {
    generatedAt,
    boundExportContentHash: exportContentHash,
    retained: [...groups.values()].sort((a, b) => (a.source + a.locationReason).localeCompare(b.source + b.locationReason)),
    trueExclusions,
  };
}

const LOCATION_REASON_EVIDENCE: Record<string, string> = {
  geocode_failed:
    "The source published a street address, but the Census geocoder returned no match or an out-of-Chicago hit for that specific attempt.",
  administrative_address_outside_city:
    "The source published a real coordinate/address, but it is the funder/grantee's suburban or out-of-state administrative office, not a Chicago site.",
  source_unlocated:
    "The source itself publishes no usable single-site location for this row (an intermediary/regranting recipient, a multi-site description, or a program that never publishes street addresses).",
  out_of_scope:
    "The row fails the product's own jurisdiction/subject test and is excluded entirely (not retained even unplotted).",
};

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const generatedAt = new Date().toISOString();

  // Deliverable 1 — bind this export to the manifest version that produced it.
  // manifestContentHash (NOT a raw-file hash) so this stays stable across a
  // manifest regeneration that only touches the volatile top-level
  // `generatedAt` stamp — see its doc comment in scripts/lib/investment-manifest.ts.
  const sourceManifestHash = manifestContentHash(investmentManifest);

  // Deliverable 3 — the dedupe ledger summary (per-group detail already lives
  // in the committed foundation_dedupe_ledger.json; only the totals travel
  // into meta).
  const dedupeLedgerPath = join(INPUT_DIR, "foundation_dedupe_ledger.json");
  const dedupeLedgerSummary = existsSync(dedupeLedgerPath)
    ? (JSON.parse(readFileSync(dedupeLedgerPath, "utf8")) as {
        summary: { candidate_groups: number; collapsed_rows: number; collapsed_dollars: number };
      }).summary
    : { candidate_groups: 0, collapsed_rows: 0, collapsed_dollars: 0 };

  // 1) Sources that already carry coordinates (or resolve citywide by locType).
  const nofSmallRows = JSON.parse(
    readFileSync(join(INPUT_DIR, "nof_small.json"), "utf8"),
  ) as SocrataRow[];
  const nofLargeRows = JSON.parse(
    readFileSync(join(INPUT_DIR, "nof_large.json"), "utf8"),
  ) as SocrataRow[];
  const sbifRows = JSON.parse(
    readFileSync(join(INPUT_DIR, "sbif.json"), "utf8"),
  ) as SocrataRow[];
  const nofSmallR = mapSocrata(nofSmallRows, "nof-small", NOF_PROGRAM, 2017);
  const nofLargeR = mapSocrata(nofLargeRows, "nof-large", NOF_PROGRAM, 2017);
  const sbifR = mapSocrata(sbifRows, "sbif", SBIF_PROGRAM, 2020);
  const nofSmall = nofSmallR.records;
  const nofLarge = nofLargeR.records;
  const sbif = sbifR.records;
  // Four foundation files, ONE mapper: same locType/citywide handling, same
  // placeholder rejection, same negative-amount nulling. Disjointness is asserted
  // PAIRWISE before any file is mapped, so a collision aborts the export instead
  // of shipping a double-counted headline.
  const foundationBaseRows = readCsv(FOUNDATION_GRANTS_FILE);
  const foundationTier1Rows = readCsv(FOUNDATION_TIER1_FILE);
  const foundationPhase2Rows = readCsv(FOUNDATION_PHASE2_FILE);
  const foundationPhase3Rows = readCsv(FOUNDATION_PHASE3_FILE);
  const foundationInputs = [
    { file: FOUNDATION_GRANTS_FILE, rows: foundationBaseRows },
    { file: FOUNDATION_TIER1_FILE, rows: foundationTier1Rows },
    { file: FOUNDATION_PHASE2_FILE, rows: foundationPhase2Rows },
    { file: FOUNDATION_PHASE3_FILE, rows: foundationPhase3Rows },
  ];
  for (let i = 0; i < foundationInputs.length; i++) {
    for (let j = i + 1; j < foundationInputs.length; j++) {
      assertDisjointFoundationFunders(foundationInputs[i], foundationInputs[j]);
    }
  }
  // Deliverable 2/3 sidecars — see scripts/foundation/build_grant_identity.py and
  // scripts/foundation/adjudicate_dedupe.py. Both key by (raw csv file name, raw
  // 0-based row index) so the join below is exact regardless of which rows the
  // placeholder filter later drops.
  const foundationIdentity = loadFoundationIdentity();
  const foundationDedupeActions = loadFoundationDedupeActions();

  const foundationBase = mapFoundations(
    foundationBaseRows,
    "foundation",
    FOUNDATION_GRANTS_FILE,
    foundationIdentity,
    foundationDedupeActions,
  );
  const foundationTier1 = mapFoundations(
    foundationTier1Rows,
    "foundation-t1",
    FOUNDATION_TIER1_FILE,
    foundationIdentity,
    foundationDedupeActions,
  );
  const foundationPhase2 = mapFoundations(
    foundationPhase2Rows,
    "foundation-p2",
    FOUNDATION_PHASE2_FILE,
    foundationIdentity,
    foundationDedupeActions,
  );
  const foundationPhase3 = mapFoundations(
    foundationPhase3Rows,
    "foundation-p3",
    FOUNDATION_PHASE3_FILE,
    foundationIdentity,
    foundationDedupeActions,
  );
  const foundations = [
    ...foundationBase.records,
    ...foundationTier1.records,
    ...foundationPhase2.records,
    ...foundationPhase3.records,
  ];
  const foundationStats = mergeFoundationStats(
    mergeFoundationStats(
      mergeFoundationStats(foundationBase.stats, foundationTier1.stats),
      foundationPhase2.stats,
    ),
    foundationPhase3.stats,
  );

  // Major private developments (developments_major.csv) + Chicago Prize inputs.
  const kmlRows = readCsv("developments.csv");
  const megaRows = readCsv("developments_major.csv");
  const prizeRows = readCsv("chicago_prize.csv");
  const prize = mapChicagoPrize(prizeRows);

  // Split megadev rows by origin, then validate the explicit join tables LOUDLY
  // (a stale name aborts the export — see validateMegadevJoins).
  const verifiedMega = megaRows.filter((r) => (r.origin || "").trim() === "verified");
  const discoveredMega = megaRows.filter((r) => (r.origin || "").trim() === "discovered");
  validateMegadevJoins(verifiedMega, discoveredMega, kmlRows);

  // Reverse the verified join to key by KML name; note any KML rows whose matching
  // megadev is dropped as non-private (mapDevelopments then skips those KML rows).
  const verifiedByKmlName = new Map<string, Record<string, string>>();
  const droppedKmlNames = new Set<string>();
  for (const mega of verifiedMega) {
    const kmlName = MEGADEV_KML_JOIN[(mega.name || "").trim()];
    if (!kmlName) continue; // (validateMegadevJoins guarantees presence)
    if (isDroppableNonPrivate(mega)) droppedKmlNames.add(kmlName);
    else verifiedByKmlName.set(kmlName, mega);
  }

  // Aggregate the Socrata drop tallies across the three completion sources.
  // (Sited foundation rows with unusable coords are NOT dropped — they are held
  // citywide, already reflected in citywideCount, so they are excluded here.)
  const droppedPreWindow = nofSmallR.drops.preWindow + nofLargeR.drops.preWindow + sbifR.drops.preWindow;
  const droppedNoCoords = nofSmallR.drops.noCoords + nofLargeR.drops.noCoords + sbifR.drops.noCoords;

  console.log(
    `Mapped (pre-geocode): nof-small=${nofSmall.length} nof-large=${nofLarge.length} sbif=${sbif.length} ` +
      `foundation=${foundations.length} (base=${foundationBase.records.length} tier1=${foundationTier1.records.length} phase2=${foundationPhase2.records.length} phase3=${foundationPhase3.records.length}) ` +
      `prize=${prize.length} kml=${kmlRows.length} ` +
      `mega(verified=${verifiedMega.length} discovered=${discoveredMega.length}) ` +
      `(placeholder-dropped=${foundationStats.droppedPlaceholder} out-of-bounds->citywide=${foundationStats.outOfBoundsGeocodes} ` +
      `negative-nulled=${foundationStats.negativeAmountsNulled} preWindow-dropped=${droppedPreWindow} ` +
      `dedupe-collapsed=${foundationStats.dedupeCollapsed} identity-resolved=${foundationStats.identityResolved} identity-unresolved=${foundationStats.identityUnresolved})`,
  );

  // 2) City-grant sources that need geocoding (CDG + Jim's corridor list).
  const cdgRows = readCsv("cdg_awards.csv");
  const jimRows = readTsv("ellen_nof_awardees.tsv");
  const dceoCandidates = selectChicagoDceoCandidates(readCsv("dceo_capital_appropriations.csv"));
  const chicagoZipCodes = loadChicagoZipCodes();
  const cookSource = mapCookSourceGrants(
    readCsv("cook_county_source_grants_2023.csv"),
    chicagoZipCodes,
  );
  const illinoisBig = mapIllinoisBusinessInterruptionGrants(
    readCsv("illinois_business_interruption_grants.csv"),
    chicagoZipCodes,
  );
  const illinoisHospitality = mapIllinoisHospitalityEmergencyGrants(
    readCsv("illinois_hospitality_emergency_grant_awards.csv"),
  );
  const illinoisB2B = mapIllinoisBackToBusiness(
    readCsv("illinois_back_to_business_awards.csv"),
    chicagoZipCodes,
  );
  const sbaRrfRows = readCsv("sba_restaurant_revitalization_chicago.csv");

  const cdgQuery = (addr: string) => `${addr.trim()}, Chicago, IL`;
  const queries: string[] = [];
  for (const r of cdgRows) {
    const a = nullableStr(r.address);
    // All candidates go into the batch so mapCdgAwards can take the first hit
    // in candidate order; pushing only the verbatim query was half of why
    // address-bearing awards shipped citywide (the other half: the Current
    // benchmark's gaps — see CENSUS_BENCHMARKS).
    if (a) queries.push(...cdgQueryCandidates(a, cdgQuery));
  }
  for (const r of jimRows) {
    const a = nullableStr(r.Address);
    if (a) queries.push(cdgQuery(a));
  }
  for (const candidate of dceoCandidates) {
    if (candidate.safeAddress) queries.push(cdgQuery(candidate.safeAddress));
  }
  for (const row of sbaRrfRows) {
    const query = sbaRrfGeocodeQuery(row);
    if (query) queries.push(query);
  }

  // Discovered megadev rows that carry a well-known street address to geocode.
  const discoveredGeocodeQuery = new Map<string, string>(); // megadev name -> census query
  for (const mega of discoveredMega) {
    if (isDroppableNonPrivate(mega)) continue;
    const spec = MEGADEV_DISCOVERED_GEO[(mega.name || "").trim()];
    if (spec?.kind === "geocode") {
      const q = cdgQuery(spec.address);
      discoveredGeocodeQuery.set((mega.name || "").trim(), q);
      queries.push(q);
    }
  }

  const cache = loadGeocodeCache();
  const geo = await geocodeBatch(queries, cache);

  // Resolve the discovered megadev geocodes into plottable geometry (a miss →
  // left absent so mapDevelopments holds that row citywide, counted in meta).
  const discoveredGeo = new Map<string, InvestmentGeometry>();
  for (const [name, q] of discoveredGeocodeQuery) {
    const hit = geo.get(q);
    if (hit) discoveredGeo.set(name, point(hit.lat, hit.lng));
  }

  // CDG rows that cannot be geocoded are HELD CITYWIDE, not dropped — their
  // dollars stay in the export (see mapCdgAwards for the $16.26M this used to
  // delete). Nothing here feeds droppedNoGeocode any more.
  const cdgMapped = mapCdgAwards(cdgRows, geo, cdgQuery);
  const cdg = cdgMapped.records;

  const officialAwardFacts = [
    ...buildOfficialAwardDuplicateFacts(nofSmallRows, 2017),
    ...buildOfficialAwardDuplicateFacts(nofLargeRows, 2017),
    ...buildOfficialAwardDuplicateFacts(sbifRows, 2020),
  ];
  const jimMapped = mapPartnerNofAwards(jimRows, geo, cdgQuery, officialAwardFacts);
  const jim = jimMapped.records;
  const jimConfirmedDuplicates = jimMapped.reconciliation
    .filter((outcome) => outcome.outcome === "confirmed-duplicate")
    .map((outcome) => outcome.recipient);

  const caPolygons = loadCommunityAreaPolygons(CA_GEOJSON_PATH);
  console.log(
    `Geocoded: cdg=${cdg.length} (point=${cdgMapped.pointRecords} held-citywide=${cdgMapped.citywideRecords} ` +
      `geocode-miss=${cdgMapped.addressGeocodeMisses} held-citywide-dollars=${cdgMapped.heldCitywideDollars}) ` +
      `jim kept=${jim.length} point=${jimMapped.pointRecords} held-citywide=${jimMapped.citywideRecords} ` +
      `geocode-miss=${jimMapped.addressGeocodeMisses} held-citywide-dollars=${jimMapped.heldCitywideDollars} ` +
      `confirmed-duplicates=${jimMapped.confirmedDuplicateRows} [${jimConfirmedDuplicates.join("; ")}]`,
  );
  const dceo = mapDceoCapital(dceoCandidates, geo, cdgQuery, caPolygons);
  const sbaRrf = mapSbaRestaurantRevitalization(sbaRrfRows, geo, caPolygons);
  console.log(
    `Public investment additions: cook-source Chicago=${cookSource.chicagoRecords} ` +
      `outside-Chicago=${cookSource.outsideChicagoRecords}; ` +
      `Illinois-BIG Chicago=${illinoisBig.chicagoRecords} outside-Chicago=${illinoisBig.outsideChicagoRecords}; ` +
      `Illinois-Hospitality Chicago=${illinoisHospitality.chicagoRecords} ` +
      `outside-Chicago=${illinoisHospitality.outsideChicagoRecords}; ` +
      `Illinois-B2B Chicago=${illinoisB2B.chicagoRecords} outside-Chicago=${illinoisB2B.outsideChicagoRecords}; ` +
      `SBA-RRF Chicago=${sbaRrf.records.length} (point=${sbaRrf.pointRecords} ` +
      `citywide=${sbaRrf.citywideRecords} geocode-miss=${sbaRrf.addressGeocodeMisses} ` +
      `out-of-bounds=${sbaRrf.addressOutOfBounds}); dceo Chicago=${dceo.records.length} ` +
      `(point=${dceo.pointRecords} citywide=${dceo.citywideRecords} ` +
      `geocode-miss=${dceo.addressGeocodeMisses} out-of-bounds=${dceo.addressOutOfBounds} ` +
      `multi-site-citywide=${dceo.multiSiteHeldCitywide})`,
  );

  // Build the development records now that discovered geocodes are resolved:
  // enrich the 27 verified megadevs onto their KML coordinates, keep the ~68
  // unmatched KML rows, and append the discovered megadevs.
  const { records: developments, stats: devStats } = mapDevelopments(
    kmlRows,
    verifiedByKmlName,
    discoveredMega,
    discoveredGeo,
    droppedKmlNames,
  );
  console.log(
    `Developments: enrichedVerified=${devStats.enrichedVerified} discoveredAdded=${devStats.discoveredAdded} ` +
      `discoveredCitywide=${devStats.discoveredCitywide} subsetExcluded=${devStats.subsetExcluded} ` +
      `privateLedExcluded=${devStats.privateLedExcluded} total=${developments.length}`,
  );

  // 2b) Capital-spine sources (TIF / HUD CDBG-HOME / LIHTC / NMTC). All carry
  //     amountAwarded=null (their money lives in authorizedAmount / creditAmount)
  //     so they are structurally NEVER dedupe-eligible and pass through untouched.
  //     Load the CA polygons here so NMTC's citywide records can be community-area
  //     stamped from their 2020 tract centroid (the same polygons stamp the points).
  const { records: tif, drops: tifDrops } = mapTif(readCsv("tif_projects.csv"));
  const { records: hud, drops: hudDrops } = mapHud(readCsv("hud_cpd_activities.csv"), new Date(generatedAt));
  const { records: lihtc, drops: lihtcDrops } = mapLihtc(readCsv("lihtc_chicago.csv"));
  const { records: nmtc, stamp: nmtcStamp } = mapNmtc(readCsv("nmtc_chicago.csv"), caPolygons);
  console.log(
    `Capital spine: tif=${tif.length} (true-excluded=${tifDrops.noCoords} held-unlocated=${tifDrops.heldUnlocated}) ` +
      `cdbg-home=${hud.length} (true-excluded=${hudDrops.outOfBbox} held-admin-outside-city=${hudDrops.heldAdministrativeOutsideCity}) ` +
      `lihtc=${lihtc.length} (true-excluded=${lihtcDrops.noCoords} held-unlocated=${lihtcDrops.heldUnlocated}) ` +
      `nmtc=${nmtc.length} (CA-stamped=${nmtcStamp.stamped} unstamped=${nmtcStamp.unstamped})`,
  );

  // 3) Concatenate in stable order. Partner awards were already reconciled against
  //    official approval facts and are never eligible for generic dedupe. Chicago
  //    Prize rows join the philanthropic (foundation) block; developments (private)
  //    are never dedupe-eligible so their position is immaterial. The capital-spine
  //    sources append last (also never dedupe-eligible).
  const all: Array<CommunityInvestmentRecordDraft | CommunityInvestmentRecord> = [
    ...nofSmall, ...nofLarge, ...sbif, ...cdg, ...foundations, ...prize, ...developments, ...jim,
    ...tif, ...hud, ...lihtc, ...nmtc, ...cookSource.records, ...illinoisBig.records,
    ...illinoisHospitality.records, ...illinoisB2B.records,
    ...sbaRrf.records, ...dceo.records,
  ];

  // Assign the primary public purpose once, from source-published importer
  // fields, and persist it on the canonical record. NMTC is already assigned
  // above from its dedicated purpose_text column; every other record is
  // classified here from its source and accepted source fields. Downstream
  // clients read this field directly and never reclassify display copy.
  const classified: CommunityInvestmentRecord[] = all.map((record) => ({
    ...record,
    governmentFundingPurpose:
      "governmentFundingPurpose" in record
        ? record.governmentFundingPurpose
        : governmentFundingPurposeForRecord(record),
  }));

  // 4) Cross-source dedupe (government point rows sharing address+amount).
  const { records: deduped, removedCount } = dedupeInvestmentRecords(classified);
  const totalDedupedRows = removedCount + jimMapped.confirmedDuplicateRows;
  console.log(
    `Deduped: ${classified.length + jimMapped.confirmedDuplicateRows} -> ${deduped.length} ` +
      `(removed ${totalDedupedRows}; ${jimMapped.confirmedDuplicateRows} confirmed before geometry)`,
  );

  // 5) Point-in-polygon community-area stamping for EVERY point record. Runs on
  //    the final deduped set so the tallies describe the kept records. NMTC
  //    citywide records already carry a communityArea (stamped in mapNmtc) and are
  //    skipped here (they are not point geometry) — never overwritten, never plotted.
  const caStamp = stampCommunityAreas(deduped, caPolygons);
  console.log(
    `Community-area stamp: ${caPolygons.length} CA polygons · ${caStamp.inside} points inside a CA · ` +
      `${caStamp.outside} outside (kept, no CA)`,
  );

  // 6) Assemble + structural banned-figure assert + write.
  const out = buildCommunityInvestmentExport(deduped, generatedAt, {
    droppedNoGeocode: 0,
    dedupedRows: totalDedupedRows,
    droppedPlaceholder: foundationStats.droppedPlaceholder,
    droppedPreWindow,
    droppedNoCoords,
    outOfBoundsGeocodes: foundationStats.outOfBoundsGeocodes,
    negativeAmountsNulled: foundationStats.negativeAmountsNulled,
    outsideCommunityAreas: caStamp.outside,
    subsetExcluded: devStats.subsetExcluded,
    privateLedExcluded: devStats.privateLedExcluded,
    droppedHudOutOfBbox: hudDrops.outOfBbox,
    droppedTifNoCoords: tifDrops.noCoords,
    droppedLihtcNoCoords: lihtcDrops.noCoords,
    nmtcCitywideStamped: nmtcStamp.stamped,
    nmtcUnstamped: nmtcStamp.unstamped,
    cookSourceChicagoRecords: cookSource.chicagoRecords,
    cookSourceOutsideChicagoRecords: cookSource.outsideChicagoRecords,
    illinoisB2BChicagoRecords: illinoisB2B.chicagoRecords,
    illinoisB2BOutsideChicagoRecords: illinoisB2B.outsideChicagoRecords,
    illinoisBigChicagoRecords: illinoisBig.chicagoRecords,
    illinoisBigOutsideChicagoRecords: illinoisBig.outsideChicagoRecords,
    illinoisHospitalityChicagoRecords: illinoisHospitality.chicagoRecords,
    illinoisHospitalityOutsideChicagoRecords:
      illinoisHospitality.outsideChicagoRecords,
    sbaRrfChicagoRecords: sbaRrf.records.length,
    sbaRrfPointRecords: sbaRrf.pointRecords,
    sbaRrfCitywideRecords: sbaRrf.citywideRecords,
    sbaRrfAddressGeocodeMisses: sbaRrf.addressGeocodeMisses,
    sbaRrfAddressOutOfBounds: sbaRrf.addressOutOfBounds,
    dceoChicagoRecords: dceo.records.length,
    dceoPointRecords: dceo.pointRecords,
    dceoCitywideRecords: dceo.citywideRecords,
    dceoAddressGeocodeMisses: dceo.addressGeocodeMisses,
    dceoAddressOutOfBounds: dceo.addressOutOfBounds,
    dceoMultiSiteHeldCitywide: dceo.multiSiteHeldCitywide,
    sources: PROVENANCE_LABELS,
    dedupeCandidateGroups: dedupeLedgerSummary.candidate_groups,
    dedupeCollapsedRows: dedupeLedgerSummary.collapsed_rows,
    dedupeCollapsedDollars: dedupeLedgerSummary.collapsed_dollars,
    foundationIdentityResolved: foundationStats.identityResolved,
    foundationIdentityUnresolved: foundationStats.identityUnresolved,
    sourceManifestHash,
  });

  // Sol gate finding 3 — record-level, source-keyed exclusion ledger. TRUE
  // exclusions (never became a record) are listed from this run's own drop
  // counters; RETAINED-with-reason records are grouped straight from `out.records`
  // inside buildExclusionLedger.
  const trueExclusions: ExclusionLedgerTrueExclusion[] = [
    {
      source: "foundation",
      reason: "out_of_scope",
      count: foundationStats.droppedPlaceholder,
      dollars: foundationStats.droppedPlaceholderDollars || null,
      evidence:
        "Recipient/address is a grant-SCHEDULE aggregate placeholder (\"SEE ATTACHED\", a 99999-style " +
        "filler zip/address) — not a real single itemized grant row.",
    },
    {
      source: "foundation",
      reason: "out_of_scope",
      count: dedupeLedgerSummary.collapsed_rows,
      dollars: dedupeLedgerSummary.collapsed_dollars || null,
      evidence:
        "236-group dedupe adjudication (deliverable 3): the row's own filing does not carry as many " +
        "matching grant nodes as the CSV does — proven extractor duplication, not a real second award. " +
        "See foundation_dedupe_ledger.json.",
    },
    {
      source: "nof-small/nof-large/sbif",
      reason: "out_of_scope",
      count: droppedPreWindow,
      dollars: null,
      evidence:
        "Socrata completion row dated before the source's inclusion window (nof 2017 / sbif 2020) — " +
        "per-row dollar figures not retained for this aggregate count in this run.",
    },
    {
      source: "nof-small/nof-large/sbif",
      reason: "geocode_failed",
      count: droppedNoCoords,
      dollars: null,
      evidence:
        "Socrata completion row published no usable coordinate — per-row dollar figures not retained " +
        "for this aggregate count in this run.",
    },
    {
      source: "cdbg-home",
      reason: "geocode_failed",
      count: hudDrops.outOfBbox,
      dollars: null,
      evidence:
        "HUD CDBG/HOME activity with no usable coordinate at all (nothing to classify as an administrative " +
        "address vs. a Chicago site) — the only cdbg-home category still a true drop after consult Q5.",
    },
    {
      source: "development",
      reason: "out_of_scope",
      count: devStats.privateLedExcluded,
      dollars: null,
      evidence:
        "Major-development row is NOT private-led (public infrastructure) — this layer models private " +
        "development only.",
    },
  ].filter((e) => e.count > 0);
  const exclusionLedger = buildExclusionLedger(out.records, trueExclusions, generatedAt, out.meta.exportContentHash);

  // Build and validate ALL THREE sibling artifacts before replacing any one of
  // them. A failed context/ledger build must never leave a fresh record
  // export beside stale siblings. Temporary files also keep partially-written
  // JSON off the read path.
  const context = buildCapitalContext(generatedAt);
  assertNoBannedFigureKeys(context);
  const outPayload = JSON.stringify(out, null, 2) + "\n";
  const contextPayload = JSON.stringify(context, null, 2) + "\n";
  const ledgerPayload = JSON.stringify(exclusionLedger, null, 2) + "\n";
  const outTempPath = `${OUT_PATH}.${process.pid}.tmp`;
  const contextTempPath = `${CONTEXT_OUT_PATH}.${process.pid}.tmp`;
  const ledgerTempPath = `${EXCLUSION_LEDGER_OUT_PATH}.${process.pid}.tmp`;

  try {
    writeFileSync(outTempPath, outPayload);
    writeFileSync(contextTempPath, contextPayload);
    writeFileSync(ledgerTempPath, ledgerPayload);
    renameSync(ledgerTempPath, EXCLUSION_LEDGER_OUT_PATH);
    renameSync(outTempPath, OUT_PATH);
    renameSync(contextTempPath, CONTEXT_OUT_PATH);
  } finally {
    if (existsSync(outTempPath)) unlinkSync(outTempPath);
    if (existsSync(contextTempPath)) unlinkSync(contextTempPath);
    if (existsSync(ledgerTempPath)) unlinkSync(ledgerTempPath);
  }

  console.log(`\nWrote ${OUT_PATH}`);
  console.log(
    `  totalRecords=${out.meta.totalRecords} point=${out.meta.pointCount} citywide=${out.meta.citywideCount} ` +
      `totalDollarsAwarded=${out.meta.totalDollarsAwarded.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
  );
  console.log(
    `  announcedCapitalTotal=${out.meta.announcedCapitalTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })} ` +
      `subsetExcluded=${out.meta.subsetExcluded} privateLedExcluded=${out.meta.privateLedExcluded}`,
  );
  console.log(
    `  totalAuthorizedTif=${out.meta.totalAuthorizedTif.toLocaleString("en-US", { style: "currency", currency: "USD" })} ` +
      `totalFederalProgram=${out.meta.totalFederalProgram.toLocaleString("en-US", { style: "currency", currency: "USD" })} ` +
      `totalCreditCapital=${out.meta.totalCreditCapital.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
  );
  console.log(`  counts=${JSON.stringify(out.meta.counts)}`);

  // Capital CONTEXT and the exclusion ledger are assembled and replaced in the
  // same three-phase write above.
  console.log(`Wrote ${CONTEXT_OUT_PATH}`);
  console.log(
    `Wrote ${EXCLUSION_LEDGER_OUT_PATH} (retained groups=${exclusionLedger.retained.length} trueExclusions=${exclusionLedger.trueExclusions.length})`,
  );
}

/**
 * Only run the export when this file is the entry point. The pure helpers above
 * (isPlaceholderFoundationRow, assertDisjointFoundationFunders, mapFoundations)
 * are exported so the test suite can exercise them directly — without this guard,
 * importing one of them would kick off a full 27k-record export mid-test. Same
 * pattern as scripts/import-chicago-arpa-recovery.ts.
 */
const isDirectRun =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  });
}

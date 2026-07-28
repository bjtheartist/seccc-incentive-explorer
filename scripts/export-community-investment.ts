#!/usr/bin/env npx tsx
/**
 * Merge the six Community Investment inputs into the single admin-only export
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
 * Inputs (produced by prior agents, read from the scratchpad by default):
 *   nof_small.json / nof_large.json / sbif.json  — Socrata completion rows
 *   cdg_awards.csv                               — CDG award rounds 2022–2025
 *   foundation_grants_geocoded.csv               — 990 grants w/ lat/lng + locType
 *   developments.csv                             — major development projects
 *   ellen_nof_awardees.tsv                       — Jim's 38 NOF corridor awards
 *
 * Honesty rails (mirror the TIF doctrine):
 *   • IRON RULE — no derived received/available/remaining/unspent figure ever;
 *     enforced structurally by buildCommunityInvestmentExport().
 *   • Every amount is a real awarded/reported number or null — never coerced to 0.
 *   • Deterministic: records are emitted in stable input order; the geocode
 *     cache makes re-runs reproducible; generatedAt is the only wall-clock value.
 *   • A row that cannot be placed (geocode failed AND no coordinates) is DROPPED
 *     and counted (meta.droppedNoGeocode) — never plotted at 0,0 or guessed.
 *
 * Usage:
 *   npx tsx scripts/export-community-investment.ts
 *   INPUT_DIR=/some/dir npx tsx scripts/export-community-investment.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCommunityInvestmentExport,
  dedupeInvestmentRecords,
  SOURCE_FUNDER_TYPE,
  type CommunityInvestmentRecord,
  type InvestmentGeometry,
} from "../lib/community-investment";

// ── Paths ────────────────────────────────────────────────────────────────────

const SCRATCH =
  "/private/tmp/claude-502/-Users-billyndizeye-Desktop/b9c151f4-b8dc-40ba-b72f-92b827fa50d4/scratchpad";
const INPUT_DIR = process.env.INPUT_DIR || SCRATCH;
const GEOCODE_CACHE_PATH = join(SCRATCH, "geocode-cache.json");
const OUT_PATH = join(process.cwd(), "data", "private", "community-investment.json");

const NOF_PROGRAM = "Neighborhood Opportunity Fund (City of Chicago)";
const SBIF_PROGRAM = "Small Business Improvement Fund (City of Chicago)";
const CDG_PROGRAM = "Community Development Grant (City of Chicago)";
const DEVELOPMENT_FUNDER = "Private development";

const PROVENANCE_LABELS = [
  "City of Chicago Neighborhood Opportunity Fund — grant completions (Chicago Data Portal / Socrata)",
  "City of Chicago Small Business Improvement Fund — grant completions (Chicago Data Portal / Socrata)",
  "City of Chicago Community Development Grant — award rounds 2022–2025 (chicago.gov press releases)",
  "Private-foundation grants parsed from IRS 990-PF / 990 filings (ProPublica), geocoded to recipient address",
  "Major development projects — Ellen's Developments map (Google My Maps)",
  "Neighborhood Opportunity Fund corridor awards 2017–2020 — Jim's South Shore list (award records)",
  "Address geocoding: U.S. Census Bureau Geocoder (Public_AR_Current benchmark)",
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

// ── Minimal CSV/TSV reader (quoted fields, embedded newlines) ─────────────────

/** Parse delimited text into row objects keyed by the header row. Handles
 * double-quoted fields, escaped quotes ("") and newlines inside quotes. */
function parseDelimited(text: string, delimiter: string): Record<string, string>[] {
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
async function censusGeocode(query: string): Promise<GeoResult | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
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
      return null; // valid response, genuinely no match
    } catch {
      if (attempt < 3) await sleep(400 * attempt);
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
): { records: CommunityInvestmentRecord[]; drops: SocrataDrops } {
  const out: CommunityInvestmentRecord[] = [];
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

/** Placeholder rows the 990 parser captured as a whole grant-SCHEDULE aggregate
 * rather than a single grant: recipient/address literally "SEE ATTACHED", or a
 * 99999-style filler zip/address. Rejected so a $120M "grant to SEE ATTACHED"
 * never counts as a real award. */
function isPlaceholderFoundationRow(r: Record<string, string>): boolean {
  const recipient = (r.recipient || "").trim();
  const addr1 = (r.address_line1 || "").trim();
  const zip = (r.zip || "").trim();
  return (
    /see attached/i.test(recipient) ||
    /see attached/i.test(addr1) ||
    /^9{5}$/.test(zip) ||
    /^9{5}$/.test(addr1)
  );
}

interface FoundationStats {
  citywideFallback: number;
  droppedPlaceholder: number;
  outOfBoundsGeocodes: number;
  negativeAmountsNulled: number;
}

/** Map foundation grant rows — geometry from locType (intermediary -> citywide). */
function mapFoundations(rows: Record<string, string>[]): {
  records: CommunityInvestmentRecord[];
  stats: FoundationStats;
} {
  const out: CommunityInvestmentRecord[] = [];
  const stats: FoundationStats = {
    citywideFallback: 0,
    droppedPlaceholder: 0,
    outOfBoundsGeocodes: 0,
    negativeAmountsNulled: 0,
  };
  let idx = 0;
  for (const r of rows) {
    if (isPlaceholderFoundationRow(r)) {
      stats.droppedPlaceholder++;
      continue;
    }
    let geometry: InvestmentGeometry;
    if (r.locType === "intermediary_or_citywide") {
      geometry = { kind: "citywide" };
    } else {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        if (inChicagoBounds(lat, lng)) {
          geometry = point(lat, lng);
        } else {
          geometry = { kind: "citywide" }; // out-of-Chicago geocode -> honest citywide, never a misplaced dot
          stats.outOfBoundsGeocodes++;
        }
      } else {
        geometry = { kind: "citywide" }; // sited row with unusable coords -> honest citywide, not 0,0
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
    out.push({
      id: `foundation-${idx++}`,
      source: "foundation",
      funderType: SOURCE_FUNDER_TYPE.foundation,
      funderName: nullableStr(r.foundation) || "(unnamed foundation)",
      recipient: nullableStr(r.recipient) || "(unnamed recipient)",
      amountAwarded,
      logLine: nullableStr(r.purpose),
      year: Number.isInteger(Number(r.tax_year)) ? Number(r.tax_year) : null,
      geometry,
      address: addr || null,
      status: "awarded",
      recordDate: null,
      links: [],
    });
  }
  return { records: out, stats };
}

/** Map development projects — announced unless the category is "Proposed Projects". */
function mapDevelopments(rows: Record<string, string>[]): CommunityInvestmentRecord[] {
  const out: CommunityInvestmentRecord[] = [];
  let idx = 0;
  for (const r of rows) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // developments all carry coords
    const status = (r.category || "").trim() === "Proposed Projects" ? "proposed" : "announced";
    const logLine = nullableStr(r.description) || nullableStr(r.amount_text);
    out.push({
      id: `development-${idx++}`,
      source: "development",
      funderType: SOURCE_FUNDER_TYPE.development,
      funderName: DEVELOPMENT_FUNDER,
      recipient: nullableStr(r.name) || "(unnamed project)",
      amountAwarded: null, // amount_text is unparsed prose ("$7 billion"); kept in logLine, never coerced
      logLine,
      year: null, // developments carry no reliable single year — left null, never guessed
      geometry: point(lat, lng),
      address: null,
      status,
      recordDate: null,
      links: parseLinks(r.link),
    });
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const generatedAt = new Date().toISOString();

  // 1) Sources that already carry coordinates (or resolve citywide by locType).
  const nofSmallR = mapSocrata(JSON.parse(readFileSync(join(INPUT_DIR, "nof_small.json"), "utf8")), "nof-small", NOF_PROGRAM, 2017);
  const nofLargeR = mapSocrata(JSON.parse(readFileSync(join(INPUT_DIR, "nof_large.json"), "utf8")), "nof-large", NOF_PROGRAM, 2017);
  const sbifR = mapSocrata(JSON.parse(readFileSync(join(INPUT_DIR, "sbif.json"), "utf8")), "sbif", SBIF_PROGRAM, 2020);
  const nofSmall = nofSmallR.records;
  const nofLarge = nofLargeR.records;
  const sbif = sbifR.records;
  const { records: foundations, stats: foundationStats } = mapFoundations(readCsv("foundation_grants_geocoded.csv"));
  const developments = mapDevelopments(readCsv("developments.csv"));

  // Aggregate the Socrata drop tallies across the three completion sources.
  // (Sited foundation rows with unusable coords are NOT dropped — they are held
  // citywide, already reflected in citywideCount, so they are excluded here.)
  const droppedPreWindow = nofSmallR.drops.preWindow + nofLargeR.drops.preWindow + sbifR.drops.preWindow;
  const droppedNoCoords = nofSmallR.drops.noCoords + nofLargeR.drops.noCoords + sbifR.drops.noCoords;

  console.log(
    `Mapped (pre-geocode): nof-small=${nofSmall.length} nof-large=${nofLarge.length} sbif=${sbif.length} ` +
      `foundation=${foundations.length} development=${developments.length} ` +
      `(placeholder-dropped=${foundationStats.droppedPlaceholder} out-of-bounds->citywide=${foundationStats.outOfBoundsGeocodes} ` +
      `negative-nulled=${foundationStats.negativeAmountsNulled} preWindow-dropped=${droppedPreWindow})`,
  );

  // 2) City-grant sources that need geocoding (CDG + Jim's corridor list).
  const cdgRows = readCsv("cdg_awards.csv");
  const jimRows = readTsv("ellen_nof_awardees.tsv");

  const cdgQuery = (addr: string) => `${addr.trim()}, Chicago, IL`;
  const queries: string[] = [];
  for (const r of cdgRows) {
    const a = nullableStr(r.address);
    if (a) queries.push(cdgQuery(a));
  }
  for (const r of jimRows) {
    const a = nullableStr(r.Address);
    if (a) queries.push(cdgQuery(a));
  }

  const cache = loadGeocodeCache();
  const geo = await geocodeBatch(queries, cache);

  let droppedNoGeocode = 0;

  const cdg: CommunityInvestmentRecord[] = [];
  let cdgIdx = 0;
  for (const r of cdgRows) {
    const addr = nullableStr(r.address);
    const hit = addr ? geo.get(cdgQuery(addr)) : null;
    if (!hit) {
      droppedNoGeocode++;
      continue;
    }
    const links = parseLinks(r.source_url);
    cdg.push({
      id: `cdg-${cdgIdx++}`,
      source: "cdg",
      funderType: SOURCE_FUNDER_TYPE.cdg,
      funderName: CDG_PROGRAM,
      recipient: nullableStr(r.recipient) || "(unnamed recipient)",
      amountAwarded: parseAmount(r.amount),
      logLine: nullableStr(r.log_line),
      year: yearOfRound(r.round),
      geometry: point(hit.lat, hit.lng),
      address: addr,
      status: "awarded",
      recordDate: null, // CDG rounds carry only a round label, no per-record date
      links,
    });
  }

  const jim: CommunityInvestmentRecord[] = [];
  let jimIdx = 0;
  for (const r of jimRows) {
    const addr = nullableStr(r.Address);
    const hit = addr ? geo.get(cdgQuery(addr)) : null;
    if (!hit) {
      droppedNoGeocode++;
      continue;
    }
    jim.push({
      id: `nof-small-corridor-${jimIdx++}`,
      source: "nof-small",
      funderType: SOURCE_FUNDER_TYPE["nof-small"],
      funderName: NOF_PROGRAM,
      recipient: nullableStr(r.Project) || "(unnamed project)",
      amountAwarded: parseAmount(r["Award Amount"]),
      logLine: null,
      year: Number.isInteger(Number(r["Year Awarded"])) ? Number(r["Year Awarded"]) : null,
      geometry: point(hit.lat, hit.lng),
      address: addr,
      status: "awarded",
      recordDate: null, // Jim's corridor list carries only a year, no per-record date
      recordProvenance: "partner-list",
      links: [],
    });
  }

  console.log(`Geocoded: cdg kept=${cdg.length} jim kept=${jim.length} droppedNoGeocode=${droppedNoGeocode}`);

  // 3) Concatenate in stable order. Socrata completions precede Jim's awards so a
  //    completed record holds the dedupe slot and the corridor award collapses in.
  const all = [...nofSmall, ...nofLarge, ...sbif, ...cdg, ...foundations, ...developments, ...jim];

  // 4) Cross-source dedupe (government point rows sharing address+amount).
  const { records: deduped, removedCount } = dedupeInvestmentRecords(all);
  console.log(`Deduped: ${all.length} -> ${deduped.length} (removed ${removedCount})`);

  // 5) Assemble + structural banned-figure assert + write.
  const out = buildCommunityInvestmentExport(deduped, generatedAt, {
    droppedNoGeocode,
    dedupedRows: removedCount,
    droppedPlaceholder: foundationStats.droppedPlaceholder,
    droppedPreWindow,
    droppedNoCoords,
    outOfBoundsGeocodes: foundationStats.outOfBoundsGeocodes,
    negativeAmountsNulled: foundationStats.negativeAmountsNulled,
    sources: PROVENANCE_LABELS,
  });

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(
    `  totalRecords=${out.meta.totalRecords} point=${out.meta.pointCount} citywide=${out.meta.citywideCount} ` +
      `totalDollarsAwarded=${out.meta.totalDollarsAwarded.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
  );
  console.log(`  counts=${JSON.stringify(out.meta.counts)}`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});

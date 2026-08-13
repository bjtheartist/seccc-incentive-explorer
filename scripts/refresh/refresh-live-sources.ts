#!/usr/bin/env npx tsx
/**
 * Monthly refresh of the LIVE-API Community Investment inputs.
 *
 * ONE entry point (`npm run data:refresh:live`) that re-pulls every input whose
 * upstream is a queryable API, rewrites the curated input file ONLY when the
 * bytes actually change, and then regenerates the export
 * (`npm run data:export:investment`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REFRESHES (live APIs — upstream can change any month)
 *
 *   nof_small.json                  Socrata rym7-49n8  (NOF Small Business)
 *   nof_large.json                  Socrata j7ew-b73u  (NOF Large)
 *   sbif.json                       Socrata etqr-sz5x  (SBIF completions)
 *   tif_projects.csv                Socrata mex4-ppfc  (TIF RDA/IGA projects)
 *                                 + Socrata 72uz-ikdv  (TIF Annual Report)
 *   chicago_cares_program_ledger.csv  Socrata rsxa-ify5 + iyu8-jkf8
 *                                     (delegated to the existing importer)
 *   hud_cpd_activities.csv          HUD ArcGIS CDBG_PROGRAM_ACTIVITY
 *                                 + HUD ArcGIS HOME_Program_Activity
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT REFRESH (frozen snapshots — by design)
 *
 * Every other file in data/curated/investment-inputs/ is a SNAPSHOT of a closed
 * or point-in-time publication. Re-pulling them is either impossible (there is
 * no API) or wrong (the program is closed and its published totals are pinned
 * integrity contracts). Refreshing them here would silently break the absolute
 * pins those sources are allowed to keep. They are:
 *
 *   cook_county_source_grants_2023.csv   PDF awardee list, v2024-11-20 (closed)
 *   cook_county_cares_2020_programs.csv  2020 impact report PDF (closed)
 *   dceo_capital_appropriations.csv      DCEO capital PDF, 2026-04-10 (quarterly,
 *                                        manual — a new PDF is a new snapshot)
 *   illinois_business_interruption_grants.csv  BIG awardee PDF (program closed)
 *   illinois_hospitality_emergency_grant_awards.csv  (program closed)
 *   illinois_back_to_business_awards.csv (program closed)
 *   sba_restaurant_revitalization_chicago.csv  RRF FOIA extract (program closed)
 *   chicago_arpa_road_to_recovery_programs.csv  pinned ARPA integrity contract
 *   foundation_grants_geocoded.csv       IRS 990 filings (annual, manual)
 *   cdg_awards.csv                       CDG press-release rounds (per-announcement)
 *   developments.csv / developments_major.csv  curated megaproject list
 *   chicago_prize.csv                    one-off philanthropic round
 *   lihtc_chicago.csv / nmtc_chicago.csv HUD/CDFI annual placed-in-service files
 *   cra_by_community_area.csv / cdfi_by_geo.csv  annual regulatory releases
 *   state_awards.csv                     GATA award snapshot (quarterly, manual)
 *   ellen_nof_awardees.tsv               partner-supplied corridor list
 *   geocode-cache.json                   derived cache, written by the export
 *
 * See data/curated/investment-inputs/REFRESH.md for the full cadence table.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DETERMINISM
 *
 * A scheduled job that produces a spurious diff every run is noise, so every
 * fetch is sorted by an explicit BUSINESS key in-process after paging (never by
 * the provider's natural order, and never by a system row id like Socrata `:id`
 * or ArcGIS `OBJECTID`, both of which can be reassigned on a full republish).
 * Same upstream rows in, byte-identical file out.
 *
 * NOTE — this reorders the July-2026 snapshot files, which were captured in the
 * providers' natural (unordered) response order by an ephemeral scratchpad
 * script that no longer exists. The one-time reordering diff is expected; row
 * CONTENT is what the delta table reports.
 *
 * FAILURE POLICY
 *
 * Fail loudly PER SOURCE but keep going: one dead upstream must not block the
 * other five. Every source reports into a summary table and the process exits
 * nonzero if ANY source failed, so a partial refresh is never silently green.
 *
 * Usage:
 *   npm run data:refresh:live
 *   npx tsx scripts/refresh/refresh-live-sources.ts --dry-run
 *   npx tsx scripts/refresh/refresh-live-sources.ts --only sbif,tif
 *   npx tsx scripts/refresh/refresh-live-sources.ts --skip-export
 *   npx tsx scripts/refresh/refresh-live-sources.ts --summary-out /tmp/delta.md
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CHICAGO_CARES_PROGRAM_LEDGER_OUTPUT,
  importChicagoCaresProgramLedger,
} from "../import-chicago-cares-program-ledger";
import { loadManifest, type DecreasePolicy } from "../lib/investment-manifest";

// ── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
const INPUT_DIR = join(REPO_ROOT, "data", "curated", "investment-inputs");
/** Deliverable 7 — committed ONLY on a failed refresh attempt (see main()), so
 * a failure-only run (nothing else changed) still produces a diff for the
 * workflow's PR-open step to see. */
const REFRESH_ATTEMPT_PATH = join(INPUT_DIR, "refresh-attempt.json");

// ── Small shared utilities ───────────────────────────────────────────────────

const SOCRATA_BASE = "https://data.cityofchicago.org/resource";
const HUD_ARCGIS_BASE =
  "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services";

/** City of Chicago's HUD CPD grantee id — the ONLY grantee we ingest. */
const HUD_CHICAGO_GRANTEE_ID = 17408;

const FETCH_TIMEOUT_MS = 120_000;
const FETCH_RETRIES = 3;

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 1_000 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type Row = Record<string, unknown>;

/** Largest number of rows SODA will return in a single request. */
const SOCRATA_MAX_SINGLE_REQUEST = 50_000;

/**
 * Fetch a whole Socrata dataset in ONE request, cross-checked against the
 * dataset's own count endpoint.
 *
 * Why not offset paging with `$order`? Because ANY `$order` makes SODA drop the
 * `:@computed_region_*` columns from the response, silently stripping the
 * ward/community-area/tract stamps that are part of the committed input files.
 * A single unordered request keeps every column; the count cross-check is what
 * makes it safe (a short read fails loudly instead of quietly truncating the
 * dataset — which would read downstream as "this program shrank").
 *
 * Deterministic ordering is imposed in-process by each source's business key.
 */
async function socrataFetchAll(datasetId: string): Promise<Row[]> {
  const countPayload = await fetchJson(
    `${SOCRATA_BASE}/${datasetId}.json?$select=count(1)`,
  );
  const expected = Number(
    (Array.isArray(countPayload) ? (countPayload[0] as Row | undefined) : undefined)
      ?.count_1 ?? NaN,
  );
  if (!Number.isFinite(expected)) {
    throw new Error(`Socrata ${datasetId}: could not read a row count`);
  }
  if (expected > SOCRATA_MAX_SINGLE_REQUEST) {
    throw new Error(
      `Socrata ${datasetId} now has ${expected} rows, above the ${SOCRATA_MAX_SINGLE_REQUEST}-row ` +
        `single-request ceiling. Switch this source to ordered offset paging and accept the ` +
        `loss of the :@computed_region_* columns (or select them explicitly).`,
    );
  }

  const rows = await fetchJson(
    `${SOCRATA_BASE}/${datasetId}.json?$limit=${SOCRATA_MAX_SINGLE_REQUEST}`,
  );
  if (!Array.isArray(rows)) {
    throw new Error(`Socrata ${datasetId} returned a non-array payload`);
  }
  if (rows.length !== expected) {
    throw new Error(
      `Socrata ${datasetId}: fetched ${rows.length} rows but the dataset reports ${expected}`,
    );
  }
  return rows as Row[];
}

/** Page an ArcGIS FeatureServer layer to exhaustion (attributes only). */
async function arcgisFetchAll(
  service: string,
  where: string,
  orderByFields: string,
): Promise<Row[]> {
  const pageSize = 2_000; // the layer's advertised maxRecordCount
  const out: Row[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const url =
      `${HUD_ARCGIS_BASE}/${service}/FeatureServer/0/query` +
      `?where=${encodeURIComponent(where)}` +
      `&outFields=*&returnGeometry=false&f=json` +
      `&orderByFields=${encodeURIComponent(orderByFields)}` +
      `&resultOffset=${offset}&resultRecordCount=${pageSize}`;
    const page = (await fetchJson(url)) as {
      error?: { message?: string };
      features?: Array<{ attributes?: Row }>;
    };
    if (page.error) {
      throw new Error(`ArcGIS ${service}: ${page.error.message ?? "query error"}`);
    }
    const features = page.features ?? [];
    for (const f of features) if (f.attributes) out.push(f.attributes);
    if (features.length < pageSize) break;
  }
  return out;
}

function str(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

/**
 * Trim AND collapse internal whitespace. Several DPD text fields carry embedded
 * newlines ("Cabrera Capital Partners/\nThe Habitat Company"); a raw newline is
 * legal inside a quoted CSV field but makes the committed file and its diffs
 * unreadable, so runs of whitespace collapse to a single space.
 */
function trimmed(value: unknown): string {
  return str(value).replace(/\s+/g, " ").trim();
}

/** RFC4180 field escape, matching the existing curated CSVs. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize to CRLF-terminated CSV with a trailing newline (existing convention). */
function toCsv(header: readonly string[], rows: readonly string[][]): string {
  const lines = [header.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Minimal CSV parser (mirrors scripts/export-community-investment.ts). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
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
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // handled by the \n branch
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0].trim() === "") continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? "";
    out.push(obj);
  }
  return out;
}

function sumField(rows: Record<string, string>[], field: string): number {
  let total = 0;
  for (const r of rows) {
    const n = Number(String(r[field] ?? "").replace(/[$,]/g, ""));
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

function formatDollars(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCount(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

/** Percent change, or null when there is no meaningful baseline. */
function pctDelta(before: number | null, after: number | null): number | null {
  if (before == null || after == null || before === 0) return null;
  return ((after - before) / before) * 100;
}

// ── Source definitions ───────────────────────────────────────────────────────

interface Metrics {
  rows: number;
  dollars: number | null;
  /** Optional per-partition counts, surfaced in the summary notes. */
  parts?: Record<string, number>;
}

interface RefreshSource {
  id: string;
  label: string;
  file: string;
  /** What the dollar column means for this source. */
  dollarLabel: string;
  /** Build the file contents from the live API. */
  build(): Promise<string>;
  /** Measure a serialized file (used for BOTH the before and after snapshot). */
  measure(content: string): Metrics;
  /**
   * Sources that own their own writer (the CARES importer writes atomically and
   * only-if-changed itself). When set, `build` is not used.
   */
  writeSelf?: () => Promise<void>;
}

// ── Socrata: NOF Small / NOF Large / SBIF ────────────────────────────────────

/**
 * These three share the DPD completion-row shape. The curated files are the raw
 * Socrata JSON (including the `:@computed_region_*` columns the export ignores)
 * serialized compactly with a trailing newline — the export reads them with
 * JSON.parse, so only content matters, but keeping the existing byte convention
 * keeps the diffs readable.
 *
 * Sort key: a business key, not `:id`. Socrata reassigns `:id` on a full dataset
 * replace, which would produce a total-reorder diff that looks like a data change.
 */
function socrataSortKey(row: Row): string {
  return [
    trimmed(row.completion_date),
    trimmed(row.approval_date),
    trimmed(row.project_name),
    trimmed(row.applicant_name),
    trimmed(row.address_number),
    trimmed(row.street_direction),
    trimmed(row.street_name),
    trimmed(row.street_type),
  ].join(" ");
}

function measureSocrataJson(content: string): Metrics {
  const rows = JSON.parse(content) as Row[];
  let dollars = 0;
  for (const r of rows) {
    const n = Number(trimmed(r.incentive_amount));
    if (Number.isFinite(n)) dollars += n;
  }
  return { rows: rows.length, dollars };
}

function socrataCompletionSource(
  id: string,
  label: string,
  file: string,
  datasetId: string,
): RefreshSource {
  return {
    id,
    label,
    file,
    dollarLabel: "incentive_amount",
    async build() {
      const rows = await socrataFetchAll(datasetId);
      rows.sort((a, b) => socrataSortKey(a).localeCompare(socrataSortKey(b)));
      return JSON.stringify(rows) + "\n";
    },
    measure: measureSocrataJson,
  };
}

// ── Socrata: TIF projects (two datasets, one file) ───────────────────────────

const TIF_RDA_IGA_DATASET = "mex4-ppfc"; // TIF Funded RDA and IGA Projects
const TIF_ANNUAL_REPORT_DATASET = "72uz-ikdv"; // TIF Annual Report - Projects

const TIF_CSV_HEADER = [
  "dataset",
  "project_name",
  "recipient_or_developer",
  "address",
  "tif_district",
  "ward_or_area",
  "authorized_tif_assistance",
  "city_reported_expenditure",
  "total_project_cost",
  "announced_private_leverage",
  "approval_or_report_year",
  "status_text",
  "lat",
  "lng",
  "source_row_id",
] as const;

/** `2023-11-01T00:00:00.000` → `2023`. */
function yearOf(value: unknown): string {
  const m = /^(\d{4})-/.exec(trimmed(value));
  return m ? m[1] : "";
}

/** `2023-11-01T00:00:00.000` → `2023-11-01`. */
function dateOf(value: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed(value));
  return m ? m[1] : "";
}

/**
 * RDA/IGA rows are the only TIF rows the export turns into map records
 * (mapTif keeps `dataset === "rda-iga"` rows that carry coordinates). Status
 * text encodes the lifecycle the export reads: a Certificate of Completion
 * (COC) marks the project completed, otherwise it is CDC-approved/awarded.
 */
function buildTifRdaIgaRows(rows: Row[]): string[][] {
  const sorted = [...rows].sort((a, b) => {
    const an = Number(trimmed(a.id));
    const bn = Number(trimmed(b.id));
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return trimmed(a.id).localeCompare(trimmed(b.id));
  });
  return sorted.map((r, index) => {
    const ward = trimmed(r.ward);
    const communityArea = trimmed(r.community_area);
    const wardOrArea =
      ward && communityArea
        ? `Ward ${ward} - ${communityArea}`
        : ward
          ? `Ward ${ward}`
          : communityArea;
    // Both milestones are kept, in lifecycle order, so the status reads as a
    // history rather than a single state. mapTif() keys "completed" off the
    // presence of "COC issued", so a project that has both still resolves
    // completed — the CDC date is retained as provenance, not as the status.
    const coc = dateOf(r.coc_date);
    const cdc = dateOf(r.cdc_date);
    const statusText = [
      cdc ? `CDC approved ${cdc}` : null,
      coc ? `COC issued ${coc}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    return [
      "rda-iga",
      trimmed(r.project_name),
      trimmed(r.developer),
      trimmed(r.address),
      trimmed(r.tif_district),
      wardOrArea,
      trimmed(r.approved_amount),
      "", // city_reported_expenditure: annual-report only
      trimmed(r.total_project_cost),
      "", // announced_private_leverage: annual-report only
      yearOf(r.cdc_date) || yearOf(r.coc_date),
      statusText,
      trimmed(r.latitude),
      trimmed(r.longitude),
      `rda-iga:${trimmed(r.id)}:${index}`,
    ];
  });
}

/**
 * Annual-report rows never become map records — they feed the per-district
 * expenditure/leverage series in data/private/capital-context.json. The money
 * columns are the CUMULATIVE-TO-COMPLETION figures (public_funds_to_completion /
 * private_funds_to_completion), which is what buildCapitalContext() documents
 * and exposes as a per-year series (never summed across years).
 *
 * Ordering: report_year DESC, then tif_number, then project_name — matching the
 * committed file's layout. `source_row_id` carries an occurrence counter because
 * project_number repeats across project_type groups within one district-year.
 */
function buildTifAnnualReportRows(rows: Row[]): string[][] {
  const sorted = [...rows].sort((a, b) => {
    const yearA = Number(trimmed(a.report_year));
    const yearB = Number(trimmed(b.report_year));
    if (yearA !== yearB) return yearB - yearA; // newest report year first
    const numberCmp = trimmed(a.tif_number).localeCompare(trimmed(b.tif_number));
    if (numberCmp !== 0) return numberCmp;
    return trimmed(a.project_name).localeCompare(trimmed(b.project_name));
  });

  const occurrences = new Map<string, number>();
  return sorted.map((r) => {
    const tifNumber = trimmed(r.tif_number);
    const reportYear = trimmed(r.report_year);
    const projectNumber = trimmed(r.project_number);
    const projectName = trimmed(r.project_name);
    const reportName = trimmed(r.annual_report_name);
    const projectType = trimmed(r.project_type);
    const status = trimmed(r.status);

    const occurrenceKey = `${tifNumber}:${reportYear}:${projectNumber}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);

    // A plain Redevelopment Agreement adds nothing to the status; every other
    // project_type names the counterparty or sub-program (IGA partner, SBIF,
    // TIFWorks) and is worth carrying into the human-readable status.
    const statusText =
      projectType && projectType !== "Redevelopment Agreement"
        ? `${status} (${projectType})`
        : status;

    // project_iga splits the annual report into three shapes:
    //   "IGA"     — project_type names the COUNTERPARTY agency (Chicago Board of
    //               Education, CTA, Public Buildings Commission…), so that is the
    //               recipient; annual_report_name is just the project label again.
    //   "Project" — a redevelopment agreement; annual_report_name is the developer.
    //   "Program" — SBIF / TIFWorks and friends, where there is no single
    //               recipient and annual_report_name mirrors project_name.
    // For the latter two, a name that merely repeats project_name adds nothing
    // and is left blank rather than duplicated.
    const recipient =
      trimmed(r.project_iga) === "IGA"
        ? projectType
        : reportName === projectName
          ? ""
          : reportName;

    return [
      "annual-report",
      projectName,
      recipient,
      "", // address: not published in the annual report
      trimmed(r.tif_district),
      "", // ward_or_area: not published in the annual report
      "", // authorized_tif_assistance: RDA/IGA only
      trimmed(r.public_funds_to_completion),
      "", // total_project_cost: RDA/IGA only
      trimmed(r.private_funds_to_completion),
      reportYear,
      statusText,
      "", // lat: annual-report rows are never plotted
      "", // lng
      `annual-report:${tifNumber}:${reportYear}:${projectNumber}:${occurrence}`,
    ];
  });
}

const tifSource: RefreshSource = {
  id: "tif",
  label: "TIF projects (RDA/IGA + Annual Report)",
  file: "tif_projects.csv",
  dollarLabel: "authorized_tif_assistance (rda-iga)",
  async build() {
    const [rdaIga, annualReport] = await Promise.all([
      socrataFetchAll(TIF_RDA_IGA_DATASET),
      socrataFetchAll(TIF_ANNUAL_REPORT_DATASET),
    ]);
    return toCsv(TIF_CSV_HEADER, [
      ...buildTifRdaIgaRows(rdaIga),
      ...buildTifAnnualReportRows(annualReport),
    ]);
  },
  measure(content) {
    const rows = parseCsv(content);
    const rdaIga = rows.filter((r) => r.dataset === "rda-iga");
    const annualReport = rows.filter((r) => r.dataset === "annual-report");
    return {
      rows: rows.length,
      dollars: sumField(rdaIga, "authorized_tif_assistance"),
      parts: { "rda-iga": rdaIga.length, "annual-report": annualReport.length },
    };
  },
};

// ── HUD ArcGIS: CDBG + HOME activities ───────────────────────────────────────

const HUD_CSV_HEADER = [
  "program",
  "activity_id",
  "activity_name",
  "address",
  "funding_amount",
  "national_objective",
  "activity_group",
  "status_text",
  "completion_date",
  "lat",
  "lng",
] as const;

/** `01/24/2003` → `2003-01-24`; already-ISO values pass through. */
function hudCompletionDate(value: unknown): string {
  const raw = trimmed(value);
  if (!raw) return "";
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (iso) return iso[1];
  // ArcGIS may serve dates as epoch milliseconds depending on layer settings.
  const epoch = Number(raw);
  if (Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch).toISOString().slice(0, 10);
  }
  return "";
}

/** HUD pads ADDRESS to a fixed width and leaves a trailing comma. */
function hudAddress(r: Row): string {
  const street = trimmed(r.ADDRESS).replace(/,+$/, "").trim();
  const city = trimmed(r.CITY);
  const stateZip = [trimmed(r.STATE), trimmed(r.ZIP)].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
}

function hudCoord(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  // 6 decimals ≈ 0.1 m — more precision than the source justifies, and it keeps
  // float noise (41.96823800000004) out of the committed file.
  return String(Number(n.toFixed(6)));
}

function hudAmount(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

const hudSource: RefreshSource = {
  id: "hud",
  label: "HUD CPD activities (CDBG + HOME)",
  file: "hud_cpd_activities.csv",
  dollarLabel: "funding_amount",
  async build() {
    // GRANTEE_ID 17408 is the City of Chicago as a CPD entitlement grantee. We
    // filter by GRANTEE rather than by CITY on purpose: these are activities
    // funded out of Chicago's own CDBG/HOME allocation, and a handful carry a
    // suburban ADMINISTRATIVE address that a city filter would wrongly drop.
    // Rows whose coordinates fall outside Chicago are dropped later, by the
    // export's inChicagoBounds() check — not here.
    const where = `GRANTEE_ID=${HUD_CHICAGO_GRANTEE_ID}`;
    const [cdbg, home] = await Promise.all([
      arcgisFetchAll("CDBG_PROGRAM_ACTIVITY", where, "IDIS_ACTV_ID,ID"),
      arcgisFetchAll("HOME_Program_Activity", where, "IDIS_ACTV_ID,ID"),
    ]);

    const rows: string[][] = [];
    const push = (
      program: "cdbg" | "home",
      r: Row,
      fundingField: string,
      group: string,
    ) => {
      rows.push([
        program,
        trimmed(r.IDIS_ACTV_ID),
        trimmed(r.NAME),
        hudAddress(r),
        hudAmount(r[fundingField]),
        "", // national_objective: not published on either layer
        group,
        "", // status_text: not published on either layer
        hudCompletionDate(r.COMPLETED_DT),
        hudCoord(r.LAT),
        hudCoord(r.LON),
      ]);
    };

    const sortKey = (r: Row) =>
      [
        trimmed(r.IDIS_ACTV_ID).padStart(12, "0"),
        trimmed(r.NAME),
        hudAddress(r),
      ].join(" ");
    const byKey = (a: Row, b: Row) => sortKey(a).localeCompare(sortKey(b));

    for (const r of [...cdbg].sort(byKey)) {
      push("cdbg", r, "ACTV_FUNDING_AMT", trimmed(r.GROUPING));
    }
    // The HOME layer has no GROUPING column — the whole layer IS HUD's
    // multifamily-rental activity set, so the group is a constant, not a guess.
    for (const r of [...home].sort(byKey)) {
      push("home", r, "TOTAL_HOME_FUND", "Multifamily Rental");
    }
    return toCsv(HUD_CSV_HEADER, rows);
  },
  measure(content) {
    const rows = parseCsv(content);
    return {
      rows: rows.length,
      dollars: sumField(rows, "funding_amount"),
      parts: {
        cdbg: rows.filter((r) => r.program === "cdbg").length,
        home: rows.filter((r) => r.program === "home").length,
      },
    };
  },
};

// ── Chicago CARES ledger (delegated to the existing importer) ────────────────

const caresSource: RefreshSource = {
  id: "chicago-cares",
  label: "Chicago CARES-era program ledger",
  file: "chicago_cares_program_ledger.csv",
  dollarLabel: "historical_authorized_usd",
  build() {
    throw new Error("chicago-cares uses writeSelf()");
  },
  async writeSelf() {
    // The importer owns its own bounded Socrata queries, its integrity checks
    // and its atomic write-if-changed. Re-implementing any of that here would
    // fork the contract, so the refresh just drives it.
    await importChicagoCaresProgramLedger({
      input: null, // null = pull live, not from a fixture
      output: DEFAULT_CHICAGO_CARES_PROGRAM_LEDGER_OUTPUT,
    });
  },
  measure(content) {
    const rows = parseCsv(content);
    return {
      rows: rows.length,
      dollars: sumField(rows, "historical_authorized_usd"),
      parts: {
        program: rows.filter((r) => r.record_kind === "program").length,
        administrator: rows.filter((r) => r.record_kind === "program_administrator").length,
        accounting: rows.filter((r) => r.record_kind === "program_accounting").length,
      },
    };
  },
};

const SOURCES: RefreshSource[] = [
  socrataCompletionSource(
    "nof-small",
    "NOF Small Business Improvement",
    "nof_small.json",
    "rym7-49n8",
  ),
  socrataCompletionSource("nof-large", "NOF Large", "nof_large.json", "j7ew-b73u"),
  socrataCompletionSource("sbif", "SBIF completions", "sbif.json", "etqr-sz5x"),
  tifSource,
  caresSource,
  hudSource,
];

// ── Runner ───────────────────────────────────────────────────────────────────

export interface Outcome {
  id: string;
  label: string;
  file: string;
  dollarLabel: string;
  ok: boolean;
  changed: boolean;
  before: Metrics | null;
  after: Metrics | null;
  error?: string;
}

interface CliOptions {
  dryRun: boolean;
  skipExport: boolean;
  only: string[] | null;
  summaryOut: string | null;
}

export function parseRefreshCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    skipExport: false,
    only: null,
    summaryOut: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--skip-export") options.skipExport = true;
    else if (arg === "--only") {
      const value = argv[++i];
      if (!value) throw new Error("--only requires a comma-separated source list");
      options.only = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--summary-out") {
      const value = argv[++i];
      if (!value) throw new Error("--summary-out requires a path");
      options.summaryOut = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function safeMeasure(source: RefreshSource, content: string | null): Metrics | null {
  if (content == null) return null;
  try {
    return source.measure(content);
  } catch {
    return null;
  }
}

// Sol gate finding 7 (BLOCKER) — "the manifest's decrease policies are never
// imported or enforced. Refresh still writes after measuring... does not
// compare declared dollar value fields." MONOTONIC_FLOOR_PCT mirrors the
// pre-existing REFRESHED_SOURCE_FLOORS 2% convention in
// lib/__tests__/community-investment.test.ts — this REPLACES that hard-coded
// floor with a manifest-driven, per-source, per-field check.
const MONOTONIC_FLOOR_PCT = 0.02;

interface DecreasePolicyCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Enforces the manifest's decreasePolicy for a source BEFORE the caller
 * writes the refreshed file — rows AND the manifest's declared value field,
 * never rows alone. "not_refreshed" sources (e.g. chicago-cares, whose ledger
 * legitimately shows a diff most months from an upstream publish timestamp,
 * not real churn) are exempt by design, not by omission. Pure — no I/O beyond
 * the manifest read the caller already paid for once per process.
 */
export function checkDecreasePolicy(sourceId: string, before: Metrics | null, after: Metrics | null): DecreasePolicyCheck {
  if (!before || !after) return { allowed: true };
  const manifest = loadManifest();
  const entry = manifest.sources.find((s) => s.id === sourceId);
  const policy: DecreasePolicy = entry?.decreasePolicy ?? "monotonic_floor";
  if (policy === "not_refreshed") return { allowed: true };

  const fields: Array<{ label: string; beforeVal: number | null; afterVal: number | null }> = [
    { label: "rows", beforeVal: before.rows, afterVal: after.rows },
  ];
  if (before.dollars != null || after.dollars != null) {
    const label = entry?.valueField ? `dollars (declared value field: ${entry.valueField})` : "dollars";
    fields.push({ label, beforeVal: before.dollars, afterVal: after.dollars });
  }

  for (const f of fields) {
    if (f.beforeVal == null || f.afterVal == null) continue;
    if (f.afterVal >= f.beforeVal) continue; // growth/unchanged always allowed, both policies
    const dropPct = f.beforeVal === 0 ? 1 : (f.beforeVal - f.afterVal) / f.beforeVal;
    if (policy === "exact_pin") {
      return {
        allowed: false,
        reason:
          `${sourceId}: ${f.label} decreased (${f.beforeVal} -> ${f.afterVal}) under decreasePolicy ` +
          `"exact_pin" — a closed/pinned source must never shrink. Refusing to write.`,
      };
    }
    if (policy === "monotonic_floor" && dropPct > MONOTONIC_FLOOR_PCT) {
      return {
        allowed: false,
        reason:
          `${sourceId}: ${f.label} dropped ${(dropPct * 100).toFixed(1)}% (${f.beforeVal} -> ${f.afterVal}), ` +
          `exceeding the ${(MONOTONIC_FLOOR_PCT * 100).toFixed(0)}% monotonic_floor decreasePolicy. Refusing to write.`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Deliverable 7 — pure builder for the refresh-attempt.json failure artifact:
 * `null` when nothing failed (main() then REMOVES any stale artifact from a
 * previously-failing run), otherwise the exact JSON object to commit.
 * Extracted as a pure function (no I/O) specifically so a unit test can
 * exercise "does a failure produce an artifact" and "does an all-healthy run
 * produce none" without invoking a live refresh.
 */
export function buildRefreshAttemptArtifact(
  outcomes: readonly Outcome[],
): { attemptedAt: string; failedSources: Array<{ id: string; file: string; error?: string }>; okSources: string[] } | null {
  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length === 0) return null;
  return {
    attemptedAt: new Date().toISOString(),
    failedSources: failed.map((f) => ({ id: f.id, file: f.file, error: f.error })),
    okSources: outcomes.filter((o) => o.ok).map((o) => o.id),
  };
}

async function refreshOne(source: RefreshSource, options: CliOptions): Promise<Outcome> {
  const path = join(INPUT_DIR, source.file);
  const beforeContent = readIfExists(path);
  const base: Outcome = {
    id: source.id,
    label: source.label,
    file: source.file,
    dollarLabel: source.dollarLabel,
    ok: true,
    changed: false,
    before: safeMeasure(source, beforeContent),
    after: null,
  };

  try {
    if (source.writeSelf) {
      if (options.dryRun) {
        // The delegated importer owns its writer, so a dry run cannot preview it
        // without duplicating that logic. Report the current state instead of
        // pretending we measured a fetch.
        base.after = base.before;
        return base;
      }
      await source.writeSelf();
      const afterContent = readIfExists(path);
      base.after = safeMeasure(source, afterContent);
      base.changed = afterContent !== beforeContent;
      return base;
    }

    const nextContent = await source.build();
    base.after = source.measure(nextContent);
    base.changed = nextContent !== beforeContent;
    if (base.changed) {
      // Sol gate finding 7 — enforce the manifest's decreasePolicy BEFORE
      // writing, for rows AND the declared value field, on every run
      // (including --dry-run, so a dry run's report already shows the
      // refusal rather than only discovering it on the real attempt).
      const decreaseCheck = checkDecreasePolicy(source.id, base.before, base.after);
      if (!decreaseCheck.allowed) {
        base.ok = false;
        base.error = decreaseCheck.reason;
        base.changed = false; // refused — the committed file is untouched
        return base;
      }
      if (!options.dryRun) {
        writeFileSync(path, nextContent, "utf8");
      }
    }
    return base;
  } catch (error) {
    base.ok = false;
    base.error = error instanceof Error ? error.message : String(error);
    return base;
  }
}

function renderSummaryMarkdown(outcomes: readonly Outcome[]): string {
  const lines: string[] = [];
  lines.push("| Source | File | Status | Rows (old → new) | Dollars (old → new) |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const o of outcomes) {
    const status = !o.ok
      ? "FAILED"
      : o.changed
        ? "updated"
        : "unchanged";
    const rowPct = pctDelta(o.before?.rows ?? null, o.after?.rows ?? null);
    const rowCell =
      `${formatCount(o.before?.rows ?? null)} → ${formatCount(o.after?.rows ?? null)}` +
      (rowPct != null && Math.abs(rowPct) >= 0.05 ? ` (${rowPct > 0 ? "+" : ""}${rowPct.toFixed(1)}%)` : "");
    const dollarCell = `${formatDollars(o.before?.dollars ?? null)} → ${formatDollars(o.after?.dollars ?? null)}`;
    lines.push(`| ${o.label} | \`${o.file}\` | ${status} | ${rowCell} | ${dollarCell} |`);
  }
  lines.push("");
  for (const o of outcomes) {
    if (o.after?.parts) {
      const beforeParts = o.before?.parts ?? {};
      const parts = Object.entries(o.after.parts)
        .map(([k, v]) => `${k} ${formatCount(beforeParts[k] ?? null)} → ${formatCount(v)}`)
        .join(", ");
      lines.push(`- **${o.label}** partitions: ${parts}`);
    }
    if (!o.ok) lines.push(`- **${o.label}** FAILED: ${o.error}`);
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const options = parseRefreshCliArgs(process.argv.slice(2));
  const selected = options.only
    ? SOURCES.filter((s) => options.only!.includes(s.id))
    : SOURCES;
  if (selected.length === 0) throw new Error("No sources selected");

  const outcomes: Outcome[] = [];
  for (const source of selected) {
    process.stdout.write(`\n▶ ${source.label} (${source.file})\n`);
    const outcome = await refreshOne(source, options);
    outcomes.push(outcome);
    if (!outcome.ok) {
      process.stdout.write(`  ✖ FAILED: ${outcome.error}\n`);
      continue;
    }
    process.stdout.write(
      `  rows   ${formatCount(outcome.before?.rows ?? null)} → ${formatCount(outcome.after?.rows ?? null)}\n` +
        `  ${outcome.dollarLabel}  ${formatDollars(outcome.before?.dollars ?? null)} → ${formatDollars(outcome.after?.dollars ?? null)}\n` +
        `  ${outcome.changed ? (options.dryRun ? "would change" : "written") : "unchanged"}\n`,
    );
  }

  const summary = renderSummaryMarkdown(outcomes);
  process.stdout.write(`\n${"─".repeat(72)}\nREFRESH SUMMARY\n${"─".repeat(72)}\n${summary}\n`);
  if (options.summaryOut) writeFileSync(options.summaryOut, summary, "utf8");

  const failed = outcomes.filter((o) => !o.ok);
  const changed = outcomes.some((o) => o.changed);

  if (changed && !options.dryRun && !options.skipExport) {
    process.stdout.write("\n▶ Regenerating the Community Investment export…\n");
    const run = spawnSync("npm", ["run", "data:export:investment"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (run.status !== 0) {
      process.stdout.write("\n✖ Export failed after refresh\n");
      process.exitCode = 1;
      return;
    }
  } else if (!changed) {
    process.stdout.write("\nNo input changed — export skipped.\n");
  }

  // Deliverable 7 (consult F9) — "always commit a refresh-attempt artifact on
  // failure so a failure-only run has a diff and can open a PR." Without this,
  // a run where EVERY source fails before writing any bytes leaves `git status`
  // clean, data-refresh.yml's "changed" check reports false, the PR-open step
  // never runs, and the failure is visible only in a workflow log nobody reads
  // until the run goes red for other reasons — exactly the gap audit finding 13
  // flagged. Written ONLY on failure (never on an ordinary no-op success, which
  // must stay silent) and removed once every source is healthy again, so it
  // never lingers as permanent no-op diff noise.
  if (!options.dryRun) {
    const attempt = buildRefreshAttemptArtifact(outcomes);
    if (attempt) {
      writeFileSync(REFRESH_ATTEMPT_PATH, JSON.stringify(attempt, null, 2) + "\n", "utf8");
      process.stdout.write(`\n(wrote ${REFRESH_ATTEMPT_PATH} — failure artifact for the delta PR)\n`);
    } else if (existsSync(REFRESH_ATTEMPT_PATH)) {
      unlinkSync(REFRESH_ATTEMPT_PATH);
      process.stdout.write(`\n(removed ${REFRESH_ATTEMPT_PATH} — every source is healthy again)\n`);
    }
  }

  if (failed.length > 0) {
    process.stdout.write(
      `\n✖ ${failed.length} of ${outcomes.length} source(s) failed: ${failed.map((f) => f.id).join(", ")}\n`,
    );
    process.exitCode = 1;
  }
}

/**
 * Only run the refresh when this file is the entry point. checkDecreasePolicy
 * (and other pure helpers) are exported so the test suite can exercise them
 * directly — without this guard, importing checkDecreasePolicy for a unit
 * test would kick off a LIVE refresh (real Socrata/HUD network calls,
 * potential file writes) as a module-load side effect. Same pattern as
 * scripts/export-community-investment.ts.
 */
const isDirectRun = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}

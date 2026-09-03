#!/usr/bin/env npx tsx
/**
 * Production synthetic check.
 *
 * Hits the handful of production surfaces whose silent failure nobody would
 * notice from the outside: the three pages a visitor actually lands on, the
 * two data routes every page depends on, the admin gate, and — the one that
 * matters most — ONE real report generation driven exactly the way the wizard
 * drives it (POST /api/report/generate with a WizardState + ReportContext,
 * see `generateReportRemote` in app/report/page.tsx).
 *
 * Deliberately read-only against production: no email is sent, the
 * email-report and support-request routes are never touched, and no lead is
 * written. /api/report/generate is pure compute over the static catalog (its
 * only DB touch is a fail-open rate limiter), so exercising it leaves nothing
 * behind.
 *
 * Usage:
 *   npx tsx scripts/prod-synthetic-check.ts
 *   npx tsx scripts/prod-synthetic-check.ts --base-url https://staging.example.com
 *   npx tsx scripts/prod-synthetic-check.ts --force-fail   # exercise the alert path
 *
 * Exits 1 if any check fails. Prints a markdown table to stdout and appends it
 * to $GITHUB_STEP_SUMMARY when that is set.
 *
 * No dependencies — Node 22 global fetch only.
 */

import { appendFileSync } from "node:fs";

// ─── Configuration ──────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://chicagoincentiveexplorer.com";

/** Every ordinary check. Generous, but a page this far over is a real defect. */
const PAGE_TIMEOUT_MS = 15_000;

/**
 * The report generation gets its own, much larger budget. It is the most
 * expensive endpoint in the app (`maxDuration = 30` on the route itself) and
 * a scheduled check hits a cold lambda more often than a visitor does, so a
 * page-sized timeout here would report cold starts as outages.
 */
const REPORT_TIMEOUT_MS = 60_000;

/**
 * A fixed Southeast Chicago address, geocoded once and pinned here so the
 * report check never depends on the geocode check having passed first — the
 * two failures stay independent and each reason stays honest.
 */
const SAMPLE_ADDRESS = "8801 S Commercial Ave, Chicago, IL 60617";
const SAMPLE_LAT = 41.735436;
const SAMPLE_LON = -87.551277;

const GEOCODE_PATH = `/api/geocode?address=${encodeURIComponent("8801 S Commercial Ave Chicago IL 60617")}`;

/**
 * The minimal wizard state that still produces a real report: a report type,
 * a located address, and the three answers the site-incentives path asks for.
 * `ctx` is omitted — the route treats an absent context as `{}` (see
 * lib/report-request-schemas.ts) and the engine defaults throughout, so this
 * is the smallest body the wizard could ever send and still get a report.
 */
const SAMPLE_WIZARD_STATE = {
  reportType: "site-incentives",
  address: SAMPLE_ADDRESS,
  lat: SAMPLE_LAT,
  lon: SAMPLE_LON,
  neighborhood: "South Chicago",
  industry: "retail",
  budgetRange: "100k-500k",
  projectGoals: ["rehab"],
  projectType: "rehab",
  customGoal: "",
  proposedUse: "",
  fundingCommitted: "",
  remainingGap: "",
  timeline: "",
  siteControl: "",
  documentsAvailable: [] as string[],
  jobsImpact: "",
  supportNeeded: [] as string[],
  creditsToAnalyze: [] as string[],
};

// ─── Result model ───────────────────────────────────────────────────

interface CheckResult {
  name: string;
  ok: boolean;
  /** HTTP status, or null when the request never completed (timeout, DNS…). */
  status: number | null;
  ms: number;
  /** One line. On failure it must say what was wrong, not just "failed". */
  reason: string;
}

// ─── Arguments ──────────────────────────────────────────────────────

interface Options {
  baseUrl: string;
  forceFail: boolean;
}

function parseArgs(argv: string[]): Options {
  let baseUrl = DEFAULT_BASE_URL;
  let forceFail = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force-fail") {
      forceFail = true;
    } else if (arg === "--base-url") {
      const next = argv[i + 1];
      if (!next) {
        console.error("--base-url requires a value");
        process.exit(2);
      }
      baseUrl = next;
      i++;
    } else if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), forceFail };
}

// ─── Fetch helper ───────────────────────────────────────────────────

interface Fetched {
  status: number | null;
  ms: number;
  body: string;
  /** Set when the request itself failed (timeout, network); body is empty. */
  error: string | null;
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Fetched> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      // A synthetic check must never be served a CDN copy of a page that has
      // since started failing at the origin.
      headers: {
        "User-Agent": "seccc-prod-synthetic-check",
        "Cache-Control": "no-cache",
        ...(init.headers ?? {}),
      },
    });
    const body = await res.text();
    return { status: res.status, ms: Date.now() - started, body, error: null };
  } catch (err) {
    const ms = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      status: null,
      ms,
      body: "",
      error: aborted
        ? `no response within ${timeoutMs / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    // Without this the abort timer keeps the event loop alive for the full
    // budget after a fast response — seven checks would hold the process open
    // long past the last result.
    clearTimeout(timer);
  }
}

/**
 * A GET check. `validate` runs only on a 200 and returns null when the body is
 * acceptable or a one-line reason when it is not.
 */
async function checkGet(
  name: string,
  baseUrl: string,
  path: string,
  validate?: (body: string) => string | null,
): Promise<CheckResult> {
  const { status, ms, body, error } = await timedFetch(
    `${baseUrl}${path}`,
    { method: "GET" },
    PAGE_TIMEOUT_MS,
  );

  if (error) return { name, ok: false, status, ms, reason: error };
  if (status !== 200) {
    return { name, ok: false, status, ms, reason: `expected HTTP 200, got ${status}` };
  }

  const problem = validate?.(body) ?? null;
  if (problem) return { name, ok: false, status, ms, reason: problem };

  return { name, ok: true, status, ms, reason: "ok" };
}

// ─── Body validators ────────────────────────────────────────────────

function parseJson(body: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(body) };
  } catch {
    return { error: "response body was not valid JSON" };
  }
}

/** /api/programs must return a non-empty array — an empty catalog is an outage. */
function validatePrograms(body: string): string | null {
  const parsed = parseJson(body);
  if ("error" in parsed) return parsed.error;
  if (!Array.isArray(parsed.value)) return "expected a JSON array of programs";
  if (parsed.value.length === 0) return "program array was empty";
  return null;
}

/** The geocoder must return usable, finite coordinates — not just a 200. */
function validateGeocode(body: string): string | null {
  const parsed = parseJson(body);
  if ("error" in parsed) return parsed.error;
  const value = parsed.value as { lat?: unknown; lon?: unknown } | null;
  if (!value || typeof value !== "object") return "expected a JSON object";
  const { lat, lon } = value;
  if (typeof lat !== "number" || !Number.isFinite(lat)) {
    return `lat was not a finite number (got ${JSON.stringify(lat)})`;
  }
  if (typeof lon !== "number" || !Number.isFinite(lon)) {
    return `lon was not a finite number (got ${JSON.stringify(lon)})`;
  }
  return null;
}

// ─── The report generation check ────────────────────────────────────

interface ReportSectionLike {
  items?: unknown[];
}

/**
 * Exercises ONE real report the way the wizard does: POST
 * /api/report/generate with `{ state, ctx }`, exactly as
 * `generateReportRemote` in app/report/page.tsx does.
 *
 * The assertion is deliberately about SHAPE, never about which programs came
 * back: a report with a title, a report type, and at least one section or one
 * program match. Pinning specific programs here would make a legitimate
 * catalog edit page whoever is on call.
 */
async function checkReportGeneration(baseUrl: string): Promise<CheckResult> {
  const name = "POST /api/report/generate";
  const { status, ms, body, error } = await timedFetch(
    `${baseUrl}/api/report/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: SAMPLE_WIZARD_STATE, ctx: {} }),
    },
    REPORT_TIMEOUT_MS,
  );

  if (error) return { name, ok: false, status, ms, reason: error };
  if (status !== 200) {
    const detail = body.slice(0, 160).replace(/\s+/g, " ").trim();
    return {
      name,
      ok: false,
      status,
      ms,
      reason: `expected HTTP 200, got ${status}${detail ? ` — ${detail}` : ""}`,
    };
  }

  const parsed = parseJson(body);
  if ("error" in parsed) return { name, ok: false, status, ms, reason: parsed.error };

  const report = parsed.value as {
    title?: unknown;
    reportType?: unknown;
    sections?: ReportSectionLike[];
    metadata?: { matchedPrograms?: unknown[] };
  } | null;

  if (!report || typeof report !== "object") {
    return { name, ok: false, status, ms, reason: "response was not a report object" };
  }
  if (typeof report.title !== "string" || typeof report.reportType !== "string") {
    return {
      name,
      ok: false,
      status,
      ms,
      reason: "report object had no title/reportType",
    };
  }

  const sections = Array.isArray(report.sections) ? report.sections : [];
  const items = sections.reduce(
    (total, section) => total + (Array.isArray(section?.items) ? section.items.length : 0),
    0,
  );
  const matches = Array.isArray(report.metadata?.matchedPrograms)
    ? report.metadata.matchedPrograms.length
    : 0;

  if (sections.length === 0 && matches === 0) {
    return {
      name,
      ok: false,
      status,
      ms,
      reason: "report had no sections and no program matches",
    };
  }

  return {
    name,
    ok: true,
    status,
    ms,
    reason: `${sections.length} section(s), ${items} item(s), ${matches} program match(es)`,
  };
}

// ─── Reporting ──────────────────────────────────────────────────────

function renderTable(results: CheckResult[], baseUrl: string, failed: number): string {
  const lines: string[] = [];
  const verdict = failed === 0 ? "PASS" : `FAIL (${failed} of ${results.length})`;

  lines.push(`### Production synthetic check — ${verdict}`);
  lines.push("");
  lines.push(`Target: \`${baseUrl}\` · ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Check | Result | Status | Latency | Detail |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of results) {
    lines.push(
      `| \`${r.name}\` | ${r.ok ? "PASS" : "FAIL"} | ${r.status ?? "—"} | ${r.ms} ms | ${r.reason.replace(/\|/g, "\\|")} |`,
    );
  }
  return lines.join("\n");
}

// ─── Entry point ────────────────────────────────────────────────────

async function main() {
  const { baseUrl, forceFail } = parseArgs(process.argv.slice(2));

  const results: CheckResult[] = [];

  results.push(await checkGet("GET /", baseUrl, "/"));
  results.push(await checkGet("GET /report", baseUrl, "/report"));
  results.push(await checkGet("GET /map", baseUrl, "/map"));
  results.push(await checkGet("GET /api/programs", baseUrl, "/api/programs", validatePrograms));
  results.push(await checkGet("GET /api/geocode", baseUrl, GEOCODE_PATH, validateGeocode));
  // 200 is the whole assertion here: the page legitimately renders an access
  // gate rather than the admin view, and asserting on its contents would make
  // this check a test of the gate copy instead of a test of the route.
  results.push(await checkGet("GET /admin/zoning-changes", baseUrl, "/admin/zoning-changes"));
  results.push(await checkReportGeneration(baseUrl));

  if (forceFail) {
    results.push({
      name: "forced failure (--force-fail)",
      ok: false,
      status: null,
      ms: 0,
      reason: "synthetic failure requested to exercise the alert path",
    });
  }

  const failed = results.filter((r) => !r.ok).length;
  const table = renderTable(results, baseUrl, failed);

  console.log(table);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, `${table}\n`);
    } catch (err) {
      console.error(
        `Could not append to GITHUB_STEP_SUMMARY: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("prod-synthetic-check crashed:", err);
  process.exit(1);
});

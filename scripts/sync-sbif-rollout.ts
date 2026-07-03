#!/usr/bin/env npx tsx
/**
 * Sync the SBIF rollout calendar from chicago.gov and/or the SomerCor
 * equivalent listing. Produces public/data/sbif-rollout.json.
 *
 * Source priority:
 *   1. chicago.gov SBIF rollout calendar page
 *      https://www.chicago.gov/city/en/sites/small-business-improvement-fund/home/rollout-calendar.html
 *   2. SomerCor SBIF listing page (fallback if chicago.gov returns 403/non-HTML)
 *      https://somercor.com/sbif/
 *
 * Both pages frequently return 403 to automated fetchers. When blocked on both:
 *   - The script emits public/data/sbif-rollout.json with an empty windows[]
 *     array and an error field documenting the block.
 *   - The "skipped" annotation records that a manual pull is needed.
 *
 * Manual update path: paste the calendar table from the program page into the
 * JSON file as [{tifDistrict, windowStart, windowEnd}] entries. The script
 * also accepts a SBIF_ROLLOUT_JSON env var pointing to a local JSON file to
 * seed from (useful for testing or manual import):
 *   SBIF_ROLLOUT_JSON=./sbif-manual.json npx tsx scripts/sync-sbif-rollout.ts
 *
 * Usage:
 *   npx tsx scripts/sync-sbif-rollout.ts
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dirname ?? __dirname, "..");
const STATIC_OUT = join(REPO_ROOT, "public", "data", "sbif-rollout.json");

const CHICAGO_GOV_URL =
  "https://www.chicago.gov/city/en/sites/small-business-improvement-fund/home/rollout-calendar.html";
const SOMERCOR_URL = "https://somercor.com/sbif/";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SbifWindow {
  /** TIF district name as printed on the rollout calendar. */
  tifDistrict: string;
  /** ISO date string YYYY-MM-DD (first day of the window). */
  windowStart: string;
  /** ISO date string YYYY-MM-DD (last day of the window, inclusive). */
  windowEnd: string;
}

interface SbifRolloutExport {
  exportedAt: string;
  sourceUrl: string;
  /** Empty when the page was unreachable; populated when parsing succeeded. */
  windows: SbifWindow[];
  /**
   * Set when the calendar page could not be fetched or parsed automatically.
   * Consumers should treat this file as "pending manual update" when set.
   */
  fetchError?: string;
  /**
   * Human note about what "manual pull" means in this context, surfaced so
   * the next developer/operator knows exactly what to do.
   */
  manualUpdateNote?: string;
}

// ── Fetch + parse helpers ─────────────────────────────────────────────────────

/**
 * Attempt to fetch HTML from a URL. Returns the raw body or null on failure.
 * Logs the HTTP status when blocked.
 */
async function tryFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SECCC-IncentiveExplorer/1.0; +https://seccc.org)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.log(`  ${url} → HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${url} → fetch error: ${msg}`);
    return null;
  }
}

/**
 * Parse month-year strings like "July 2026", "August 2026" to YYYY-MM-DD
 * range. Returns [windowStart, windowEnd] as ISO dates for the full month.
 * Returns null if the string is not a recognized month-year.
 */
function parseMonthYear(
  s: string
): { windowStart: string; windowEnd: string } | null {
  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  const m = s
    .trim()
    .toLowerCase()
    .match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/);
  if (!m) return null;
  const mm = months[m[1]];
  const yyyy = m[2];
  // Last day: use Date overflow trick.
  const lastDay = new Date(
    parseInt(yyyy),
    parseInt(mm), // month is 1-based; JS months are 0-based so month index = parseInt(mm)-1+1
    0
  ).getDate();
  return {
    windowStart: `${yyyy}-${mm}-01`,
    windowEnd: `${yyyy}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Attempt to extract SBIF rollout windows from raw HTML.
 *
 * Both the chicago.gov and SomerCor pages present the calendar as an HTML
 * table or a structured list. We do lightweight heuristic parsing rather than
 * full DOM parsing (no jsdom dependency).
 *
 * Pattern: rows typically look like:
 *   <td>Commercial Avenue TIF</td><td>July 2026</td>
 * or:
 *   <tr><td>South Chicago TIF</td><td>July 1 – July 31, 2026</td></tr>
 *
 * Returns an empty array when no windows are recognizable.
 */
function parseRolloutHtml(html: string): SbifWindow[] {
  const windows: SbifWindow[] = [];

  // Strip script/style/comment nodes to reduce noise.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extract all <tr> blocks.
  const trMatches = cleaned.matchAll(/<tr[\s\S]*?<\/tr>/gi);
  for (const [trBlock] of trMatches) {
    // Extract text from all <td>/<th> cells.
    const cells: string[] = [];
    for (const [, cellText] of trBlock.matchAll(
      /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    )) {
      cells.push(cellText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    }
    if (cells.length < 2) continue;

    const districtCell = cells[0];
    const dateCell = cells[1];

    // Skip header rows.
    if (/district|tif\s+name|window|date|month/i.test(districtCell)) continue;
    if (!districtCell || districtCell.length < 5) continue;

    // Try to parse the date cell as a month-year string.
    const parsed = parseMonthYear(dateCell);
    if (!parsed) {
      // Try "Month DD – Month DD, YYYY" or "Month 1–30, YYYY" patterns.
      const rangeMatch = dateCell.match(
        /(\w+ \d{1,2})[–\-–][\s\w]*?(\d{4})/
      );
      if (rangeMatch) {
        // Best-effort: fall back to full-month parse for the named month.
        const monthParse = parseMonthYear(
          dateCell.replace(/\d+/g, "").trim() + " " + rangeMatch[2]
        );
        if (monthParse) {
          windows.push({
            tifDistrict: districtCell,
            ...monthParse,
          });
        }
      }
      continue;
    }
    windows.push({ tifDistrict: districtCell, ...parsed });
  }

  return windows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== SBIF Rollout Calendar Sync ===\n");
  console.log(
    "Source 1: chicago.gov SBIF rollout calendar\n" +
      "Source 2: SomerCor SBIF listing (fallback)\n"
  );

  // ── 0. Manual seed via env var (for testing / manual import) ────────────
  const manualPath = process.env.SBIF_ROLLOUT_JSON;
  if (manualPath) {
    if (!existsSync(manualPath)) {
      console.error(`SBIF_ROLLOUT_JSON file not found: ${manualPath}`);
      process.exit(1);
    }
    console.log(`Loading from SBIF_ROLLOUT_JSON: ${manualPath}`);
    const raw = JSON.parse(readFileSync(manualPath, "utf8")) as SbifWindow[];
    const exportPayload: SbifRolloutExport = {
      exportedAt: new Date().toISOString(),
      sourceUrl: `file://${manualPath}`,
      windows: raw,
    };
    mkdirSync(join(REPO_ROOT, "public", "data"), { recursive: true });
    writeFileSync(STATIC_OUT, JSON.stringify(exportPayload, null, 2), "utf8");
    console.log(`Written (manual seed) → ${STATIC_OUT}`);
    console.log(`  Windows: ${raw.length}`);
    return;
  }

  // ── 1. Try chicago.gov ──────────────────────────────────────────────────
  console.log("Fetching chicago.gov rollout calendar...");
  let html = await tryFetch(CHICAGO_GOV_URL);
  let sourceUrl = CHICAGO_GOV_URL;
  let windows: SbifWindow[] = [];
  let fetchError: string | undefined;

  if (html) {
    windows = parseRolloutHtml(html);
    console.log(
      `  Parsed ${windows.length} window(s) from chicago.gov`
    );
  } else {
    // ── 2. Try SomerCor fallback ─────────────────────────────────────────
    console.log("chicago.gov blocked or empty; trying SomerCor...");
    html = await tryFetch(SOMERCOR_URL);
    sourceUrl = SOMERCOR_URL;
    if (html) {
      windows = parseRolloutHtml(html);
      console.log(`  Parsed ${windows.length} window(s) from SomerCor`);
    } else {
      fetchError =
        "Both chicago.gov and somercor.com returned non-200 responses or " +
        "timed out. The SBIF rollout calendar requires a manual pull. " +
        "See manualUpdateNote in this file for instructions.";
      console.warn(`\n[WARN] ${fetchError}`);
    }
  }

  // If we got HTML but found 0 windows, the page is likely JS-rendered and
  // could not be parsed statically. Treat this the same as a fetch block.
  if (!fetchError && windows.length === 0 && html) {
    fetchError =
      "The SBIF rollout calendar page returned HTML but zero windows were " +
      "parsed — the page is likely JavaScript-rendered and cannot be scraped " +
      "statically. The sbif-rollout.json file ships with an empty windows[] " +
      "array pending a manual pull. See manualUpdateNote.";
    console.warn(`\n[WARN] ${fetchError}`);
  }

  // ── 3. Write output ──────────────────────────────────────────────────────
  const exportPayload: SbifRolloutExport = {
    exportedAt: new Date().toISOString(),
    sourceUrl,
    windows,
    ...(fetchError
      ? {
          fetchError,
          manualUpdateNote:
            "Visit https://www.chicago.gov/city/en/sites/small-business-improvement-fund/home/rollout-calendar.html " +
            "in a browser and copy the calendar table. Update the 'windows' array in this file as " +
            "[{tifDistrict: string, windowStart: 'YYYY-MM-DD', windowEnd: 'YYYY-MM-DD'}]. " +
            "Alternatively set SBIF_ROLLOUT_JSON=/path/to/windows.json and re-run this script.",
        }
      : {}),
  };

  mkdirSync(join(REPO_ROOT, "public", "data"), { recursive: true });
  writeFileSync(STATIC_OUT, JSON.stringify(exportPayload, null, 2), "utf8");

  if (fetchError) {
    console.log(
      `\nStatic export written with EMPTY windows (fetch blocked) → ${STATIC_OUT}`
    );
    console.log(
      "ACTION NEEDED: manually pull the calendar and update windows[]."
    );
  } else {
    console.log(`\nStatic export written → ${STATIC_OUT}`);
    console.log(`  Windows: ${windows.length}`);
    for (const w of windows.slice(0, 10)) {
      console.log(`    ${w.tifDistrict}: ${w.windowStart} – ${w.windowEnd}`);
    }
    if (windows.length > 10) {
      console.log(`    ... and ${windows.length - 10} more`);
    }
  }

  console.log("\nDone!\n");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});

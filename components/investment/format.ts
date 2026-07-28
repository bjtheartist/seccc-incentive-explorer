/**
 * Display formatting + labels for the Investment & Impact Analysis pages.
 * Pure, dependency-free, client-safe (no fs, no map deps). Every dollar figure
 * here is an AWARDED amount — the helpers never imply a received/available/
 * remaining balance.
 */

import type { InvestmentSource } from "@/lib/community-investment";

/**
 * Compact dollars for hero figures, axis ticks, and bar-tip labels:
 * $1.3B / $14.9M / $250K / $0. Proportional (not tabular) so a display-size
 * number never looks loose. Rounds to one decimal for B/M, whole for K.
 */
export function formatCompactDollars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not disclosed";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) {
    const k = Math.round(n / 1_000);
    // Rounding can carry 999.5K over the boundary — roll to $1.0M, never "$1000K".
    if (Math.abs(k) >= 1_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${k}K`;
  }
  return `$${Math.round(n)}`;
}

/** Full grouped dollars for table cells + tooltips: "$14,940,310". */
export function formatFullDollars(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not disclosed";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** A grouped integer count. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** A share fraction (0–1) as a percent string, e.g. 0.452 → "45%". */
export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A multiple, e.g. 2.317 → "2.3×". */
export function formatMultiple(x: number): string {
  return `${x.toFixed(1)}×`;
}

/** As-of date from an ISO timestamp: "July 27, 2026". */
export function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date unavailable";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Human-readable program label for a source key. */
export const SOURCE_LABELS: Record<InvestmentSource, string> = {
  "nof-small": "Neighborhood Opportunity Fund — small grants",
  "nof-large": "Neighborhood Opportunity Fund — large grants",
  sbif: "Small Business Improvement Fund",
  cdg: "Community Development Grant",
  foundation: "Private foundations",
  development: "Development projects",
  tif: "TIF-funded RDA/IGA projects",
  "cdbg-home": "HUD CDBG/HOME activities",
  lihtc: "Low-Income Housing Tax Credit",
  nmtc: "New Markets Tax Credit",
};

/** Short program label for tight table cells. */
export const SOURCE_LABELS_SHORT: Record<InvestmentSource, string> = {
  "nof-small": "NOF (small)",
  "nof-large": "NOF (large)",
  sbif: "SBIF",
  cdg: "CDG",
  foundation: "Foundation",
  development: "Development",
  tif: "TIF",
  "cdbg-home": "CDBG/HOME",
  lihtc: "LIHTC",
  nmtc: "NMTC",
};

/**
 * The single neutral hue for magnitude bars (year trend + program mix). Kept
 * deliberately OFF the three funder-type hues (blue/green/purple) so those stay
 * reserved for funderType — a neutral slate reads as "magnitude", not identity.
 */
export const MAGNITUDE_HUE = "#475569";

/** Text tokens (navy ink at opacity steps) — never a series color for text. */
export const INK = "#0C1B33";
export const INK_70 = "rgba(12,27,51,0.70)";
export const INK_55 = "rgba(12,27,51,0.55)";
export const INK_40 = "rgba(12,27,51,0.40)";
/** One-step-off-surface hairline for gridlines/axes. */
export const GRID = "rgba(12,27,51,0.10)";
export const SURFACE = "#FAF9F6";

/** Truncate a log line for a table cell without cutting mid-entity too harshly. */
export function truncate(text: string | null, max = 90): string {
  if (!text) return "";
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

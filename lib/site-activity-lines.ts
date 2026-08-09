/**
 * SITE ACTIVITY — SHARED PRESENTATION (no JSX, no fetch, no DOM).
 *
 * One voice for every surface that publishes the five raw site measurements:
 * the report's full card (components/report/SiteActivityCard.tsx) and the
 * COMPACT variant inside the Vacant Sites map card
 * (components/vacancy/vacancy-site-card.ts). Both render the same sentences
 * from these functions, so a wording or provenance fix lands in one place and
 * neither surface can drift into a friendlier claim than the other.
 *
 * The rails this module exists to hold — identical to lib/site-activity.ts:
 *   • NOTHING here composes measures. There is no combined foot-traffic,
 *     visitor, or "activity score" line, and none may be added: every string
 *     below traces to exactly one government dataset.
 *   • An ABSENCE is stated as an absence ("No 'L' station within 0.5 mi of this
 *     site."), never as a zero and never omitted. `absenceStatement` is the
 *     only way any surface may say it.
 *   • A value NEVER travels without its provenance: `sourceText` pairs the
 *     dataset label with the vintage carried by the data itself, and every
 *     compact line ships a `source` whenever it ships a `figure`.
 *
 * Radius wording is subject-aware only: the report card measures from a
 * geocoded ADDRESS, the vacancy card from a parcel SITE. Nothing else about a
 * sentence changes between surfaces.
 */

import {
  LICENSE_CATEGORY_LABELS,
  type ArterialMeasure,
  type CatchmentMeasure,
  type LicenseMeasure,
  type RailMeasure,
  type SiteActivityContext,
  type SiteActivitySources,
  type SourceRef,
} from "./site-activity";

/** The four measured lines, in the order every surface renders them. */
export type SiteActivityMeasureKey = "arterial" | "rail" | "catchment" | "licenses";

export const SITE_ACTIVITY_MEASURE_ORDER: readonly SiteActivityMeasureKey[] = [
  "arterial",
  "rail",
  "catchment",
  "licenses",
];

/** What the disclosed radius is measured FROM on this surface. */
export type RadiusSubject = "address" | "site";

/** The header/footer claim both surfaces make about the whole block. */
export const SITE_ACTIVITY_NOTE = "Raw public measurements — nothing modeled";

/** In-flight wording. Never phrased as a preliminary result. */
export function siteActivityCheckingText(subject: RadiusSubject = "site"): string {
  return `Checking public measurements near this ${subject}…`;
}

/**
 * Failure wording. A lookup that did not complete says so — it must never be
 * rendered as "nothing is near this site", which is the one misreading that
 * would turn a network blip into a false statement about a neighborhood.
 */
export const SITE_ACTIVITY_ERROR_TEXT =
  "Could not check public measurements right now — open the full address report to verify.";

const nf = new Intl.NumberFormat("en-US");

/** One thousands-separated integer style for every surface. */
export function formatCount(value: number): string {
  return nf.format(value);
}

/**
 * The explicit absence for one measure. The radius appears verbatim so the
 * claim carries its own boundary: "nothing within 0.15 mi" is checkable,
 * "no traffic here" is not.
 */
export function absenceStatement(
  key: SiteActivityMeasureKey,
  radii: SiteActivityContext["radii"],
  subject: RadiusSubject = "address",
): string {
  switch (key) {
    case "arterial":
      return `No IDOT count station within ${radii.arterialMi} mi of this ${subject}.`;
    case "rail":
      return `No 'L' station within ${radii.railMi} mi of this ${subject}.`;
    case "catchment":
      return `No census block-group centroid within ${radii.catchmentMi} mi.`;
    case "licenses":
      return `No active business license on record within ${radii.licenseMi} mi.`;
  }
}

// ── Per-measure vintages (carried by the DATA, not by the source register) ────

export function arterialVintage(measure: ArterialMeasure): string {
  return `${measure.aadtYear} count year`;
}

export function railVintage(measure: RailMeasure): string {
  return measure.month;
}

export function catchmentVintage(measure: CatchmentMeasure): string {
  return `${measure.acsVintage} · ${measure.lodesVintage}`;
}

/** "City of Chicago active business licenses · 2026-08 publication" — the tiny
 *  provenance line under a value. `vintage` overrides the register's default
 *  whenever the row itself carries a more specific one. */
export function sourceText(source: SourceRef, vintage?: string): string {
  return `${source.label} · ${vintage ?? source.vintage}`;
}

// ── Licensed businesses ──────────────────────────────────────────────────────

export const LICENSE_CATEGORY_DISPLAY_LIMIT = 4;

/**
 * "4 restaurants & cafes, 3 general retail" — the largest categories, excluding
 * the uncategorizable remainder, which is reported separately by
 * `licenseOtherCount` rather than folded in (folding it would overstate how
 * specific the categorization is). Empty string when every license is "other".
 */
export function licenseCategoryPhrase(
  measure: LicenseMeasure,
  limit: number = LICENSE_CATEGORY_DISPLAY_LIMIT,
): string {
  return measure.byCategory
    .filter((c) => c.category !== "other")
    .slice(0, limit)
    .map((c) => `${c.count} ${(LICENSE_CATEGORY_LABELS[c.category] ?? c.category).toLowerCase()}`)
    .join(", ");
}

/** The uncategorizable remainder, or null when the data carried none. */
export function licenseOtherCount(measure: LicenseMeasure): number | null {
  const other = measure.byCategory.find((c) => c.category === "other");
  return other ? other.count : null;
}

// ── The compact variant ──────────────────────────────────────────────────────

/**
 * One measure as at most two rendered lines: a bold `figure` plus `detail`,
 * then the `source` line. An absence carries `figure: null`, the absence
 * sentence in `detail`, and no source — nothing was measured to attribute.
 */
export interface SiteActivityCompactLine {
  key: SiteActivityMeasureKey;
  /** Mono micro-label; carries the radius when the measure is a catchment. */
  label: string;
  /** True only when a real measurement exists inside the disclosed radius. */
  present: boolean;
  figure: string | null;
  detail: string;
  source: { text: string; url: string } | null;
}

/** The compact micro-label. Radii ride along where the value line would
 *  otherwise have to repeat them. */
export function siteActivityLabel(
  key: SiteActivityMeasureKey,
  radii: SiteActivityContext["radii"],
): string {
  switch (key) {
    case "arterial":
      return "Arterial flow";
    case "rail":
      return "Nearest 'L'";
    case "catchment":
      return `Residents & jobs · ${radii.catchmentMi} mi`;
    case "licenses":
      return `Licensed businesses · ${radii.licenseMi} mi`;
  }
}

/**
 * The four compact lines, always all four and always in
 * SITE_ACTIVITY_MEASURE_ORDER: a surface cannot quietly drop the measure that
 * came back empty, because a dropped absence reads as a measure nobody checked.
 */
export function siteActivityCompactLines(
  context: SiteActivityContext,
  sources: SiteActivitySources,
  subject: RadiusSubject = "site",
): SiteActivityCompactLine[] {
  const { arterial, rail, catchment, licenses, radii } = context;

  const absent = (key: SiteActivityMeasureKey): SiteActivityCompactLine => ({
    key,
    label: siteActivityLabel(key, radii),
    present: false,
    figure: null,
    detail: absenceStatement(key, radii, subject),
    source: null,
  });

  const nearestRail = rail[0];

  const arterialLine: SiteActivityCompactLine = arterial
    ? {
        key: "arterial",
        label: siteActivityLabel("arterial", radii),
        present: true,
        figure: `${formatCount(arterial.aadt)} vehicles/day`,
        detail: `on ${arterial.roadName} · station ${arterial.stationId} · ${arterial.distanceMi} mi away`,
        source: {
          text: sourceText(sources.aadt, arterialVintage(arterial)),
          url: sources.aadt.url,
        },
      }
    : absent("arterial");

  const railLine: SiteActivityCompactLine = nearestRail
    ? {
        key: "rail",
        label: siteActivityLabel("rail", radii),
        present: true,
        figure: `${formatCount(Math.round(nearestRail.avgWeekdayEntries))} avg weekday entries`,
        detail: [
          `at ${nearestRail.name}`,
          nearestRail.lines.length > 0 ? ` (${nearestRail.lines.join(", ")})` : "",
          ` · ${nearestRail.distanceMi} mi away`,
          rail.length > 1
            ? ` · +${rail.length - 1} more station${rail.length > 2 ? "s" : ""} within ${radii.railMi} mi`
            : "",
        ].join(""),
        source: { text: sourceText(sources.rail, railVintage(nearestRail)), url: sources.rail.url },
      }
    : absent("rail");

  const catchmentLine: SiteActivityCompactLine = catchment
    ? {
        key: "catchment",
        label: siteActivityLabel("catchment", radii),
        present: true,
        figure: `${formatCount(catchment.population)} residents · ${formatCount(catchment.jobs)} jobs`,
        detail: `across ${catchment.blockGroups} census block ${
          catchment.blockGroups === 1 ? "group" : "groups"
        } by centroid`,
        source: {
          text: sourceText(sources.catchment, catchmentVintage(catchment)),
          url: sources.catchment.url,
        },
      }
    : absent("catchment");

  const licenseLine: SiteActivityCompactLine = licenses
    ? {
        key: "licenses",
        label: siteActivityLabel("licenses", radii),
        present: true,
        figure: `${formatCount(licenses.total)} active licenses`,
        detail: compactLicenseDetail(licenses),
        source: { text: sourceText(sources.licenses), url: sources.licenses.url },
      }
    : absent("licenses");

  return [arterialLine, railLine, catchmentLine, licenseLine];
}

/** "— 4 restaurants & cafes, 3 general retail (+2 other licensed)", the report
 *  card's own connector — and just the remainder when nothing categorized, so
 *  the total is never left unexplained. */
function compactLicenseDetail(measure: LicenseMeasure): string {
  const phrase = licenseCategoryPhrase(measure);
  const other = licenseOtherCount(measure);
  const body =
    phrase && other != null
      ? `${phrase} (+${other} other licensed)`
      : phrase || (other != null ? `${other} other licensed` : "");
  return body ? `— ${body}` : "";
}

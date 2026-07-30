/**
 * The Vacant Sites map popup card — a PURE, mapbox-free HTML-string builder
 * (extracted from VacancyReportMap so it can be unit-tested without the map
 * runtime). Rebuilt per the GPT-5.6 IA consult wireframe: PLACE → SIGNIFICANCE
 * → ACT, with progressive disclosure behind native <details> accordions.
 *
 * ── Rails ──
 *  • Owner TYPE / category only — NEVER an owner name or mailing address.
 *  • Discovery, not compliance: conditional voice; no "ideal for" /
 *    "development-ready" / "available".
 *  • Fixed templates over real fields; empty facts are omitted, never invented,
 *    and there are no positive empty states ("No violations", etc.).
 *
 * Public naming: "Not yet classified" (never "Unknown"); "Ownership type"; and
 * priority renders as a plain badge ("Start here" / "Worth a look" / "Needs more
 * research") only inside the "Why it was flagged" disclosure.
 */

import { OWNER_TYPE_COLORS, type OwnerType } from "@/lib/owner-classify";
import { zoningGloss } from "@/lib/vacancy-zoning";
import { clerkRecordsUrl, cookViewerUrl } from "@/lib/cook-viewer";
import { STARRED_RING } from "@/lib/vacancy-starred";
import {
  siteReportHref,
  siteZoneLine,
  siteZonesSummary,
  type SiteZoneState,
} from "@/lib/vacancy-site-zones";
import {
  OWNER_GEOGRAPHY_LABELS,
  OWNER_STRUCTURE_LABELS,
  type OwnerGeography,
  type OwnerStructure,
} from "@/lib/owner-taxonomy";
import { PUBLIC_OWNER_TYPE_LABELS } from "@/lib/vacancy-public-labels";
import { approxSqft } from "@/lib/vacancy-opportunity-areas";
import type {
  OwnerConfidence,
  VacancyCluster,
  VacancyPropertyType,
} from "@/lib/vacancy-index";

const CARD_INK = "#0C1B33";
const CARD_MUTED = "#5A6478";
const CARD_FAINT = "#8A93A6";
const CARD_BLUE = "#2563EB";
const DISTRESS_RED = "#DC2626";
const MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PROPERTY_TYPE_LABELS: Record<VacancyPropertyType, string> = {
  vacant_land: "Vacant land",
  vacant_building: "Vacant building",
};

/** The one-line ownership-confidence disclosure (never a name). */
const OWNER_CONFIDENCE_LINE: Record<OwnerConfidence, string> = {
  pin_matched: "PIN-matched to the City land inventory",
  inferred: "Inferred from taxpayer records",
  needs_verification: "Needs verification",
};

/** Everything the card needs about one site, normalized from feature props. */
export interface CardData {
  isLand: boolean;
  markerNumber: number | null;
  address: string | null;
  ownerType: OwnerType;
  propertyType: VacancyPropertyType;
  pin: string | null;
  squareFeet: number | null;
  zoningClass: string | null;
  incentiveCount: number;
  ownerConfidence: OwnerConfidence;
  ownerStructure: OwnerStructure | null;
  ownerGeography: OwnerGeography | null;
  clusterId: number | null;
  saleYear: number | null;
  violation: boolean;
  cluster: VacancyCluster | null;
  neighborhood: string | null;
  /** The dot's own coordinate. Optional so every existing caller/test compiles;
   *  when present it powers the live place-based zone lookup and the full
   *  address-report deep link in "Programs and zones". */
  lat?: number | null;
  lon?: number | null;
}

/** Everything the card needs beyond the site facts themselves. */
export interface SiteCardOptions {
  /**
   * Cap the card's rendered height (px) and give it internal scroll, so a fully
   * expanded card can never run past the map frame. `null`/omitted = no cap
   * (the pre-existing behavior).
   */
  maxHeightPx?: number | null;
  /**
   * Live place-based zone coverage for this point. Omitted (or `{status:"idle"}`)
   * keeps the legacy `incentiveCount` phrasing.
   */
  zones?: SiteZoneState;
  /**
   * Admin-only star affordance. Omitted for the public (a non-admin sees no
   * star anywhere), so this is the single gate for the whole feature on the map.
   */
  star?: { key: string; starred: boolean } | null;
}

/** Marks the element whose innerHTML is swapped when the zone lookup lands. */
export const ZONE_SLOT_ATTR = "data-vacancy-zones";
/** Marks the "· N mapped" badge in the Programs-and-zones summary. */
export const ZONE_BADGE_ATTR = "data-vacancy-zone-badge";
/** Marks the star button; its value is the site's star key. */
export const STAR_BUTTON_ATTR = "data-vacancy-star";
/** Marks the scroll container that guarantees the card fits the frame. */
export const CARD_SCROLLER_ATTR = "data-vacancy-card-scroll";

/** A plain land-use noun for the significance sentence — from the zoning prefix
 *  when present, else the property type. Longest prefixes first. */
export function landUseNoun(
  zoningClass: string | null,
  propertyType: VacancyPropertyType,
): string {
  if (zoningClass) {
    const u = zoningClass.trim().toUpperCase();
    if (u.startsWith("PMD")) return "industrial parcel";
    if (u.startsWith("POS")) return "open-space parcel";
    if (u.startsWith("PD")) return "planned-development parcel";
    if (u.startsWith("D")) return "downtown parcel";
    if (u.startsWith("R")) return "residential parcel";
    if (u.startsWith("B")) return "commercial/mixed-use parcel";
    if (u.startsWith("C")) return "commercial parcel";
    if (u.startsWith("M")) return "industrial parcel";
  }
  return propertyType === "vacant_building" ? "vacant building" : "vacant parcel";
}

/**
 * ONE significance sentence — place-led (land use + nearby cluster + incentive
 * count), never owner-led, never more than one sentence. Fixed template over
 * real fields; conditional voice only. Ends with exactly one period.
 */
export function significanceSentence(d: CardData): string {
  const noun = landUseNoun(d.zoningClass, d.propertyType);
  const lead = noun.charAt(0).toUpperCase() + noun.slice(1);
  const sqftClause =
    d.squareFeet != null && Number.isFinite(d.squareFeet)
      ? `, about ${approxSqft(d.squareFeet).toLocaleString("en-US")} sq ft`
      : "";
  const clusterClause = d.cluster ? ` among ${d.cluster.count} nearby vacant sites` : "";
  const incentiveClause =
    d.incentiveCount > 0
      ? ` in ${d.incentiveCount} incentive ${d.incentiveCount === 1 ? "geography" : "geographies"}`
      : "";
  const ending =
    d.cluster && d.cluster.count >= 10
      ? " could support exploring a larger reuse with nearby parcels"
      : "";
  return `${lead}${sqftClause}${clusterClause}${incentiveClause}${ending}.`;
}

/** At most ONE consequential caution, only when present (tax-sale first, then a
 * building violation). No positive empty states. */
export function cautionLine(d: CardData): string | null {
  if (d.saleYear != null) return `Tax-sale record on file (latest ${d.saleYear}) — verify current tax and title status.`;
  if (d.violation) return "Open building-violation record — verify current condition.";
  return null;
}

/** The recommended next-step SENTENCE (owner→action mapping, with the tax-sale
 * non-city override). */
export function nextStepAction(d: CardData): string {
  if (d.saleYear != null && d.ownerType !== "city_public") {
    return "Complete a tax and title review before any outreach.";
  }
  switch (d.ownerType) {
    case "city_public":
      return "Begin a City / CCLBA disposition inquiry and review adjacent parcels.";
    case "local_private":
      return "Verify ownership and prepare local-owner outreach.";
    case "corporate_llc":
      return "Identify the entity's decision-maker and related holdings.";
    case "out_of_state":
      return "Verify ownership and initiate targeted outreach.";
    case "unknown":
    default:
      return "Complete title and taxpayer-record verification.";
  }
}

/** Whether the recommended next step emphasizes deed/ownership history (so the
 * Clerk deed-history link should be the PRIMARY county action). */
function emphasizesDeed(d: CardData): boolean {
  return (
    (d.saleYear != null && d.ownerType !== "city_public") ||
    d.ownerConfidence === "needs_verification" ||
    d.ownerType === "unknown"
  );
}

/** The "why it was flagged" reasons (real fields only). */
function flagReasons(d: CardData): string[] {
  const reasons: string[] = [];
  if (d.ownerType === "city_public") reasons.push("City / public land — a disposition path exists.");
  if (d.cluster && d.cluster.count >= 10) {
    reasons.push(`Part of a ${d.cluster.count}-site vacancy cluster.`);
  } else if (d.cluster) {
    reasons.push(`Near ${d.cluster.count - 1} other vacant sites.`);
  }
  if (d.incentiveCount > 0) {
    reasons.push(
      `Intersects ${d.incentiveCount} incentive ${d.incentiveCount === 1 ? "geography" : "geographies"}.`,
    );
  }
  if (d.squareFeet != null && d.squareFeet >= 10000) reasons.push("Larger lot (10,000+ sq ft).");
  if (d.saleYear != null) reasons.push(`Tax-sale record on file (latest ${d.saleYear}).`);
  if (d.violation) reasons.push("Building-violation record on file.");
  if (reasons.length === 0) reasons.push("Flagged as a tracked vacant site for follow-up.");
  return reasons;
}

/**
 * The "Programs and zones" body: the zoning gloss, then this point's PLACE-BASED
 * incentive geographies.
 *
 * Honesty rails (the reason this is its own tested function):
 *   • "Not inside a mapped incentive geography." is claimed ONLY from a lookup
 *     that completed and genuinely returned nothing. A failed lookup says it
 *     failed; an in-flight one says it is checking.
 *   • The legacy `incentiveCount` phrasing survives verbatim for the `idle`
 *     state (a caller with no coordinate to check) — but a card WITH a
 *     coordinate never reports coverage from that stamped count, because the
 *     reconciled vacant-land series ships every dot with `incentiveCount: 0`
 *     and reading that zero as evidence is exactly the bug this replaces.
 *   • Geographies are stated as containment, never as eligibility or an award.
 */
export function programsAndZonesRows(
  d: CardData,
  zones: SiteZoneState = { status: "idle" },
): string[] {
  const gloss = zoningGloss(d.zoningClass);
  const rows: string[] = [gloss ? escapeHtml(gloss) : "Zoning not recorded."];

  if (zones.status === "loading") {
    rows.push("Checking mapped incentive geographies&hellip;");
    return rows;
  }

  if (zones.status === "error") {
    rows.push(
      "Could not check mapped incentive geographies right now — open the full address report to verify.",
    );
    return rows;
  }

  if (zones.status === "loaded") {
    rows.push(escapeHtml(siteZonesSummary(zones.matches)));
    for (const match of zones.matches) {
      rows.push(
        `<span style="color:${CARD_INK}">&bull; ${escapeHtml(siteZoneLine(match))}</span>`,
      );
    }
    return rows;
  }

  // idle — no coordinate to check; fall back to the stamped export count.
  rows.push(
    d.incentiveCount > 0
      ? `Intersects ${d.incentiveCount} incentive ${d.incentiveCount === 1 ? "geography" : "geographies"}.`
      : "Not inside a mapped incentive geography.",
  );
  return rows;
}

/** The "· N mapped" badge appended to the accordion summary once resolved. */
export function zoneBadgeText(zones: SiteZoneState): string {
  return zones.status === "loaded" && zones.matches.length > 0
    ? ` · ${zones.matches.length} mapped`
    : "";
}

const SOURCES_NOTE =
  "Records indicate; verify current ownership, eligibility, and condition with the county before relying. " +
  "Ownership type is inferred from public taxpayer-of-record patterns — no owner names appear.";

/**
 * Build the full structured site-card HTML. `zip` powers the Opportunity Area
 * link; `asOf` (optional) prints the records-as-of line. Native <details>
 * accordions render fine inside the mapbox popup HTML string.
 */
export function buildSiteCardHtml(
  d: CardData,
  zip: string,
  asOf: string | null,
  options: SiteCardOptions = {},
): string {
  const zones: SiteZoneState = options.zones ?? { status: "idle" };
  const propertyLabel = PROPERTY_TYPE_LABELS[d.propertyType] ?? "Vacant site";
  const addressText = d.address && d.address.trim() ? d.address.trim() : "Address not recorded";

  const label = (text: string) =>
    `<div style="font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:${CARD_FAINT};font-weight:600;margin-bottom:5px">${escapeHtml(text)}</div>`;

  // ── 1 · Glance: address, then property type + approximate size ──
  const sizeClause =
    d.squareFeet != null && Number.isFinite(d.squareFeet)
      ? ` · about ${approxSqft(d.squareFeet).toLocaleString("en-US")} sq ft`
      : "";
  // Admin-only star. `options.star` is absent for the public, so a non-admin's
  // card carries no star markup at all — not a hidden one.
  const starHtml = options.star
    ? `<button type="button" ${STAR_BUTTON_ATTR}="${escapeHtml(options.star.key)}" aria-pressed="${
        options.star.starred ? "true" : "false"
      }" title="${options.star.starred ? "Remove from starred locations" : "Save to starred locations"}" style="flex-shrink:0;cursor:pointer;background:none;border:1px solid ${
        options.star.starred ? STARRED_RING : `${CARD_INK}25`
      };border-radius:2px;padding:3px 6px;font-size:12px;line-height:1;color:${
        options.star.starred ? STARRED_RING : CARD_FAINT
      }">${options.star.starred ? "★" : "☆"}</button>`
    : "";
  const glance = `
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:${CARD_INK};line-height:1.3">${escapeHtml(addressText)}</div>
        <div style="font-size:11px;color:${CARD_MUTED};margin-top:3px">${escapeHtml(propertyLabel)}${escapeHtml(sizeClause)}</div>
      </div>
      ${starHtml}
    </div>
  `;

  // ── 2 · Significance (one sentence) ──
  const significance = `
    <div style="margin-top:11px;font-size:12px;color:${CARD_INK};line-height:1.45">${escapeHtml(significanceSentence(d))}</div>
  `;

  // ── 3 · At most one caution ──
  const caution = cautionLine(d);
  const cautionBlock = caution
    ? `<div style="margin-top:11px">${label("Needs checking")}<div style="font-size:11px;color:${DISTRESS_RED};line-height:1.4"><span style="margin-right:5px">◉</span>${escapeHtml(caution)}</div></div>`
    : "";

  // ── 4 · Next step + ONE primary action ──
  const cookViewer = cookViewerUrl(d.pin);
  const clerk = clerkRecordsUrl(d.pin);
  const btnStyle = `display:inline-block;font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:white;background:${CARD_INK};border:1px solid ${CARD_INK};padding:5px 9px;border-radius:2px;cursor:pointer;text-decoration:none`;
  const linkStyle = `font-size:10px;color:${CARD_BLUE};text-decoration:none`;
  let primaryHtml = "";
  let secondaryHtml = "";
  if (cookViewer && clerk) {
    if (emphasizesDeed(d)) {
      primaryHtml = `<a href="${escapeHtml(clerk)}" target="_blank" rel="noopener noreferrer" style="${btnStyle}">Review deed history ↗</a>`;
      secondaryHtml = `<a href="${escapeHtml(cookViewer)}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Parcel record ↗</a>`;
    } else {
      primaryHtml = `<a href="${escapeHtml(cookViewer)}" target="_blank" rel="noopener noreferrer" style="${btnStyle}">Check parcel record ↗</a>`;
      secondaryHtml = `<a href="${escapeHtml(clerk)}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Deed history ↗</a>`;
    }
  } else if (cookViewer) {
    primaryHtml = `<a href="${escapeHtml(cookViewer)}" target="_blank" rel="noopener noreferrer" style="${btnStyle}">Check parcel record ↗</a>`;
  } else {
    // 311 rows carry no PIN — no external record link is possible.
    secondaryHtml = `<span style="font-size:10px;color:${CARD_FAINT}">No county PIN on record yet.</span>`;
  }
  const nextStep = `
    <div style="margin-top:12px;border:1px solid ${CARD_INK}25;border-left:3px solid ${CARD_INK};padding:8px 9px;background:${CARD_INK}05">
      ${label("Next step")}
      <div style="font-size:12px;color:${CARD_INK};line-height:1.4">${escapeHtml(nextStepAction(d))}</div>
      <div style="margin-top:7px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">${primaryHtml}${secondaryHtml}</div>
    </div>
  `;

  // ── 5 · Opportunity-area cross-link ──
  const areaLink =
    d.clusterId != null
      ? `<div style="margin-top:10px"><a href="/vacancy/${encodeURIComponent(zip)}/areas/${d.clusterId}" style="font-size:11px;font-weight:600;color:${CARD_BLUE};text-decoration:none">View its opportunity area →</a></div>`
      : "";

  // ── 6 · Progressive disclosure (native <details>) ──
  const summaryStyle = `cursor:pointer;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${CARD_MUTED};font-weight:600;padding:6px 0`;
  const detailBodyStyle = `font-size:11px;color:${CARD_MUTED};line-height:1.5;padding:0 0 6px 0`;
  const detail = (summary: string, body: string) =>
    `<details style="border-top:1px solid ${CARD_INK}12"><summary style="${summaryStyle}">${escapeHtml(summary)}</summary><div style="${detailBodyStyle}">${body}</div></details>`;

  // 6a · Site facts
  const siteFacts = detail(
    "Site facts",
    [
      `Lot size: ${d.squareFeet != null && Number.isFinite(d.squareFeet) ? `${d.squareFeet.toLocaleString("en-US")} sq ft` : "Not recorded"}`,
      `PIN: ${d.pin ? `<span style="font-family:${MONO_STACK}">${escapeHtml(d.pin)}</span>` : "No PIN on record"}`,
      `Type: ${escapeHtml(propertyLabel)}`,
    ]
      .map((r) => `<div>${r}</div>`)
      .join(""),
  );

  // 6b · Programs and zones — the live place-based coverage for this point.
  //      Built explicitly (not via `detail`) because two of its parts are
  //      patched in place when the async lookup lands: the summary badge and
  //      the row body. See ZONE_BADGE_ATTR / ZONE_SLOT_ATTR.
  const reportLink =
    d.lat != null && d.lon != null && Number.isFinite(d.lat) && Number.isFinite(d.lon)
      ? `<div style="margin-top:5px"><a href="${escapeHtml(
          siteReportHref(d.lat, d.lon, d.address),
        )}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">Full address report &#8599;</a></div>`
      : "";
  const programs =
    `<details style="border-top:1px solid ${CARD_INK}12">` +
    `<summary style="${summaryStyle}">Programs and zones<span ${ZONE_BADGE_ATTR}>${escapeHtml(
      zoneBadgeText(zones),
    )}</span></summary>` +
    `<div style="${detailBodyStyle}">` +
    `<div ${ZONE_SLOT_ATTR}>${programsAndZonesRows(d, zones)
      .map((r) => `<div>${r}</div>`)
      .join("")}</div>${reportLink}` +
    `</div></details>`;

  // 6c · Why it was flagged (real-field reasons only — no rank or badge)
  const whyFlagged = detail(
    "Why it was flagged",
    flagReasons(d)
      .map((r) => `<div>• ${escapeHtml(r)}</div>`)
      .join(""),
  );

  // 6d · Data and sources (ownership type lives here — off the headline)
  const ownerLabel = PUBLIC_OWNER_TYPE_LABELS[d.ownerType] ?? PUBLIC_OWNER_TYPE_LABELS.unknown;
  const ownerColor = OWNER_TYPE_COLORS[d.ownerType] ?? OWNER_TYPE_COLORS.unknown;
  const axisLine =
    d.ownerStructure && d.ownerGeography
      ? `<div>Structure · location: ${escapeHtml(OWNER_STRUCTURE_LABELS[d.ownerStructure])} · ${escapeHtml(OWNER_GEOGRAPHY_LABELS[d.ownerGeography])} <span style="color:${CARD_FAINT}">(taxpayer mailing)</span></div>`
      : "";
  const dataSources = detail(
    "Data and sources",
    [
      asOf ? `<div>Records as of ${escapeHtml(asOf)}</div>` : "",
      `<div>Ownership type: <span style="color:${ownerColor};font-weight:600">${escapeHtml(ownerLabel)}</span> — ${escapeHtml(OWNER_CONFIDENCE_LINE[d.ownerConfidence])}</div>`,
      axisLine,
      `<div style="color:${CARD_FAINT};margin-top:4px">${escapeHtml(SOURCES_NOTE)}</div>`,
    ].join(""),
  );

  const body = `${glance}${significance}${cautionBlock}${nextStep}${areaLink}<div style="margin-top:10px">${siteFacts}${programs}${whyFlagged}${dataSources}</div>`;

  // The GUARANTEE half of the viewport fit: cap the card to the map frame and
  // scroll the overflow inside it, so a fully-expanded card can never run its
  // lower sections off screen — including on a phone, where no amount of
  // panning would seat it. `overscroll-behavior:contain` keeps a scroll that
  // reaches the end of the card from chaining out to the page.
  const cap = options.maxHeightPx;
  const scroller =
    cap != null && Number.isFinite(cap) && cap > 0
      ? `<div ${CARD_SCROLLER_ATTR} style="max-height:${Math.floor(cap)}px;overflow-y:auto;overscroll-behavior:contain">${body}</div>`
      : body;

  return `<div style="font-family:Inter,sans-serif;max-width:300px">${scroller}</div>`;
}

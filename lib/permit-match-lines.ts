/**
 * MATCHED BUILDING PERMIT RECORD — the copy.
 *
 * Every sentence and label the "Matched building permit record" block renders
 * lives here, exactly the way lib/site-activity-lines.ts owns the site-activity
 * copy, so the map card, any future report surface, and the tests read one
 * source of truth and cannot drift.
 *
 * ── Honesty rails baked into this module ──
 *
 * 1. `reported_cost` is the APPLICANT'S OWN ESTIMATE on the permit application.
 *    It is labeled {@link PERMIT_COST_LABEL} at every appearance and it is
 *    NEVER summed. There is no total, no rollup, no "permitted investment"
 *    figure — not here, not in the card, not in any export. Permits are
 *    evidence that a filing happened; they are not dollars awarded, committed,
 *    or spent, and one applicant estimate added to another produces a number
 *    that means nothing while looking like a capital total.
 *
 * 2. A permit is a FILING, not construction. {@link PERMIT_VERIFICATION_NOTE}
 *    says so verbatim and always renders with a match.
 *
 * 3. An absence is stated as an absence, with the window that was actually
 *    queried. {@link PERMIT_NO_MATCH_TEXT} is derived from `SINCE_DATE` in
 *    lib/ingest/permits.ts — the same constant the fetch uses — so the card can
 *    never advertise a window the ingest did not query.
 *
 * 4. A lookup that did not complete says so ({@link PERMIT_MATCH_ERROR_TEXT});
 *    it must never render as "no permit record", which would read as a fact
 *    about the parcel rather than a fact about the request.
 */

import {
  PERMIT_MATCH_CONFIDENCE_LABELS,
  PERMIT_MATCH_METHOD_LABELS,
  PERMIT_SINCE_DATE,
  type MatchedPermit,
} from "./permit-match";

/** The queried window, rendered from the constant the ingest actually uses. */
export const PERMIT_DATA_WINDOW_LABEL = `${PERMIT_SINCE_DATE.slice(0, 4)}–Present`;

/** Section heading. */
export const PERMIT_SECTION_TITLE = "Matched building permit record";

/** The applicant-estimate qualifier. Required at every appearance of the cost. */
export const PERMIT_COST_LABEL = "(Applicant Estimate)";

/** Provenance line. */
export const PERMIT_DATA_SOURCE_TEXT = "City of Chicago Building Permits (ydr8-5enu)";

/** The city's public permit + inspection record search. */
export const PERMIT_PORTAL_URL = "https://webapps1.chicago.gov/buildingrecords/";
export const PERMIT_PORTAL_LABEL = "City of Chicago permit portal";

/** Verbatim, non-negotiable. Renders with every match. */
export const PERMIT_VERIFICATION_NOTE =
  "A recent permit record was matched to this parcel. Permit issuance does not guarantee work has commenced or finished. Verify current site conditions in person before outreach or capital commitments.";

/** Required whenever the only link is a nearby point rather than PIN/address. */
export const PERMIT_PROXIMITY_WARNING =
  "Location-only match: this filing may belong to a neighboring parcel. Confirm the permit address or PIN in the City record before relying on it.";

/** Verbatim absence, carrying the window the ingest genuinely queried. */
export const PERMIT_NO_MATCH_TEXT = `No matched permit record in current data window (${PERMIT_DATA_WINDOW_LABEL}).`;

/** In-flight. */
export const PERMIT_MATCH_CHECKING_TEXT = "Checking matched permit records…";

/** Failed lookup — never an absence. */
export const PERMIT_MATCH_ERROR_TEXT =
  "Could not check permit records right now — open the City of Chicago permit portal to verify.";

/** A rendered label/value pair from the matched record. */
export interface PermitDetailLine {
  label: string;
  value: string;
}

/** ISO-ish date → "Mar 15, 2024"; anything unparseable renders as recorded. */
export function formatPermitDate(issueDate: string | null): string {
  if (!issueDate) return "Not recorded";
  const d = new Date(issueDate);
  if (Number.isNaN(d.getTime())) return issueDate;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The reported cost, always qualified. Returns "Not recorded" for null so the
 * row is never silently dropped (a missing estimate is a fact about the filing).
 */
export function formatPermitCost(reportedCost: number | null): string {
  if (reportedCost == null || !Number.isFinite(reportedCost)) {
    return `Not recorded ${PERMIT_COST_LABEL}`;
  }
  return `$${Math.round(reportedCost).toLocaleString("en-US")} ${PERMIT_COST_LABEL}`;
}

/** "Parcel PIN · High confidence". */
export function formatMatchBasis(permit: MatchedPermit): string {
  return `${PERMIT_MATCH_METHOD_LABELS[permit.matchMethod]} · ${
    PERMIT_MATCH_CONFIDENCE_LABELS[permit.matchConfidence]
  }`;
}

/** Match-specific caution. Stronger identity joins do not need this warning. */
export function permitMatchWarning(permit: MatchedPermit): string | null {
  return permit.matchMethod === "spatial_proximity" ? PERMIT_PROXIMITY_WARNING : null;
}

/** The permit's work type/description, or the permit type, or an honest blank. */
function permitTypeValue(permit: MatchedPermit): string {
  return permit.permitType ?? permit.workType ?? "Not recorded";
}

/**
 * The permit's status.
 *
 * `permit_status` is a clean enum on this dataset — verified against the loaded
 * citywide table: COMPLETE / ACTIVE / EXPIRED / SUSPENDED / PHASED PERMITTING /
 * CANCELLED / REVOKED. `permit_milestone` is a progress stage (INSPECTIONS,
 * CERTIFICATE OF OCCUPANCY ISSUED, ...) and qualifies the status usefully, so it
 * is appended when it says something the status does not.
 *
 * `permit_condition` is deliberately NOT shown here, and must not be added.
 * Despite the name it is not a status at all — it holds free-text plan-review
 * and inspector conditions, e.g. paragraphs of electrical-code notes, and in
 * some rows a street-address range. Rendering it on a line labeled "Permit
 * status" would print an address or a code note where the reader expects a
 * state. It is still ingested (it is genuine permit metadata); it simply has no
 * place on this line.
 */
function permitStatusValue(permit: MatchedPermit): string {
  const status = permit.permitStatus?.trim() ?? "";
  const milestone = permit.permitMilestone?.trim() ?? "";
  if (status && milestone && status.toUpperCase() !== milestone.toUpperCase()) {
    return `${status} · ${milestone}`;
  }
  // De-duplicate: the dataset very often repeats the same word across both
  // (e.g. status COMPLETE, milestone COMPLETE), and printing it twice reads as
  // two independent confirmations.
  return status || milestone || "Not recorded";
}

/**
 * The six substantive rows of the block, in fixed order. Fixed template over
 * real fields — a value that is not recorded says so rather than vanishing,
 * because a missing row would let the reader assume the field was checked and
 * came back clean.
 */
export function permitDetailLines(permit: MatchedPermit): PermitDetailLine[] {
  return [
    { label: "Type", value: permitTypeValue(permit) },
    { label: "Date issued", value: formatPermitDate(permit.issueDate) },
    { label: "Reported cost", value: formatPermitCost(permit.reportedCost) },
    { label: "Permit status", value: permitStatusValue(permit) },
    { label: "Permit #", value: permit.permitId },
    { label: "Match basis", value: formatMatchBasis(permit) },
  ];
}

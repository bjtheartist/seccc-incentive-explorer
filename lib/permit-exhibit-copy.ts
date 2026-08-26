/**
 * lib/permit-exhibit-copy.ts — REVIEWED COPY for the Permit History Exhibit
 * (master spec, "Product posture" + S4). Every user-facing sentence on this
 * surface that is not a raw data value comes from here, so the whole
 * surface can be reviewed as one small, auditable list rather than prose
 * scattered across components. Registered in lib/public-claim-surfaces.ts
 * under the "permit-exhibit" entry's `reviewed-copy` contract.
 *
 * EVIDENCE, NEVER CONCLUSION: nothing here argues, scores, or opines on a
 * zoning outcome. No eligibility language, no "supports your case" copy.
 */

export const PERMIT_EXHIBIT_EYEBROW = "Community evidence brief · public records";

export const PERMIT_EXHIBIT_UPL_SAFE_LINE =
  "A research aid for the attorney or expediter preparing a zoning matter — variations, " +
  "special uses, nonconforming-use continuity, appeals. This exhibit assembles the " +
  "traceable public record; it does not argue, score, or opine on a zoning outcome. " +
  "Prepared for verification against the City's own records.";

/** The exact, pinned label for every cost figure on this surface. Never a
 *  total, never an average — see the walker test in
 *  lib/__tests__/permit-exhibit-cost-label.test.ts. */
export const PERMIT_EXHIBIT_COST_LABEL = "Estimated cost (self-reported to City)";

export const PERMIT_EXHIBIT_PROXIMITY_HEADING = "Nearby, not matched to this parcel";

export const PERMIT_EXHIBIT_PROXIMITY_NOTE =
  "These permits fall within the search radius but their point does not fall inside the " +
  "subject parcel and their address does not match its situs address. They are evidence " +
  "about the area, not about this parcel, and must never be read as a parcel match.";

export const PERMIT_EXHIBIT_S3_HONEST_LIMIT =
  "District boundaries in effect at each permit's issue date are not yet reconstructable " +
  "from this tool; verify era-specific zoning with the City's ordinance record.";

export const PERMIT_EXHIBIT_LIMITS: readonly string[] = [
  "A permit shows work was authorized. It does not show that a use occurred or continued. " +
    "Business licenses, certificates of occupancy, utility records, photographs, and sworn " +
    "affidavits are the usual companion evidence.",
  "The absence of a permit is not evidence of absence: the City's electronic permit record " +
    "thins sharply before the mid-2000s, and unpermitted work occurs.",
  "This exhibit is a derivative of the public record, not the record itself. Verify every " +
    "row against the City's own dataset at the linked source.",
];

export function permitExhibitVintageSentence(exhibitId: string): string {
  return (
    `Exhibit ${exhibitId}. Regenerating after a data refresh may include newer permits; ` +
    "the snapshot date above identifies this exhibit's data vintage."
  );
}

export const PERMIT_EXHIBIT_SOURCE_LABEL = "City of Chicago Building Permits (ydr8-5enu)";
export const PERMIT_EXHIBIT_SOURCE_URL =
  "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data";

/**
 * Per-row deep link into the City's own Socrata data portal, filtered to
 * this exact permit number — verified live 2026-08-25: the portal's SoQL
 * "explore/query" URL scheme filters the published Building Permits
 * dataset to `permit_ = "<permitNumber>"` and renders a one-row grid
 * ("Showing row 1 of 1"), so this is a real City record, not a guessed or
 * fabricated link. `permit_` is the dataset's own row identifier
 * (Socrata "Row Identifier: PERMIT#"), so this is a stable per-record link.
 */
export function permitExhibitCityRecordUrl(permitNumber: string): string | null {
  const trimmed = permitNumber.trim();
  if (!trimmed) return null;
  const soql =
    "SELECT\n  `id`,\n  `permit_`,\n  `permit_type`,\n  `issue_date`,\n  `work_description`,\n  `reported_cost`\n" +
    `WHERE \`permit_\` = "${trimmed.replaceAll('"', '\\"')}"`;
  return `https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/explore/query/${encodeURIComponent(soql)}/page/filter`;
}

export const PERMIT_EXHIBIT_ENTRY_SCOPE_STATEMENT =
  "Assembles every City building-permit filing linked to a subject parcel, plus filings " +
  "within a chosen radius, from the traceable public record. It does not argue, score, or " +
  "opine on a zoning outcome — verify every row against the City's own records.";

/** The exhibit page's own header aside: the S4 limits distilled to three
 *  short clauses, so a reader gets the load-bearing caveats before
 *  scrolling to any row — the full-length versions still live, verbatim,
 *  in the S4 footer below. */
export const PERMIT_EXHIBIT_HEADER_SCOPE_STATEMENT =
  "A permit shows authorized work, not a use that occurred or continued. Missing permits " +
  "are not evidence of absence — the City's record thins before the mid-2000s. This exhibit " +
  "is a derivative of the public record; verify every row against the City's own dataset.";

export const PERMIT_EXHIBIT_ENTRY_LINK_TEXT = "Preparing a zoning matter? Build a Permit History Exhibit →";

export const PERMIT_EXHIBIT_UNAVAILABLE_COPY: Record<
  "invalid_pin" | "invalid_radius" | "parcel_not_found" | "unavailable",
  string
> = {
  invalid_pin:
    "That doesn't look like a 14-digit Cook County PIN. Enter the PIN exactly as the County " +
    "publishes it (dashes optional), or look it up from an address below.",
  invalid_radius: "Choose one of the offered search radii.",
  parcel_not_found:
    "No parcel record was found for that PIN. Verify the PIN against the County's own parcel " +
    "records, or look it up from an address below.",
  unavailable:
    "The Permit History Exhibit is temporarily unavailable for this parcel. Retry, or verify " +
    "directly against the City's Building Permits dataset.",
};

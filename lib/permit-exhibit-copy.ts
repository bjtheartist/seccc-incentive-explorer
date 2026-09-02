/**
 * lib/permit-exhibit-copy.ts — REVIEWED COPY that is PR2's OWN (the surface
 * chrome: header, entry page, unavailable states). The S1/S3/S4 verbatim
 * copy the spec pins to the evidence spine (cost label, proximity
 * subsection title, S3 honest-limit line, S4 limits block, coverage note,
 * exhibit-id footer sentence) lives in lib/permit-exhibit.ts and is
 * imported directly from there by the section components — never
 * duplicated here, so there is exactly one place each sentence can drift.
 * Registered in lib/public-claim-surfaces.ts under this surface's
 * `reviewed-copy` contract.
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

/** The exhibit page's own header aside: the S4 limits distilled to three
 *  short clauses, so a reader gets the load-bearing caveats before
 *  scrolling to any row — the full-length versions still live, verbatim,
 *  in the S4 footer below (imported from lib/permit-exhibit.ts). */
export const PERMIT_EXHIBIT_HEADER_SCOPE_STATEMENT =
  "A permit shows authorized work, not a use that occurred or continued. Missing permits " +
  "are not evidence of absence — the City's record thins before the mid-2000s. This exhibit " +
  "is a derivative of the public record; verify every row against the City's own dataset.";

/** S1's proximity subsection gets its own short explanatory sentence — the
 *  spine exports the subsection TITLE (`PERMIT_EXHIBIT_PROXIMITY_SUBSECTION_TITLE`)
 *  but not this longer note, which is PR2's own rendering-layer copy. */
export const PERMIT_EXHIBIT_PROXIMITY_NOTE =
  "These permits fall near the parcel but their point does not fall inside it and their " +
  "address does not match its situs address. They are evidence about the area, not about " +
  "this parcel, and must never be read as a parcel match.";

export const PERMIT_EXHIBIT_ADDRESS_ONLY_NOTE_TEMPLATE =
  "These permits' street address matches a location in this area, but the source record has " +
  "no usable coordinate to confirm the point falls inside the {radius} radius.";

export function permitExhibitAddressOnlyNote(radiusLabel: string): string {
  return PERMIT_EXHIBIT_ADDRESS_ONLY_NOTE_TEMPLATE.replace("{radius}", radiusLabel);
}

export const PERMIT_EXHIBIT_ENTRY_SCOPE_STATEMENT =
  "Assembles every City building-permit filing linked to a subject parcel, plus filings " +
  "within a chosen radius, from the traceable public record. It does not argue, score, or " +
  "opine on a zoning outcome — verify every row against the City's own records.";

export const PERMIT_EXHIBIT_ENTRY_LINK_TEXT = "Preparing a zoning matter? Build a Permit History Exhibit →";

export const PERMIT_EXHIBIT_UNAVAILABLE_COPY: Record<
  "invalid_pin" | "invalid_radius" | "parcel_not_found" | "parcel_geometry_unavailable" | "parcel_source_unavailable" | "database_unavailable" | "unavailable",
  string
> = {
  invalid_pin:
    "That doesn't look like a 14-digit Cook County PIN. Enter the PIN exactly as the County " +
    "publishes it (dashes optional), or look it up from an address below.",
  invalid_radius: "Choose one of the offered search radii.",
  parcel_not_found:
    "No parcel record was found for that PIN. Verify the PIN against the County's own parcel " +
    "records, or look it up from an address below.",
  parcel_geometry_unavailable:
    "The parcel's boundary could not be resolved right now, so the exhibit cannot be built. Retry, " +
    "or verify directly against the City's Building Permits dataset.",
  parcel_source_unavailable:
    "The Cook County parcel lookup is temporarily unavailable. Retry in a moment.",
  database_unavailable:
    "The Permit History Exhibit is temporarily unavailable. Retry, or verify directly against the " +
    "City's Building Permits dataset.",
  unavailable:
    "The Permit History Exhibit is temporarily unavailable for this parcel. Retry, or verify " +
    "directly against the City's Building Permits dataset.",
};

/**
 * Row-cap disclosure chrome (R2 finding 8 follow-up).
 *
 * The disclosure SENTENCE itself is the spine's — `meta.truncation.notice`,
 * built in lib/permit-exhibit.ts alongside the cap that produced it — so it
 * is not duplicated here. What lives here is only the rendering-layer label
 * and the which-query line, i.e. this surface's own chrome, the same split
 * every other constant in this file observes.
 */
export const PERMIT_EXHIBIT_TRUNCATION_LABEL = "Incomplete read · counts below are a floor";

export function permitExhibitTruncationScopeLine(
  scope: "subject" | "area" | "both",
  rowCap: number,
): string {
  const cap = rowCap.toLocaleString("en-US");
  if (scope === "both") {
    return `Reached at the ${cap}-record cap on both the subject-parcel read and the radius read.`;
  }
  if (scope === "subject") {
    return `Reached at the ${cap}-record cap on the subject-parcel read.`;
  }
  return `Reached at the ${cap}-record cap on the radius read.`;
}

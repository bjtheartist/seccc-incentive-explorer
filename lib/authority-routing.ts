/**
 * lib/authority-routing.ts — build-spec.md 2.4 (audit F10; consult item 12's
 * "typed authority registry" instruction).
 *
 * Binding authority doctrine: zoning classification/use questions route to
 * ZBA; building condition/permits route to DOB; licensing routes to BACP;
 * TIF routes to DPD only. An unresolved zoning question must never be
 * routed to a generic "City or a zoning professional" — the Zoning Board of
 * Appeals is the specific body that resolves a Title 17 use-category
 * question. `buildZoningHandoff` (below) injects the ZBA link itself so a
 * caller cannot omit it by passing an arbitrary `officialLinks` array —
 * that was the exact defect the audit found (ZoningReviewQuestions.tsx's
 * supplied official links omit ZBA; handoff-pdf.ts renders the same
 * structure verbatim).
 */

export type AuthorityDomain = "zoning" | "condition" | "licensing" | "tif";

export interface AuthorityRoute {
  domain: AuthorityDomain;
  /** The specific body/department name — never "the City" alone. */
  name: string;
  abbreviation: string;
  /** What this authority actually resolves — used in generated copy. */
  resolves: string;
  url: string;
}

export const AUTHORITY_ROUTING: Readonly<Record<AuthorityDomain, AuthorityRoute>> = {
  zoning: {
    domain: "zoning",
    name: "Chicago Zoning Board of Appeals",
    abbreviation: "ZBA",
    resolves: "zoning classification and use-permission questions (which Title 17 use category applies, whether it is permitted by-right, and any required zoning relief)",
    url: "https://www.chicago.gov/city/en/depts/dcd/provdrs/zoning/svcs/zoning_board_of_appeals.html",
  },
  condition: {
    domain: "condition",
    name: "Chicago Department of Buildings",
    abbreviation: "DOB",
    resolves: "building-condition and permit questions (which permit/review program applies, inspection status, code compliance)",
    url: "https://www.chicago.gov/city/en/depts/bldgs.html",
  },
  licensing: {
    domain: "licensing",
    name: "Chicago Department of Business Affairs and Consumer Protection",
    abbreviation: "BACP",
    resolves: "business licensing questions",
    url: "https://www.chicago.gov/city/en/depts/bacp.html",
  },
  tif: {
    domain: "tif",
    name: "Chicago Department of Planning and Development",
    abbreviation: "DPD",
    resolves: "TIF-district and Redevelopment Agreement questions",
    url: "https://www.chicago.gov/city/en/depts/dcd/provdrs/tif.html",
  },
};

export function authorityFor(domain: AuthorityDomain): AuthorityRoute {
  return AUTHORITY_ROUTING[domain];
}

/** One rendered "confirm with <name> (<abbreviation>)" reference — the
 *  routing-safe replacement for any hand-authored "City or a zoning
 *  professional" / "administering agency" placeholder in zoning copy. */
export function authorityReferenceLine(domain: AuthorityDomain): string {
  const authority = authorityFor(domain);
  return `${authority.name} (${authority.abbreviation})`;
}

export interface OfficialLink {
  label: string;
  url: string;
}

/**
 * Build the official-links list for a zoning handoff (stage-handoff.ts /
 * handoff-pdf.ts / ZoningReviewQuestions.tsx). The ZBA link is ALWAYS the
 * first entry and cannot be omitted — `extraLinks` can only ADD to the
 * list, never replace the ZBA entry. This is the actual fix for F10: the
 * caller-supplied `officialLinks` array that previously omitted ZBA is no
 * longer how the list gets built.
 */
export function buildZoningOfficialLinks(extraLinks: OfficialLink[] = []): OfficialLink[] {
  const zba = authorityFor("zoning");
  return [{ label: `${zba.name} (${zba.abbreviation})`, url: zba.url }, ...extraLinks];
}

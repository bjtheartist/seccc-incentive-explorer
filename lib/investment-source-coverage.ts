import type {
  CommunityInvestmentMeta,
  InvestmentSource,
} from "./community-investment";

export const COVERAGE_STATES = [
  "complete_published",
  "partial",
  "aggregate_only",
  "awaiting_publication",
  "quarantined",
] as const;

export type CoverageState = (typeof COVERAGE_STATES)[number];
export type CoverageDimension = "capture" | "map_detail" | "refresh" | "review";

export const COVERAGE_STATE_LABELS: Record<CoverageState, string> = {
  complete_published: "Complete for published source",
  partial: "Partial",
  aggregate_only: "Aggregate only",
  awaiting_publication: "Awaiting publication",
  quarantined: "Quarantined",
};

export const COVERAGE_DIMENSION_LABELS: Record<CoverageDimension, string> = {
  capture: "Source capture",
  map_detail: "Map detail",
  refresh: "Refresh posture",
  review: "Review posture",
};

export interface CoverageCell {
  state: CoverageState;
  detail: string;
}

export interface SourceCoverageRow {
  id: string;
  name: string;
  sources: InvestmentSource[];
  releasedRecords: number;
  cadence: string;
  coverage: Record<CoverageDimension, CoverageCell>;
}

interface CoverageDefinition {
  id: string;
  name: string;
  sources: InvestmentSource[];
  cadence: string;
  coverage: Record<CoverageDimension, CoverageCell>;
}

const complete = (detail: string): CoverageCell => ({ state: "complete_published", detail });
const partial = (detail: string): CoverageCell => ({ state: "partial", detail });
const aggregate = (detail: string): CoverageCell => ({ state: "aggregate_only", detail });
const awaiting = (detail: string): CoverageCell => ({ state: "awaiting_publication", detail });
const quarantined = (detail: string): CoverageCell => ({ state: "quarantined", detail });

/**
 * Source postures are intentionally categorical. They restate the committed
 * refresh ledger and export contract; they do not divide by a moving or inferred
 * denominator, and they never expose a held recipient row.
 */
const DEFINITIONS: readonly CoverageDefinition[] = [
  {
    id: "city-completions",
    name: "NOF and SBIF completion feeds",
    sources: ["nof-small", "nof-large", "sbif"],
    cadence: "Monthly automatic, human-reviewed PR",
    coverage: {
      capture: complete("The export pulls the complete published City completion feeds inside each program's documented inclusion window."),
      map_detail: partial("Only records carrying usable source coordinates can appear as property points; any excluded coordinate rows remain counted in export diagnostics."),
      refresh: awaiting("The next change enters after the City source publishes it and the monthly refresh PR is reviewed."),
      review: complete("Record floors, source windows, and the generated export are checked before a refresh is accepted."),
    },
  },
  {
    id: "community-development-grants",
    name: "Community Development Grant awards",
    sources: ["cdg"],
    cadence: "Per public announcement",
    coverage: {
      capture: partial("Awards are assembled from public announcement rounds because the City does not publish one complete machine-readable award table."),
      map_detail: partial("Published addresses are geocoded when possible; an unsuccessful geocode is not replaced with a guessed point."),
      refresh: awaiting("A new round enters only after an official award announcement is published and reviewed."),
      review: complete("Released rows retain their announcement provenance and pass the export's geocode and amount checks."),
    },
  },
  {
    id: "foundation-filings",
    name: "Private foundation grant filings",
    sources: ["foundation"],
    cadence: "Annual manual filing refresh",
    coverage: {
      capture: partial("Published itemized grants are included after filing reconciliation. Aggregate-only schedules and non-itemized attachments cannot be represented as grant rows."),
      map_detail: partial("A grant is mapped only when its published recipient location is usable; intermediary and non-point-safe rows remain citywide."),
      refresh: awaiting("The next tax-year tranche depends on IRS filing publication and a manual parse and reconciliation pass."),
      review: quarantined("Attachment gaps, filer-address artifacts, bookkeeping labels, and other unresolved rows are held outside the export until they can be represented faithfully."),
    },
  },
  {
    id: "major-developments",
    name: "Major private developments",
    sources: ["development"],
    cadence: "Per verified announcement",
    coverage: {
      capture: partial("This is a curated set of source-verified major developments, not a census of every private project in Chicago."),
      map_detail: partial("Only developments with a defensible site point are mapped; no location is inferred from a company address."),
      refresh: awaiting("Projects change when a verified announcement, filing, or status source is published."),
      review: complete("Released projects carry source links and keep announced private capital separate from awarded public or philanthropic dollars."),
    },
  },
  {
    id: "tif-projects",
    name: "TIF RDA and IGA projects",
    sources: ["tif"],
    cadence: "Monthly automatic, human-reviewed PR",
    coverage: {
      capture: complete("The export uses the complete published RDA and IGA project dataset for its current source snapshot."),
      map_detail: partial("Rows without usable published coordinates are counted in diagnostics and are not plotted at a substitute location."),
      refresh: awaiting("The next source change enters through the monthly reviewed refresh PR."),
      review: complete("TIF assistance remains a council-authorized ceiling and is never relabeled or summed as an awarded grant."),
    },
  },
  {
    id: "hud-cpd",
    name: "HUD CDBG and HOME activities",
    sources: ["cdbg-home"],
    cadence: "Monthly automatic, human-reviewed PR",
    coverage: {
      capture: complete("The published HUD activity feeds are pulled for Chicago's entitlement-grantee identifier rather than a fragile city-name filter."),
      map_detail: partial("Activities whose published coordinates fall outside Chicago are excluded from the map and counted in diagnostics."),
      refresh: awaiting("The next upstream activity snapshot enters through the monthly reviewed refresh PR."),
      review: complete("Federal program allocations stay in their own capital class and are never combined with grant awards."),
    },
  },
  {
    id: "lihtc",
    name: "Low-Income Housing Tax Credit placements",
    sources: ["lihtc"],
    cadence: "Annual manual source snapshot",
    coverage: {
      capture: complete("The released rows reflect the complete downloaded HUD LIHTC source snapshot used by the export."),
      map_detail: partial("A placement without usable published coordinates remains outside the point layer and is counted in diagnostics."),
      refresh: awaiting("New placements depend on the next annual public source release and manual import."),
      review: complete("Tax-credit capital remains separate from grants, TIF ceilings, and announced development capital."),
    },
  },
  {
    id: "nmtc",
    name: "New Markets Tax Credit transactions",
    sources: ["nmtc"],
    cadence: "Annual manual source snapshot",
    coverage: {
      capture: complete("The released rows reflect the complete CDFI Fund public-data snapshot used by the export."),
      map_detail: aggregate("The public file does not publish a street address. Community context comes from a census-tract centroid stamp; records are never plotted as exact sites."),
      refresh: awaiting("New transactions depend on the next annual public-data release and manual import."),
      review: complete("Transaction capital stays in the tax-credit class and is never added to awarded grants."),
    },
  },
  {
    id: "recovery-aggregates",
    name: "State and county recovery award lists",
    sources: [
      "cook-source-2023",
      "illinois-big",
      "illinois-hospitality-emergency",
      "illinois-b2b",
    ],
    cadence: "Closed and frozen by design",
    coverage: {
      capture: complete("The committed row counts are pinned to the final published recipient lists for these closed programs."),
      map_detail: aggregate("The source lists publish ZIP or municipality rather than street addresses, so records render only as ZIP aggregates or citywide context."),
      refresh: complete("These programs are closed; the frozen source contracts change only if an official correction is verified."),
      review: complete("Historical recovery amounts remain in a separate recovery field and never inflate the ordinary awarded-capital analysis."),
    },
  },
  {
    id: "sba-rrf",
    name: "SBA Restaurant Revitalization Fund",
    sources: ["sba-rrf"],
    cadence: "Closed and frozen by design",
    coverage: {
      capture: complete("The committed source contract is pinned to the published SBA FOIA recipient dataset and its explicit Chicago subset."),
      map_detail: partial("Published Chicago addresses plot only after a successful in-boundary geocode; unmatched records remain citywide rather than guessed."),
      refresh: complete("The program is closed; the frozen source contract changes only if an official correction is verified."),
      review: complete("RRF is labeled as historical ARPA assistance and excluded from the ordinary current/base investment analysis."),
    },
  },
  {
    id: "dceo-capital",
    name: "DCEO capital appropriations",
    sources: ["dceo-capital"],
    cadence: "Quarterly manual PDF snapshot",
    coverage: {
      capture: partial("The export retains high-confidence Chicago records from a statewide appropriation listing and does not treat ambiguous geography as a Chicago project."),
      map_detail: partial("One explicit in-boundary address can plot; multi-site, failed-geocode, and non-point-safe records remain citywide."),
      refresh: awaiting("The next snapshot depends on a newly published quarterly DCEO PDF and manual import review."),
      review: complete("Published balances remain appropriation context, not active opportunities, award payments, or amounts a user could receive."),
    },
  },
] as const;

export function buildSourceCoverageRows(meta: CommunityInvestmentMeta): SourceCoverageRow[] {
  return DEFINITIONS.map((definition) => ({
    ...definition,
    sources: [...definition.sources],
    releasedRecords: definition.sources.reduce(
      (total, source) => total + (meta.counts[source] ?? 0),
      0,
    ),
  }));
}

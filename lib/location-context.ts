import { runConfidenceEngine } from "./confidence-engine";
import { orderProgramCheckResultsByProjectGoal } from "./project-fit";
import type { LocalBusinessSupportContext } from "./local-business-support";
import type {
  NeighborhoodEconomicContext,
  ReportCensusData,
  ReportZoningData,
} from "./report-engine";
import type { SiteSignals } from "./site-signals";
import type { TifFinanceContext } from "./tif-finance";
import type { TransportAccess } from "./transport-access";
import type { MobilityAccess } from "./mobility-access";
import type {
  CommunityAsset,
  DistrictData,
  ParcelData,
  Program,
  ProgramCheckResult,
  StackingRule,
  Stats,
} from "./types";

export const LOCATION_CONTEXT_VERSION = "location-context.v1";

export type LocationContextClaimKind =
  | "measured"
  | "modeled"
  | "proximity"
  | "partner_verified"
  | "derived"
  | "user_provided"
  | "needs_verification";

export interface LocationContextSource {
  id: string;
  label: string;
  url?: string;
  freshness?: string;
}

export interface LocationContextClaim<T> {
  key: string;
  label: string;
  kind: LocationContextClaimKind;
  value: T;
  confidence?: string;
  freshness?: string;
  sourceIds: string[];
  caveat?: string;
}

export type PublicParcelContext = Omit<ParcelData, "ownerName" | "ownerMailingAddress">;
export type LocationContextTifFinance = TifFinanceContext | NonNullable<NeighborhoodEconomicContext["tifFinance"]>;

export interface LocationContextState {
  reportType?: string | null;
  address?: string;
  lat?: number | null;
  lon?: number | null;
  neighborhood?: string;
  industry?: string;
  projectType?: string;
  proposedUse?: string;
  siteControl?: string;
  documentsAvailable?: string[];
  supportNeeded?: string[];
}

export interface LocationContextInput {
  zones?: Record<string, boolean>;
  zoneNames?: Record<string, string>;
  census?: ReportCensusData;
  cityZoning?: ReportZoningData;
  parcel?: ParcelData | null;
  districts?: DistrictData;
  stackingRules?: StackingRule[];
  communityAssets?: CommunityAsset[];
  localBusinessSupport?: LocalBusinessSupportContext | null;
  stats?: Stats;
  neighborhoodEconomics?: NeighborhoodEconomicContext;
  siteSignals?: SiteSignals | null;
  transport?: TransportAccess | null;
  mobilityAccess?: MobilityAccess | null;
  tifFinance?: TifFinanceContext | null;
}

export interface LocationContext {
  version: typeof LOCATION_CONTEXT_VERSION;
  posture: "internal";
  input: {
    reportType?: string | null;
    address?: string;
    lat?: number | null;
    lon?: number | null;
    project?: {
      industry?: string;
      projectType?: string;
      proposedUse?: string;
      siteControl?: string;
      documentsAvailable?: string[];
      supportNeeded?: string[];
    };
  };
  geography: {
    zones: LocationContextClaim<string[]>;
    zoneNames: Record<string, string>;
    census?: LocationContextClaim<ReportCensusData>;
    cityZoning?: LocationContextClaim<ReportZoningData>;
    parcel?: LocationContextClaim<PublicParcelContext>;
    districts?: LocationContextClaim<DistrictData>;
  };
  programs: {
    checked: LocationContextClaim<ProgramCheckResult[]>;
    topMatches: ProgramCheckResult[];
  };
  site: {
    siteSignals?: LocationContextClaim<SiteSignals>;
    transport?: LocationContextClaim<TransportAccess>;
    mobilityAccess?: LocationContextClaim<MobilityAccess>;
    tifFinance?: LocationContextClaim<LocationContextTifFinance>;
  };
  neighborhood: {
    economics?: LocationContextClaim<NeighborhoodEconomicContext>;
    localSupport?: LocationContextClaim<LocalBusinessSupportContext>;
    communityAssets?: LocationContextClaim<CommunityAsset[]>;
    stats?: LocationContextClaim<Stats>;
  };
  sources: LocationContextSource[];
  trust: {
    caveats: string[];
    claimTypes: Record<LocationContextClaimKind, string>;
  };
}

const SOURCE_REGISTRY: Record<string, LocationContextSource> = {
  zones: {
    id: "zones",
    label: "Incentive zone boundaries",
    url: "https://data.cityofchicago.org",
    freshness: "Application boundary dataset",
  },
  census: {
    id: "census",
    label: "U.S. Census / EPA Smart Location context",
    url: "https://data.census.gov",
    freshness: "Latest available public estimate in app context",
  },
  zoning: {
    id: "zoning",
    label: "City of Chicago zoning",
    url: "https://gisapps.chicago.gov/arcgis/rest/services",
    freshness: "Live or cached city GIS lookup",
  },
  parcel: {
    id: "parcel",
    label: "Cook County Assessor parcel record",
    url: "https://www.cookcountyassessoril.gov",
    freshness: "Latest available parcel lookup",
  },
  districts: {
    id: "districts",
    label: "Political district lookup",
    freshness: "Application district lookup",
  },
  programs: {
    id: "programs",
    label: "Chicago Incentive Explorer program catalog",
    freshness: "Curated program catalog",
  },
  siteSignals: {
    id: "siteSignals",
    label: "Nearby public-data site signals",
    freshness: "Application proximity scan",
  },
  transport: {
    id: "transport",
    label: "Transportation and logistics access layer",
    freshness: "Application proximity scan",
  },
  mobilityAccess: {
    id: "mobilityAccess",
    label: "Transportation and site access context",
    freshness: "Cached public-source proximity scan",
  },
  tifFinance: {
    id: "tifFinance",
    label: "City of Chicago TIF annual reports",
    url: "https://data.cityofchicago.org/Community-Economic-Development/Tax-Increment-Financing-TIF-Annual-Report-Analysis/qm7s-3ctt",
    freshness: "Latest matched TIF annual report row",
  },
  neighborhoodEconomics: {
    id: "neighborhoodEconomics",
    label: "Neighborhood economic context",
    freshness: "Mixed public-data benchmark and modeled context",
  },
  localBusinessSupport: {
    id: "localBusinessSupport",
    label: "Chicago small business support resource map",
    freshness: "Curated partner/resource map",
  },
  communityAssets: {
    id: "communityAssets",
    label: "Community asset dataset",
    freshness: "Application asset dataset",
  },
  stats: {
    id: "stats",
    label: "Explorer aggregate stats",
    freshness: "Application aggregate dataset",
  },
};

const CLAIM_TYPE_LABELS: Record<LocationContextClaimKind, string> = {
  measured: "Directly measured from a public or curated source.",
  modeled: "Modeled estimate; useful for context, not a verified fact.",
  proximity: "Nearby public-data signal; not an eligibility determination.",
  partner_verified: "Curated or partner-validated record.",
  derived: "Derived from one or more source-backed inputs.",
  user_provided: "Provided by the report user.",
  needs_verification: "Useful lead that should be verified before action.",
};

function activeZoneKeys(zones?: Record<string, boolean>): string[] {
  return Object.entries(zones ?? {})
    .filter(([, active]) => Boolean(active))
    .map(([key]) => key)
    .sort();
}

export function publicParcelContext(parcel: ParcelData): PublicParcelContext {
  const { ownerName: _ownerName, ownerMailingAddress: _ownerMailingAddress, ...safeParcel } = parcel;
  return safeParcel;
}

function uniqueSources(sourceIds: string[], overrides: LocationContextSource[] = []): LocationContextSource[] {
  const overrideMap = new Map(overrides.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const sources: LocationContextSource[] = [];
  for (const id of sourceIds) {
    if (seen.has(id)) continue;
    const source = overrideMap.get(id) ?? SOURCE_REGISTRY[id];
    if (!source) continue;
    seen.add(id);
    sources.push(source);
  }
  return sources;
}

function claim<T>(
  key: string,
  label: string,
  kind: LocationContextClaimKind,
  value: T,
  sourceIds: string[],
  extras: Omit<LocationContextClaim<T>, "key" | "label" | "kind" | "value" | "sourceIds"> = {}
): LocationContextClaim<T> {
  return { key, label, kind, value, sourceIds, ...extras };
}

function supportSourceOverrides(localSupport?: LocalBusinessSupportContext | null): LocationContextSource[] {
  if (!localSupport?.sourceLabel && !localSupport?.sourceUrls?.length) return [];
  return [
    {
      id: "localBusinessSupport",
      label: localSupport.sourceLabel || SOURCE_REGISTRY.localBusinessSupport.label,
      url: localSupport.sourceUrls?.[0],
      freshness: "Curated support-resource source map",
    },
  ];
}

function collectSourceIds(input: LocationContextInput, programResults: ProgramCheckResult[]): string[] {
  return [
    input.zones ? "zones" : null,
    input.census ? "census" : null,
    input.cityZoning ? "zoning" : null,
    input.parcel ? "parcel" : null,
    input.districts ? "districts" : null,
    programResults.length > 0 ? "programs" : null,
    input.siteSignals ? "siteSignals" : null,
    input.transport ? "transport" : null,
    input.tifFinance || input.neighborhoodEconomics?.tifFinance ? "tifFinance" : null,
    input.neighborhoodEconomics ? "neighborhoodEconomics" : null,
    input.localBusinessSupport?.organizations?.length ? "localBusinessSupport" : null,
    input.communityAssets?.length ? "communityAssets" : null,
    input.stats ? "stats" : null,
  ].filter(Boolean) as string[];
}

export function buildLocationContext(
  state: LocationContextState,
  programs: Program[],
  input: LocationContextInput = {}
): LocationContext {
  const programResults = input.zones
    ? runConfidenceEngine(programs, input.zones, input.zoneNames || {}, undefined, input.parcel ?? undefined)
    : [];
  const orderedProgramResults = state.projectType
    ? orderProgramCheckResultsByProjectGoal(programResults, state.projectType, state.industry)
    : programResults;
  const topMatches = orderedProgramResults
    .filter((result) => result.confidence !== "not_applicable")
    .slice(0, 8);
  const zoneKeys = activeZoneKeys(input.zones);
  const tifFinance = input.tifFinance ?? input.neighborhoodEconomics?.tifFinance ?? null;
  const sourceIds = collectSourceIds(input, programResults);

  const context: LocationContext = {
    version: LOCATION_CONTEXT_VERSION,
    posture: "internal",
    input: {
      reportType: state.reportType,
      address: state.address,
      lat: state.lat,
      lon: state.lon,
      project: {
        industry: state.industry,
        projectType: state.projectType,
        proposedUse: state.proposedUse,
        siteControl: state.siteControl,
        documentsAvailable: state.documentsAvailable,
        supportNeeded: state.supportNeeded,
      },
    },
    geography: {
      zones: claim(
        "zones",
        "Matched incentive zones",
        "measured",
        zoneKeys,
        ["zones"],
        {
          confidence: input.zones ? "boundary lookup" : "not loaded",
          caveat: "Zone matches are based on current app boundary layers and should be verified with the administering agency before action.",
        }
      ),
      zoneNames: input.zoneNames ?? {},
    },
    programs: {
      checked: claim(
        "programs",
        "Program fit checks",
        "derived",
        programResults,
        ["programs", ...(input.zones ? ["zones"] : [])],
        {
          confidence: input.zones ? "rules + location context" : "not loaded",
          caveat: "Program fit is discovery guidance, not final eligibility or award approval.",
        }
      ),
      topMatches,
    },
    site: {},
    neighborhood: {},
    sources: uniqueSources(sourceIds, supportSourceOverrides(input.localBusinessSupport)),
    trust: {
      caveats: [
        "The context engine is internal-first and does not expose a public partner or agent API in v1.",
        "Location-based signals show where public data suggests a possible fit; final eligibility depends on project scope, documents, administrator review, and current program rules.",
        "Modeled and proximity signals are contextual leads, not verified outcomes.",
        "Sensitive owner-level and user-entered project details should stay out of public surfaces unless explicitly reviewed.",
      ],
      claimTypes: CLAIM_TYPE_LABELS,
    },
  };

  if (input.census) {
    context.geography.census = claim("census", "Census and market context", "measured", input.census, ["census"]);
  }
  if (input.cityZoning) {
    context.geography.cityZoning = claim("cityZoning", "City zoning", "measured", input.cityZoning, ["zoning"]);
  }
  if (input.parcel) {
    context.geography.parcel = claim(
      "parcel",
      "Parcel record",
      "measured",
      publicParcelContext(input.parcel),
      ["parcel"],
      {
        caveat: "Owner names and owner mailing addresses are intentionally excluded from the public context object.",
      }
    );
  }
  if (input.districts) {
    context.geography.districts = claim("districts", "Political districts", "measured", input.districts, ["districts"]);
  }
  if (input.siteSignals) {
    context.site.siteSignals = claim(
      "siteSignals",
      "Nearby site signals",
      "proximity",
      input.siteSignals,
      ["siteSignals"],
      { caveat: "Nearby funding precedents and environmental records are proximity signals only." }
    );
  }
  if (input.transport) {
    context.site.transport = claim(
      "transport",
      "Logistics access",
      "proximity",
      input.transport,
      ["transport"],
      { caveat: "Distances are straight-line proximity signals, not travel-time or freight-capacity analysis." }
    );
  }
  if (input.mobilityAccess) {
    context.site.mobilityAccess = claim(
      "mobilityAccess",
      "Transportation and site access",
      "proximity",
      input.mobilityAccess,
      ["mobilityAccess"],
      { caveat: "Distances are straight-line proximity signals, not routed travel times or site-access due diligence." }
    );
  }
  if (tifFinance) {
    context.site.tifFinance = claim(
      "tifFinance",
      "TIF finance context",
      "measured",
      tifFinance,
      ["tifFinance"],
      {
        freshness: tifFinance.reportYear ? `Report year ${tifFinance.reportYear}` : undefined,
        caveat: tifFinance.caution || "District-level annual report context; not proof of available funds or project approval.",
      }
    );
  }
  if (input.neighborhoodEconomics) {
    context.neighborhood.economics = claim(
      "neighborhoodEconomics",
      "Neighborhood economic context",
      "modeled",
      input.neighborhoodEconomics,
      ["neighborhoodEconomics"],
      {
        caveat: "Economic context mixes measured public data, benchmarks, and modeled estimates; use it as context, not proof.",
      }
    );
  }
  if (input.localBusinessSupport?.organizations?.length) {
    context.neighborhood.localSupport = claim(
      "localBusinessSupport",
      "Local support network",
      "partner_verified",
      input.localBusinessSupport,
      ["localBusinessSupport"],
      {
        confidence: input.localBusinessSupport.confidence,
        caveat: "Confirm current capacity, service area, language access, and intake path before making a referral.",
      }
    );
  }
  if (input.communityAssets?.length) {
    context.neighborhood.communityAssets = claim(
      "communityAssets",
      "Community assets",
      "measured",
      input.communityAssets,
      ["communityAssets"]
    );
  }
  if (input.stats) {
    context.neighborhood.stats = claim("stats", "Explorer aggregate stats", "derived", input.stats, ["stats"]);
  }

  return context;
}

export function locationContextSources(context: LocationContext): LocationContextSource[] {
  return context.sources;
}

export interface LocationContextMapSummary {
  programs: ProgramCheckResult[];
  siteSignals: SiteSignals | null;
  transport: TransportAccess | null;
  tifFinance: LocationContextTifFinance | null;
}

export function summarizeLocationContextForMap(context: LocationContext): LocationContextMapSummary {
  return {
    programs: context.programs.topMatches.slice(0, 3),
    siteSignals: context.site.siteSignals?.value ?? null,
    transport: context.site.transport?.value ?? null,
    tifFinance: context.site.tifFinance?.value ?? null,
  };
}

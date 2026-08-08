export type LocalBusinessSupportRelationship =
  | "primary_access_point"
  | "secondary_access_point"
  | "legal_support"
  | "nbdc_2025"
  | "cbc_hub"
  | "ssa_provider";

export type LocalSupportLane =
  | "business_navigation"
  | "capital_readiness"
  | "small_business_capital"
  | "housing_homeownership"
  | "property_community_development"
  | "corridor_place_based"
  | "legal_support"
  | "workforce";

export interface LocalBusinessSupportOrganization {
  id?: string;
  name: string;
  primaryType?: string;
  programSubtype?: string;
  relationships: LocalBusinessSupportRelationship[];
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  supportTypes?: string;
  serviceGeography?: string;
  citywideOrRegional?: string;
  validationLevel?: string;
  currentStatus?: string;
  sourceYear?: string;
  lastVerifiedAt?: string;
  supportLanes?: LocalSupportLane[];
  communityAreaNumbers?: string[];
  serviceRegions?: string[];
  reportTypes?: string[];
  projectTypes?: string[];
  proposedUses?: string[];
  requiresProjectContext?: boolean;
  sourceUrls: string[];
}

export interface LocalBusinessSupportRequest {
  communityAreaNumber?: string;
  communityArea?: string;
  region?: string;
  reportType?: string;
  projectType?: string;
  proposedUse?: string;
  /** True when the report address sits inside an SSA or CCSA corridor. */
  storefrontCorridor?: boolean;
}

export interface LocalBusinessSupportContext {
  communityAreaNumber: string;
  communityArea: string;
  region?: string;
  confidence?: string;
  biggestGap?: string;
  coverage?: {
    nbdc?: string;
    sbdc?: string;
    cbc?: string;
    capital?: string;
    corridor?: string;
    nbdcOfficial?: string;
    cbcHub?: string;
    ssa?: string;
  };
  organizations: LocalBusinessSupportOrganization[];
  /** Echoed by the API when the SSA-first storefront reordering applied. */
  storefrontCorridor?: boolean;
  sourceLabel: string;
  sourceUrls: string[];
}

const RELATIONSHIP_WEIGHT: Record<LocalBusinessSupportRelationship, number> = {
  primary_access_point: 100,
  nbdc_2025: 80,
  legal_support: 75,
  ssa_provider: 70,
  secondary_access_point: 60,
  cbc_hub: 50,
};

function bestRelationshipScore(org: LocalBusinessSupportOrganization): number {
  return Math.max(...org.relationships.map((r) => RELATIONSHIP_WEIGHT[r] ?? 0), 0);
}

const CAPITAL_PROJECT_TYPES = new Set([
  "rehab",
  "expansion",
  "equipment",
  "relocation",
  "energy",
  "new-construction",
  "mixed-use",
  "affordable-housing",
  "vacant-acquisition",
]);

const DEVELOPMENT_PROJECT_TYPES = new Set([
  "rehab",
  "new-construction",
  "mixed-use",
  "affordable-housing",
  "vacant-acquisition",
]);

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function includesNormalized(values: string[] | undefined, value: string | undefined): boolean {
  const candidate = normalized(value);
  return Boolean(candidate && values?.some((item) => normalized(item) === candidate));
}

export function inferSupportLanes(
  org: LocalBusinessSupportOrganization,
): LocalSupportLane[] {
  if (org.supportLanes?.length) return [...new Set(org.supportLanes)];

  const haystack = [
    org.primaryType,
    org.programSubtype,
    org.supportTypes,
    org.serviceGeography,
    org.relationships.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const lanes = new Set<LocalSupportLane>();

  if (/legal|entity formation|contracts|intellectual property/.test(haystack)) {
    lanes.add("legal_support");
  }
  if (/loan|lender|capital|financ|grant|micro.?credit/.test(haystack)) {
    lanes.add("capital_readiness");
  }
  if (/cdfi|lender|loan|micro.?credit/.test(haystack)) {
    lanes.add("small_business_capital");
  }
  if (/homeown|housing|mortgage|foreclosure|home repair/.test(haystack)) {
    lanes.add("housing_homeownership");
  }
  if (/real estate|community development|vacan|development planning|property/.test(haystack)) {
    lanes.add("property_community_development");
  }
  if (/workforce|hiring|employment|jobs/.test(haystack)) {
    lanes.add("workforce");
  }
  if (
    org.relationships.some((relationship) =>
      ["primary_access_point", "nbdc_2025", "ssa_provider"].includes(relationship),
    ) || /chamber|corridor|place-based|neighborhood/.test(haystack)
  ) {
    lanes.add("corridor_place_based");
  }
  if (/business|entrepreneur|nbdc|sbdc|chamber|incubator|advis/.test(haystack)) {
    lanes.add("business_navigation");
  }

  if (lanes.size === 0) lanes.add("business_navigation");
  return [...lanes];
}

export function requestedSupportLanes(
  request: LocalBusinessSupportRequest = {},
): LocalSupportLane[] {
  const lanes = new Set<LocalSupportLane>([
    "business_navigation",
    "corridor_place_based",
    "legal_support",
  ]);
  const projectType = normalized(request.projectType);
  const proposedUse = normalized(request.proposedUse);

  if (CAPITAL_PROJECT_TYPES.has(projectType)) {
    lanes.add("capital_readiness");
    lanes.add("small_business_capital");
  }
  if (projectType === "hiring") lanes.add("workforce");
  if (
    request.reportType === "dev-feasibility" ||
    DEVELOPMENT_PROJECT_TYPES.has(projectType) ||
    ["community-cultural", "housing", "mixed-use", "industrial-maker"].includes(proposedUse)
  ) {
    lanes.add("property_community_development");
  }

  return [...lanes];
}

export function normalizeSupportName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/^the\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GREATER_ENGLEWOOD_CONTACT_URL = "https://www.gechamber.com/contactus";

export function applyVerifiedLocalBusinessSupportOverride<
  T extends LocalBusinessSupportOrganization,
>(organization: T): T {
  const isGreaterEnglewood =
    organization.id === "P019" ||
    normalizeSupportName(organization.name) === "greater englewood chamber foundation";
  if (!isGreaterEnglewood) return organization;

  return {
    ...organization,
    address: "825 W. 69th St., 2nd Floor, Chicago, IL 60621",
    phone: "312-768-8573",
    email: "connect@geccf.org",
    website: GREATER_ENGLEWOOD_CONTACT_URL,
    validationLevel: "Verified: official organization contact page",
    currentStatus: "Active public intake",
    sourceYear: "2026",
    lastVerifiedAt: "2026-08-07",
    sourceUrls: Array.from(
      new Set([...organization.sourceUrls, GREATER_ENGLEWOOD_CONTACT_URL]),
    ),
  } as T;
}

function organizationMatchesContext(
  org: LocalBusinessSupportOrganization,
  request: LocalBusinessSupportRequest,
): boolean {
  if (
    org.communityAreaNumbers?.length &&
    !includesNormalized(org.communityAreaNumbers, request.communityAreaNumber)
  ) {
    return false;
  }
  if (org.serviceRegions?.length && !includesNormalized(org.serviceRegions, request.region)) {
    return false;
  }
  if (org.reportTypes?.length && !includesNormalized(org.reportTypes, request.reportType)) {
    return false;
  }
  if (!org.requiresProjectContext) return true;

  return (
    includesNormalized(org.projectTypes, request.projectType) ||
    includesNormalized(org.proposedUses, request.proposedUse)
  );
}

function mergeOrganization(
  existing: LocalBusinessSupportOrganization,
  enrichment: LocalBusinessSupportOrganization,
): LocalBusinessSupportOrganization {
  return {
    ...existing,
    ...enrichment,
    relationships: [...new Set([...existing.relationships, ...enrichment.relationships])],
    supportLanes: [
      ...new Set([...inferSupportLanes(existing), ...inferSupportLanes(enrichment)]),
    ],
    sourceUrls: [...new Set([...existing.sourceUrls, ...enrichment.sourceUrls])],
  };
}

function dedupeOrganizations(
  organizations: LocalBusinessSupportOrganization[],
): LocalBusinessSupportOrganization[] {
  const byName = new Map<string, LocalBusinessSupportOrganization>();
  for (const org of organizations) {
    const key = normalizeSupportName(org.name);
    if (!key) continue;
    const existing = byName.get(key);
    byName.set(key, existing ? mergeOrganization(existing, org) : org);
  }
  return [...byName.values()];
}

export function rankLocalBusinessSupport(
  organizations: LocalBusinessSupportOrganization[],
  limit = 6,
  request: LocalBusinessSupportRequest = {},
): LocalBusinessSupportOrganization[] {
  const requestedLanes = new Set(requestedSupportLanes(request));

  return dedupeOrganizations(organizations)
    .filter((org) => org.name.trim())
    .filter((org) => organizationMatchesContext(org, request))
    .slice()
    .sort((a, b) => {
      const relevance = (org: LocalBusinessSupportOrganization) => {
        const laneMatches = inferSupportLanes(org).filter((lane) => requestedLanes.has(lane)).length;
        const projectMatch = includesNormalized(org.projectTypes, request.projectType) ? 30 : 0;
        const useMatch = includesNormalized(org.proposedUses, request.proposedUse) ? 30 : 0;
        // Naming this community area is stronger place-based evidence than a
        // region-wide claim, and both beat merely not being excluded.
        const geographyMatch = includesNormalized(org.communityAreaNumbers, request.communityAreaNumber)
          ? 25
          : includesNormalized(org.serviceRegions, request.region)
            ? 15
            : 0;
        // Corridor storefront programs (CCSA, and SBIF windows) are delivered
        // through SSA/corridor operators: for a permanent storefront remodel
        // inside an SSA or CCSA corridor, the SSA provider is the first
        // conversation and outranks even the primary access point.
        const ssaFirst =
          request.storefrontCorridor &&
          normalized(request.projectType) === "rehab" &&
          org.relationships.includes("ssa_provider")
            ? 90
            : 0;
        return (
          bestRelationshipScore(org) + Math.min(laneMatches, 2) * 20 + projectMatch + useMatch + geographyMatch + ssaFirst
        );
      };
      const relevanceDelta = relevance(b) - relevance(a);
      if (relevanceDelta !== 0) return relevanceDelta;

      const verifiedA = /active|verified/i.test(`${a.currentStatus ?? ""} ${a.validationLevel ?? ""}`) ? 1 : 0;
      const verifiedB = /active|verified/i.test(`${b.currentStatus ?? ""} ${b.validationLevel ?? ""}`) ? 1 : 0;
      if (verifiedA !== verifiedB) return verifiedB - verifiedA;

      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function mergeCitywideBusinessSupport(
  organizations: LocalBusinessSupportOrganization[],
  citywideOrganizations: LocalBusinessSupportOrganization[],
  request: LocalBusinessSupportRequest = {},
): LocalBusinessSupportOrganization[] {
  const merged = dedupeOrganizations(organizations);
  const index = new Map(merged.map((org, position) => [normalizeSupportName(org.name), position]));

  for (const org of citywideOrganizations) {
    if (!organizationMatchesContext(org, request)) continue;
    const key = normalizeSupportName(org.name);
    const existingPosition = index.get(key);
    if (existingPosition === undefined) {
      index.set(key, merged.length);
      merged.push(org);
      continue;
    }
    merged[existingPosition] = mergeOrganization(merged[existingPosition], org);
  }

  return merged;
}

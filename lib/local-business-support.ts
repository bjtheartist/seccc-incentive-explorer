export type LocalBusinessSupportRelationship =
  | "primary_access_point"
  | "secondary_access_point"
  | "legal_support"
  | "nbdc_2025"
  | "cbc_hub"
  | "ssa_provider";

export interface LocalBusinessSupportOrganization {
  name: string;
  primaryType?: string;
  programSubtype?: string;
  relationships: LocalBusinessSupportRelationship[];
  address?: string;
  phone?: string;
  website?: string;
  supportTypes?: string;
  serviceGeography?: string;
  citywideOrRegional?: string;
  validationLevel?: string;
  currentStatus?: string;
  sourceYear?: string;
  sourceUrls: string[];
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

export function normalizeSupportName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function rankLocalBusinessSupport(
  organizations: LocalBusinessSupportOrganization[],
  limit = 6
): LocalBusinessSupportOrganization[] {
  return organizations
    .filter((org) => org.name.trim())
    .slice()
    .sort((a, b) => {
      const relationshipDelta = bestRelationshipScore(b) - bestRelationshipScore(a);
      if (relationshipDelta !== 0) return relationshipDelta;

      const verifiedA = /active|verified/i.test(`${a.currentStatus ?? ""} ${a.validationLevel ?? ""}`) ? 1 : 0;
      const verifiedB = /active|verified/i.test(`${b.currentStatus ?? ""} ${b.validationLevel ?? ""}`) ? 1 : 0;
      if (verifiedA !== verifiedB) return verifiedB - verifiedA;

      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function mergeCitywideBusinessSupport(
  organizations: LocalBusinessSupportOrganization[],
  citywideOrganizations: LocalBusinessSupportOrganization[]
): LocalBusinessSupportOrganization[] {
  const existingNames = new Set(organizations.map((org) => normalizeSupportName(org.name)));
  const additions = citywideOrganizations.filter((org) => !existingNames.has(normalizeSupportName(org.name)));
  return [...organizations, ...additions];
}

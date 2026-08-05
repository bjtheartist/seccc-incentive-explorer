import capitalPartnerData from "@/data/curated/capital_partners.json";
import citywideSupportData from "@/data/curated/citywide_business_support_resources.json";
import localSupportData from "@/data/exports/chicago-neighborhood-economics/local_business_support_by_community_area.json";
import { parseCapitalPartnerRegistry } from "@/lib/capital-partners";
import { inferSupportLanes, type LocalBusinessSupportOrganization } from "@/lib/local-business-support";
import type { ConciergePageContext } from "./types";

interface LocalSupportExport {
  byCommunityArea?: Record<string, { organizations?: LocalBusinessSupportOrganization[] }>;
}

interface CitywideSupportExport {
  organizations?: LocalBusinessSupportOrganization[];
}

function localRegistry() {
  const organizations = [
    ...Object.values((localSupportData as LocalSupportExport).byCommunityArea ?? {}).flatMap(
      (area) => area.organizations ?? [],
    ),
    ...((citywideSupportData as CitywideSupportExport).organizations ?? []),
  ];
  return new Map(
    organizations
      .filter((organization) => Boolean(organization.id))
      .map((organization) => [organization.id!, organization]),
  );
}

const LOCAL_SUPPORT_BY_ID = localRegistry();
const CAPITAL_SUPPORT_BY_ID = new Map(
  parseCapitalPartnerRegistry(capitalPartnerData).partners.map((partner) => [partner.id, partner]),
);

/**
 * Replace client-supplied partner descriptions with canonical public registry
 * records. The browser may identify a report selection by id, but it cannot
 * introduce a new organization or rewrite what that organization does.
 */
export function attestPartnerContext(context: ConciergePageContext): ConciergePageContext {
  const localSupportOrganizations = (context.localSupportOrganizations ?? []).flatMap(
    (candidate) => {
      const organization = LOCAL_SUPPORT_BY_ID.get(candidate.id);
      if (!organization || organization.name !== candidate.name) return [];
      return [{
        id: organization.id!,
        name: organization.name,
        role: organization.primaryType || "Business support organization",
        supportTypes: organization.supportTypes,
        serviceGeography: organization.serviceGeography,
        website: organization.website,
        supportLanes: inferSupportLanes(organization),
      }];
    },
  );

  const capitalPartner = context.capitalSupportId
    ? CAPITAL_SUPPORT_BY_ID.get(context.capitalSupportId)
    : undefined;
  const capitalSelectionMatches = Boolean(
    capitalPartner && capitalPartner.name === context.capitalSupportName,
  );
  const publicFitNote = capitalPartner?.products.find(
    (product) => product.active !== false && product.publicFitNote,
  )?.publicFitNote;

  return {
    ...context,
    localSupportOrganizations,
    capitalSupportId: capitalSelectionMatches ? capitalPartner?.id : undefined,
    capitalSupportName: capitalSelectionMatches ? capitalPartner?.name : undefined,
    capitalSupportReason: undefined,
    capitalSupportFitNote: capitalSelectionMatches ? publicFitNote : undefined,
    capitalSupportIntakeUrl: capitalSelectionMatches
      ? capitalPartner?.intakeUrl || capitalPartner?.website
      : undefined,
  };
}

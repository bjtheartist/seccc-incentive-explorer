import registryData from "@/data/curated/capital_partners.json";
import {
  matchCapitalPartners,
  parseCapitalPartnerRegistry,
  type CapitalMatchResult,
  type CapitalProductType,
} from "@/lib/capital-partners";

export const CAPITAL_PARTNER_SECTION_TITLE = "Financing Resources to Explore";

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

const PROJECT_PRODUCT_NEEDS: Record<string, CapitalProductType> = {
  rehab: "commercial_real_estate",
  expansion: "term_loan",
  equipment: "equipment_financing",
  hiring: "line_of_credit",
  relocation: "commercial_real_estate",
  energy: "equipment_financing",
  "new-construction": "commercial_real_estate",
  "mixed-use": "commercial_real_estate",
  "affordable-housing": "commercial_real_estate",
  "vacant-acquisition": "commercial_real_estate",
  other: "term_loan",
};

export interface CapitalPartnerReportContext {
  zip?: string | null;
  lat?: number | null;
  lon?: number | null;
  asOf?: string;
}

export interface CapitalPartnerReportState {
  reportType: string | null;
  projectType: string;
  supportNeeded: string[];
  neighborhood: string;
  industry: string;
}

export function reportNeedsCapitalPartner(
  state: Pick<CapitalPartnerReportState, "reportType" | "projectType" | "supportNeeded">,
): boolean {
  if (state.reportType === "corridor-intelligence" || state.reportType === "program-explorer") {
    return false;
  }
  if (CAPITAL_PROJECT_TYPES.has(state.projectType)) return true;
  return state.supportNeeded.some((need) => need === "financing" || need === "grant");
}

export function capitalPartnerHandoffForReport(
  state: CapitalPartnerReportState,
  context: CapitalPartnerReportContext = {},
): CapitalMatchResult | null {
  if (!reportNeedsCapitalPartner(state)) return null;

  const registry = parseCapitalPartnerRegistry(registryData);
  return matchCapitalPartners(registry.partners, {
    communityArea: state.neighborhood || undefined,
    zip: context.zip || undefined,
    lat: context.lat ?? undefined,
    lon: context.lon ?? undefined,
    projectType: state.projectType || undefined,
    productNeed: PROJECT_PRODUCT_NEEDS[state.projectType] || undefined,
    industry: state.industry || undefined,
    asOf: context.asOf,
  });
}

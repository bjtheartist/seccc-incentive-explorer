/**
 * Capital partner registry contract and deterministic referral matcher.
 *
 * The registry is JSON/DB neutral: the same `CapitalPartner` shape can be
 * hydrated from a static JSON file (no DATABASE_URL) or from the
 * partners / partner_service_areas / partner_products tables.
 *
 * Matching order is fixed by product policy:
 *   1. Service geography is a hard gate (citywide entries pass everywhere).
 *   2. Exact project/product fit ranks eligible partners.
 *   3. Proximity is used only as a tie-break, then name/id for determinism.
 *
 * Internal ordering tiers and product amount bounds are never placed on the
 * returned match objects — matches carry only plain-language reasons and
 * source provenance, and never promise approvals, dollars, or eligibility.
 */

export type PartnerType = "cdfi" | "mission_lender" | "community_bank" | "public_program";

export type PartnerVerificationStatus = "verified" | "unverified" | "stale";

export type ServiceAreaScope = "citywide" | "community_area" | "zip" | "ward";

export type CapitalProductType =
  | "term_loan"
  | "microloan"
  | "line_of_credit"
  | "equipment_financing"
  | "commercial_real_estate"
  | "working_capital";

export interface PartnerServiceArea {
  scope: ServiceAreaScope;
  /** Community area number or name, ZIP, or ward. Omitted for citywide. */
  value?: string;
}

export interface PartnerProduct {
  id: string;
  productType: CapitalProductType | string;
  productName?: string;
  /** Report project types this product is meant for (e.g. "rehab", "expansion"). */
  projectTypes?: string[];
  industries?: string[];
  /** Internal routing bounds in whole USD. Never serialized to users. */
  minUsd?: number;
  maxUsd?: number;
  verificationStatus?: PartnerVerificationStatus;
  sourceUrl?: string;
  sourceDate?: string;
  active?: boolean;
}

export interface CapitalPartner {
  id: string;
  name: string;
  partnerType: PartnerType | string;
  website?: string;
  contactEmail?: string;
  phone?: string;
  address?: string;
  /** Office location, used only for the proximity tie-break. */
  lat?: number;
  lon?: number;
  serviceAreas: PartnerServiceArea[];
  products: PartnerProduct[];
  verificationStatus: PartnerVerificationStatus;
  sourceUrl?: string;
  sourceDate?: string;
  lastVerifiedAt?: string;
  active?: boolean;
  notes?: string;
}

export interface CapitalPartnerRegistry {
  generatedAt?: string;
  sourceLabel?: string;
  partners: CapitalPartner[];
}

export interface CapitalMatchRequest {
  communityAreaNumber?: string;
  communityArea?: string;
  zip?: string;
  ward?: string;
  lat?: number;
  lon?: number;
  projectType?: string;
  productNeed?: CapitalProductType | string;
  /** Reference date for staleness checks; pass a fixed value for determinism. */
  asOf?: string;
}

export interface CapitalMatchProvenance {
  verificationStatus: PartnerVerificationStatus;
  sourceUrl?: string;
  sourceDate?: string;
  lastVerifiedAt?: string;
}

export interface CapitalPartnerMatch {
  partnerId: string;
  name: string;
  partnerType: string;
  website?: string;
  productType?: string;
  reason: string;
  provenance: CapitalMatchProvenance;
}

export interface CapitalMatchResult {
  primary: CapitalPartnerMatch | null;
  alternates: CapitalPartnerMatch[];
}

/** Verification older than this is downgraded below fresh entries. */
export const PARTNER_STALE_AFTER_DAYS = 365;
/** Verification older than this is excluded from matching entirely. */
export const PARTNER_EXCLUDE_AFTER_DAYS = 730;

const MAX_ALTERNATES = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  term_loan: "small business term loans",
  microloan: "microloans",
  line_of_credit: "lines of credit",
  equipment_financing: "equipment financing",
  commercial_real_estate: "commercial real estate financing",
  working_capital: "working capital financing",
};

const PROJECT_TYPE_PHRASES: Record<string, string> = {
  rehab: "building rehab",
  expansion: "business expansion",
  acquisition: "property acquisition",
  startup: "business launch",
  equipment: "equipment purchase",
};

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").trim();
}

function normalizeArea(value: string): string {
  return value.trim().toLowerCase().replace(/^0+(?=\d)/, "");
}

export function parseCapitalPartnerRegistry(input: unknown): CapitalPartnerRegistry {
  if (typeof input !== "object" || input === null) {
    return { partners: [] };
  }
  const raw = input as Partial<CapitalPartnerRegistry>;
  const partners = Array.isArray(raw.partners)
    ? raw.partners.filter(
        (partner): partner is CapitalPartner =>
          typeof partner === "object" &&
          partner !== null &&
          typeof partner.id === "string" &&
          partner.id.trim() !== "" &&
          typeof partner.name === "string" &&
          partner.name.trim() !== "" &&
          typeof partner.partnerType === "string" &&
          Array.isArray(partner.serviceAreas) &&
          Array.isArray(partner.products)
      )
    : [];
  return {
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : undefined,
    sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : undefined,
    partners,
  };
}

function freshnessDate(partner: CapitalPartner): number | null {
  const raw = partner.lastVerifiedAt ?? partner.sourceDate;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

type VerificationTier = 0 | 1 | 2;

function verificationTier(partner: CapitalPartner, asOfMs: number): VerificationTier | null {
  const verifiedAt = freshnessDate(partner);
  if (verifiedAt !== null) {
    const ageDays = (asOfMs - verifiedAt) / DAY_MS;
    if (ageDays > PARTNER_EXCLUDE_AFTER_DAYS) return null;
    if (ageDays > PARTNER_STALE_AFTER_DAYS) return 2;
  }
  if (partner.verificationStatus === "stale") return 2;
  if (partner.verificationStatus === "unverified") return 1;
  return 0;
}

interface GeographyFit {
  local: boolean;
  areaLabel: string;
}

function geographyFit(partner: CapitalPartner, request: CapitalMatchRequest): GeographyFit | null {
  let citywide = false;
  for (const area of partner.serviceAreas) {
    if (area.scope === "citywide") {
      citywide = true;
      continue;
    }
    const value = area.value ? normalizeArea(area.value) : "";
    if (!value) continue;
    if (
      area.scope === "community_area" &&
      ((request.communityAreaNumber && value === normalizeArea(request.communityAreaNumber)) ||
        (request.communityArea && value === normalizeArea(request.communityArea)))
    ) {
      return { local: true, areaLabel: request.communityArea ?? `community area ${request.communityAreaNumber}` };
    }
    if (area.scope === "zip" && request.zip && value === normalizeArea(request.zip)) {
      return { local: true, areaLabel: `the ${request.zip} ZIP code` };
    }
    if (area.scope === "ward" && request.ward && value === normalizeArea(request.ward)) {
      return { local: true, areaLabel: `Ward ${request.ward}` };
    }
  }
  return citywide ? { local: false, areaLabel: "businesses citywide in Chicago" } : null;
}

type FitTier = 0 | 1 | 2;

function productFit(product: PartnerProduct, request: CapitalMatchRequest): FitTier {
  const wantsProduct = Boolean(request.productNeed);
  const wantsProject = Boolean(request.projectType);
  const productMatches =
    wantsProduct && product.productType.toLowerCase() === String(request.productNeed).toLowerCase();
  const projectMatches =
    wantsProject &&
    (product.projectTypes ?? []).some(
      (type) => type.toLowerCase() === String(request.projectType).toLowerCase()
    );

  const requested = Number(wantsProduct) + Number(wantsProject);
  if (requested === 0) return 0;
  const matched = Number(productMatches) + Number(projectMatches);
  if (matched === requested) return 0;
  if (matched > 0) return 1;
  return 2;
}

function bestProduct(
  partner: CapitalPartner,
  request: CapitalMatchRequest
): { product: PartnerProduct | null; fit: FitTier } {
  const active = partner.products.filter((product) => product.active !== false);
  if (active.length === 0) return { product: null, fit: 2 };

  let best: PartnerProduct | null = null;
  let bestFit: FitTier = 2;
  for (const product of active) {
    const fit = productFit(product, request);
    if (
      best === null ||
      fit < bestFit ||
      (fit === bestFit && product.id.localeCompare(best.id) < 0)
    ) {
      best = product;
      bestFit = fit;
    }
  }
  return { product: best, fit: bestFit };
}

function haversineKm(latA: number, lonA: number, latB: number, lonB: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLon = toRad(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface Candidate {
  partner: CapitalPartner;
  geography: GeographyFit;
  product: PartnerProduct | null;
  fitTier: FitTier;
  verification: VerificationTier;
  distanceKm: number;
}

function buildReason(candidate: Candidate, request: CapitalMatchRequest): string {
  const { partner, geography, product, fitTier } = candidate;
  const servePhrase = `serves ${geography.areaLabel}`;

  let productPhrase = "offers small business financing";
  if (product && fitTier < 2) {
    const productLabel = PRODUCT_TYPE_LABELS[product.productType] ?? humanize(product.productType);
    const projectLabel = request.projectType
      ? PROJECT_TYPE_PHRASES[request.projectType] ?? humanize(request.projectType)
      : null;
    productPhrase =
      projectLabel && (product.projectTypes ?? []).some(
        (type) => type.toLowerCase() === String(request.projectType).toLowerCase()
      )
        ? `lists ${productLabel} for ${projectLabel} projects`
        : `lists ${productLabel}`;
  }

  return `${partner.name} ${servePhrase} and ${productPhrase}. Contact them directly to confirm current offerings and next steps.`;
}

function toMatch(candidate: Candidate, request: CapitalMatchRequest): CapitalPartnerMatch {
  const { partner, product } = candidate;
  return {
    partnerId: partner.id,
    name: partner.name,
    partnerType: partner.partnerType,
    ...(partner.website ? { website: partner.website } : {}),
    ...(product && candidate.fitTier < 2 ? { productType: product.productType } : {}),
    reason: buildReason(candidate, request),
    provenance: {
      verificationStatus: partner.verificationStatus,
      ...(partner.sourceUrl ? { sourceUrl: partner.sourceUrl } : {}),
      ...(partner.sourceDate ? { sourceDate: partner.sourceDate } : {}),
      ...(partner.lastVerifiedAt ? { lastVerifiedAt: partner.lastVerifiedAt } : {}),
    },
  };
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.fitTier !== b.fitTier) return a.fitTier - b.fitTier;
  if (a.verification !== b.verification) return a.verification - b.verification;
  if (a.geography.local !== b.geography.local) return a.geography.local ? -1 : 1;
  if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
  const byName = a.partner.name.localeCompare(b.partner.name);
  if (byName !== 0) return byName;
  return a.partner.id.localeCompare(b.partner.id);
}

/**
 * Pure, deterministic matcher. Returns one primary partner and up to two
 * alternates for a capital-shaped request, or a null primary when no partner
 * (including citywide fallbacks) serves the request geography.
 */
export function matchCapitalPartners(
  partners: CapitalPartner[],
  request: CapitalMatchRequest
): CapitalMatchResult {
  const asOfMs = request.asOf ? Date.parse(request.asOf) : Date.now();

  const candidates: Candidate[] = [];
  for (const partner of partners) {
    if (partner.active === false) continue;
    const verification = verificationTier(partner, asOfMs);
    if (verification === null) continue;
    const geography = geographyFit(partner, request);
    if (!geography) continue;

    const { product, fit } = bestProduct(partner, request);
    const distanceKm =
      request.lat !== undefined &&
      request.lon !== undefined &&
      partner.lat !== undefined &&
      partner.lon !== undefined
        ? haversineKm(request.lat, request.lon, partner.lat, partner.lon)
        : Number.POSITIVE_INFINITY;

    candidates.push({ partner, geography, product, fitTier: fit, verification, distanceKm });
  }

  candidates.sort(compareCandidates);

  const [first, ...rest] = candidates;
  return {
    primary: first ? toMatch(first, request) : null,
    alternates: rest.slice(0, MAX_ALTERNATES).map((candidate) => toMatch(candidate, request)),
  };
}

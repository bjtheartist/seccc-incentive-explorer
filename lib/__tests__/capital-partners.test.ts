import { describe, expect, it } from "vitest";
import capitalPartnerData from "@/data/curated/capital_partners.json";
import {
  matchCapitalPartners,
  parseCapitalPartnerRegistry,
  type CapitalMatchRequest,
  type CapitalPartner,
  type SbaPartnerRole,
} from "@/lib/capital-partners";

const AS_OF = "2026-07-01T00:00:00.000Z";

function fixturePartner(overrides: Partial<CapitalPartner> & { id: string; name: string }): CapitalPartner {
  return {
    partnerType: "cdfi",
    website: "https://example.org",
    serviceAreas: [{ scope: "community_area", value: "46" }],
    products: [
      {
        id: `${overrides.id}-term`,
        productType: "term_loan",
        projectTypes: ["rehab", "expansion"],
        minUsd: 10000,
        maxUsd: 250000,
      },
    ],
    verificationStatus: "verified",
    sourceUrl: "https://example.org/programs",
    sourceDate: "2026-05-01",
    lastVerifiedAt: "2026-05-15T00:00:00.000Z",
    ...overrides,
  };
}

const southSideFund = fixturePartner({
  id: "south-side-fund",
  name: "South Side Community Fund",
  lat: 41.739,
  lon: -87.556,
  sbaRoles: ["7a_lender"],
});

const generalLender46 = fixturePartner({
  id: "general-lender-46",
  name: "Area 46 General Lender",
  products: [
    {
      id: "general-lender-46-loc",
      productType: "line_of_credit",
      projectTypes: ["startup"],
    },
  ],
});

const westSideOnly = fixturePartner({
  id: "west-side-only",
  name: "Austin Capital Collaborative",
  serviceAreas: [{ scope: "community_area", value: "25" }],
  lat: 41.739,
  lon: -87.556,
});

const citywideCdfi = fixturePartner({
  id: "citywide-cdfi",
  name: "Chicago Citywide CDFI",
  partnerType: "mission_lender",
  serviceAreas: [{ scope: "citywide" }],
  lat: 41.882,
  lon: -87.632,
});

const staleLocal = fixturePartner({
  id: "stale-local",
  name: "Dormant Local Fund",
  sourceDate: "2025-03-01",
  lastVerifiedAt: "2025-03-01T00:00:00.000Z",
});

const ancientLocal = fixturePartner({
  id: "ancient-local",
  name: "Ancient Records Fund",
  sourceDate: "2023-01-01",
  lastVerifiedAt: "2023-01-01T00:00:00.000Z",
});

const inactiveLocal = fixturePartner({
  id: "inactive-local",
  name: "Closed Doors Fund",
  active: false,
});

const ALL_PARTNERS = [
  southSideFund,
  generalLender46,
  westSideOnly,
  citywideCdfi,
  staleLocal,
  ancientLocal,
  inactiveLocal,
];

const SOUTH_CHICAGO_REQUEST: CapitalMatchRequest = {
  communityAreaNumber: "46",
  communityArea: "South Chicago",
  lat: 41.739,
  lon: -87.556,
  projectType: "rehab",
  productNeed: "term_loan",
  asOf: AS_OF,
};

function matchedIds(partners: CapitalPartner[], request: CapitalMatchRequest): string[] {
  const result = matchCapitalPartners(partners, request);
  return [result.primary?.partnerId, ...result.alternates.map((match) => match.partnerId)].filter(
    (id): id is string => Boolean(id)
  );
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, keys);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      keys.push(key);
      collectKeys(entry, keys);
    }
  }
  return keys;
}

describe("matchCapitalPartners", () => {
  it("returns identical results regardless of input order", () => {
    const forward = matchCapitalPartners(ALL_PARTNERS, SOUTH_CHICAGO_REQUEST);
    const reversed = matchCapitalPartners([...ALL_PARTNERS].reverse(), SOUTH_CHICAGO_REQUEST);
    const shuffled = matchCapitalPartners(
      [citywideCdfi, staleLocal, inactiveLocal, southSideFund, ancientLocal, generalLender46, westSideOnly],
      SOUTH_CHICAGO_REQUEST
    );

    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
    expect(forward.primary?.partnerId).toBe("south-side-fund");
  });

  it("hard-gates on service geography even when product fit and proximity are perfect", () => {
    const ids = matchedIds(ALL_PARTNERS, SOUTH_CHICAGO_REQUEST);
    expect(ids).not.toContain("west-side-only");

    const westOnlyPool = matchCapitalPartners([westSideOnly], SOUTH_CHICAGO_REQUEST);
    expect(westOnlyPool.primary).toBeNull();
    expect(westOnlyPool.alternates).toEqual([]);
  });

  it("ranks exact project/product fit above general local lenders", () => {
    const result = matchCapitalPartners([generalLender46, southSideFund], SOUTH_CHICAGO_REQUEST);
    expect(result.primary?.partnerId).toBe("south-side-fund");
    expect(result.primary?.productType).toBe("term_loan");
    expect(result.alternates[0]?.partnerId).toBe("general-lender-46");
  });

  it("prefers a local partner over a citywide one when both fit exactly", () => {
    const result = matchCapitalPartners([citywideCdfi, southSideFund], SOUTH_CHICAGO_REQUEST);
    expect(result.primary?.partnerId).toBe("south-side-fund");
  });

  it("falls back to citywide partners for areas with no local coverage", () => {
    const norwoodParkRequest: CapitalMatchRequest = {
      communityAreaNumber: "10",
      communityArea: "Norwood Park",
      projectType: "rehab",
      productNeed: "term_loan",
      asOf: AS_OF,
    };
    const result = matchCapitalPartners(ALL_PARTNERS, norwoodParkRequest);
    expect(result.primary?.partnerId).toBe("citywide-cdfi");
    expect(result.primary?.reason).toContain("citywide");
  });

  it("downgrades stale verification and excludes entries beyond the hard cutoff", () => {
    const result = matchCapitalPartners([staleLocal, southSideFund, ancientLocal], SOUTH_CHICAGO_REQUEST);
    expect(result.primary?.partnerId).toBe("south-side-fund");
    expect(result.alternates.map((match) => match.partnerId)).toEqual(["stale-local"]);
    expect(matchedIds(ALL_PARTNERS, SOUTH_CHICAGO_REQUEST)).not.toContain("ancient-local");
  });

  it("ranks fresh verified partners above unverified ones even across geography specificity", () => {
    const unverifiedLocal = fixturePartner({
      id: "unverified-local",
      name: "Unverified Local Fund",
      verificationStatus: "unverified",
      sourceDate: undefined,
      lastVerifiedAt: undefined,
    });
    const result = matchCapitalPartners([unverifiedLocal, citywideCdfi], SOUTH_CHICAGO_REQUEST);
    expect(result.primary?.partnerId).toBe("citywide-cdfi");
    expect(result.alternates[0]?.provenance.verificationStatus).toBe("unverified");
  });

  it("excludes inactive partners and caps alternates at two", () => {
    const result = matchCapitalPartners(ALL_PARTNERS, SOUTH_CHICAGO_REQUEST);
    const ids = [result.primary?.partnerId, ...result.alternates.map((match) => match.partnerId)];
    expect(ids).not.toContain("inactive-local");
    expect(result.alternates).toHaveLength(2);
    expect(new Set(ids).size).toBe(3);
  });

  it("uses proximity only as a tie-break within equal geography and fit", () => {
    const nearCitywide = fixturePartner({
      id: "near-citywide",
      name: "Near Citywide Fund",
      serviceAreas: [{ scope: "citywide" }],
      lat: 41.74,
      lon: -87.56,
    });
    const farCitywide = fixturePartner({
      id: "far-citywide",
      name: "Far Citywide Fund",
      serviceAreas: [{ scope: "citywide" }],
      lat: 42.008,
      lon: -87.668,
    });
    const result = matchCapitalPartners([farCitywide, nearCitywide], SOUTH_CHICAGO_REQUEST);
    expect(result.primary?.partnerId).toBe("near-citywide");
  });

  it("uses a declared industry restriction before proximity", () => {
    const nearbyRetailOnly = fixturePartner({
      id: "nearby-retail-only",
      name: "Nearby Retail Fund",
      lat: 41.739,
      lon: -87.556,
      products: [
        {
          id: "nearby-retail-only-term",
          productType: "term_loan",
          projectTypes: ["rehab"],
          industries: ["retail"],
        },
      ],
    });
    const fartherGeneral = fixturePartner({
      id: "farther-general",
      name: "Farther General Fund",
      lat: 41.82,
      lon: -87.62,
    });
    const result = matchCapitalPartners([nearbyRetailOnly, fartherGeneral], {
      ...SOUTH_CHICAGO_REQUEST,
      industry: "manufacturing",
    });
    expect(result.primary?.partnerId).toBe("farther-general");
  });

  it("hard-gates specialist partners to their declared project context", () => {
    const multifamilySpecialist = fixturePartner({
      id: "multifamily-specialist",
      name: "Multifamily Specialist",
      requiresProjectContext: true,
      products: [
        {
          id: "multifamily-specialist-real-estate",
          productType: "commercial_real_estate",
          projectTypes: ["affordable-housing", "mixed-use"],
          proposedUses: ["housing", "mixed-use"],
        },
      ],
    });

    const generalEquipment = matchCapitalPartners([multifamilySpecialist], {
      ...SOUTH_CHICAGO_REQUEST,
      projectType: "equipment",
      productNeed: "equipment_financing",
    });
    expect(generalEquipment.primary).toBeNull();

    const affordableHousing = matchCapitalPartners([multifamilySpecialist], {
      ...SOUTH_CHICAGO_REQUEST,
      projectType: "affordable-housing",
      productNeed: "commercial_real_estate",
    });
    expect(affordableHousing.primary?.partnerId).toBe("multifamily-specialist");

    const housingRehab = matchCapitalPartners([multifamilySpecialist], {
      ...SOUTH_CHICAGO_REQUEST,
      projectType: "rehab",
      proposedUse: "housing",
      productNeed: "commercial_real_estate",
    });
    expect(housingRehab.primary?.partnerId).toBe("multifamily-specialist");
  });

  it("hard-gates organizations to their declared report surfaces", () => {
    const developmentAdvisor = fixturePartner({
      id: "development-advisor",
      name: "Development Advisor",
      reportTypes: ["dev-feasibility"],
    });

    const generalReport = matchCapitalPartners([developmentAdvisor], {
      ...SOUTH_CHICAGO_REQUEST,
      reportType: "site-incentives",
    });
    expect(generalReport.primary).toBeNull();

    const developmentReport = matchCapitalPartners([developmentAdvisor], {
      ...SOUTH_CHICAGO_REQUEST,
      reportType: "dev-feasibility",
    });
    expect(developmentReport.primary?.partnerId).toBe("development-advisor");
  });

  it("keeps provenance dates and verification state on every match", () => {
    const result = matchCapitalPartners(ALL_PARTNERS, SOUTH_CHICAGO_REQUEST);
    expect(result.primary?.provenance).toEqual({
      verificationStatus: "verified",
      sourceUrl: "https://example.org/programs",
      sourceDate: "2026-05-01",
      lastVerifiedAt: "2026-05-15T00:00:00.000Z",
    });
  });

  it("uses the selected product source and omits notes from an unrelated fallback product", () => {
    const productSourced = fixturePartner({
      id: "product-sourced",
      name: "Product Sourced Fund",
      products: [
        {
          id: "product-sourced-equipment",
          productType: "equipment_financing",
          projectTypes: ["equipment"],
          publicFitNote: "Equipment projects with long-lived fixed assets.",
          sourceUrl: "https://example.org/equipment",
          sourceDate: "2026-06-15",
        },
      ],
    });

    const exact = matchCapitalPartners([productSourced], {
      ...SOUTH_CHICAGO_REQUEST,
      projectType: "equipment",
      productNeed: "equipment_financing",
    });
    expect(exact.primary?.fitNote).toBe("Equipment projects with long-lived fixed assets.");
    expect(exact.primary?.provenance.sourceUrl).toBe("https://example.org/equipment");
    expect(exact.primary?.provenance.sourceDate).toBe("2026-06-15");

    const unrelated = matchCapitalPartners([productSourced], {
      ...SOUTH_CHICAGO_REQUEST,
      projectType: "hiring",
      productNeed: "line_of_credit",
    });
    expect(unrelated.primary?.fitNote).toBeUndefined();
  });

  it("never serializes internal ordering or product bound fields", () => {
    const result = matchCapitalPartners(ALL_PARTNERS, SOUTH_CHICAGO_REQUEST);
    const serialized = JSON.stringify(result);
    const keys = collectKeys(JSON.parse(serialized));

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toMatch(/score|rank|min|max|amount|dollar|usd|tier|fee/i);
    }
    expect(serialized).not.toContain("$");
    expect(serialized).not.toContain("7a_lender");
    expect(keys).not.toContain("sbaRoles");
    expect(result.primary?.reason).not.toMatch(/guarantee|approved|eligible|qualif/i);
  });
});

describe("curated SBA capital network", () => {
  const registry = parseCapitalPartnerRegistry(capitalPartnerData);

  function partnersWithRole(role: SbaPartnerRole) {
    return registry.partners.filter((partner) => partner.sbaRoles?.includes(role));
  }

  it("keeps SBA Certified Development Companies distinct from neighborhood CDCs", () => {
    expect(
      partnersWithRole("certified_development_company").map((partner) => partner.name).sort()
    ).toEqual(["Small Business Growth Corporation", "SomerCor"]);
  });

  it("uses the current SBA-authorized Illinois microlender designation", () => {
    const microlenders = partnersWithRole("microloan_intermediary");
    expect(microlenders.map((partner) => partner.name)).toEqual(["Justine PETERSEN"]);
    expect(microlenders[0]?.sourceUrl).toContain("sba.gov");
  });

  it("stores current 7(a), Community Advantage, microloan, and 504 roles without public estimates", () => {
    const requiredRoles = [
      "7a_lender",
      "community_advantage_sblc",
      "microloan_intermediary",
      "certified_development_company",
    ] as const;

    for (const role of requiredRoles) {
      expect(partnersWithRole(role).length).toBeGreaterThan(0);
    }

    for (const partner of registry.partners.filter((entry) => entry.sbaRoles?.length)) {
      expect(partner.verificationStatus).toBe("verified");
      expect(partner.lastVerifiedAt).toBeTruthy();
      for (const product of partner.products) {
        expect(product.publicFitNote ?? "").not.toMatch(/\$\s*\d/);
        expect(product.publicFitNote ?? "").not.toMatch(/\bguaranteed approval\b/i);
      }
    }
  });
});

describe("parseCapitalPartnerRegistry", () => {
  it("accepts a JSON-shaped registry and drops malformed entries", () => {
    const registry = parseCapitalPartnerRegistry({
      generatedAt: "2026-06-01",
      sourceLabel: "curated fixture",
      partners: [southSideFund, { id: "", name: "Broken" }, { name: "No id" }, null],
    });

    expect(registry.sourceLabel).toBe("curated fixture");
    expect(registry.partners.map((partner) => partner.id)).toEqual(["south-side-fund"]);
  });

  it("returns an empty registry for non-object input", () => {
    expect(parseCapitalPartnerRegistry(undefined)).toEqual({ partners: [] });
    expect(parseCapitalPartnerRegistry("nope")).toEqual({
      generatedAt: undefined,
      sourceLabel: undefined,
      partners: [],
    });
  });
});

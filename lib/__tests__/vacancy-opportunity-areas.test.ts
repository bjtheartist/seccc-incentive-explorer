import { describe, expect, it } from "vitest";
import {
  AREA_DISPLAY_CAP,
  approxSqft,
  deriveOpportunityAreas,
  modalStreet,
  needsCheckingForArea,
  opportunityAreaById,
  scenariosForArea,
  standoutReasonsForArea,
  streetNameFromAddress,
  zoningFamilyOf,
  type OpportunityAreaMember,
} from "../vacancy-opportunity-areas";
import type {
  VacancyCluster,
  VacancyIndexEdition,
  VacancySitePoint,
} from "../vacancy-index";

/** Words that must NEVER appear in any templated public copy (discovery, not
 * compliance / availability). */
const FORBIDDEN = ["ideal for", "development-ready", "available"];

function makeCluster(overrides: Partial<VacancyCluster> & { id: number }): VacancyCluster {
  const ownerTypeCounts = overrides.ownerTypeCounts ?? [
    { ownerType: "corporate_llc", count: 0 },
    { ownerType: "out_of_state", count: 0 },
    { ownerType: "local_private", count: 0 },
    { ownerType: "city_public", count: 0 },
    { ownerType: "unknown", count: 0 },
  ];
  return {
    id: overrides.id,
    centroid: overrides.centroid ?? { lat: 41.74, lon: -87.54 },
    bbox: overrides.bbox ?? [-87.55, 41.73, -87.53, 41.75],
    count: overrides.count ?? 5,
    ownerTypeCounts,
    taxSaleCount: overrides.taxSaleCount ?? 0,
    violationCount: overrides.violationCount ?? 0,
    vacantLandCount: overrides.vacantLandCount ?? 0,
    vacantBuildingCount: overrides.vacantBuildingCount ?? 0,
    corridorName: overrides.corridorName ?? null,
  };
}

function makePoint(overrides: Partial<VacancySitePoint> & { clusterId: number }): VacancySitePoint {
  return {
    lat: overrides.lat ?? 41.74,
    lon: overrides.lon ?? -87.54,
    ownerType: overrides.ownerType ?? "city_public",
    propertyType: overrides.propertyType ?? "vacant_land",
    markerNumber: null,
    address: overrides.address === undefined ? "100 S GREEN BAY AVE" : overrides.address,
    pin: overrides.pin ?? "21322110390000",
    squareFeet: overrides.squareFeet ?? 6000,
    zoningClass: overrides.zoningClass ?? "C1-1",
    incentiveCount: overrides.incentiveCount ?? 2,
    ownerConfidence: "pin_matched",
    clusterId: overrides.clusterId,
    saleYear: overrides.saleYear ?? null,
    violation: overrides.violation ?? false,
    ownerStructure: "entity",
    ownerGeography: "in_state",
    pinMatch: "inventory",
  };
}

function makeEdition(overrides: {
  clusters: VacancyCluster[];
  sitePoints: VacancySitePoint[];
  neighborhood?: string;
}): VacancyIndexEdition {
  return {
    neighborhood: overrides.neighborhood ?? "South Chicago",
    clusters: overrides.clusters,
    sitePoints: overrides.sitePoints,
  } as unknown as VacancyIndexEdition;
}

/** A minimal member for the unit-level template tests. */
function member(over: Partial<OpportunityAreaMember>): OpportunityAreaMember {
  return {
    address: over.address === undefined ? "100 S GREEN BAY AVE" : over.address,
    propertyType: over.propertyType ?? "vacant_land",
    ownerType: over.ownerType ?? "city_public",
    squareFeet: over.squareFeet ?? 6000,
    zoningClass: over.zoningClass ?? "C1-1",
    incentiveCount: over.incentiveCount ?? 1,
    pin: over.pin ?? "21322110390000",
    saleYear: over.saleYear ?? null,
    violation: over.violation ?? false,
    lat: over.lat ?? 41.74,
    lon: over.lon ?? -87.54,
  };
}

describe("streetNameFromAddress", () => {
  it("drops the house number and directional, expands the type suffix", () => {
    expect(streetNameFromAddress("8558 S GREEN BAY AVE")).toBe("Green Bay Avenue");
    expect(streetNameFromAddress("8131 S EXCHANGE AVE")).toBe("Exchange Avenue");
    expect(streetNameFromAddress("E 91ST ST")).toBe("91st Street");
    expect(streetNameFromAddress("123 W 79TH PL")).toBe("79th Place");
  });

  it("returns null for empty / number-only input", () => {
    expect(streetNameFromAddress(null)).toBeNull();
    expect(streetNameFromAddress("")).toBeNull();
    expect(streetNameFromAddress("   ")).toBeNull();
  });
});

describe("modalStreet", () => {
  it("returns the most common street, ties broken alphabetically", () => {
    const members = [
      member({ address: "1 S BUFFALO AVE" }),
      member({ address: "2 S BUFFALO AVE" }),
      member({ address: "3 S MACKINAW AVE" }),
    ];
    expect(modalStreet(members)).toBe("Buffalo Avenue");
  });

  it("returns null when no member carries a usable address", () => {
    expect(modalStreet([member({ address: null }), member({ address: "" })])).toBeNull();
  });
});

describe("zoningFamilyOf", () => {
  it("maps prefixes longest-first", () => {
    expect(zoningFamilyOf("C1-1")).toBe("commercial");
    expect(zoningFamilyOf("B3-2")).toBe("commercial");
    expect(zoningFamilyOf("RS-3")).toBe("residential");
    expect(zoningFamilyOf("M1-2")).toBe("industrial");
    expect(zoningFamilyOf("PMD 11")).toBe("industrial");
    expect(zoningFamilyOf(null)).toBeNull();
  });
});

describe("approxSqft", () => {
  it("rounds to two significant figures, never inflating a zero", () => {
    expect(approxSqft(6234)).toBe(6200);
    expect(approxSqft(18450)).toBe(18000);
    expect(approxSqft(0)).toBe(0);
    expect(approxSqft(-5)).toBe(0);
  });
});

describe("scenariosForArea — template branch selection", () => {
  it("commercial + ≥3 sites → storefront/mixed-use", () => {
    const out = scenariosForArea({ siteCount: 5, combinedKnownSqft: 0, zoningFamilies: ["commercial"] });
    expect(out[0]).toMatch(/storefront or mixed-use/i);
  });

  it("residential → side-lot / community reuse", () => {
    const out = scenariosForArea({ siteCount: 6, combinedKnownSqft: 0, zoningFamilies: ["residential"] });
    expect(out.some((s) => /side-lot or community reuse/i.test(s))).toBe(true);
  });

  it("≥8 sites and ≥20k sq ft → larger assembled site", () => {
    const out = scenariosForArea({ siteCount: 8, combinedKnownSqft: 20000, zoningFamilies: ["commercial"] });
    expect(out.some((s) => /larger assembled site/i.test(s))).toBe(true);
  });

  it("industrial → light-manufacturing / industrial reuse", () => {
    const out = scenariosForArea({ siteCount: 5, combinedKnownSqft: 0, zoningFamilies: ["industrial"] });
    expect(out.some((s) => /industrial reuse/i.test(s))).toBe(true);
  });

  it("no signal → a single generic further-exploration scenario", () => {
    const out = scenariosForArea({ siteCount: 5, combinedKnownSqft: 0, zoningFamilies: ["other"] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/further exploration/i);
  });

  it("caps at three scenarios and never uses forbidden words", () => {
    const out = scenariosForArea({
      siteCount: 10,
      combinedKnownSqft: 40000,
      zoningFamilies: ["commercial", "residential", "industrial"],
    });
    expect(out.length).toBeLessThanOrEqual(3);
    for (const s of out) {
      expect(s).toMatch(/could support/i);
      for (const bad of FORBIDDEN) expect(s.toLowerCase()).not.toContain(bad);
    }
  });
});

describe("standoutReasonsForArea / needsCheckingForArea", () => {
  it("standout reasons are capped at two and free of forbidden words", () => {
    const reasons = standoutReasonsForArea({
      siteCount: 12,
      memberCount: 12,
      combinedKnownSqft: 30000,
      incentiveSiteCount: 12,
      ownershipMix: [{ ownerType: "city_public", label: "Public agency", count: 8 }],
      zoningFamilies: ["commercial"],
    });
    expect(reasons.length).toBeLessThanOrEqual(2);
    for (const r of reasons) for (const bad of FORBIDDEN) expect(r.toLowerCase()).not.toContain(bad);
  });

  it("needs-checking surfaces the not-yet-classified share and distress", () => {
    const needs = needsCheckingForArea({
      siteCount: 10,
      memberCount: 10,
      taxSaleCount: 3,
      violationCount: 0,
      zoningUnknownCount: 0,
      ownershipMix: [
        { ownerType: "city_public", label: "Public agency", count: 6 },
        { ownerType: "unknown", label: "Not yet classified", count: 4 },
      ],
    });
    expect(needs.some((n) => /not yet classified/i.test(n))).toBe(true);
    expect(needs.some((n) => /tax-sale or violation/i.test(n))).toBe(true);
  });
});

describe("deriveOpportunityAreas — curation, naming, uniqueness", () => {
  it("excludes clusters below the minimum size", () => {
    const clusters = [
      makeCluster({ id: 1, count: 6, vacantLandCount: 6 }),
      makeCluster({ id: 2, count: 4, vacantLandCount: 4 }), // below min → excluded
    ];
    const sitePoints = [
      ...Array.from({ length: 6 }, (_, i) => makePoint({ clusterId: 1, address: `${i} S BUFFALO AVE`, lat: 41.74, lon: -87.54 })),
      ...Array.from({ length: 4 }, (_, i) => makePoint({ clusterId: 2, address: `${i} S TORRENCE AVE`, lat: 41.72, lon: -87.56 })),
    ];
    const { areas, totalQualifying } = deriveOpportunityAreas(makeEdition({ clusters, sitePoints }));
    expect(totalQualifying).toBe(1);
    expect(areas).toHaveLength(1);
    expect(areas[0].clusterId).toBe(1);
  });

  it("caps display and reports the hidden remainder without a silent cap", () => {
    const clusters = Array.from({ length: 14 }, (_, i) =>
      makeCluster({ id: i + 1, count: 20 - i, vacantLandCount: 20 - i, centroid: { lat: 41.7 + i * 0.01, lon: -87.5 } }),
    );
    const sitePoints = clusters.flatMap((c) =>
      Array.from({ length: 5 }, (_, j) => makePoint({ clusterId: c.id, address: `${j} S STREET${c.id} AVE`, lat: c.centroid.lat, lon: c.centroid.lon })),
    );
    const { areas, hiddenCount, totalQualifying } = deriveOpportunityAreas(makeEdition({ clusters, sitePoints }), { cap: AREA_DISPLAY_CAP });
    expect(totalQualifying).toBe(14);
    expect(areas).toHaveLength(AREA_DISPLAY_CAP);
    expect(hiddenCount).toBe(14 - AREA_DISPLAY_CAP);
  });

  it("names by modal street and disambiguates shared streets by geography", () => {
    // Two clusters both modal on 91st Street, separated E–W.
    const clusters = [
      makeCluster({ id: 1, count: 5, centroid: { lat: 41.74, lon: -87.56 } }),
      makeCluster({ id: 2, count: 5, centroid: { lat: 41.74, lon: -87.53 } }),
    ];
    const sitePoints = [
      ...Array.from({ length: 5 }, (_, i) => makePoint({ clusterId: 1, address: `${i} E 91ST ST`, lat: 41.74, lon: -87.56 })),
      ...Array.from({ length: 5 }, (_, i) => makePoint({ clusterId: 2, address: `${i} E 91ST ST`, lat: 41.74, lon: -87.53 })),
    ];
    const { areas } = deriveOpportunityAreas(makeEdition({ clusters, sitePoints }));
    const names = areas.map((a) => a.name).sort();
    expect(names).toEqual(["91st Street area (east)", "91st Street area (west)"]);
    for (const a of areas) expect(a.namingSource).toBe("street");
  });

  it("falls back to 'Area N near {neighborhood}' when no member has an address", () => {
    const clusters = [makeCluster({ id: 3, count: 5 })];
    const sitePoints = Array.from({ length: 5 }, () => makePoint({ clusterId: 3, address: null }));
    const { areas } = deriveOpportunityAreas(makeEdition({ clusters, sitePoints, neighborhood: "South Chicago" }));
    expect(areas[0].namingSource).toBe("fallback");
    expect(areas[0].name).toBe("Area 3 near South Chicago");
  });

  it("groups by geography only and exposes ownership solely as a category mix", () => {
    const clusters = [
      makeCluster({
        id: 1,
        count: 9,
        vacantLandCount: 9,
        ownerTypeCounts: [
          { ownerType: "corporate_llc", count: 6 },
          { ownerType: "out_of_state", count: 0 },
          { ownerType: "local_private", count: 0 },
          { ownerType: "city_public", count: 0 },
          { ownerType: "unknown", count: 3 },
        ],
      }),
    ];
    const sitePoints = Array.from({ length: 9 }, (_, i) => makePoint({ clusterId: 1, address: `${i} S BUFFALO AVE` }));
    const { areas } = deriveOpportunityAreas(makeEdition({ clusters, sitePoints }));
    const mix = areas[0].ownershipMix;
    // Public labels, honest zeros, sums to the cluster count.
    expect(mix.find((m) => m.ownerType === "corporate_llc")?.label).toBe("Company or LLC");
    expect(mix.find((m) => m.ownerType === "unknown")?.label).toBe("Not yet classified");
    expect(mix.reduce((s, m) => s + m.count, 0)).toBe(9);
  });

  it("never emits an owner name / mailing address, nor any forbidden word", () => {
    const clusters = [makeCluster({ id: 1, count: 6, vacantLandCount: 6, corridorName: "Commercial Avenue" })];
    const sitePoints = Array.from({ length: 6 }, (_, i) => makePoint({ clusterId: 1, address: `${i} S BUFFALO AVE`, saleYear: 2015 }));
    const { areas } = deriveOpportunityAreas(makeEdition({ clusters, sitePoints }));
    const json = JSON.stringify(areas).toLowerCase();
    expect(json).not.toContain("ownername");
    expect(json).not.toContain("ownermailingaddress");
    expect(json).not.toContain("mailing address");
    for (const bad of FORBIDDEN) expect(json).not.toContain(bad);
  });
});

describe("opportunityAreaById", () => {
  it("resolves an area by cluster id with names identical to the index", () => {
    const clusters = [
      makeCluster({ id: 1, count: 8, centroid: { lat: 41.74, lon: -87.56 } }),
      makeCluster({ id: 2, count: 6, centroid: { lat: 41.72, lon: -87.53 } }),
    ];
    const sitePoints = [
      ...Array.from({ length: 8 }, (_, i) => makePoint({ clusterId: 1, address: `${i} S BUFFALO AVE`, lat: 41.74, lon: -87.56 })),
      ...Array.from({ length: 6 }, (_, i) => makePoint({ clusterId: 2, address: `${i} S TORRENCE AVE`, lat: 41.72, lon: -87.53 })),
    ];
    const edition = makeEdition({ clusters, sitePoints });
    const fromIndex = deriveOpportunityAreas(edition).areas.find((a) => a.clusterId === 2);
    const byId = opportunityAreaById(edition, 2);
    expect(byId).not.toBeNull();
    expect(byId!.name).toBe(fromIndex!.name);
    expect(opportunityAreaById(edition, 999)).toBeNull();
  });
});

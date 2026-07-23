import { describe, expect, it } from "vitest";
import {
  buildSiteCardHtml,
  cautionLine,
  significanceSentence,
  type CardData,
} from "../vacancy-site-card";
import type { VacancyCluster } from "@/lib/vacancy-index";

function cluster(count: number): VacancyCluster {
  return {
    id: 3,
    centroid: { lat: 41.74, lon: -87.54 },
    bbox: [-87.55, 41.73, -87.53, 41.75],
    count,
    ownerTypeCounts: [],
    taxSaleCount: 0,
    violationCount: 0,
    vacantLandCount: count,
    vacantBuildingCount: 0,
    corridorName: "Commercial Avenue",
  };
}

function card(over: Partial<CardData>): CardData {
  return {
    isLand: false,
    markerNumber: null,
    address: over.address ?? "8131 S EXCHANGE AVE",
    ownerType: over.ownerType ?? "city_public",
    propertyType: over.propertyType ?? "vacant_land",
    pin: over.pin ?? "21322110390000",
    squareFeet: over.squareFeet ?? 6234,
    zoningClass: over.zoningClass ?? "C1-1",
    incentiveCount: over.incentiveCount ?? 3,
    ownerConfidence: over.ownerConfidence ?? "pin_matched",
    ownerStructure: over.ownerStructure ?? "entity",
    ownerGeography: over.ownerGeography ?? "in_state",
    clusterId: over.clusterId ?? 3,
    saleYear: over.saleYear ?? null,
    violation: over.violation ?? false,
    cluster: over.cluster ?? cluster(over.clusterId != null ? 12 : 12),
    neighborhood: over.neighborhood ?? "South Chicago",
    ...over,
  };
}

describe("significanceSentence", () => {
  it("is exactly one sentence (one terminal period, no interior sentence break)", () => {
    const s = significanceSentence(card({ cluster: cluster(12) }));
    expect(s.endsWith(".")).toBe(true);
    // No interior ". " (would signal a second sentence).
    expect(s.slice(0, -1)).not.toMatch(/\.\s/);
    expect((s.match(/[.!?]/g) ?? []).length).toBe(1);
  });

  it("leads with land use and approximate size, never an owner phrase", () => {
    const s = significanceSentence(card({ zoningClass: "C1-1", squareFeet: 6234, cluster: cluster(3) }));
    expect(s).toMatch(/^Commercial parcel/);
    expect(s).toMatch(/about 6,200 sq ft/);
    expect(s.toLowerCase()).not.toContain("ideal for");
    expect(s.toLowerCase()).not.toContain("available");
  });
});

describe("cautionLine", () => {
  it("returns null when there is no consequential condition (no positive empty state)", () => {
    expect(cautionLine(card({ saleYear: null, violation: false }))).toBeNull();
  });
  it("surfaces the tax-sale record first", () => {
    expect(cautionLine(card({ saleYear: 2015, violation: true }))).toMatch(
      /tax-sale record on file \(latest 2015\) — verify current tax and title status/i,
    );
  });
  it("surfaces a building violation when there is no tax sale", () => {
    expect(cautionLine(card({ saleYear: null, violation: true }))).toMatch(/building-violation/i);
  });
});

describe("buildSiteCardHtml", () => {
  it("leads with the address and the property-type + approximate-size line", () => {
    const html = buildSiteCardHtml(card({ address: "8131 S EXCHANGE AVE", squareFeet: 6234 }), "60617", "July 22, 2026");
    expect(html).toContain("8131 S EXCHANGE AVE");
    expect(html).toContain("Vacant land · about 6,200 sq ft");
  });

  it("renders at most one caution line", () => {
    const html = buildSiteCardHtml(card({ saleYear: 2015, violation: true }), "60617", null);
    const cautions = html.match(/Needs checking/g) ?? [];
    expect(cautions.length).toBe(1);
  });

  it("puts the PIN behind the Site facts accordion", () => {
    const html = buildSiteCardHtml(card({ pin: "21322110390000" }), "60617", null);
    expect(html).toContain("<details");
    expect(html).toContain("Site facts");
    expect(html).toContain("21322110390000");
  });

  it("maps unknown ownership to 'Not yet classified' and never shows 'Unknown'", () => {
    const html = buildSiteCardHtml(card({ ownerType: "unknown" }), "60617", null);
    expect(html).toContain("Not yet classified");
    expect(html).not.toMatch(/>Unknown</);
  });

  it("links to the opportunity area when the site has a cluster", () => {
    const html = buildSiteCardHtml(card({ clusterId: 3 }), "60617", null);
    expect(html).toContain("/vacancy/60617/areas/3");
    expect(html).toContain("View its opportunity area");
  });

  it("offers a single primary county-record action when a PIN resolves", () => {
    const html = buildSiteCardHtml(card({ ownerType: "city_public", saleYear: null }), "60617", null);
    expect(html).toContain("cookcountyil.gov/cookviewer");
    expect(html).toContain("Check parcel record");
  });

  it("never emits an owner name field (anonymized end to end)", () => {
    const html = buildSiteCardHtml(card({}), "60617", null).toLowerCase();
    expect(html).not.toContain("ownername");
    expect(html).not.toContain("taxpayer name");
    expect(html).not.toContain("mailing address");
  });
});

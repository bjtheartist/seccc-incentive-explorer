import { describe, expect, it } from "vitest";
import {
  filterClusters,
  isEntityOwnerFromClusterOnly,
  sortAndFilterClusters,
  sortClusters,
} from "../owner-cluster-sort-filter";
import { EMPTY_DISTRESS_SIGNALS, type OwnerCluster } from "../corridor-owners";

function makeCluster(overrides: Partial<OwnerCluster>): OwnerCluster {
  return {
    clusterKey: overrides.clusterKey ?? "mail:fake",
    pins: [],
    ownerName: null,
    ownerMailingAddress: null,
    ownerType: null,
    parcelCount: 1,
    vacantParcelCount: 0,
    businessCount: 0,
    businessNames: [],
    sampleAddresses: [],
    latestTransferDate: null,
    latestBuyerName: null,
    latestSellerName: null,
    confidence: "Low",
    evidence: "",
    distressSignals: { ...EMPTY_DISTRESS_SIGNALS },
    ...overrides,
  };
}

// Fixture notes:
//  - mail:acme and owner:city are entities via BOTH a taxpayer-name marker
//    (LLC / "city of chicago") AND their classified ownerType.
//  - mail:doe-oos is a genuine out-of-state INDIVIDUAL: ownerType
//    "out_of_state" but a plain personal name with no entity marker — this
//    is the case that would be misclassified if entity detection only
//    looked at ownerType.
//  - pin:unknown has no owner data at all.
const clusters: OwnerCluster[] = [
  makeCluster({
    clusterKey: "mail:acme",
    ownerName: "ACME PROPERTIES LLC",
    ownerType: "corporate_llc",
    parcelCount: 10,
    vacantParcelCount: 4,
  }),
  makeCluster({
    clusterKey: "mail:jane",
    ownerName: "JANE SMITH",
    ownerType: "local_private",
    parcelCount: 3,
    vacantParcelCount: 1,
  }),
  makeCluster({
    clusterKey: "owner:city",
    ownerName: "CITY OF CHICAGO",
    ownerType: "city_public",
    parcelCount: 20,
    vacantParcelCount: 8,
  }),
  makeCluster({
    clusterKey: "mail:doe-oos",
    ownerName: "JOHN DOE",
    ownerType: "out_of_state",
    parcelCount: 6,
    vacantParcelCount: 6,
  }),
  makeCluster({
    clusterKey: "pin:unknown",
    ownerName: null,
    ownerType: null,
    parcelCount: 1,
    vacantParcelCount: 0,
  }),
];

describe("sortClusters", () => {
  it("sorts by vacantParcelCount descending", () => {
    const sorted = sortClusters(clusters, "vacant");
    expect(sorted.map((c) => c.clusterKey)).toEqual([
      "owner:city", // 8
      "mail:doe-oos", // 6
      "mail:acme", // 4
      "mail:jane", // 1
      "pin:unknown", // 0
    ]);
  });

  it("sorts by parcelCount descending", () => {
    const sorted = sortClusters(clusters, "parcels");
    expect(sorted.map((c) => c.clusterKey)).toEqual([
      "owner:city", // 20
      "mail:acme", // 10
      "mail:doe-oos", // 6
      "mail:jane", // 3
      "pin:unknown", // 1
    ]);
  });

  it("sorts by owner name A-Z, case-insensitively, with null/missing names sorted last", () => {
    const sorted = sortClusters(clusters, "ownerName");
    expect(sorted.map((c) => c.clusterKey)).toEqual([
      "mail:acme", // ACME PROPERTIES LLC
      "owner:city", // CITY OF CHICAGO
      "mail:jane", // JANE SMITH
      "mail:doe-oos", // JOHN DOE
      "pin:unknown", // no name — last regardless of sort direction
    ]);
  });

  it("does not mutate the input array", () => {
    const original = clusters.map((c) => c.clusterKey);
    sortClusters(clusters, "vacant");
    expect(clusters.map((c) => c.clusterKey)).toEqual(original);
  });
});

describe("filterClusters", () => {
  it("returns every cluster when no options are given", () => {
    expect(filterClusters(clusters)).toHaveLength(clusters.length);
  });

  it("filters by a set of owner-type chips, normalizing a missing type to unknown", () => {
    const result = filterClusters(clusters, { ownerTypes: ["corporate_llc", "unknown"] });
    expect(result.map((c) => c.clusterKey).sort()).toEqual(["mail:acme", "pin:unknown"].sort());
  });

  it("filters to entities only", () => {
    const result = filterClusters(clusters, { entityFilter: "entities" });
    // ACME (LLC marker + corporate_llc type), CITY OF CHICAGO (public marker + city_public type)
    expect(result.map((c) => c.clusterKey).sort()).toEqual(["mail:acme", "owner:city"].sort());
  });

  it("filters to individuals only, correctly excluding an out-of-state individual from 'entities'", () => {
    const result = filterClusters(clusters, { entityFilter: "individuals" });
    expect(result.map((c) => c.clusterKey).sort()).toEqual(
      ["mail:jane", "mail:doe-oos", "pin:unknown"].sort()
    );
  });

  it("applies a min-vacant floor, inclusive", () => {
    const result = filterClusters(clusters, { minVacant: 4 });
    expect(result.map((c) => c.clusterKey).sort()).toEqual(["mail:acme", "mail:doe-oos", "owner:city"].sort());
  });

  it("combines owner-type, entity, and min-vacant filters", () => {
    const result = filterClusters(clusters, {
      ownerTypes: ["corporate_llc", "out_of_state"],
      entityFilter: "all",
      minVacant: 5,
    });
    expect(result.map((c) => c.clusterKey)).toEqual(["mail:doe-oos"]);
  });
});

describe("sortAndFilterClusters", () => {
  it("defaults to vacant-descending with no filters", () => {
    const result = sortAndFilterClusters(clusters);
    expect(result.map((c) => c.clusterKey)).toEqual([
      "owner:city",
      "mail:doe-oos",
      "mail:acme",
      "mail:jane",
      "pin:unknown",
    ]);
  });

  it("filters then sorts by the requested key", () => {
    const result = sortAndFilterClusters(clusters, {
      entityFilter: "individuals",
      sortKey: "ownerName",
    });
    expect(result.map((c) => c.clusterKey)).toEqual(["mail:jane", "mail:doe-oos", "pin:unknown"]);
  });
});

describe("isEntityOwnerFromClusterOnly", () => {
  it("treats a taxpayer-name entity marker as an entity", () => {
    expect(isEntityOwnerFromClusterOnly({ ownerName: "ACME PROPERTIES LLC", ownerType: null })).toBe(true);
  });

  it("treats corporate_llc / city_public ownerType as an entity even without a name marker", () => {
    expect(isEntityOwnerFromClusterOnly({ ownerName: "JANE DOE", ownerType: "corporate_llc" })).toBe(true);
    expect(isEntityOwnerFromClusterOnly({ ownerName: null, ownerType: "city_public" })).toBe(true);
  });

  it("treats an out-of-state individual (no name marker, non-entity ownerType) as an individual", () => {
    expect(isEntityOwnerFromClusterOnly({ ownerName: "JOHN DOE", ownerType: "out_of_state" })).toBe(false);
  });

  it("treats a plain individual name with no entity ownerType as an individual", () => {
    expect(isEntityOwnerFromClusterOnly({ ownerName: "JANE SMITH", ownerType: "local_private" })).toBe(false);
    expect(isEntityOwnerFromClusterOnly({ ownerName: null, ownerType: null })).toBe(false);
  });
});

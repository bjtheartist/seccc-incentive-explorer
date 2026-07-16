import { describe, expect, it } from "vitest";
import type { OwnerClusterGeoFeatureCollection } from "../owner-cluster-geo";
import { matchReportAddressToOwnerParcel, topOwnerClustersByVacancy } from "../owner-file-report-context";

function fixtureCollection(): OwnerClusterGeoFeatureCollection {
  return {
    type: "FeatureCollection",
    generatedAt: "2026-01-01T00:00:00.000Z",
    meta: { skippedNullLatLng: 0, zips: ["60617", "60624"] },
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-87.5605, 41.7137] },
        properties: {
          pin: "FAKE-1",
          address: "100 E 100TH ST",
          vacant: true,
          zip: "60617",
          clusterKey: "mail:owner-one",
          ownerName: "OWNER ONE LLC",
          ownerType: "corporate_llc",
          clusterParcelCount: 6,
          clusterVacantCount: 4,
          confidence: "High",
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-87.5598, 41.714] },
        properties: {
          pin: "FAKE-2",
          address: "102 E 100TH ST",
          vacant: true,
          zip: "60617",
          clusterKey: "mail:owner-one",
          ownerName: "OWNER ONE LLC",
          ownerType: "corporate_llc",
          clusterParcelCount: 6,
          clusterVacantCount: 4,
          confidence: "High",
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-87.7273, 41.8725] },
        properties: {
          pin: "FAKE-3",
          address: "200 S PULASKI RD",
          vacant: false,
          zip: "60624",
          clusterKey: "mail:owner-two",
          ownerName: "OWNER TWO TRUST",
          ownerType: "out_of_state",
          clusterParcelCount: 6,
          clusterVacantCount: 2,
          confidence: "Medium",
        },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-87.7266, 41.8728] },
        properties: {
          pin: "FAKE-4",
          address: "202 S PULASKI RD",
          vacant: false,
          zip: "60624",
          clusterKey: "mail:owner-three",
          ownerName: "OWNER THREE INC",
          ownerType: "local_private",
          clusterParcelCount: 1,
          clusterVacantCount: 1,
          confidence: "Low",
        },
      },
    ],
  };
}

describe("matchReportAddressToOwnerParcel", () => {
  it("finds an exact normalized-address match", () => {
    const match = matchReportAddressToOwnerParcel(fixtureCollection(), "100 E 100th St");
    expect(match).not.toBeNull();
    expect(match!.pin).toBe("FAKE-1");
    expect(match!.ownerName).toBe("OWNER ONE LLC");
    expect(match!.clusterVacantCount).toBe(4);
  });

  it("matches through common formatting differences (punctuation, spacing, case)", () => {
    const match = matchReportAddressToOwnerParcel(fixtureCollection(), "100 E. 100TH ST.,");
    expect(match?.pin).toBe("FAKE-1");
  });

  it("falls back to a fuzzy contains-match when no exact match exists", () => {
    // Query includes a suite suffix that isn't in the parcel record.
    const match = matchReportAddressToOwnerParcel(fixtureCollection(), "200 S Pulaski Rd Suite 2, Chicago, IL 60624");
    expect(match?.pin).toBe("FAKE-3");
  });

  it("returns null for an address with no plausible match", () => {
    expect(matchReportAddressToOwnerParcel(fixtureCollection(), "9999 W Nowhere Ave")).toBeNull();
  });

  it("returns null for an empty/blank address", () => {
    expect(matchReportAddressToOwnerParcel(fixtureCollection(), "")).toBeNull();
    expect(matchReportAddressToOwnerParcel(fixtureCollection(), "   ")).toBeNull();
  });
});

describe("topOwnerClustersByVacancy", () => {
  it("returns clusters for the given zip only, sorted by vacant count desc", () => {
    const top = topOwnerClustersByVacancy(fixtureCollection(), "60624", 3);
    expect(top.map((c) => c.clusterKey)).toEqual(["mail:owner-two", "mail:owner-three"]);
    expect(top.every((c) => c.zip === "60624")).toBe(true);
  });

  it("deduplicates to one row per clusterKey even with multiple parcels", () => {
    const top = topOwnerClustersByVacancy(fixtureCollection(), "60617", 3);
    expect(top).toHaveLength(1);
    expect(top[0].clusterKey).toBe("mail:owner-one");
  });

  it("respects the limit parameter", () => {
    expect(topOwnerClustersByVacancy(fixtureCollection(), "60624", 1)).toHaveLength(1);
  });

  it("returns an empty array for a zip with no clusters", () => {
    expect(topOwnerClustersByVacancy(fixtureCollection(), "60601", 3)).toEqual([]);
  });
});

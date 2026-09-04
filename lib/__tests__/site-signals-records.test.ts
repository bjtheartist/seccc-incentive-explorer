import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature, FeatureCollection } from "geojson";

/**
 * Nearby public records have to be back-traceable: a count alone ("1 open
 * tank-leak record within 1/4 mi") cannot be checked against the agency.
 * These assert the record list behind each count — what is included, in what
 * order, where the threshold cuts, and what the cap reports.
 */

const LAT = 41.8;
const LON = -87.6;
/** Degrees of latitude per mile at this scale, close enough for thresholds. */
const MILE_IN_DEG = 1 / 69.05;

function pointAt(milesNorth: number, props: Record<string, unknown>): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [LON, LAT + milesNorth * MILE_IN_DEG] },
    properties: props,
  };
}

function fc(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

function lustFeature(miles: number, incident: string, status = "Open", nfrDate = ""): Feature {
  return pointAt(miles, {
    name: `Incident site ${incident}`,
    address: `${incident} S Example Ave`,
    incident,
    status,
    nfrDate,
  });
}

// 15 open incidents inside the quarter mile (cap is 12, so 3 are truncated),
// deliberately shuffled so a sorted result proves the sort.
const OPEN_LUST_FEATURES = [11, 3, 15, 7, 1, 14, 5, 9, 2, 12, 6, 13, 4, 10, 8].map((n) =>
  lustFeature(n * 0.015, `2000${String(n).padStart(4, "0")}`),
);

const LUST = fc([
  ...OPEN_LUST_FEATURES,
  // Closed incidents are not "open tank-leak records" and must not appear.
  lustFeature(0.005, "20009001", "Closed (NFR letter issued)", "2008-02-22"),
  // Outside the quarter-mile threshold.
  lustFeature(0.9, "20009999"),
]);

const NOF = fc([
  pointAt(0.3, {
    name: "Natural Roots Kids Hair, LLC",
    address: "1851-1855 E 87th St",
    grantAmount: 190725.5,
    grantType: "small",
    status: "completed",
    applicant: "Tess McKenzie",
    communityArea: "Calumet Heights",
    ward: "8",
    approvalDate: "2020-12-22",
    completionDate: "2023-05-23",
    totalProjectCost: 343215,
  }),
  pointAt(0.45, {
    name: "Big Marsh Redevelopment",
    address: "11000 S Doty Ave",
    grantAmount: 1250000,
    grantType: "large",
    status: "approved",
    applicant: "Someone Else",
    communityArea: "Riverdale",
    ward: "10",
    approvalDate: "2021-04-01",
    completionDate: "",
  }),
  // Outside the half-mile threshold.
  pointAt(0.8, { name: "Too Far Cafe", grantAmount: 1000, grantType: "small" }),
]);

const PARCELS = fc([
  pointAt(0.05, {
    name: "Class 6b Industrial - 895 W Upper Express Dr",
    incentiveClass: "Class 6b Industrial",
    classCode: "663",
    pin: "09321000128007",
    address: "895 W Upper Express Dr",
    reportUrl: "https://www.cookcountyassessoril.gov/pin/09321000128007",
  }),
  // Outside the quarter-mile threshold.
  pointAt(0.4, {
    name: "Class 8 - far parcel",
    incentiveClass: "Class 8",
    classCode: "800",
    pin: "11111111111111",
    reportUrl: "https://www.cookcountyassessoril.gov/pin/11111111111111",
  }),
]);

const BROWNFIELDS = fc([
  pointAt(0.4, {
    name: "5541 S. Racine Ave",
    address: "5541 S. Racine Ave",
    registryId: "110071986557",
    acresId: "258169",
    lastReported: "2023-12-13",
    reportUrl:
      "https://ofmpub.epa.gov/frs_public2/fii_query_detail.disp_program_facility?p_registry_id=110071986557",
  }),
  // Outside the half-mile threshold.
  pointAt(0.7, {
    name: "Far brownfield",
    registryId: "999",
    acresId: "998",
    lastReported: "2019-01-01",
  }),
]);

const LAYERS: Record<string, FeatureCollection> = {
  "/data/zones/lust-sites.geojson": LUST,
  "/data/zones/nof-funded-projects.geojson": NOF,
  "/data/zones/county-incentive-parcels.geojson": PARCELS,
  "/data/zones/brownfield-sites.geojson": BROWNFIELDS,
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: Boolean(LAYERS[url]),
      json: async () => LAYERS[url] ?? null,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signals() {
  const mod = await import("@/lib/site-signals");
  const result = await mod.getSiteSignals(LAT, LON);
  if (!result) throw new Error("expected site signals");
  return result;
}

describe("site-signal records", () => {
  it("keeps the counts the surfaces already show", async () => {
    const result = await signals();

    expect(result.openLustNearby).toBe(15);
    expect(result.nofAwardsNearby).toBe(2);
    expect(result.incentiveParcelsNearby).toBe(1);
  });

  it("lists open tank-leak records nearest-first, filtered, capped, with a truncated count", async () => {
    const group = (await signals()).records!.openLust;

    // 15 open incidents are inside the threshold; the cap keeps 12.
    expect(group.records).toHaveLength(12);
    expect(group.truncated).toBe(3);

    const miles = group.records.map((record) => record.miles);
    expect([...miles].sort((a, b) => a - b)).toEqual(miles);
    expect(group.records[0].name).toBe("Incident site 20000001");

    // Closed incidents and out-of-threshold incidents never appear.
    const incidents = group.records.flatMap((record) => record.facts);
    expect(incidents.join(" ")).not.toContain("20009001");
    expect(incidents.join(" ")).not.toContain("20009999");
  });

  it("carries the incident number, status and the Illinois EPA lookup for a tank-leak record", async () => {
    const record = (await signals()).records!.openLust.records[0];

    expect(record.address).toBe("20000001 S Example Ave");
    expect(record.facts).toContain("Incident no. 20000001");
    expect(record.facts).toContain("Status: Open");
    expect(record.sourceLabel).toBe("Illinois EPA leaking-UST incident lookup");
    expect(record.sourceUrl).toBe(
      "https://epa.illinois.gov/topics/cleanup-programs/bol-database/leaking-ust.html",
    );
  });

  it("carries NOF grant facts and the matching Chicago data-portal dataset", async () => {
    const group = (await signals()).records!.nofAwards;

    expect(group.records.map((record) => record.name)).toEqual([
      "Natural Roots Kids Hair, LLC",
      "Big Marsh Redevelopment",
    ]);
    expect(group.truncated).toBe(0);

    const [small, large] = group.records;
    expect(small.facts).toContain("NOF Small grant: $190,726");
    expect(small.facts).toContain("Approved 2020-12-22");
    expect(small.facts).toContain("Completed 2023-05-23");
    expect(small.facts).toContain("Ward 8 · Calumet Heights");
    expect(small.sourceUrl).toBe("https://data.cityofchicago.org/d/rym7-49n8");

    expect(large.facts).toContain("NOF Large grant: $1,250,000");
    expect(large.sourceUrl).toBe("https://data.cityofchicago.org/d/j7ew-b73u");
    // No completion date on an approved-but-unfinished project.
    expect(large.facts.join(" ")).not.toContain("Completed");
  });

  it("uses the assessor and EPA per-record deep links the layers already publish", async () => {
    const result = await signals();

    const parcel = result.records!.incentiveParcels.records;
    expect(parcel).toHaveLength(1);
    expect(parcel[0].facts).toContain("Class 6b Industrial (class code 663)");
    expect(parcel[0].facts).toContain("PIN 09321000128007");
    expect(parcel[0].sourceUrl).toBe(
      "https://www.cookcountyassessoril.gov/pin/09321000128007",
    );

    const brownfields = result.records!.brownfields.records;
    expect(brownfields).toHaveLength(1);
    expect(brownfields[0].facts).toContain("EPA registry ID 110071986557");
    expect(brownfields[0].facts).toContain("ACRES ID 258169");
    expect(brownfields[0].facts).toContain("Last reported 2023-12-13");
    expect(brownfields[0].sourceUrl).toContain("p_registry_id=110071986557");
  });
});

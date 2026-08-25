import { describe, expect, it } from "vitest";
import {
  buildCensusBatchCsv,
  evaluateCensusResult,
  parseCensusBatchResponse,
  parseCsv,
  selectInternalPermitGeocode,
  uniqueCensusRequests,
  type PermitBackfillCandidate,
} from "../permit-geocode-backfill";
import { parsePermitGeocodeBackfillCliArgs } from "../../scripts/backfill-permit-geocodes";
import { parseRepairPermitMatchCliArgs } from "../../scripts/repair-permit-match-table";

function candidate(overrides: Partial<PermitBackfillCandidate> = {}): PermitBackfillCandidate {
  return {
    permitId: "P-1",
    address: "100 S STATE ST",
    addressKey: "100sstatest",
    addressCandidateLat: 41.88,
    addressCandidateLon: -87.63,
    addressCandidatePoints: 2,
    addressCandidateRows: 10,
    addressMaxSpreadM: 4,
    pinCandidateLat: 41.881,
    pinCandidateLon: -87.631,
    pinCandidatePoints: 1,
    pinCandidateRows: 3,
    pinMaxSpreadM: 0,
    ...overrides,
  };
}

describe("native City coordinate reuse", () => {
  it("prefers an exact address cluster and records its observed spread", () => {
    expect(selectInternalPermitGeocode(candidate())).toEqual({
      source: "city_permit_address_reuse",
      matchType: "exact_address_cluster",
      lat: 41.88,
      lon: -87.63,
      maxSpreadM: 4,
      candidatePoints: 2,
      candidateRows: 10,
    });
  });

  it("falls back to an exact PIN cluster when address points disagree", () => {
    expect(
      selectInternalPermitGeocode(candidate({ addressMaxSpreadM: 25.01 })),
    ).toMatchObject({
      source: "city_permit_pin_reuse",
      matchType: "exact_pin_cluster",
    });
  });

  it("refuses both ambiguous and outside-Chicago candidates", () => {
    expect(
      selectInternalPermitGeocode(
        candidate({
          addressMaxSpreadM: 100,
          pinMaxSpreadM: 100,
        }),
      ),
    ).toBeNull();
    expect(
      selectInternalPermitGeocode(
        candidate({
          addressCandidateLat: 40,
          pinCandidateLat: 40,
        }),
      ),
    ).toBeNull();
  });
});

describe("Census batch contract", () => {
  it("writes the required five input fields and de-duplicates address requests", () => {
    const requests = uniqueCensusRequests([
      candidate(),
      candidate({ permitId: "P-2" }),
      candidate({
        permitId: "P-3",
        address: "200 W MADISON ST",
        addressKey: "200wmadisonst",
      }),
    ]);
    expect(requests).toHaveLength(2);
    expect(buildCensusBatchCsv(requests).split("\n")[0]).toBe(
      "address-00001,100 S STATE ST,Chicago,IL,",
    );
  });

  it("parses quoted Census output, including its longitude/latitude field", () => {
    const response = [
      'address-00001,"100 S STATE ST, Chicago, IL,",Match,Exact,100 S STATE ST,"-87.627800,41.879600",12345,L',
      'address-00002,"200 W MADISON ST, Chicago, IL,",No_Match,,,,',
    ].join("\r\n");
    const parsed = parseCensusBatchResponse(response);
    expect(parsed.get("address-00001")).toMatchObject({
      matchIndicator: "Match",
      matchType: "Exact",
      lon: -87.6278,
      lat: 41.8796,
      tigerLineId: "12345",
    });
    expect(parsed.get("address-00002")).toMatchObject({
      matchIndicator: "No_Match",
      lat: null,
      lon: null,
    });
  });

  it("handles embedded quotes and rejects a truncated quoted response", () => {
    expect(parseCsv('1,"12 W ""OAK"" ST",Chicago\n')).toEqual([
      ["1", '12 W "OAK" ST', "Chicago"],
    ]);
    expect(() => parseCsv('1,"unfinished')).toThrow(/quoted field/);
  });

  it("accepts only exact in-bounds matches and keeps every other case non-applied", () => {
    const exact = parseCensusBatchResponse(
      'a,100 S STATE ST,Match,Exact,100 S STATE ST,"-87.63,41.88",1,L\n',
    ).get("a");
    expect(evaluateCensusResult(exact)).toEqual({
      status: "accepted",
      reason: "exact_match",
      lat: 41.88,
      lon: -87.63,
    });

    expect(evaluateCensusResult({ ...exact!, matchType: "Non_Exact" })).toMatchObject({
      status: "review_required",
      reason: "non_exact_match",
    });
    expect(evaluateCensusResult({ ...exact!, lat: 40 })).toMatchObject({
      status: "review_required",
      reason: "outside_chicago",
    });
    expect(evaluateCensusResult({ ...exact!, matchIndicator: "No_Match" })).toEqual({
      status: "unmatched",
      reason: "no_match",
      lat: null,
      lon: null,
    });
    expect(evaluateCensusResult(undefined)).toMatchObject({
      status: "provider_error",
      reason: "missing_response",
    });
  });
});

describe("controlled-operation CLI defaults", () => {
  it("keeps both jobs read-only unless --write is explicit", () => {
    expect(parsePermitGeocodeBackfillCliArgs([])).toMatchObject({
      write: false,
      fetchCensus: false,
    });
    expect(parseRepairPermitMatchCliArgs([]).write).toBe(false);
    expect(parsePermitGeocodeBackfillCliArgs(["--fetch-census"])).toMatchObject({
      write: false,
      fetchCensus: true,
    });
  });

  it("makes --write fetch the provider and rejects conflicting modes", () => {
    expect(parsePermitGeocodeBackfillCliArgs(["--write"])).toMatchObject({
      write: true,
      fetchCensus: true,
    });
    expect(() =>
      parsePermitGeocodeBackfillCliArgs(["--write", "--dry-run"]),
    ).toThrow(/either --write or --dry-run/);
    expect(() => parseRepairPermitMatchCliArgs(["--write", "--dry-run"])).toThrow(
      /either --write or --dry-run/,
    );
  });
});

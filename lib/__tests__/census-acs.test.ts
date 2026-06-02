import { describe, expect, it, vi } from "vitest";
import {
  fetchLiveZipAcsContext,
  parseCensusEstimate,
  residentSpendingPowerProxy,
} from "@/lib/census-acs";

describe("parseCensusEstimate", () => {
  it("parses normal Census estimate values", () => {
    expect(parseCensusEstimate("121458")).toBe(121458);
  });

  it("treats Census sentinel and missing values as null", () => {
    expect(parseCensusEstimate("-666666666")).toBeNull();
    expect(parseCensusEstimate(undefined)).toBeNull();
  });
});

describe("residentSpendingPowerProxy", () => {
  it("models spending power from households and median household income", () => {
    expect(residentSpendingPowerProxy(9631, 121458)).toBe(1169761998);
  });
});

describe("fetchLiveZipAcsContext", () => {
  it("returns null when no API key is available", async () => {
    await expect(
      fetchLiveZipAcsContext("60601", { apiKey: "" })
    ).resolves.toBeNull();
  });

  it("maps live ACS ZCTA response into report context values", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [
          "NAME",
          "B01003_001E",
          "B11001_001E",
          "B19013_001E",
          "B23025_004E",
          "zip code tabulation area",
        ],
        ["ZCTA5 60601", "15235", "9631", "121458", "10081", "60601"],
      ],
    });

    const context = await fetchLiveZipAcsContext("60601", {
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(context).toEqual({
      zip: "60601",
      population: 15235,
      households: 9631,
      medianHouseholdIncome: 121458,
      employedResidents: 10081,
      residentSpendingPowerProxy: 1169761998,
      sourceLabel: "2024 ACS 5-year ZCTA API (live Census)",
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      "https://api.census.gov/data/2024/acs/acs5"
    );
  });
});

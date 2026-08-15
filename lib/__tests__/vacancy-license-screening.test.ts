import { describe, expect, it, vi } from "vitest";
import {
  screenVacancyLicenseConflicts,
  VACANCY_LICENSE_MAX_BATCHES,
  VACANCY_LICENSE_BATCH_RESULT_LIMIT,
  VACANCY_LICENSE_MAX_SOURCE_CALLS,
} from "@/lib/vacancy-license-screening";

function collection(count = 2): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [-87.6, 41.8] },
      properties: { id: `p-${index}`, address: `${100 + index} S STATE ST` },
    })),
  };
}

const CHECKED_AT = "2026-08-14T12:00:00.000Z";

describe("area vacancy current-license conflict screening", () => {
  it("queries the Chicago license day before the UTC-day rollover", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const result = await screenVacancyLicenseConflicts(collection(1), {
      fetchImpl,
      checkedAt: "2026-08-15T04:38:00.000Z",
    });

    expect(decodeURIComponent(String(fetchImpl.mock.calls[0][0]))).toContain(
      "expiration_date>'2026-08-14T00:00:00'",
    );
    expect(result.meta.checkedAt).toBe("2026-08-15T04:38:00.000Z");
  });

  it("requires issued status and future expiration and carries evidence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            address: "100 S STATE ST",
            doing_business_as_name: "Open Cafe",
            license_description: "Retail Food",
            license_status: "AAI",
            expiration_date: "2027-01-01T00:00:00.000",
          },
          {
            address: "101 S STATE ST",
            doing_business_as_name: "Cancelled Shop",
            license_description: "Retail Food",
            license_status: "AAC",
            expiration_date: "2027-01-01T00:00:00.000",
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await screenVacancyLicenseConflicts(collection(), {
      fetchImpl,
      checkedAt: CHECKED_AT,
    });

    expect(decodeURIComponent(String(fetchImpl.mock.calls[0][0]))).toContain(
      "license_status='AAI'",
    );
    expect(result.features[0].properties).toMatchObject({
      licenseCheckState: "match",
      currentLicenseMatches: [
        {
          name: "Open Cafe",
          description: "Retail Food",
          status: "AAI",
          expirationDate: "2027-01-01",
        },
      ],
      licenseCheckedAt: CHECKED_AT,
    });
    expect(result.features[1].properties?.licenseCheckState).toBe("no_match");
    expect(result.meta).toMatchObject({
      status: "partial",
      checkedCount: 2,
      matchedPropertyCount: 1,
      malformedRowCount: 1,
      partialReasons: ["malformed_source_rows"],
    });
    expect(result.meta.caveats.join(" ")).toContain("1 malformed");
  });

  it("preserves strict source calendar days for timezone-less and offset timestamps", async () => {
    const rows = [
      ["100 S STATE ST", "Late Local", "2027-01-01T23:30:00.000"],
      ["101 S STATE ST", "Offset Source", "2027-01-02T00:30:00-10:00"],
      ["102 S STATE ST", "Leap Day", "2028-02-29T22:30:00.000"],
      ["103 S STATE ST", "Impossible Day", "2027-02-30T00:00:00.000"],
      ["104 S STATE ST", "Malformed Date", "01/03/2027"],
    ].map(([address, name, expiration_date]) => ({
      address,
      doing_business_as_name: name,
      license_description: "Limited Business",
      license_status: "AAI",
      expiration_date,
    }));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(rows), { status: 200 }),
    );

    const result = await screenVacancyLicenseConflicts(collection(5), {
      fetchImpl,
      checkedAt: CHECKED_AT,
    });

    expect(result.features.slice(0, 3).map((feature) =>
      feature.properties?.currentLicenseMatches?.[0]?.expirationDate,
    )).toEqual(["2027-01-01", "2027-01-02", "2028-02-29"]);
    expect(result.features.slice(3).every((feature) =>
      feature.properties?.licenseCheckState === "no_match",
    )).toBe(true);
    expect(result.meta).toMatchObject({
      status: "partial",
      malformedRowCount: 2,
      partialReasons: ["malformed_source_rows"],
    });
  });

  it("subdivides a saturated batch and does not double-count matches", async () => {
    const saturated = Array.from(
      { length: VACANCY_LICENSE_BATCH_RESULT_LIMIT },
      () => ({
        address: "100 S STATE ST",
        doing_business_as_name: "Repeated Cafe",
        license_description: "Retail Food",
        license_status: "AAI",
        expiration_date: "2027-01-01T00:00:00.000",
      }),
    );
    const completeMatch = saturated[0];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(saturated), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([completeMatch]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([completeMatch]), { status: 200 }));

    const result = await screenVacancyLicenseConflicts(collection(50), {
      fetchImpl,
      checkedAt: CHECKED_AT,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.meta).toMatchObject({
      status: "available",
      checkedCount: 50,
      matchedPropertyCount: 1,
      sourceCallCount: 3,
      successfulBatches: 1,
      failedBatches: 0,
    });
    expect(result.features[0].properties?.currentLicenseMatches).toHaveLength(1);
  });

  it("keeps a saturated single address unavailable instead of publishing no-match", async () => {
    const saturated = Array.from(
      { length: VACANCY_LICENSE_BATCH_RESULT_LIMIT },
      () => ({
        address: "100 S STATE ST",
        doing_business_as_name: "Dense Address",
        license_description: "Limited Business",
        license_status: "AAI",
        expiration_date: "2027-01-01T00:00:00.000",
      }),
    );
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(saturated), { status: 200 }),
    );

    const result = await screenVacancyLicenseConflicts(collection(1), {
      fetchImpl,
      checkedAt: CHECKED_AT,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.meta).toMatchObject({
      status: "unavailable",
      checkedCount: 0,
      sourceCallCount: 1,
      failedBatches: 1,
      partialReasons: ["source_batch_failure"],
    });
    expect(result.features[0].properties?.licenseCheckState).toBe("unavailable");
  });

  it("bounds recursively saturated screening at the hard source-call ceiling", async () => {
    const saturated = Array.from(
      { length: VACANCY_LICENSE_BATCH_RESULT_LIMIT },
      () => ({
        address: "100 S STATE ST",
        doing_business_as_name: "Dense Address",
        license_description: "Limited Business",
        license_status: "AAI",
        expiration_date: "2027-01-01T00:00:00.000",
      }),
    );
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(saturated), { status: 200 })),
    );

    const result = await screenVacancyLicenseConflicts(collection(500), {
      fetchImpl,
      checkedAt: CHECKED_AT,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(VACANCY_LICENSE_MAX_SOURCE_CALLS);
    expect(result.meta).toMatchObject({
      status: "unavailable",
      checkedCount: 0,
      sourceCallCount: VACANCY_LICENSE_MAX_SOURCE_CALLS,
      successfulBatches: 0,
      failedBatches: 10,
      partialReasons: ["source_batch_failure"],
    });
    expect(result.features.every((feature) =>
      feature.properties?.licenseCheckState === "unavailable",
    )).toBe(true);
  });

  it("makes a failed source explicit instead of returning clean zero", async () => {
    const result = await screenVacancyLicenseConflicts(collection(), {
      fetchImpl: vi.fn().mockResolvedValue(new Response("down", { status: 503 })),
      checkedAt: CHECKED_AT,
    });
    expect(result.meta).toMatchObject({
      status: "unavailable",
      checkedCount: 0,
      failedBatches: 1,
      malformedRowCount: 0,
      partialReasons: ["source_batch_failure"],
    });
    expect(result.features.every((feature) =>
      feature.properties?.licenseCheckState === "unavailable",
    )).toBe(true);
  });

  it("caps a 10,000-record area at ten batched source calls", async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    );
    const result = await screenVacancyLicenseConflicts(collection(10_000), {
      fetchImpl,
      checkedAt: CHECKED_AT,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(VACANCY_LICENSE_MAX_BATCHES);
    expect(result.meta).toMatchObject({
      status: "partial",
      candidateCount: 10_000,
      checkedCount: 500,
      capped: true,
      partialReasons: ["address_cap"],
    });
    expect(
      result.features.filter(
        (feature) => feature.properties?.licenseCheckState === "not_checked_cap",
      ),
    ).toHaveLength(9_500);
  });
});

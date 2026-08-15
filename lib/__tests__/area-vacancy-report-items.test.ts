import { describe, expect, it } from "vitest";
import { licenseScreeningReportItems } from "@/lib/area-vacancy-presentation";
import type { VacancyLicenseScreeningMetadata } from "@/lib/vacancy-license-screening";

describe("area vacancy report license coverage", () => {
  it("keeps every capped partial-screening fact inside PDF-safe compact items", () => {
    const screening: VacancyLicenseScreeningMetadata = {
      policyVersion: "issued-exact-address-v4",
      sourcePath: "https://data.cityofchicago.org/resource/r5kz-chrr.json",
      status: "partial",
      checkedAt: "2026-08-15T04:38:00.000Z",
      candidateCount: 1_499,
      checkedCount: 500,
      matchedPropertyCount: 3,
      capped: true,
      addressCap: 500,
      sourceCallCount: 10,
      successfulBatches: 9,
      failedBatches: 1,
      malformedRowCount: 7,
      partialReasons: [
        "address_cap",
        "source_batch_failure",
        "malformed_source_rows",
      ],
      caveats: [],
    };

    const items = licenseScreeningReportItems(screening);
    const serialized = JSON.stringify(items);
    expect(items.every((item) => !item.detail || item.detail.length <= 175)).toBe(true);
    expect(serialized).toContain("500 of 1499");
    expect(serialized).toContain("3 returned properties matched");
    expect(serialized).toContain("Capped: yes");
    expect(serialized).toContain("Address cap 500");
    expect(serialized).toContain("9 complete, 1 incomplete");
    expect(serialized).toContain("source calls: 10");
    expect(serialized).toContain("malformed rows: 7");
    expect(serialized).toContain("2026-08-15T04:38:00.000Z");
    expect(serialized).toContain(
      "address_cap, source_batch_failure, malformed_source_rows",
    );
  });
});

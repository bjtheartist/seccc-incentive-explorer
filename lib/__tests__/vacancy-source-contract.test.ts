import { describe, expect, it } from "vitest";
import {
  assertVacancySourceSnapshotSane,
  build311VacancySourcePageUrl,
  buildColsSourcePageUrl,
  COLS_STABLE_ORDER,
  isPlausible311VacancySourceRow,
  isPlausibleColsSourceRow,
  SR311_STABLE_ORDER,
} from "@/lib/vacancy-source-contract";

describe("vacancy destructive source contract", () => {
  it("rejects empty and schema-collapsed complete HTTP snapshots", () => {
    expect(() =>
      assertVacancySourceSnapshotSane({
        source: "COLS",
        rawCount: 0,
        validShapeCount: 0,
        candidateCount: 0,
        normalizedCount: 0,
      }),
    ).toThrow("Live membership was not changed");
    expect(() =>
      assertVacancySourceSnapshotSane({
        source: "311",
        rawCount: 10_000,
        validShapeCount: 0,
        candidateCount: 10_000,
        normalizedCount: 0,
      }),
    ).toThrow("failed destructive-publish sanity");
  });

  it("accepts a plausible complete snapshot and requires explicit override for intentional zero", () => {
    expect(() =>
      assertVacancySourceSnapshotSane({
        source: "COLS",
        rawCount: 20_000,
        validShapeCount: 18_000,
        candidateCount: 18_000,
        normalizedCount: 18_000,
      }),
    ).not.toThrow();
    expect(() =>
      assertVacancySourceSnapshotSane(
        {
          source: "311",
          rawCount: 0,
          validShapeCount: 0,
          candidateCount: 0,
          normalizedCount: 0,
        },
        true,
      ),
    ).not.toThrow();
  });

  it("requires stable unique Socrata ordering and source-specific row shape", () => {
    expect(COLS_STABLE_ORDER).toBe("pin,:id");
    expect(SR311_STABLE_ORDER).toBe("created_date DESC,:id");
    expect(
      new URL(
        buildColsSourcePageUrl("https://example.test/cols", 2_000, 1_000),
      ).searchParams.get("$order"),
    ).toBe("pin,:id");
    expect(
      new URL(
        build311VacancySourcePageUrl(
          "https://example.test/311",
          "2021-08-14",
          3_000,
          1_000,
        ),
      ).searchParams.get("$order"),
    ).toBe("created_date DESC,:id");
    expect(
      isPlausibleColsSourceRow({
        pin: "16-11-105-004-0000",
        address: "1 TEST ST",
        latitude: "41.8",
        longitude: "-87.7",
      }),
    ).toBe(true);
    expect(
      isPlausible311VacancySourceRow({
        sr_number: "SR26-1",
        sr_type: "Clean Vacant Lot Request",
        created_date: "2026-01-01T00:00:00.000Z",
        street_address: "1 TEST ST",
        latitude: "41.8",
        longitude: "-87.7",
      }),
    ).toBe(true);
    expect(isPlausible311VacancySourceRow({ sr_number: "SR26-1" })).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  assertVacancySourceSnapshotSane,
  assertCclbaMembershipTransitionSane,
  assertCclbaSourceSnapshotSane,
  build311VacancySourcePageUrl,
  buildColsSourcePageUrl,
  COLS_STABLE_ORDER,
  isPlausible311VacancySourceRow,
  isPlausibleCclbaSourceRow,
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

  it("rejects a one-row public subset and requires source-scope arithmetic", () => {
    expect(() =>
      assertCclbaSourceSnapshotSane({
        expectedCount: 1,
        rawCount: 1,
        uniqueIdCount: 1,
        validShapeCount: 1,
        chicagoCount: 1,
        locatedChicagoCount: 1,
        unlocatedChicagoCount: 0,
        normalizedCount: 1,
        priorLiveCount: 0,
      }),
    ).toThrow("failed destructive-publish sanity");
    expect(() =>
      assertCclbaSourceSnapshotSane({
        expectedCount: 1,
        rawCount: 0,
        uniqueIdCount: 0,
        validShapeCount: 0,
        chicagoCount: 0,
        locatedChicagoCount: 0,
        unlocatedChicagoCount: 0,
        normalizedCount: 0,
        priorLiveCount: 0,
      }),
    ).toThrow("Live membership was not changed");
    expect(() =>
      assertCclbaSourceSnapshotSane({
        expectedCount: 1,
        rawCount: 1,
        uniqueIdCount: 1,
        validShapeCount: 1,
        chicagoCount: 0,
        locatedChicagoCount: 0,
        unlocatedChicagoCount: 0,
        normalizedCount: 0,
        priorLiveCount: 0,
      }),
    ).toThrow("failed destructive-publish sanity");
    expect(() =>
      assertCclbaSourceSnapshotSane(
        {
          expectedCount: 0,
          rawCount: 0,
          uniqueIdCount: 0,
          validShapeCount: 0,
          chicagoCount: 0,
          locatedChicagoCount: 0,
          unlocatedChicagoCount: 0,
          normalizedCount: 0,
          priorLiveCount: 0,
        },
        true,
      ),
    ).not.toThrow();
  });

  it("blocks a catastrophic Chicago-count drop before publication", () => {
    const publish = vi.fn();

    expect(() => {
      assertCclbaSourceSnapshotSane({
        expectedCount: 100,
        rawCount: 100,
        uniqueIdCount: 100,
        validShapeCount: 100,
        chicagoCount: 80,
        locatedChicagoCount: 1,
        unlocatedChicagoCount: 79,
        normalizedCount: 1,
        priorLiveCount: 50,
      });
      publish();
    }).toThrow(/locatedChicago=1.*priorLive=50/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps complete source metrics distinct from located Chicago rows", () => {
    expect(() =>
      assertCclbaSourceSnapshotSane({
        expectedCount: 1_033,
        rawCount: 1_033,
        uniqueIdCount: 1_033,
        validShapeCount: 1_033,
        chicagoCount: 915,
        locatedChicagoCount: 913,
        unlocatedChicagoCount: 2,
        normalizedCount: 913,
        priorLiveCount: 900,
      }),
    ).not.toThrow();

    expect(() =>
      assertCclbaSourceSnapshotSane({
        expectedCount: 1_033,
        rawCount: 1_033,
        uniqueIdCount: 1_033,
        validShapeCount: 1_033,
        chicagoCount: 915,
        locatedChicagoCount: 913,
        unlocatedChicagoCount: 1,
        normalizedCount: 913,
        priorLiveCount: 900,
      }),
    ).toThrow("failed destructive-publish sanity");
  });

  it("blocks coverage publication when a located Chicago row fails normalization", () => {
    expect(() =>
      assertCclbaSourceSnapshotSane({
        expectedCount: 1_033,
        rawCount: 1_033,
        uniqueIdCount: 1_033,
        validShapeCount: 1_033,
        chicagoCount: 915,
        locatedChicagoCount: 913,
        unlocatedChicagoCount: 2,
        normalizedCount: 912,
        priorLiveCount: 900,
      }),
    ).toThrow(/locatedChicago=913.*normalized=912/);
  });

  it("blocks a same-size disjoint CCLBA membership before publication", () => {
    const publish = vi.fn();
    const priorLiveIds = Array.from({ length: 50 }, (_, index) =>
      `cclba-prior-${index}`,
    );
    const normalizedChicagoIds = Array.from({ length: 50 }, (_, index) =>
      `cclba-next-${index}`,
    );

    expect(() => {
      assertCclbaMembershipTransitionSane({
        priorLiveIds,
        normalizedChicagoIds,
      });
      publish();
    }).toThrow(/priorIds=50, nextIds=50, retainedPriorIds=0/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("accepts a CCLBA transition retaining at least half of prior stable IDs", () => {
    const priorLiveIds = Array.from({ length: 50 }, (_, index) =>
      `cclba-prior-${index}`,
    );
    const normalizedChicagoIds = [
      ...priorLiveIds.slice(0, 25),
      ...Array.from({ length: 25 }, (_, index) => `cclba-new-${index}`),
    ];

    expect(() =>
      assertCclbaMembershipTransitionSane({
        priorLiveIds,
        normalizedChicagoIds,
      }),
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
    expect(
      isPlausibleCclbaSourceRow({
        id: 1_002_952,
        parcelNumber: "16-14-101-009-0000",
        propertyAddress1: "3856 W Monroe St",
        city: "CHICAGO",
        currentStatus: "Acquired",
        inventoryType: "Vacant Land",
        propertyClass: "Residential Land",
        latitude: 41.88008,
        longitude: -87.72299,
      }),
    ).toBe(true);
    expect(
      isPlausibleCclbaSourceRow({
        id: 1_083_837,
        parcelNumber: "25-03-322-036-0000",
        propertyAddress1: "60 E 95TH ST",
        city: "Chicago",
        currentStatus: "Acquired",
        inventoryType: "Vacant Land",
        propertyClass: "Residential Land",
      }),
    ).toBe(true);
    expect(
      isPlausibleCclbaSourceRow({
        id: 1_002_952,
        propertyAddress1: "3856 W Monroe St",
        city: "CHICAGO",
        currentStatus: "Acquired",
        inventoryType: "Vacant Land",
        propertyClass: "Residential Land",
      }),
    ).toBe(false);
  });
});

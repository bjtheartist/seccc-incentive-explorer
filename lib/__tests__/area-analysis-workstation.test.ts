import { describe, expect, it } from "vitest";
import {
  AREA_ANALYSIS_EVIDENCE_FAMILIES,
  AREA_ANALYSIS_EVIDENCE_FAMILY_IDS,
  AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH,
  DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS,
  DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
  activeAreaPermitFilterLabels,
  activeAreaVacancyFilterLabels,
  areaPermitTypeFilterValue,
  deriveAreaPermitFacetOptions,
  deriveAreaVacancyFacetOptions,
  filterAreaPermitWorkstationRecords,
  filterAreaVacancyWorkstationFeatures,
  hasActiveAreaPermitFilters,
  hasActiveAreaVacancyFilters,
  normalizeAreaPractitionerNotes,
  type AreaPermitWorkstationFilters,
  type AreaVacancyWorkstationFilters,
} from "@/lib/area-analysis-workstation";
import type { PermitAreaRecord } from "@/lib/permit-area";

function vacancyFeature(
  id: string,
  properties: Record<string, unknown>,
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-87.63, 41.88] },
    properties: {
      id,
      address: `${id} S STATE ST`,
      zoneMatches: [],
      licenseCheckState: "no_match",
      ...properties,
    },
  };
}

const VACANCIES: GeoJSON.Feature[] = [
  vacancyFeature("100", {
    source: "cols",
    status: "city_owned",
    propertyType: "vacant_land",
    canonicalType: "land",
    ownerType: "city_public",
    ownerName: "City of Chicago",
    pin: "20360000000001",
    freshnessClass: "unknown_date",
    zoneMatches: [
      { zoneKey: "tif", zoneName: "Test TIF" },
      { zoneKey: "tif", zoneName: "Duplicate TIF" },
    ],
  }),
  vacancyFeature("200", {
    address: "200 S BETA AVE",
    source: "dpd_vacant",
    status: "Open",
    propertyType: "vacant_building",
    canonicalType: "building",
    ownerType: "corporate_llc",
    ownerName: "Beta Bakery LLC",
    freshnessClass: "recent",
    licenseCheckState: "match",
    currentLicenseMatches: [{ name: "Beta Bakery", status: "AAI" }],
    zoneMatches: [
      { zoneKey: "energyCommunities", zoneName: "IRA Energy Community" },
    ],
  }),
  vacancyFeature("300", {
    source: "311_clean_lot",
    status: "Completed",
    propertyType: "reported_vacant_lot",
    canonicalType: "land",
    ownerType: "local_private",
    ownerName: "Gamma Owner",
    freshnessClass: "stale",
    licenseCheckState: "match",
  }),
];

function permit(
  permitId: string,
  overrides: Partial<PermitAreaRecord> = {},
): PermitAreaRecord {
  return {
    permitId,
    permitTypeKey: "new_construction",
    permitTypeLabel: "New Construction",
    rawPermitType: "PERMIT - NEW CONSTRUCTION",
    address: `${permitId} S STATE ST`,
    issueDate: "2025-01-15",
    permitStatus: "ACTIVE",
    permitMilestone: "Permit issued",
    workType: "New construction",
    workDescription: "Construct a mixed-use building",
    ...overrides,
  };
}

const PERMITS: PermitAreaRecord[] = [
  permit("P-100"),
  permit("P-200", {
    permitTypeKey: null,
    permitTypeLabel: "PERMIT - SOLAR",
    rawPermitType: "PERMIT - SOLAR",
    address: "200 S BETA AVE",
    issueDate: "2024-06-02",
    permitStatus: "PENDING",
    workType: "Solar installation",
    workDescription: "Install rooftop solar array",
  }),
  permit("P-300", {
    permitTypeKey: null,
    permitTypeLabel: "Not recorded",
    rawPermitType: null,
    issueDate: null,
    permitStatus: null,
    workDescription: null,
  }),
];

describe("area analysis workstation contract", () => {
  it("publishes the evidence families in workstation order", () => {
    expect(AREA_ANALYSIS_EVIDENCE_FAMILY_IDS).toEqual([
      "overview",
      "vacancy",
      "context",
      "permits",
      "investment",
      "sources",
    ]);
    expect(AREA_ANALYSIS_EVIDENCE_FAMILIES.map((family) => family.id)).toEqual(
      AREA_ANALYSIS_EVIDENCE_FAMILY_IDS,
    );
  });

  it("uses explicit all semantics in both default filter states", () => {
    expect(DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS).toEqual({
      query: "",
      freshness: "all",
      licenseConflict: "all",
      canonicalType: "all",
      ownerType: "all",
      zoneKey: "all",
      source: "all",
    });
    expect(DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS).toEqual({
      query: "",
      type: "all",
      status: "all",
      issueYear: "all",
    });
  });
});

describe("vacancy workstation filters", () => {
  it("combines query, freshness, conflict, type, owner, zone, and source with AND", () => {
    const filters: AreaVacancyWorkstationFilters = {
      query: "  beta   bakery ",
      freshness: "recent_reports",
      licenseConflict: "conflicts",
      canonicalType: "building",
      ownerType: "corporate_llc",
      zoneKey: "energyCommunities",
      source: "dpd_vacant",
    };

    expect(
      filterAreaVacancyWorkstationFeatures(VACANCIES, filters).map(
        (feature) => feature.properties?.id,
      ),
    ).toEqual(["200"]);

    expect(
      filterAreaVacancyWorkstationFeatures(VACANCIES, {
        ...filters,
        source: "cols",
      }),
    ).toEqual([]);
  });

  it("maps workstation all to the established all-record freshness behavior", () => {
    expect(
      filterAreaVacancyWorkstationFeatures(
        VACANCIES,
        DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
      ),
    ).toHaveLength(3);

    expect(
      filterAreaVacancyWorkstationFeatures(VACANCIES, {
        ...DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS,
        freshness: "current_screening",
      }).map((feature) => feature.properties?.id),
    ).toEqual(["100", "200"]);
  });

  it("derives stable vacancy options, counts one zone per property, and includes all", () => {
    const forward = deriveAreaVacancyFacetOptions(VACANCIES);
    const reversed = deriveAreaVacancyFacetOptions([...VACANCIES].reverse());

    expect(reversed).toEqual(forward);
    expect(forward.freshness).toEqual([
      { value: "all", label: "All retained records", count: 3 },
      {
        value: "current_screening",
        label: "Current inventory and recent reports",
        count: 2,
      },
      { value: "recent_reports", label: "Recent reports only", count: 1 },
    ]);
    expect(forward.licenseConflicts[1]).toEqual({
      value: "conflicts",
      label: "Current-license conflicts only",
      count: 2,
    });
    expect(forward.canonicalTypes.map((option) => option.value)).toEqual([
      "all",
      "land",
      "building",
    ]);
    expect(forward.ownerTypes.map((option) => option.value)).toEqual([
      "all",
      "corporate_llc",
      "local_private",
      "city_public",
    ]);
    expect(forward.zoneKeys).toEqual([
      { value: "all", label: "All incentive zones", count: 3 },
      {
        value: "energyCommunities",
        label: "IRA Energy Community",
        count: 1,
      },
      { value: "tif", label: "TIF District", count: 1 },
    ]);
    expect(forward.sources.map((option) => option.value)).toEqual([
      "all",
      "cols",
      "dpd_vacant",
      "311_clean_lot",
    ]);
  });

  it("reports active vacancy filters in control order", () => {
    expect(
      hasActiveAreaVacancyFilters(DEFAULT_AREA_VACANCY_WORKSTATION_FILTERS),
    ).toBe(false);
    const filters: AreaVacancyWorkstationFilters = {
      query: "  beta   bakery ",
      freshness: "recent_reports",
      licenseConflict: "conflicts",
      canonicalType: "building",
      ownerType: "corporate_llc",
      zoneKey: "energyCommunities",
      source: "dpd_vacant",
    };
    expect(hasActiveAreaVacancyFilters(filters)).toBe(true);
    expect(activeAreaVacancyFilterLabels(filters)).toEqual([
      "Search: beta bakery",
      "Evidence: Recent reports only",
      "License screening: Current-license conflicts only",
      "Vacancy type: Tracked building signal",
      "Owner type: Corporate / LLC",
      "Incentive zone: IRA Energy Community",
      "Source: 311 Vacant/Abandoned Building Complaint",
    ]);
  });
});

describe("permit workstation filters", () => {
  it("combines query, canonical or raw type, status, and issue year with AND", () => {
    const rawType = areaPermitTypeFilterValue(PERMITS[1]);
    expect(rawType).toBe("raw:PERMIT - SOLAR");

    expect(
      filterAreaPermitWorkstationRecords(PERMITS, {
        query: "solar array",
        type: rawType,
        status: "pending",
        issueYear: "2024",
      }).map((record) => record.permitId),
    ).toEqual(["P-200"]);

    expect(
      filterAreaPermitWorkstationRecords(PERMITS, {
        query: "mixed-use",
        type: "key:new_construction",
        status: "ACTIVE",
        issueYear: "2024",
      }),
    ).toEqual([]);
  });

  it("derives stable permit options including raw types and missing source values", () => {
    const forward = deriveAreaPermitFacetOptions(PERMITS);
    const reversed = deriveAreaPermitFacetOptions([...PERMITS].reverse());

    expect(reversed).toEqual(forward);
    expect(forward.types[0]).toEqual({
      value: "all",
      label: "All permit types",
      count: 3,
    });
    expect(forward.types).toContainEqual({
      value: "key:new_construction",
      label: "New Construction",
      count: 1,
    });
    expect(forward.types).toContainEqual({
      value: "raw:PERMIT - SOLAR",
      label: "PERMIT - SOLAR",
      count: 1,
    });
    expect(forward.statuses.map((option) => option.label)).toEqual([
      "All recorded statuses",
      "ACTIVE",
      "Not recorded",
      "PENDING",
    ]);
    expect(forward.issueYears.map((option) => option.value)).toEqual([
      "all",
      "2025",
      "2024",
      "unknown",
    ]);
  });

  it("reports active permit filters in control order", () => {
    expect(
      hasActiveAreaPermitFilters(DEFAULT_AREA_PERMIT_WORKSTATION_FILTERS),
    ).toBe(false);
    const filters: AreaPermitWorkstationFilters = {
      query: "  solar   array ",
      type: "raw:PERMIT - SOLAR",
      status: "PENDING",
      issueYear: "2024",
    };
    expect(hasActiveAreaPermitFilters(filters)).toBe(true);
    expect(activeAreaPermitFilterLabels(filters)).toEqual([
      "Search: solar array",
      "Permit type: PERMIT - SOLAR",
      "Recorded status: PENDING",
      "Issue year: 2024",
    ]);
  });
});

describe("practitioner notes", () => {
  it("normalizes line endings, trims, omits blank values, and enforces the cap", () => {
    expect(normalizeAreaPractitionerNotes("  First\r\nSecond\rThird  ")).toBe(
      "First\nSecond\nThird",
    );
    expect(normalizeAreaPractitionerNotes(" \r\n\t ")).toBeUndefined();
    expect(normalizeAreaPractitionerNotes(null)).toBeUndefined();

    const longNote = "a".repeat(
      AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH + 50,
    );
    const normalized = normalizeAreaPractitionerNotes(longNote);
    expect(normalized).toHaveLength(
      AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH,
    );
    expect(normalized).toBe(
      "a".repeat(AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH),
    );
  });

  it("does not leave a split surrogate at the truncation boundary", () => {
    const note =
      "a".repeat(AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH - 1) + "😀tail";
    const normalized = normalizeAreaPractitionerNotes(note);
    expect(normalized?.endsWith("\ud83d")).toBe(false);
    expect(normalized?.length).toBeLessThanOrEqual(
      AREA_ANALYSIS_PRACTITIONER_NOTES_MAX_LENGTH,
    );
  });
});

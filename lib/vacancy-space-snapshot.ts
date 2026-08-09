import { normalizePin14 } from "./cook-viewer";
import {
  CITY_BUILDING_FOOTPRINTS_VINTAGE,
  availableSpaceSourceLabel,
  compactParcelSpaceFacts,
  currentParcelSpaceFacts,
  positiveSquareFeet,
  withoutAvailableSpaceFacts,
  type ParcelSpaceFacts,
} from "./parcel-space";
import type {
  VacancyIndexEdition,
  VacancyIndexExport,
  VacancyLandPoint,
  VacancySitePoint,
} from "./vacancy-index";

export const VACANCY_SPACE_SOURCE_LABELS = {
  parcelArea: "Cook County current CookViewer parcel service (LANDSF, exact PIN)",
  assessorBuildingArea:
    "Cook County current CookViewer parcel service (residential BLDGSQFT) + Assessor Commercial Valuation Data csik-bsws (BLDGSF on exact KeyPIN)",
  cityGroundFootprint:
    "City of Chicago Building Footprints syp8-uezg (geometry current as of August 2015; spatial parcel intersection)",
  availableSpace:
    "Explicitly verified owner, chamber, Land Bank, or City property record; absent unless verified",
} as const;

export interface CurrentParcelSpaceMeasurementRow {
  pin: string | null;
  metric: string | null;
  sqft: number | string | null;
  source_key: string | null;
  source_year: number | string | null;
  verification_status: string | null;
  measurement_scope: string | null;
  is_active: boolean | null;
  verified_at: Date | string | null;
  reconfirm_after: Date | string | null;
}
export interface VacancySpaceOverlaySummary {
  selectedZips: string[];
  measurementRowsRead: number;
  measurementPinsRead: number;
  siteRowsVisited: number;
  landRowsVisited: number;
  siteRowsWithExactPin: number;
  landRowsWithExactPin: number;
  siteRowsEnriched: number;
  landRowsEnriched: number;
  uniqueEnrichedPins: number;
  metricOccurrences: {
    lotAreaSqft: number;
    assessorBuildingSqft: number;
    cityGroundFootprintSqft: number;
    availableSpaceSqft: number;
  };
}

const SPACE_SOURCE_KEYS = Object.keys(VACANCY_SPACE_SOURCE_LABELS) as Array<
  keyof typeof VACANCY_SPACE_SOURCE_LABELS
>;

const SPACE_FACT_KEYS = new Set<keyof ParcelSpaceFacts>([
  "lotAreaSqft",
  "assessorBuildingSqft",
  "assessorBuildingYear",
  "cityGroundFootprintSqft",
  "cityGroundFootprintVintage",
  "availableSpaceSqft",
  "availableSpaceSource",
  "availableSpaceVerifiedAt",
  "availableSpaceReconfirmAfter",
]);

const PRESERVED_PUBLIC_RECORD_SPACE_KEYS: readonly (keyof ParcelSpaceFacts)[] = [
  "lotAreaSqft",
  "assessorBuildingSqft",
  "assessorBuildingYear",
  "cityGroundFootprintSqft",
  "cityGroundFootprintVintage",
];

function validIsoDate(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Convert current ledger rows into one public-safe, source-separated record per PIN. */
export function buildParcelSpaceFactsByPin(
  rows: readonly CurrentParcelSpaceMeasurementRow[],
  now = new Date(),
): Map<string, ParcelSpaceFacts> {
  const byPin = new Map<string, ParcelSpaceFacts>();
  const nowMs = now.getTime();

  for (const row of rows) {
    const pin = normalizePin14(row.pin);
    const sqft = positiveSquareFeet(row.sqft);
    if (!pin || sqft === null) continue;

    const facts = byPin.get(pin) ?? {};
    if (row.metric === "lot_area") {
      facts.lotAreaSqft = sqft;
    } else if (row.metric === "assessor_building_area") {
      facts.assessorBuildingSqft = sqft;
      const sourceYear = positiveSquareFeet(row.source_year);
      if (sourceYear !== null) facts.assessorBuildingYear = sourceYear;
    } else if (row.metric === "city_ground_footprint") {
      facts.cityGroundFootprintSqft = sqft;
      facts.cityGroundFootprintVintage = CITY_BUILDING_FOOTPRINTS_VINTAGE;
    } else if (row.metric === "available_space") {
      const verifiedAt = validIsoDate(row.verified_at);
      const reconfirmAfter = validIsoDate(row.reconfirm_after);
      if (
        row.verification_status === "verified" &&
        row.measurement_scope === "largest_contiguous_usable_interior_space" &&
        row.is_active === true &&
        verifiedAt &&
        reconfirmAfter &&
        Date.parse(reconfirmAfter) > nowMs
      ) {
        facts.availableSpaceSqft = sqft;
        facts.availableSpaceSource = availableSpaceSourceLabel(row.source_key ?? "");
        facts.availableSpaceVerifiedAt = verifiedAt;
        facts.availableSpaceReconfirmAfter = reconfirmAfter;
      }
    }

    const compact = compactParcelSpaceFacts(facts);
    if (compact) byPin.set(pin, compact);
  }

  return byPin;
}

function overlaySitePoint(
  point: VacancySitePoint,
  factsByPin: ReadonlyMap<string, ParcelSpaceFacts>,
): { point: VacancySitePoint; pin: string | null; enriched: boolean } {
  const pin = normalizePin14(point.pin);
  const freshFacts = pin ? factsByPin.get(pin) : undefined;
  const preservedFacts = withoutAvailableSpaceFacts(currentParcelSpaceFacts(point.space));
  const space = compactParcelSpaceFacts({ ...preservedFacts, ...freshFacts });
  const { space: _existingSpace, ...rest } = point;
  return {
    point: space ? { ...rest, space } : rest,
    pin,
    enriched: Boolean(freshFacts),
  };
}

function overlayLandPoint(
  point: VacancyLandPoint,
  factsByPin: ReadonlyMap<string, ParcelSpaceFacts>,
): { point: VacancyLandPoint; pin: string | null; enriched: boolean } {
  const pin = normalizePin14(point.pin);
  const freshFacts = pin ? factsByPin.get(pin) : undefined;
  const preservedFacts = withoutAvailableSpaceFacts(currentParcelSpaceFacts(point.space));
  const space = compactParcelSpaceFacts({ ...preservedFacts, ...freshFacts });
  const { space: _existingSpace, ...rest } = point;
  return {
    point: space ? { ...rest, space } : rest,
    pin,
    enriched: Boolean(freshFacts),
  };
}

/**
 * Overlay exact-PIN facts without rebuilding vacancy, distress, ownership,
 * exemption, directory, cluster, or matrix data.
 */
export function overlayVacancySpaceFacts(
  input: VacancyIndexExport,
  factsByPin: ReadonlyMap<string, ParcelSpaceFacts>,
  requestedZips?: readonly string[],
): { data: VacancyIndexExport; summary: VacancySpaceOverlaySummary } {
  const selectedZips = [...new Set(requestedZips ?? Object.keys(input.editions))].sort();
  const selected = new Set(selectedZips);
  for (const zip of selected) {
    if (!input.editions[zip]) throw new Error(`Vacancy index has no edition for ZIP ${zip}`);
  }

  let siteRowsVisited = 0;
  let landRowsVisited = 0;
  let siteRowsWithExactPin = 0;
  let landRowsWithExactPin = 0;
  let siteRowsEnriched = 0;
  let landRowsEnriched = 0;
  const uniqueEnrichedPins = new Set<string>();
  const metricOccurrences = {
    lotAreaSqft: 0,
    assessorBuildingSqft: 0,
    cityGroundFootprintSqft: 0,
    availableSpaceSqft: 0,
  };

  const editions: Record<string, VacancyIndexEdition> = {};
  for (const [zip, edition] of Object.entries(input.editions)) {
    if (!selected.has(zip)) {
      editions[zip] = edition;
      continue;
    }

    const sitePoints = edition.sitePoints.map((point) => {
      siteRowsVisited++;
      const overlaid = overlaySitePoint(point, factsByPin);
      if (overlaid.pin) siteRowsWithExactPin++;
      if (overlaid.enriched && overlaid.pin) {
        siteRowsEnriched++;
        uniqueEnrichedPins.add(overlaid.pin);
      }
      return overlaid.point;
    });
    const landPoints = edition.landPoints?.map((point) => {
      landRowsVisited++;
      const overlaid = overlayLandPoint(point, factsByPin);
      if (overlaid.pin) landRowsWithExactPin++;
      if (overlaid.enriched && overlaid.pin) {
        landRowsEnriched++;
        uniqueEnrichedPins.add(overlaid.pin);
      }
      return overlaid.point;
    }) ?? null;

    for (const point of [...sitePoints, ...(landPoints ?? [])]) {
      if (point.space?.lotAreaSqft) metricOccurrences.lotAreaSqft++;
      if (point.space?.assessorBuildingSqft) metricOccurrences.assessorBuildingSqft++;
      if (point.space?.cityGroundFootprintSqft) metricOccurrences.cityGroundFootprintSqft++;
      if (point.space?.availableSpaceSqft) metricOccurrences.availableSpaceSqft++;
    }

    editions[zip] = { ...edition, sitePoints, landPoints };
  }

  const data: VacancyIndexExport = {
    ...input,
    sources: { ...input.sources, ...VACANCY_SPACE_SOURCE_LABELS },
    editions,
  };

  return {
    data,
    summary: {
      selectedZips,
      measurementRowsRead: 0,
      measurementPinsRead: factsByPin.size,
      siteRowsVisited,
      landRowsVisited,
      siteRowsWithExactPin,
      landRowsWithExactPin,
      siteRowsEnriched,
      landRowsEnriched,
      uniqueEnrichedPins: uniqueEnrichedPins.size,
      metricOccurrences,
    },
  };
}

function stripAllowedSpaceChanges(
  data: VacancyIndexExport,
  selectedZips: ReadonlySet<string>,
): VacancyIndexExport {
  const sources = { ...data.sources };
  for (const key of SPACE_SOURCE_KEYS) delete sources[key];

  const editions = Object.fromEntries(
    Object.entries(data.editions).map(([zip, edition]) => {
      if (!selectedZips.has(zip)) return [zip, edition];
      const strip = <T extends VacancySitePoint | VacancyLandPoint>(point: T): Omit<T, "space"> => {
        const { space: _space, ...rest } = point;
        return rest;
      };
      return [
        zip,
        {
          ...edition,
          sitePoints: edition.sitePoints.map(strip),
          landPoints: edition.landPoints?.map(strip) ?? null,
        },
      ];
    }),
  ) as Record<string, VacancyIndexEdition>;

  return { ...data, sources, editions };
}

/** Fail closed if an overlay touched anything besides source labels and row space facts. */
export function assertVacancySpaceOnlyChange(
  before: VacancyIndexExport,
  after: VacancyIndexExport,
  requestedZips?: readonly string[],
): void {
  const selectedZips = new Set(requestedZips ?? Object.keys(before.editions));
  const strippedBefore = stripAllowedSpaceChanges(before, selectedZips);
  const strippedAfter = stripAllowedSpaceChanges(after, selectedZips);
  if (JSON.stringify(strippedBefore) !== JSON.stringify(strippedAfter)) {
    throw new Error("Vacancy-space overlay changed data outside the approved space fields");
  }

  for (const zip of selectedZips) {
    const beforeEdition = before.editions[zip];
    const afterEdition = after.editions[zip];
    const pairs = [
      [beforeEdition.sitePoints, afterEdition.sitePoints],
      [beforeEdition.landPoints ?? [], afterEdition.landPoints ?? []],
    ] as const;
    for (const [beforePoints, afterPoints] of pairs) {
      beforePoints.forEach((point, index) => {
        for (const key of PRESERVED_PUBLIC_RECORD_SPACE_KEYS) {
          if (point.space?.[key] !== undefined && afterPoints[index]?.space?.[key] === undefined) {
            throw new Error(`Vacancy-space overlay erased ${key} in ZIP ${zip}`);
          }
        }
      });
    }
  }

  for (const key of SPACE_SOURCE_KEYS) {
    if (after.sources[key] !== VACANCY_SPACE_SOURCE_LABELS[key]) {
      throw new Error(`Vacancy-space source label ${key} is missing or unexpected`);
    }
  }

  for (const [zip, edition] of Object.entries(after.editions)) {
    if (!selectedZips.has(zip)) continue;
    for (const point of [...edition.sitePoints, ...(edition.landPoints ?? [])]) {
      for (const key of Object.keys(point.space ?? {})) {
        if (!SPACE_FACT_KEYS.has(key as keyof ParcelSpaceFacts)) {
          throw new Error(`Unexpected public space field ${key} in ZIP ${zip}`);
        }
      }
    }
  }
}

/** Keep the committed static artifact within a bounded, reviewable size increase. */
export function assertVacancySpacePayloadBudget(
  before: VacancyIndexExport,
  after: VacancyIndexExport,
  maximumGrowthRatio = 0.35,
): { beforeBytes: number; afterBytes: number; growthRatio: number } {
  const beforeBytes = Buffer.byteLength(JSON.stringify(before));
  const afterBytes = Buffer.byteLength(JSON.stringify(after));
  const growthRatio = beforeBytes === 0 ? 0 : (afterBytes - beforeBytes) / beforeBytes;
  if (growthRatio > maximumGrowthRatio) {
    throw new Error(
      `Vacancy-space payload grew ${(growthRatio * 100).toFixed(1)}%; limit is ${(maximumGrowthRatio * 100).toFixed(1)}%`,
    );
  }
  return { beforeBytes, afterBytes, growthRatio };
}

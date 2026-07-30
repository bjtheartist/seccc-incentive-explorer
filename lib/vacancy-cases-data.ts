/**
 * Case Workbench — SERVER-ONLY data layer. Reads the committed vacancy export
 * and per-ZIP directory from disk and assembles the tracked record set the
 * client-safe case model (lib/vacancy-cases.ts) computes over. Keep every
 * filesystem/loader import HERE so lib/vacancy-cases.ts stays client-safe
 * (the lib/vacancy-portfolio.ts split, applied to the workbench).
 *
 * The land record set is the DEDUPLICATED LAND UNION the public report
 * reconciles (assessor vacant-land parcels ∪ City-inventory land not already
 * present). Its total is `deriveLandUniverse(edition).total`, and its
 * per-owner-type counts are that function's `byOwnerType` rows — NOT
 * `ownership.reconciledVacantLandByOwnerType`, which covers only the assessor
 * half of the union. Getting that distinction wrong is what makes the workbench
 * look broken: on 60624 the union is 2,739 land parcels with 1,339 City/public,
 * while the assessor-only reconciled series reads 1,657 with 257 City/public,
 * and the per-ZIP directory file (a third thing again — the tracked COLS + 311
 * operational list) carries 1,339 land rows. All three are correct answers to
 * three different questions. `universe` is returned below and printed on the
 * page so the workbench states which one its counts are measured against, and
 * lib/__tests__/vacancy-cases.test.ts binds it to deriveLandUniverse on every
 * committed edition.
 *
 * Reported buildings (311) stay a separate universe and are never summed into
 * the land count.
 */

import {
  deriveLandUniverse,
  loadVacancyDirectory,
  loadVacancyIndex,
  type VacancyDirectoryFile,
} from "@/lib/vacancy-index";
import { deriveOpportunityAreas } from "@/lib/vacancy-opportunity-areas";
import {
  deriveCaseUniverse,
  type CaseUniverse,
  type VacancyCaseArea,
  type VacancyCaseRecord,
} from "@/lib/vacancy-cases";

// Re-export the client-safe model so server callers can import everything from
// one place (mirrors how lib/vacancy-index re-exports lib/vacancy-portfolio).
export * from "@/lib/vacancy-cases";

function normalizedPin(pin: string | null | undefined): string | null {
  if (!pin) return null;
  const digits = pin.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

function addressKey(address: string | null | undefined): string {
  return (address ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Build the case-workbench record set, opportunity areas, and as-of date for
 * one pilot ZIP. Returns an honest empty result (no records/areas, empty
 * recordsAsOf) when the export or the ZIP's edition is missing — callers
 * render an empty state rather than throwing.
 */
export function buildCaseRecords(zip: string): {
  records: VacancyCaseRecord[];
  areas: VacancyCaseArea[];
  recordsAsOf: string;
  /** The two tracked-universe totals the case counts are measured against. */
  universe: CaseUniverse;
} {
  const data = loadVacancyIndex();
  const edition = data?.editions[zip];
  if (!data || !edition) {
    return {
      records: [],
      areas: [],
      recordsAsOf: "",
      universe: { land: 0, landTotal: null, building: 0 },
    };
  }
  const directory: VacancyDirectoryFile | null = loadVacancyDirectory(zip);
  const directoryRows = directory?.rows ?? [];

  // Deduplicated land union used by the public reconciliation: assessor
  // vacant-land parcels plus directory land rows not already present.
  const landByKey = new Map<string, VacancyCaseRecord>();
  for (const point of edition.landPoints ?? []) {
    const pin = normalizedPin(point.pin);
    const key = pin ?? addressKey(point.address);
    if (!key) continue;
    landByKey.set(key, {
      id: `land-${key}`,
      address: point.address?.trim() || "Address not recorded",
      pin,
      universe: "land",
      ownerType: point.ownerType,
      ownerStructure: point.ownerStructure ?? null,
      ownerGeography: point.ownerGeography ?? null,
      saleYear: point.saleYear,
      violation: false,
      squareFeet: point.squareFeet,
      lat: point.lat,
      lon: point.lon,
    });
  }
  const mappedLand = new Map(
    edition.sitePoints
      .filter((point) => point.propertyType === "vacant_land")
      .map((point) => [normalizedPin(point.pin) ?? addressKey(point.address), point]),
  );
  for (const row of directoryRows.filter((item) => item.propertyType === "vacant_land")) {
    const pin = normalizedPin(row.pin);
    const key = pin ?? addressKey(row.address);
    if (!key || landByKey.has(key)) continue;
    const mapped = mappedLand.get(key);
    landByKey.set(key, {
      id: `land-${key}`,
      address: row.address,
      pin,
      universe: "land",
      ownerType: row.ownerType,
      ownerStructure: row.ownerStructure ?? null,
      ownerGeography: row.ownerGeography ?? null,
      saleYear: row.saleYear,
      violation: false,
      squareFeet: mapped?.squareFeet ?? null,
      lat: mapped?.lat ?? null,
      lon: mapped?.lon ?? null,
    });
  }

  // Reported buildings stay a distinct universe — never summed with land
  // before parcel reconciliation.
  const mappedBuildings = new Map(
    edition.sitePoints
      .filter((point) => point.propertyType === "vacant_building")
      .map((point) => [addressKey(point.address), point]),
  );
  const buildingRecords: VacancyCaseRecord[] = directoryRows
    .filter((row) => row.propertyType === "vacant_building")
    .map((row, index) => {
      const mapped = mappedBuildings.get(addressKey(row.address));
      return {
        id: `building-${addressKey(row.address)}-${index}`,
        address: row.address,
        pin: normalizedPin(row.pin),
        universe: "building_report" as const,
        ownerType: row.ownerType,
        ownerStructure: row.ownerStructure ?? null,
        ownerGeography: row.ownerGeography ?? null,
        saleYear: row.saleYear,
        violation: row.violation,
        squareFeet: null,
        lat: mapped?.lat ?? null,
        lon: mapped?.lon ?? null,
      };
    });

  const areas: VacancyCaseArea[] = deriveOpportunityAreas(edition).areas.map((area) => ({
    id: area.clusterId,
    name: area.name,
    siteCount: area.siteCount,
    mappedCount: area.memberCount,
    corridor: area.corridorContext,
    scenario: area.scenarios[0],
    needsChecking: area.needsChecking[0],
  }));

  const records = [...landByKey.values(), ...buildingRecords];

  return {
    records,
    areas,
    recordsAsOf: new Date(data.generatedAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    // The edition's own reconciled land-universe total, so the page can say when
    // the enumerable land records fall short of it (the export caps published
    // land points per edition). deriveLandUniverse THROWS on an arithmetic
    // identity violation by design; a corrupt edition must not take down a
    // public page, so a failure degrades the denominator to null (rendered as
    // "not yet available") rather than propagating.
    universe: deriveCaseUniverse(records, landUniverseTotal(edition)),
  };
}

function landUniverseTotal(edition: Parameters<typeof deriveLandUniverse>[0]): number | null {
  try {
    return deriveLandUniverse(edition)?.total ?? null;
  } catch {
    return null;
  }
}

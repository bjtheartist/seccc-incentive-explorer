/**
 * Case Workbench — SERVER-ONLY data layer. Reads the committed vacancy export
 * and per-ZIP directory from disk and assembles the tracked record set the
 * client-safe case model (lib/vacancy-cases.ts) computes over. Keep every
 * filesystem/loader import HERE so lib/vacancy-cases.ts stays client-safe
 * (the lib/vacancy-portfolio.ts split, applied to the workbench).
 *
 * The land record set is the DEDUPLICATED LAND UNION the public report
 * reconciles (assessor vacant-land parcels ∪ City-inventory land not already
 * present) — the same universe as the report's "Who controls the vacant land"
 * table, so the workbench's public-land / private / unknown land counts equal
 * the report's reconciled land figures. Reported buildings (311) stay a
 * separate universe and are never summed into the land count.
 */

import { loadVacancyDirectory, loadVacancyIndex, type VacancyDirectoryFile } from "@/lib/vacancy-index";
import { deriveOpportunityAreas } from "@/lib/vacancy-opportunity-areas";
import type { VacancyCaseArea, VacancyCaseRecord } from "@/lib/vacancy-cases";

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
} {
  const data = loadVacancyIndex();
  const edition = data?.editions[zip];
  if (!data || !edition) {
    return { records: [], areas: [], recordsAsOf: "" };
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

  return {
    records: [...landByKey.values(), ...buildingRecords],
    areas,
    recordsAsOf: new Date(data.generatedAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

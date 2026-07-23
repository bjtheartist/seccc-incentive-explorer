/**
 * Case Workbench — server-only data layer for /vacancy/[zip]/cases (all nine
 * pilot ZIPs, not just 60617). Ports the interaction-prototype's buildRecords()
 * (app/vacancy/ux-lab/page.tsx, now a redirect) to the real per-ZIP data
 * sources: loadVacancyIndex() for the edition (land points, mapped site
 * points, opportunity-area clusters) and loadVacancyDirectory(zip) for the
 * full tracked-row directory (every land/building row with an address).
 *
 * Honesty rails carried over from the prototype and the rest of the vacancy
 * section:
 *  - Land and reported buildings stay two distinct universes until parcel
 *    matching can support a deduplicated total (never summed together).
 *  - A VacancyCaseRecord carries evidence fields ONLY — no ranking. Directory
 *    rows carry a clusterId for URL-addressable area handoffs, but no score,
 *    tier, or derived rank reaches this client-facing record.
 *  - Opportunity areas are read verbatim from deriveOpportunityAreas (the
 *    same public, place-led derivation the Opportunity Areas pages use) —
 *    this module never re-derives clustering.
 *
 * Also carries the searchParams <-> UI-state codec so the URL is the single
 * source of truth for a shared case link (view/case/goal/records/tax/
 * violations/sel), testable without a browser.
 */

import { loadVacancyDirectory, loadVacancyIndex, type VacancyDirectoryFile } from "@/lib/vacancy-index";
import { deriveOpportunityAreas } from "@/lib/vacancy-opportunity-areas";
import type {
  BuilderGoal,
  BuilderUniverse,
  PresetId,
  VacancyCaseArea,
  VacancyCaseRecord,
  VacancyWorkbenchInitialState,
  WorkbenchMode,
} from "@/lib/vacancy-case-state";

export { buildCaseSearchParams } from "@/lib/vacancy-case-state";
export type {
  BuilderGoal,
  BuilderUniverse,
  CaseUrlState,
  PresetId,
  VacancyCaseArea,
  VacancyCaseRecord,
  VacancyWorkbenchInitialState,
  WorkbenchMode,
} from "@/lib/vacancy-case-state";

const MODES: WorkbenchMode[] = ["paths", "builder", "compare"];
const PRESET_IDS: PresetId[] = [
  "public-land",
  "private-outreach",
  "ownership-check",
  "building-review",
  "tax-title",
];
const GOALS: BuilderGoal[] = ["all", "public", "private", "verify", "conditions"];
const UNIVERSES: BuilderUniverse[] = ["all", "land", "building_report"];

const MAX_SELECTED = 3;

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

  // Build the deduplicated land union used by the public reconciliation:
  // assessor vacant-land rows plus directory land rows not already present.
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

  // Keep reported buildings as a distinct universe. The product explicitly
  // avoids adding land and 311 building counts before parcel reconciliation.
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

function oneParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse a route's searchParams into the workbench's initial UI state.
 * Unrecognized/missing values fall back to the same defaults the prototype
 * used (paths / public-land / all / all / off / off). `sel` is a comma-joined
 * list of record ids: ids not present in `validRecordIds` are dropped, and
 * the result is deduplicated and capped at 3 so a tampered or stale URL can
 * never seed more than the Compare view holds.
 */
export function initialStateFromParams(
  params: Record<string, string | string[] | undefined>,
  validRecordIds: ReadonlySet<string> | readonly string[],
): VacancyWorkbenchInitialState {
  const validIds = validRecordIds instanceof Set ? validRecordIds : new Set(validRecordIds);

  const rawMode = oneParam(params.view);
  const rawPreset = oneParam(params.case);
  const rawGoal = oneParam(params.goal);
  const rawUniverse = oneParam(params.records);
  const rawSel = oneParam(params.sel);

  const seen = new Set<string>();
  const initialSelectedIds: string[] = [];
  for (const rawId of (rawSel ?? "").split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id) || !validIds.has(id)) continue;
    seen.add(id);
    initialSelectedIds.push(id);
    if (initialSelectedIds.length >= MAX_SELECTED) break;
  }

  return {
    mode: MODES.includes(rawMode as WorkbenchMode) ? (rawMode as WorkbenchMode) : "paths",
    activePreset: PRESET_IDS.includes(rawPreset as PresetId)
      ? (rawPreset as PresetId)
      : "public-land",
    goal: GOALS.includes(rawGoal as BuilderGoal) ? (rawGoal as BuilderGoal) : "all",
    universe: UNIVERSES.includes(rawUniverse as BuilderUniverse)
      ? (rawUniverse as BuilderUniverse)
      : "all",
    taxSaleOnly: oneParam(params.tax) === "1",
    violationsOnly: oneParam(params.violations) === "1",
    initialSelectedIds,
  };
}

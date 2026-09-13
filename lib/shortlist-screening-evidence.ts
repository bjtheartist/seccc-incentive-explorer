import { normalizePin14 } from "./cook-viewer";
import { normalizePublishedArea } from "./published-area";
import type { SiteBuildingType, SiteMeasurementBasis } from "./site-matchmaker";
import type { ShortlistUniverseRow } from "./shortlist-universe-schema";
import type { PrecomputedCountyParcelFacts, ShortlistParcelIdentityEntry } from "./shortlist-parcel-identity";

export type RecordedPropertyType = SiteBuildingType | "land" | "exempt" | "unknown";

/** Detailed codes only. An unsupported code stays unknown, never a major-class guess.
 * Dictionary: https://prodassets.cookcountyassessoril.gov/s3fs-public/form_documents/Class_codes_definitions_12.16.24_0.pdf
 * Reviewed 2026-09-13. Industrial land 550 is land; minor improvements
 * 580/590, golf-course land/improvements 535 and special improvements 587
 * are deliberately unknown because the code does not establish a building.
 * Source: Cook County Assessor classifications of real property. Incentive and
 * assessment-only subclasses require separate evidence; do not infer a building.
 */
const TYPE_CODES: Readonly<Record<Exclude<RecordedPropertyType, "unknown">, readonly string[]>> = {
  house: ["202", "203", "204", "205", "206", "207", "208", "209", "210"],
  multifamily: ["211", "313", "314", "315", "913", "914", "915"],
  "mixed-use": ["212", "318", "918"],
  commercial: ["517", "522", "523", "526", "527", "528", "529", "530", "531", "532", "533", "591", "592", "597", "599"],
  industrial: ["581", "583", "589", "593"],
  land: ["100", "190", "200", "241", "500", "550"],
  exempt: ["EX"],
};

export function recordedPropertyType(raw: string | null | undefined): RecordedPropertyType {
  const code = raw?.trim().toUpperCase().replace(/^(\d)-(\d{2})$/, "$1$2");
  if (!code) return "unknown";
  for (const [type, codes] of Object.entries(TYPE_CODES)) {
    if (codes.includes(code)) return type as RecordedPropertyType;
  }
  return "unknown";
}

export interface ScreeningMeasurement {
  value: number;
  basis: SiteMeasurementBasis;
  source: "cook_county_assessor" | "saved_lot_record";
  effectiveYear: string | null;
  retrievedAt: string | null;
}

export interface ShortlistScreeningEvidence {
  version: 1;
  communityArea?: string | null;
  pin: string | null;
  identityStatus: "saved" | "resolved" | "unresolved" | "ambiguous" | "invalid";
  identityCheckedAt: string | null;
  identityReviewReason?: string;
  countyAddress: string | null;
  countyClass: string | null;
  recordedType: RecordedPropertyType;
  sourceYear: string | null;
  checkedAt: string | null;
  conflictingPropertyEvidence: boolean;
  measurements: Record<SiteMeasurementBasis, ScreeningMeasurement | null>;
  sourceKeys: readonly string[];
}

export type ScreeningUniverseRow = ShortlistUniverseRow & { screeningEvidence?: ShortlistScreeningEvidence };

/** Pure join of already validated local files. Does not move coordinates or
 * overwrite raw measurements. An invalid saved PIN is never repaired by guessing.
 */
export function prepareShortlistScreeningRows(
  rows: readonly ShortlistUniverseRow[],
  identities: ReadonlyMap<string, ShortlistParcelIdentityEntry>,
  factsByPin: ReadonlyMap<string, PrecomputedCountyParcelFacts>,
): ScreeningUniverseRow[] {
  return rows.map((row) => {
    const savedPin = normalizePin14(row.pin);
    const entry = identities.get(row.canonicalKey);
    const resolved = row.pin == null && entry?.status === "resolved" ? entry : null;
    const pin = savedPin ?? (resolved ? normalizePin14(resolved.pin) : null);
    const facts = pin ? factsByPin.get(pin) : undefined;
    const recordedType = recordedPropertyType(facts?.countyClass);
    const assessorArea = normalizePublishedArea(facts?.assessorBuildingSqft ?? null);
    const countyLot = normalizePublishedArea(facts?.lotAreaSqft ?? null);
    const savedLot = normalizePublishedArea(row.lotSqft);
    const measurement = (value: number | null, basis: SiteMeasurementBasis, county: boolean): ScreeningMeasurement | null =>
      value == null ? null : {
        value, basis,
        source: county ? "cook_county_assessor" : "saved_lot_record",
        effectiveYear: county ? facts?.assessorBuildingYear ?? null : null,
        retrievedAt: county ? facts?.checkedAt ?? null : null,
      };
    const knownBuilding = !["land", "exempt", "unknown"].includes(recordedType);
    return {
      ...row,
      screeningEvidence: {
        version: 1,
        pin,
        identityStatus: savedPin ? "saved" : row.pin != null ? "invalid" : resolved && pin ? "resolved" : entry?.status === "ambiguous" ? "ambiguous" : "unresolved",
        identityCheckedAt: resolved?.checkedAt ?? null,
        countyAddress: resolved?.countyAddress ?? null,
        countyClass: facts?.countyClass ?? null,
        recordedType,
        sourceYear: facts?.assessorBuildingYear ?? null,
        checkedAt: facts?.checkedAt ?? null,
        conflictingPropertyEvidence: row.conflictingPropertyTypes ||
          (row.hasVacantLandEvidence && (knownBuilding || assessorArea != null)) ||
          (row.hasVacantBuildingEvidence && recordedType === "land"),
        measurements: {
          "assessor-building": measurement(assessorArea, "assessor-building", true),
          lot: measurement(countyLot ?? savedLot, "lot", countyLot != null),
          "available-interior": null,
          footprint: null,
        },
        sourceKeys: [row.canonicalKey],
      },
    };
  });
}

export interface EvidenceAssessment {
  disposition: "match" | "review" | "conversion" | "excluded";
  reasons: string[];
}

/** Hard failures remain failures even if another requirement is unknown.
 * Conversion changes only the existing-type test, never size or zoning.
 */
export function assessShortlistEvidence(
  row: ScreeningUniverseRow,
  criteria: import("./site-matchmaker").SiteMatchCriteria,
): EvidenceAssessment {
  const evidence = row.screeningEvidence;
  const failures: string[] = [];
  const unknowns: string[] = [];
  let conversion = false;
  if (!evidence || !["saved", "resolved"].includes(evidence.identityStatus)) unknowns.push("Parcel identity needs verification; no parcel facts were inferred.");
  if (evidence?.identityReviewReason) unknowns.push(evidence.identityReviewReason);
  if (evidence?.conflictingPropertyEvidence) unknowns.push("Land and building records conflict; verify current property type.");
  if (criteria.propertyType !== "vacant-land" && row.hasVacantBuildingEvidence && ["unknown", "exempt"].includes(evidence?.recordedType ?? "unknown")) unknowns.push("Recorded building type needs verification.");
  if (criteria.buildingTypes?.length && criteria.propertyType !== "vacant-land" && row.hasVacantBuildingEvidence) {
    const type = evidence?.recordedType ?? "unknown";
    if (["unknown", "exempt"].includes(type)) {
      unknowns.push("Recorded building type needs verification.");
    } else if (!criteria.buildingTypes.includes(type as SiteBuildingType)) {
      if (criteria.includeConversions && type !== "land") conversion = true;
      else failures.push("Recorded building type does not match the selected existing building types.");
    }
  }
  const hasSize = criteria.minSquareFeet != null || criteria.maxSquareFeet != null;
  if (hasSize) {
    const basis = criteria.measurementBasis;
    const measurement = basis ? evidence?.measurements[basis] : null;
    if (!basis || !measurement) unknowns.push("The requested measurement is not published; no other area type was substituted.");
    else if ((criteria.minSquareFeet != null && measurement.value < criteria.minSquareFeet) ||
      (criteria.maxSquareFeet != null && measurement.value > criteria.maxSquareFeet)) failures.push("Published measurement is outside the selected size band.");
  }
  return {
    disposition: failures.length ? "excluded" : unknowns.length ? "review" : conversion ? "conversion" : "match",
    reasons: [...new Set([...failures, ...unknowns, ...(conversion ? ["Different recorded building type; conversion feasibility has not been evaluated."] : [])])],
  };
}

/** Consolidate only identical parcel-and-address leads. Multiple addresses on a
 * PIN may be units or a corner alias; retain them and require review instead of
 * destroying their identities. Original source keys always remain available.
 */
export function consolidateScreeningRows(rows: readonly ScreeningUniverseRow[]): ScreeningUniverseRow[] {
  const addressKey = (row: ScreeningUniverseRow) => row.address?.trim().toUpperCase().replace(/\s+/g, " ") ?? "";
  const groups = new Map<string, ScreeningUniverseRow[]>();
  for (const row of rows) {
    const pin = row.screeningEvidence?.pin;
    const key = pin && addressKey(row) ? `${pin}|${addressKey(row)}` : row.canonicalKey;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result: ScreeningUniverseRow[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => Number(Boolean(b.pin)) - Number(Boolean(a.pin)) || a.canonicalKey.localeCompare(b.canonicalKey));
    const first = ordered[0];
    if (group.length === 1 || !first.screeningEvidence) { result.push(first); continue; }
    const building = group.some((row) => row.hasVacantBuildingEvidence);
    const land = group.some((row) => row.hasVacantLandEvidence);
    const districts = new Set(group.map((row) => `${row.zoning.status}:${row.zoning.district}`));
    result.push({ ...first,
      evidenceTypes: [...new Set(group.flatMap((row) => row.evidenceTypes))],
      hasVacantBuildingEvidence: building, hasVacantLandEvidence: land,
      conflictingPropertyTypes: building && land,
      propertyType: building ? "vacant_building" : "vacant_land",
      zoning: districts.size > 1 ? { ...first.zoning, status: "ambiguous", district: null } : first.zoning,
      screeningEvidence: { ...first.screeningEvidence,
        conflictingPropertyEvidence: (building && land) || group.some((row) => row.screeningEvidence?.conflictingPropertyEvidence),
        sourceKeys: group.flatMap((row) => row.screeningEvidence?.sourceKeys ?? [row.canonicalKey]).sort(),
      },
    });
  }
  const pinAddresses = new Map<string, Set<string>>();
  for (const row of result) {
    const pin = row.screeningEvidence?.pin;
    if (pin) pinAddresses.set(pin, new Set([...(pinAddresses.get(pin) ?? []), addressKey(row)]));
  }
  return result.map((row) => row.screeningEvidence?.pin && (pinAddresses.get(row.screeningEvidence.pin)?.size ?? 0) > 1
    ? { ...row, screeningEvidence: { ...row.screeningEvidence, identityReviewReason: "Multiple recorded addresses share this parcel; verify units or address aliases." } }
    : row);
}

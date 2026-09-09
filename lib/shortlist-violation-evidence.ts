import { MERGE_DISTANCE_METERS, normalizeSiteAddress } from "./canonical-sites";
import { haversineMeters } from "./vacancy-index";
import {
  VacancyCitationSchema,
  type ShortlistUniverseFile,
  type ShortlistUniverseRow,
  type VacancyCitation,
} from "./shortlist-universe-schema";
import { chicagoCalendarDay, shiftCalendarDayYears, VACANCY_RETENTION_YEARS } from "./vacancy-evidence";

export interface LocatedVacancyCitation {
  id: string;
  address: string;
  lat: number;
  lon: number;
  zip: string;
  citation: VacancyCitation;
  zoning: ShortlistUniverseRow["zoning"];
  overlays: ShortlistUniverseRow["overlays"];
  incentiveCount: number | null;
}

/** Add a reviewed source to the existing snapshot without refreshing or
 * inventing other source facts. Preserve existing canonical identities and
 * measurement/ownership facts. A PIN-less citation joins only one uniquely
 * matching PIN-less address within the canonical aggregation distance. */
export function incorporateVacancyCitations(
  current: ShortlistUniverseFile,
  signals: readonly LocatedVacancyCitation[],
  reference: Date,
): ShortlistUniverseFile {
  const rows = current.rows.map((row) => ({ ...row }));
  const cutoff = shiftCalendarDayYears(chicagoCalendarDay(reference), -VACANCY_RETENTION_YEARS);
  let added = 0;
  let collapsed = 0;
  let newConflicts = 0;
  const seen = new Set<string>();
  for (const signal of signals) {
    if (signal.zip !== current.zip) throw new Error(`Wrong ZIP for ${signal.id}`);
    if (seen.has(signal.id)) throw new Error(`Duplicate citation group: ${signal.id}`);
    seen.add(signal.id);
    const citation = VacancyCitationSchema.parse(signal.citation);
    if (citation.id !== signal.id) throw new Error(`Citation identity mismatch: ${signal.id}`);
    const day = citation.recordDate.slice(0, 10);
    if (day < cutoff || day > chicagoCalendarDay(reference)) throw new Error(`Citation outside retention window: ${signal.id}`);
    if (!signal.address.trim() || !Number.isFinite(signal.lat) || !Number.isFinite(signal.lon) ||
        signal.lat < 41.6 || signal.lat > 42.1 || signal.lon < -88 || signal.lon > -87.4) {
      throw new Error(`Unlocated citation: ${signal.id}`);
    }
    const prior = rows.flatMap((row) => row.vacancyCitations ?? []).find((item) => item.id === signal.id);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(citation)) throw new Error(`Changed citation requires source reconciliation: ${signal.id}`);
      continue;
    }
    const matches = rows.filter((row) => row.pin === null &&
      normalizeSiteAddress(row.address) === normalizeSiteAddress(signal.address) &&
      row.lat !== null && row.lon !== null &&
      haversineMeters(row.lat, row.lon, signal.lat, signal.lon) < MERGE_DISTANCE_METERS);
    const match = matches.length === 1 ? matches[0] : null;
    if (match) {
      const conflict = match.hasVacantLandEvidence && !match.hasVacantBuildingEvidence;
      newConflicts += Number(conflict);
      match.hasVacantBuildingEvidence = true;
      match.conflictingPropertyTypes ||= conflict;
      match.propertyType = "vacant_building";
      match.evidenceTypes = [...new Set([...match.evidenceTypes, "building_violation" as const])].sort();
      match.vacancyCitations = [...(match.vacancyCitations ?? []), citation];
      match.violation = true;
      collapsed += 1;
    } else {
      rows.push({
        canonicalKey: `site:${signal.id}`, pin: null, address: signal.address,
        lat: signal.lat, lon: signal.lon,
        evidenceTypes: ["building_violation"], vacancyCitations: [citation],
        hasVacantBuildingEvidence: true, hasVacantLandEvidence: false,
        conflictingPropertyTypes: false, propertyType: "vacant_building",
        buildingSqft: null, buildingSqftSource: null, lotSqft: null, lotSqftSource: null,
        ownerStructure: null, ownerGeography: null, ownerConfidence: "needs_verification",
        saleYear: null, violation: true, zoning: signal.zoning,
        overlays: signal.overlays, incentiveCount: signal.incentiveCount,
      });
    }
    added += 1;
  }
  return {
    ...current,
    rows,
    counts: {
      ...current.counts,
      sourceRecords: current.counts.sourceRecords + added,
      sourceRecordsByEvidenceType: {
        ...current.counts.sourceRecordsByEvidenceType,
        building_violation: current.counts.sourceRecordsByEvidenceType.building_violation + added,
      },
      canonicalSites: rows.length,
      buildings: rows.filter((row) => row.hasVacantBuildingEvidence).length,
      land: rows.filter((row) => row.hasVacantLandEvidence).length,
      withPin: rows.filter((row) => row.pin !== null).length,
      withMeasuredArea: rows.filter((row) => row.lotSqft !== null || row.buildingSqft !== null).length,
      withZoning: rows.filter((row) => row.zoning.status === "resolved").length,
    },
    dedupe: {
      ...current.dedupe,
      collapsedRecords: current.dedupe.collapsedRecords + collapsed,
      conflictingPropertyTypes: rows.filter((row) => row.conflictingPropertyTypes).length,
      unresolvedConflicts: current.dedupe.unresolvedConflicts + newConflicts,
    },
  };
}

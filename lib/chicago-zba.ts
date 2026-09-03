import { createHash } from "node:crypto";
import type {
  ChicagoZbaCase,
  ChicagoZbaCaseType,
  ChicagoZbaLookupResponse,
  ChicagoZbaSourceMetadata,
} from "./types";

export const CHICAGO_ZBA_LAYER_URL =
  "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning_update/MapServer/16";
export const CHICAGO_ZBA_PUBLIC_URL =
  "https://www.chicago.gov/city/en/depts/dcd/zoning-board-of-appeals.html";
export const CHICAGO_ZBA_FRESHNESS_NOTE =
  "The City layer does not publish a refresh timestamp. Retrieval time is not a source-update date.";

export const CHICAGO_ZBA_OUT_FIELDS = [
  "OBJECTID",
  "ORDINANCE",
  "ORD_YEAR",
  "ORD_CASE",
  "ORD_TYPE",
  "ADDRESS",
  "JUDGMENT",
  "DESC_",
  "PIN10",
  "ID",
  "GLOBALID",
  "PIN_ACCURACY",
] as const;

export interface ParsedChicagoZbaCaseReference {
  caseReference: string;
  caseYear: number;
  caseSequence: number;
  caseTypeRaw: string;
  caseType: ChicagoZbaCaseType;
}

export interface ChicagoZbaSnapshotRecord extends ChicagoZbaCase {
  attributeFingerprint: string;
  geometryFingerprint: string;
}

export interface ChicagoZbaSnapshot {
  schemaVersion: 1;
  source: {
    id: "chicago-zba-arcgis";
    label: string;
    url: string;
    boardUrl: string;
    sourceUpdatedThrough: null;
    freshnessNote: string;
  };
  featureCount: number;
  coverage: {
    byCaseType: Record<ChicagoZbaCaseType, number>;
    withoutPublishedJudgment: number;
    withoutParsedCaseReference: number;
  };
  records: ChicagoZbaSnapshotRecord[];
}

export interface ChicagoZbaChange {
  globalId: string;
  change: "added" | "removed" | "attributes_changed" | "geometry_changed";
  before: Pick<
    ChicagoZbaSnapshotRecord,
    "caseReference" | "caseType" | "address" | "judgment"
  > | null;
  after: Pick<
    ChicagoZbaSnapshotRecord,
    "caseReference" | "caseType" | "address" | "judgment"
  > | null;
}

export interface ChicagoZbaDelta {
  schemaVersion: 1;
  sourceUrl: string;
  comparedFromFeatureCount: number | null;
  comparedThroughFeatureCount: number;
  counts: {
    added: number;
    removed: number;
    attributesChanged: number;
    geometryChanged: number;
  };
  changes: ChicagoZbaChange[];
}

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function classifyChicagoZbaCaseType(
  value: string | null | undefined,
): ChicagoZbaCaseType {
  switch (value?.trim().toUpperCase()) {
    case "S":
      return "special_use";
    case "Z":
      return "variation";
    case "A":
      return "administrative_appeal";
    default:
      return "unknown";
  }
}

export function parseChicagoZbaCaseReference(
  value: unknown,
): ParsedChicagoZbaCaseReference | null {
  const caseReference = nullableText(value);
  if (!caseReference) return null;
  const match = /^(\d+)-(\d{2})-([A-Za-z]+)$/.exec(caseReference);
  if (!match) return null;

  const caseSequence = Number(match[1]);
  const twoDigitYear = Number(match[2]);
  if (!Number.isInteger(caseSequence) || !Number.isInteger(twoDigitYear)) {
    return null;
  }
  const caseYear = twoDigitYear <= 29 ? 2000 + twoDigitYear : 1900 + twoDigitYear;
  const caseTypeRaw = match[3].toUpperCase();
  return {
    caseReference,
    caseYear,
    caseSequence,
    caseTypeRaw,
    caseType: classifyChicagoZbaCaseType(caseTypeRaw),
  };
}

export function normalizeChicagoZbaFeature(value: unknown): ChicagoZbaCase | null {
  if (!isRecord(value) || !isRecord(value.attributes)) return null;
  const attributes = value.attributes;
  const globalId = nullableText(attributes.GLOBALID);
  const sourceId = nullableText(attributes.ID) ?? nullableText(attributes.OBJECTID);
  const id = globalId ?? sourceId;
  if (!id) return null;

  const parsedReference = parseChicagoZbaCaseReference(attributes.ORDINANCE);
  const publishedType = nullableText(attributes.ORD_TYPE);
  const caseTypeRaw = parsedReference?.caseTypeRaw ?? publishedType;

  return {
    id,
    globalId,
    caseReference: parsedReference?.caseReference ?? nullableText(attributes.ORDINANCE),
    caseYear: parsedReference?.caseYear ?? null,
    caseSequence: parsedReference?.caseSequence ?? null,
    caseType: parsedReference?.caseType ?? classifyChicagoZbaCaseType(publishedType),
    caseTypeRaw,
    address: nullableText(attributes.ADDRESS),
    // Preserve the City's published text. Do not collapse case, spelling, or
    // mixed status language into an Explorer-created disposition.
    judgment: nullableText(attributes.JUDGMENT),
    description: nullableText(attributes.DESC_),
    pin10: nullableText(attributes.PIN10),
    pinAccuracy: nullableText(attributes.PIN_ACCURACY),
    publishedYearField: nullableText(attributes.ORD_YEAR),
    publishedCaseField: nullableText(attributes.ORD_CASE),
  };
}

export function sortChicagoZbaCases(cases: readonly ChicagoZbaCase[]) {
  return [...cases].sort((a, b) => {
    const byYear = (b.caseYear ?? -1) - (a.caseYear ?? -1);
    if (byYear !== 0) return byYear;
    const bySequence = (b.caseSequence ?? -1) - (a.caseSequence ?? -1);
    return bySequence || a.id.localeCompare(b.id);
  });
}

export function chicagoZbaSourceMetadata(retrievedAt: string): ChicagoZbaSourceMetadata {
  return {
    id: "chicago-zba-arcgis",
    label: "City of Chicago Zoning Board of Appeals case layer",
    url: CHICAGO_ZBA_LAYER_URL,
    boardUrl: CHICAGO_ZBA_PUBLIC_URL,
    retrievedAt,
    sourceUpdatedAt: null,
    freshnessNote: CHICAGO_ZBA_FRESHNESS_NOTE,
  };
}

async function fetchZbaJson(
  url: string,
  options: {
    fetchImpl: FetchLike;
    signal?: AbortSignal;
    timeoutMs: number;
    retries: number;
  },
): Promise<{ response: Response; payload: unknown }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) controller.abort(options.signal.reason);
    else options.signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Chicago ZBA request timed out")),
      options.timeoutMs,
    );

    try {
      const response = await options.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return { response, payload };
      }
      lastError = new Error(`Chicago ZBA source returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromParent);
    }

    if (attempt < options.retries) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Chicago ZBA request failed");
}

export async function lookupChicagoZba(
  lat: number,
  lon: number,
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<ChicagoZbaLookupResponse> {
  const retrievedAt = new Date().toISOString();
  const source = chicagoZbaSourceMetadata(retrievedAt);
  const url = new URL(`${CHICAGO_ZBA_LAYER_URL}/query`);
  url.searchParams.set("geometry", `${lon},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", CHICAGO_ZBA_OUT_FIELDS.join(","));
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "2000");
  url.searchParams.set("f", "json");

  try {
    const { response, payload } = await fetchZbaJson(url.toString(), {
      fetchImpl: options.fetchImpl ?? fetch,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 5_000,
      retries: options.retries ?? 1,
    });
    if (!response.ok || !isRecord(payload) || isRecord(payload.error)) {
      throw new Error("Chicago ZBA source returned an invalid response");
    }
    if (!Array.isArray(payload.features)) {
      throw new Error("Chicago ZBA source returned an invalid feature collection");
    }
    if (payload.features.length === 0) {
      return {
        status: "not_found",
        cases: [],
        returnedCount: 0,
        coverage: "complete",
        source,
        message:
          "The City layer returned no Zoning Board of Appeals record for this point. This does not establish that no ZBA action exists.",
      };
    }

    const cases = payload.features.flatMap((feature) => {
      const normalized = normalizeChicagoZbaFeature(feature);
      return normalized ? [normalized] : [];
    });
    if (cases.length === 0) {
      throw new Error("Chicago ZBA source returned only malformed records");
    }
    const coverage =
      payload.exceededTransferLimit === true || cases.length !== payload.features.length
        ? "partial"
        : "complete";
    return {
      status: "available",
      cases: sortChicagoZbaCases(cases),
      returnedCount: cases.length,
      coverage,
      source,
      message:
        coverage === "partial"
          ? "Some intersecting City ZBA records could not be represented; verify the complete history in the cited City source."
          : "Historical City ZBA records whose published geometry intersects this point.",
    };
  } catch {
    return {
      status: "unavailable",
      cases: [],
      source,
      message:
        "The City Zoning Board of Appeals source could not be checked. No absence conclusion is shown.",
    };
  }
}

/**
 * The attribute fingerprint of a ZBA record, derived from the record itself.
 *
 * The SINGLE definition of the fingerprinted field set: the normalizer writes
 * it into the snapshot and `diffChicagoZbaSnapshots` recomputes it at diff
 * time, so the two cannot drift. `id`, `globalId` and the two fingerprint
 * fields are excluded — `globalId` is the join key (a re-key is not an
 * attribute change), `id` is derived from it, and a fingerprint cannot cover
 * itself.
 *
 * Derived rather than read off `record.attributeFingerprint` for the same
 * reason as the zoning map layer: the previous snapshot is loaded from disk and
 * carries whatever formula was in force the day it was written. Comparing a
 * stored hash against a freshly computed one reports the formula change as
 * every record having changed. This layer has not had such a change yet; the
 * exposure is identical, so it is closed the same way.
 */
export function chicagoZbaAttributeFingerprint(
  record: Omit<
    ChicagoZbaSnapshotRecord,
    "id" | "globalId" | "attributeFingerprint" | "geometryFingerprint"
  >,
): string {
  return sha256({
    caseReference: record.caseReference,
    caseYear: record.caseYear,
    caseSequence: record.caseSequence,
    caseType: record.caseType,
    caseTypeRaw: record.caseTypeRaw,
    address: record.address,
    judgment: record.judgment,
    description: record.description,
    pin10: record.pin10,
    pinAccuracy: record.pinAccuracy,
    publishedYearField: record.publishedYearField,
    publishedCaseField: record.publishedCaseField,
  });
}

export function normalizeChicagoZbaSnapshotFeature(
  value: unknown,
): ChicagoZbaSnapshotRecord | null {
  if (!isRecord(value) || !isRecord(value.attributes) || !isRecord(value.geometry)) {
    return null;
  }
  const normalized = normalizeChicagoZbaFeature(value);
  if (!normalized?.globalId) return null;
  return {
    ...normalized,
    // Informational: the comparator recomputes both sides rather than trusting
    // what any snapshot stored.
    attributeFingerprint: chicagoZbaAttributeFingerprint(normalized),
    geometryFingerprint: sha256(value.geometry),
  };
}

export function buildChicagoZbaSnapshot(
  records: readonly ChicagoZbaSnapshotRecord[],
): ChicagoZbaSnapshot {
  const sorted = [...records].sort((a, b) => a.globalId!.localeCompare(b.globalId!));
  const byCaseType: Record<ChicagoZbaCaseType, number> = {
    special_use: 0,
    variation: 0,
    administrative_appeal: 0,
    unknown: 0,
  };
  let withoutPublishedJudgment = 0;
  let withoutParsedCaseReference = 0;
  for (const record of sorted) {
    byCaseType[record.caseType] += 1;
    if (!record.judgment) withoutPublishedJudgment += 1;
    if (record.caseYear === null || record.caseSequence === null) {
      withoutParsedCaseReference += 1;
    }
  }
  return {
    schemaVersion: 1,
    source: {
      id: "chicago-zba-arcgis",
      label: "City of Chicago Zoning Board of Appeals case layer",
      url: CHICAGO_ZBA_LAYER_URL,
      boardUrl: CHICAGO_ZBA_PUBLIC_URL,
      sourceUpdatedThrough: null,
      freshnessNote: CHICAGO_ZBA_FRESHNESS_NOTE,
    },
    featureCount: sorted.length,
    coverage: {
      byCaseType,
      withoutPublishedJudgment,
      withoutParsedCaseReference,
    },
    records: sorted,
  };
}

function changeFacts(row: ChicagoZbaSnapshotRecord | undefined) {
  if (!row) return null;
  return {
    caseReference: row.caseReference,
    caseType: row.caseType,
    address: row.address,
    judgment: row.judgment,
  };
}

export function diffChicagoZbaSnapshots(
  previous: ChicagoZbaSnapshot | null,
  current: ChicagoZbaSnapshot,
): ChicagoZbaDelta {
  const changes: ChicagoZbaChange[] = [];
  if (previous) {
    const before = new Map(previous.records.map((row) => [row.globalId!, row]));
    const after = new Map(current.records.map((row) => [row.globalId!, row]));
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
    for (const globalId of ids) {
      const oldRow = before.get(globalId);
      const newRow = after.get(globalId);
      if (!oldRow && newRow) {
        changes.push({ globalId, change: "added", before: null, after: changeFacts(newRow) });
      } else if (oldRow && !newRow) {
        changes.push({ globalId, change: "removed", before: changeFacts(oldRow), after: null });
      } else if (oldRow && newRow) {
        if (
          chicagoZbaAttributeFingerprint(oldRow) !== chicagoZbaAttributeFingerprint(newRow)
        ) {
          changes.push({
            globalId,
            change: "attributes_changed",
            before: changeFacts(oldRow),
            after: changeFacts(newRow),
          });
        }
        if (oldRow.geometryFingerprint !== newRow.geometryFingerprint) {
          changes.push({
            globalId,
            change: "geometry_changed",
            before: changeFacts(oldRow),
            after: changeFacts(newRow),
          });
        }
      }
    }
  }
  return {
    schemaVersion: 1,
    sourceUrl: CHICAGO_ZBA_LAYER_URL,
    comparedFromFeatureCount: previous?.featureCount ?? null,
    comparedThroughFeatureCount: current.featureCount,
    counts: {
      added: changes.filter((row) => row.change === "added").length,
      removed: changes.filter((row) => row.change === "removed").length,
      attributesChanged: changes.filter((row) => row.change === "attributes_changed").length,
      geometryChanged: changes.filter((row) => row.change === "geometry_changed").length,
    },
    changes,
  };
}

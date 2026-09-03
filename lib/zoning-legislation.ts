/**
 * Source-honest Chicago zoning legislation helpers.
 *
 * eLMS is the City Clerk's legislative record, not the current zoning map and
 * not a parcel geometry source. The ArcGIS zoning layer remains the current
 * district geometry source. We only join the two when the City publishes an
 * exact Clerk record number or eLMS matter id on the zoning polygon.
 */

import { createHash } from "node:crypto";

export const ELMS_API_BASE = "https://api.chicityclerkelms.chicago.gov";
export const ELMS_PUBLIC_BASE = "https://chicityclerkelms.chicago.gov";
export const CHICAGO_ZONING_LAYER_URL =
  "https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Zoning/MapServer/1";

export const ELMS_ZONING_SEARCHES = [
  "Zoning Reclassification",
  "Title 17",
  "Chapter 17",
] as const;

export type ZoningLegislationKind =
  | "map_amendment"
  | "zoning_code_amendment";

export type ZoningLegislationLifecycle =
  | "pending"
  | "adopted"
  | "withdrawn"
  | "failed"
  | "repealed"
  | "closed_without_adoption"
  | "unknown";

export interface ZoningLegislationAction {
  actionDate: string | null;
  actionBy: string | null;
  actionName: string | null;
  actionText: string | null;
  meetingId: string | null;
}

export interface ZoningLegislationAttachment {
  fileName: string | null;
  url: string;
  attachmentType: string | null;
}

export interface ZoningLegislationMatter {
  matterId: string;
  recordNumber: string;
  fileYear: number | null;
  kind: ZoningLegislationKind;
  lifecycle: ZoningLegislationLifecycle;
  title: string;
  status: string | null;
  subStatus: string | null;
  introductionDate: string | null;
  finalActionDate: string | null;
  lastPublicationDate: string;
  controllingBody: string | null;
  sourceUrl: string;
  searchTerms: string[];
  actions: ZoningLegislationAction[];
  attachments: ZoningLegislationAttachment[];
}

export interface ZoningLegislationArtifact {
  schemaVersion: 1;
  source: {
    id: "chicago-clerk-elms";
    label: string;
    apiUrl: string;
    publicUrl: string;
    coverage: string;
    sourceUpdatedThrough: string | null;
  };
  coverage: {
    total: number;
    searches: ElmsSearchCoverage[];
    byKind: Record<ZoningLegislationKind, number>;
    byLifecycle: Record<ZoningLegislationLifecycle, number>;
    byFileYear: Record<string, number>;
  };
  matters: ZoningLegislationMatter[];
}

export interface ElmsSearchCoverage {
  query: string;
  publishedCount: number;
  fetchedCount: number;
  normalizedMatches: number;
  excludedRelatedRecords: number;
}

export interface ZoningMapSnapshotRecord {
  globalId: string;
  zoningId: number | null;
  zoneClass: string | null;
  zoneTypeCode: number | null;
  pdNumber: number | null;
  pmdSubArea: string | null;
  ordinanceNumber: string | null;
  ordinanceDate: string | null;
  clerkDocumentNumber: string | null;
  clerkUrl: string | null;
  recordUpdatedAt: string | null;
  attributeFingerprint: string;
  geometryFingerprint: string;
}

export interface ZoningMapSnapshot {
  schemaVersion: 1;
  source: {
    id: "chicago-arcgis-zoning";
    label: string;
    url: string;
    sourceUpdatedThrough: string | null;
  };
  featureCount: number;
  records: ZoningMapSnapshotRecord[];
}

export interface ZoningMapChange {
  /** The id this record carries in the NEWER snapshot (the older one, for a
   * removal). Reported, never joined on — see `diffZoningMapSnapshots`. */
  globalId: string;
  /** Set when the join matched a record whose GLOBALID the City rotated
   * underneath it: the id this same polygon carried in the older snapshot.
   * Absent on artifacts written before the re-key was understood. */
  previousGlobalId?: string | null;
  change: "added" | "removed" | "attributes_changed" | "geometry_changed" | "rekeyed";
  before: Pick<
    ZoningMapSnapshotRecord,
    | "zoneClass"
    | "pdNumber"
    | "ordinanceNumber"
    | "clerkDocumentNumber"
    | "recordUpdatedAt"
  > | null;
  after: Pick<
    ZoningMapSnapshotRecord,
    | "zoneClass"
    | "pdNumber"
    | "ordinanceNumber"
    | "clerkDocumentNumber"
    | "recordUpdatedAt"
  > | null;
}

export interface ZoningMapDelta {
  schemaVersion: 1;
  sourceUrl: string;
  comparedFrom: string | null;
  comparedThrough: string | null;
  counts: {
    added: number;
    removed: number;
    attributesChanged: number;
    geometryChanged: number;
    /** Records the join matched by geometry whose GLOBALID changed anyway.
     * An upstream id rotation is a bookkeeping event, not a change to the
     * City's map — it gets its own line so it can never again masquerade as
     * added+removed, nor hide a real attribute change behind a churned key. */
    rekeyed: number;
  };
  changes: ZoningMapChange[];
}

export class ElmsNotFoundError extends Error {}
export class ElmsUnavailableError extends Error {}

type FetchLike = typeof fetch;

function decodeJsonPayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredText(value: unknown): string | null {
  return nullableText(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function classifyZoningLegislation(
  title: string,
): ZoningLegislationKind | null {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (
    /^zoning reclassification\b/i.test(normalizedTitle) ||
    /^amendment of zoning reclassification\b/i.test(normalizedTitle) ||
    /^amendment of ordinance\b.*\bzoning reclassification\b/i.test(normalizedTitle)
  ) {
    return "map_amendment";
  }

  if (
    /\bmunicipal code\b/i.test(normalizedTitle) &&
    (/\btitle 17\b/i.test(normalizedTitle) ||
      /\bchapter 17(?:-|\b)/i.test(normalizedTitle) ||
      /\bsection 17-/i.test(normalizedTitle))
  ) {
    return "zoning_code_amendment";
  }

  return null;
}

export function classifyZoningLifecycle(
  status: string | null,
  subStatus: string | null,
): ZoningLegislationLifecycle {
  const combined = `${status ?? ""} ${subStatus ?? ""}`.toLowerCase();
  if (combined.includes("passed")) return "adopted";
  if (combined.includes("withdrawn")) return "withdrawn";
  if (combined.includes("failed")) return "failed";
  if (combined.includes("repealed")) return "repealed";
  if (combined.includes("placed on file")) return "closed_without_adoption";
  if (
    // "2-Submitted to Clerk / Accepted": filed with the Clerk and accepted
    // onto a future Council agenda, but not yet introduced. That is the
    // earliest pending state, not an unclassifiable one.
    combined.includes("submitted to clerk") ||
    combined.includes("introduction") ||
    combined.includes("committee") ||
    combined.includes("referred") ||
    combined.includes("recommended") ||
    combined.includes("consideration") ||
    combined.includes("deferred")
  ) {
    return "pending";
  }
  return "unknown";
}

export function clerkMatterUrl(matterId: string): string {
  return `${ELMS_PUBLIC_BASE}/Matter/?matterId=${encodeURIComponent(matterId)}`;
}

export function matterIdFromClerkUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname !== "chicityclerkelms.chicago.gov") return null;
    return nullableText(url.searchParams.get("matterId"));
  } catch {
    return null;
  }
}

function normalizeActions(value: unknown): ZoningLegislationAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [
      {
        actionDate: nullableIsoDate(entry.actionDate),
        actionBy: nullableText(entry.actionByName),
        actionName: nullableText(entry.actionName),
        actionText: nullableText(entry.actionText),
        meetingId: nullableText(entry.meetingId),
      },
    ];
  });
}

function normalizeAttachments(value: unknown): ZoningLegislationAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = nullableText(entry.path);
    if (!url || !/^https:\/\//i.test(url)) return [];
    return [
      {
        fileName: nullableText(entry.fileName),
        url,
        attachmentType: nullableText(entry.attachmentType),
      },
    ];
  });
}

export function normalizeElmsZoningMatter(
  value: unknown,
  searchTerms: readonly string[] = [],
): ZoningLegislationMatter | null {
  if (!isRecord(value)) return null;
  const matterId = requiredText(value.matterId);
  const recordNumber = requiredText(value.recordNumber);
  const title = requiredText(value.title);
  const lastPublicationDate = nullableIsoDate(value.lastPublicationDate);
  if (!matterId || !recordNumber || !title || !lastPublicationDate) return null;

  const kind = classifyZoningLegislation(title);
  if (!kind) return null;

  const status = nullableText(value.status);
  const subStatus = nullableText(value.subStatus);
  const fileYear = nullableNumber(value.fileYear);

  return {
    matterId,
    recordNumber,
    fileYear: fileYear === null ? null : Math.trunc(fileYear),
    kind,
    lifecycle: classifyZoningLifecycle(status, subStatus),
    title,
    status,
    subStatus,
    introductionDate: nullableIsoDate(value.introductionDate),
    finalActionDate: nullableIsoDate(value.finalActionDate),
    lastPublicationDate,
    controllingBody: nullableText(value.controllingBody),
    sourceUrl: clerkMatterUrl(matterId),
    searchTerms: [...new Set(searchTerms)].sort(),
    actions: normalizeActions(value.actions),
    attachments: normalizeAttachments(value.attachments),
  };
}

async function fetchJson(
  url: string,
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<{ response: Response; payload: unknown }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("request timed out")),
      options.timeoutMs ?? 10_000,
    );

    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      // eLMS currently double-encodes some detail responses for Node fetch
      // clients. Decode at most one additional layer, then apply the same
      // strict source-contract validation below.
      const payload = decodeJsonPayload(await response.json().catch(() => null));
      if (response.ok || response.status === 404) return { response, payload };
      if (response.status < 500 && response.status !== 429) {
        throw new ElmsUnavailableError(`eLMS returned HTTP ${response.status}`);
      }
      lastError = new Error(`eLMS returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof ElmsUnavailableError) throw error;
      lastError = error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromParent);
    }

    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  throw new ElmsUnavailableError(
    lastError instanceof Error ? lastError.message : "eLMS request failed",
  );
}

export async function fetchElmsMatter(
  input: { matterId?: string; recordNumber?: string },
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<ZoningLegislationMatter> {
  const matterId = nullableText(input.matterId);
  const recordNumber = nullableText(input.recordNumber);
  if (!matterId && !recordNumber) {
    throw new TypeError("matterId or recordNumber is required");
  }

  const path = matterId
    ? `/matter/${encodeURIComponent(matterId)}`
    : `/matter/recordNumber/${encodeURIComponent(recordNumber!)}`;
  const { response, payload } = await fetchJson(`${ELMS_API_BASE}${path}`, options);
  if (response.status === 404) throw new ElmsNotFoundError("Matter not found");
  const matter = normalizeElmsZoningMatter(payload);
  if (!matter) {
    throw new ElmsUnavailableError("eLMS returned an invalid zoning matter");
  }
  return matter;
}

interface ElmsSearchPage {
  data: unknown[];
  meta: { skip: number; top: number; count: number; pages: number };
}

function parseSearchPage(value: unknown): ElmsSearchPage | null {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) {
    return null;
  }
  const skip = nullableNumber(value.meta.skip);
  const top = nullableNumber(value.meta.top);
  const count = nullableNumber(value.meta.count);
  const pages = nullableNumber(value.meta.pages);
  if ([skip, top, count, pages].some((item) => item === null)) return null;
  return {
    data: value.data,
    meta: {
      skip: Math.trunc(skip!),
      top: Math.trunc(top!),
      count: Math.trunc(count!),
      pages: Math.trunc(pages!),
    },
  };
}

export async function fetchAllElmsZoningMatters(
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
    searches?: readonly string[];
  } = {},
): Promise<ZoningLegislationMatter[]> {
  return (await fetchElmsZoningLedger(options)).matters;
}

export async function fetchElmsZoningLedger(
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    timeoutMs?: number;
    searches?: readonly string[];
  } = {},
): Promise<{ matters: ZoningLegislationMatter[]; searches: ElmsSearchCoverage[] }> {
  const searches = options.searches ?? ELMS_ZONING_SEARCHES;
  const byMatterId = new Map<string, ZoningLegislationMatter>();
  const searchCoverage: ElmsSearchCoverage[] = [];

  for (const search of searches) {
    const pageSize = 500;
    let skip = 0;
    let expected = Number.POSITIVE_INFINITY;
    let normalizedMatches = 0;

    while (skip < expected) {
      const url = new URL(`${ELMS_API_BASE}/search`);
      url.searchParams.set("search", `"${search}"`);
      url.searchParams.set("top", String(pageSize));
      url.searchParams.set("skip", String(skip));
      url.searchParams.set("sort", "introductionDate desc");
      const { response, payload } = await fetchJson(url.toString(), options);
      if (!response.ok) {
        throw new ElmsUnavailableError(`eLMS search returned HTTP ${response.status}`);
      }
      const page = parseSearchPage(payload);
      if (!page) throw new ElmsUnavailableError("eLMS returned an invalid search page");
      expected = page.meta.count;
      if (page.data.length === 0 && skip < expected) {
        throw new ElmsUnavailableError("eLMS search ended before its published row count");
      }

      for (const raw of page.data) {
        const normalized = normalizeElmsZoningMatter(raw, [search]);
        if (!normalized) continue;
        normalizedMatches += 1;
        const previous = byMatterId.get(normalized.matterId);
        byMatterId.set(
          normalized.matterId,
          previous
            ? {
                ...normalized,
                searchTerms: [...new Set([...previous.searchTerms, search])].sort(),
              }
            : normalized,
        );
      }

      skip += page.data.length;
      if (page.data.length === 0) break;
    }
    searchCoverage.push({
      query: search,
      publishedCount: expected,
      fetchedCount: skip,
      normalizedMatches,
      excludedRelatedRecords: expected - normalizedMatches,
    });
  }

  const matters = [...byMatterId.values()].sort((a, b) => {
    const byDate = (b.introductionDate ?? "").localeCompare(a.introductionDate ?? "");
    return byDate || b.recordNumber.localeCompare(a.recordNumber);
  });
  return { matters, searches: searchCoverage };
}

export function buildZoningLegislationArtifact(
  matters: readonly ZoningLegislationMatter[],
  searches: readonly ElmsSearchCoverage[] = [],
): ZoningLegislationArtifact {
  const byKind: Record<ZoningLegislationKind, number> = {
    map_amendment: 0,
    zoning_code_amendment: 0,
  };
  const byLifecycle: Record<ZoningLegislationLifecycle, number> = {
    pending: 0,
    adopted: 0,
    withdrawn: 0,
    failed: 0,
    repealed: 0,
    closed_without_adoption: 0,
    unknown: 0,
  };
  const byFileYear: Record<string, number> = {};
  let sourceUpdatedThrough: string | null = null;

  for (const matter of matters) {
    byKind[matter.kind] += 1;
    byLifecycle[matter.lifecycle] += 1;
    if (matter.fileYear !== null) {
      const key = String(matter.fileYear);
      byFileYear[key] = (byFileYear[key] ?? 0) + 1;
    }
    if (!sourceUpdatedThrough || matter.lastPublicationDate > sourceUpdatedThrough) {
      sourceUpdatedThrough = matter.lastPublicationDate;
    }
  }

  return {
    schemaVersion: 1,
    source: {
      id: "chicago-clerk-elms",
      label: "Chicago City Clerk Electronic Legislative Management System (eLMS)",
      apiUrl: ELMS_API_BASE,
      publicUrl: ELMS_PUBLIC_BASE,
      coverage:
        "City Council records from December 1, 2010 to present. Special-use decisions are handled separately by the Zoning Board of Appeals.",
      sourceUpdatedThrough,
    },
    coverage: {
      total: matters.length,
      searches: [...searches],
      byKind,
      byLifecycle,
      byFileYear: Object.fromEntries(
        Object.entries(byFileYear).sort(([a], [b]) => b.localeCompare(a)),
      ),
    },
    matters: [...matters],
  };
}

/** The published ZONING attributes the fingerprint covers, in the one canonical
 * field order. `globalId` is deliberately absent — see
 * `zoningMapAttributeFingerprint`. `attributeFingerprint` and
 * `geometryFingerprint` are absent because a fingerprint cannot cover itself.
 *
 * This is the SINGLE definition of the fingerprinted field set. Both the
 * normalizer (which writes the value into the snapshot) and the comparator
 * (which recomputes it at diff time) go through it, so the two cannot drift
 * into disagreeing about what "the attributes" are. */
function zoningMapFingerprintedAttributes(
  record: Omit<ZoningMapSnapshotRecord, "attributeFingerprint" | "geometryFingerprint">,
) {
  return {
    zoningId: record.zoningId,
    zoneClass: record.zoneClass,
    zoneTypeCode: record.zoneTypeCode,
    pdNumber: record.pdNumber,
    pmdSubArea: record.pmdSubArea,
    ordinanceNumber: record.ordinanceNumber,
    ordinanceDate: record.ordinanceDate,
    clerkDocumentNumber: record.clerkDocumentNumber,
    clerkUrl: record.clerkUrl,
    recordUpdatedAt: record.recordUpdatedAt,
  };
}

/**
 * The attribute fingerprint of a record, derived from the record itself.
 *
 * The fingerprint covers the published ZONING attributes and deliberately
 * EXCLUDES `globalId`. It used to hash the record whole, which meant the City
 * rotating its GLOBALIDs changed every fingerprint in the layer even though not
 * one published attribute moved.
 *
 * Callers must derive rather than read `record.attributeFingerprint`. The
 * stored value is whatever formula was in force on the day that snapshot was
 * written, and a snapshot on disk outlives the code that wrote it: the first
 * refresh after the globalId exclusion shipped compared 14,652 legacy-hashed
 * previous rows against 14,652 newly-hashed current rows and called every one
 * of them `attributes_changed`, because the two sides were not answering the
 * same question. Recomputing both sides here makes the comparison independent
 * of what any snapshot happens to have stored.
 */
export function zoningMapAttributeFingerprint(
  record: Omit<ZoningMapSnapshotRecord, "attributeFingerprint" | "geometryFingerprint">,
): string {
  return sha256(zoningMapFingerprintedAttributes(record));
}

export function normalizeZoningMapFeature(value: unknown): ZoningMapSnapshotRecord | null {
  if (!isRecord(value) || !isRecord(value.attributes) || !isRecord(value.geometry)) {
    return null;
  }
  const attributes = value.attributes;
  const globalId = requiredText(attributes.GLOBALID);
  if (!globalId) return null;

  const normalized = {
    globalId,
    zoningId: nullableNumber(attributes.ZONING_ID),
    zoneClass: nullableText(attributes.ZONE_CLASS),
    zoneTypeCode: nullableNumber(attributes.ZONE_TYPE),
    pdNumber: nullableNumber(attributes.PD_NUM),
    pmdSubArea: nullableText(attributes.PMD_SUB_AREA),
    ordinanceNumber: nullableText(attributes.ORDINANCE_NUM),
    ordinanceDate: nullableIsoDate(attributes.ORDINANCE_DATE),
    clerkDocumentNumber: nullableText(attributes.CLERK_DOCNO),
    clerkUrl: nullableText(attributes.CLERK_URL),
    recordUpdatedAt: nullableIsoDate(attributes.UPDATE_TIMESTAMP),
  };
  // Written into the snapshot for readers (and for a cheap eyeball diff of the
  // committed file). The comparator does NOT trust it — it recomputes both
  // sides through the same helper, so a formula change cannot make an
  // already-committed snapshot disagree with a freshly fetched one.
  const attributeFingerprint = zoningMapAttributeFingerprint(normalized);
  const geometryFingerprint = sha256(value.geometry);
  return { ...normalized, attributeFingerprint, geometryFingerprint };
}

export function buildZoningMapSnapshot(
  records: readonly ZoningMapSnapshotRecord[],
): ZoningMapSnapshot {
  const sorted = [...records].sort((a, b) => a.globalId.localeCompare(b.globalId));
  const sourceUpdatedThrough = sorted.reduce<string | null>(
    (latest, row) =>
      row.recordUpdatedAt && (!latest || row.recordUpdatedAt > latest)
        ? row.recordUpdatedAt
        : latest,
    null,
  );
  return {
    schemaVersion: 1,
    source: {
      id: "chicago-arcgis-zoning",
      label: "City of Chicago ArcGIS zoning boundaries",
      url: CHICAGO_ZONING_LAYER_URL,
      sourceUpdatedThrough,
    },
    featureCount: sorted.length,
    records: sorted,
  };
}

/**
 * How one polygon is followed from one snapshot to the next.
 *
 * NOT by `globalId`. On 2026-09-02 the City rotated 100% of the zoning
 * layer's GLOBALIDs in a single publish: id overlap between consecutive
 * snapshots was 0 of 14,986, while 97.8% of the published geometry was
 * byte-identical. A GLOBALID-keyed comparator has no way to describe that
 * except as a total replacement of Chicago's zoning map — 14,986 added,
 * 14,920 removed — which is what it reported to admins.
 *
 * NOT by `zoningId` either, notwithstanding that it was "100% stable"
 * across the rotation. It is stable because it is not an identity: there
 * are only 69 distinct ZONING_ID values across ~15,000 polygons (it is the
 * zone-class code — 61 = RS-3, and so on), so it cannot address a record.
 *
 * `geometryFingerprint` is the identity that actually survived, and it is
 * the thing the artifact is about: a polygon IS its published boundary.
 * It is not quite unique — a few records share a fingerprint (14,917
 * distinct across 14,920 rows) — so the join pairs rows WITHIN a
 * fingerprint bucket instead of assuming a 1:1 map.
 *
 * `globalId` is still recorded on every row, and is still consulted as a
 * SECONDARY key, but only over the leftovers: see pass 2 below.
 */
function groupByGeometry(
  records: readonly ZoningMapSnapshotRecord[],
): Map<string, ZoningMapSnapshotRecord[]> {
  const out = new Map<string, ZoningMapSnapshotRecord[]>();
  for (const row of records) {
    const bucket = out.get(row.geometryFingerprint);
    if (bucket) bucket.push(row);
    else out.set(row.geometryFingerprint, [row]);
  }
  // Deterministic pairing within a shared-geometry bucket.
  for (const bucket of out.values()) {
    bucket.sort((a, b) => a.globalId.localeCompare(b.globalId));
  }
  return out;
}

function mapChangeFacts(row: ZoningMapSnapshotRecord | undefined) {
  if (!row) return null;
  return {
    zoneClass: row.zoneClass,
    pdNumber: row.pdNumber,
    ordinanceNumber: row.ordinanceNumber,
    clerkDocumentNumber: row.clerkDocumentNumber,
    recordUpdatedAt: row.recordUpdatedAt,
  };
}

const CHANGE_ORDER: Record<ZoningMapChange["change"], number> = {
  added: 0,
  removed: 1,
  attributes_changed: 2,
  geometry_changed: 3,
  rekeyed: 4,
};

export function diffZoningMapSnapshots(
  previous: ZoningMapSnapshot | null,
  current: ZoningMapSnapshot,
): ZoningMapDelta {
  const changes: ZoningMapChange[] = [];
  let rekeyed = 0;

  if (previous) {
    const matched: Array<[ZoningMapSnapshotRecord, ZoningMapSnapshotRecord]> = [];
    const leftoverBefore: ZoningMapSnapshotRecord[] = [];
    const leftoverAfter: ZoningMapSnapshotRecord[] = [];

    // ── Pass 1: geometry-keyed join. Survives a GLOBALID rotation. ──
    const beforeByGeometry = groupByGeometry(previous.records);
    const afterByGeometry = groupByGeometry(current.records);
    const fingerprints = [
      ...new Set([...beforeByGeometry.keys(), ...afterByGeometry.keys()]),
    ].sort();
    for (const fingerprint of fingerprints) {
      const olds = beforeByGeometry.get(fingerprint) ?? [];
      const news = afterByGeometry.get(fingerprint) ?? [];
      const pairs = Math.min(olds.length, news.length);
      for (let i = 0; i < pairs; i++) matched.push([olds[i], news[i]]);
      leftoverBefore.push(...olds.slice(pairs));
      leftoverAfter.push(...news.slice(pairs));
    }

    // ── Pass 2: GLOBALID join, over ONLY what geometry could not match. ──
    // A polygon whose boundary was genuinely redrawn has no geometry
    // counterpart; when its id did not rotate it is still the same record,
    // and calling it added+removed would bury a real geometry change. This
    // is the one place globalId is joined on, and it can never mask a
    // re-key: by construction the ids it matches are equal.
    const leftoverAfterById = new Map(leftoverAfter.map((row) => [row.globalId, row]));
    const removed: ZoningMapSnapshotRecord[] = [];
    for (const oldRow of leftoverBefore) {
      const newRow = leftoverAfterById.get(oldRow.globalId);
      if (!newRow) {
        removed.push(oldRow);
        continue;
      }
      leftoverAfterById.delete(oldRow.globalId);
      matched.push([oldRow, newRow]);
    }

    for (const [oldRow, newRow] of matched) {
      const wasRekeyed = oldRow.globalId !== newRow.globalId;
      const previousGlobalId = wasRekeyed ? oldRow.globalId : null;
      if (wasRekeyed) rekeyed += 1;

      let reportedSubstantiveChange = false;
      // Derived, not read off the rows: `previous` is a snapshot loaded from
      // disk whose stored fingerprints were produced by whatever formula was
      // current the day it was written.
      if (
        zoningMapAttributeFingerprint(oldRow) !== zoningMapAttributeFingerprint(newRow)
      ) {
        changes.push({
          globalId: newRow.globalId,
          previousGlobalId,
          change: "attributes_changed",
          before: mapChangeFacts(oldRow),
          after: mapChangeFacts(newRow),
        });
        reportedSubstantiveChange = true;
      }
      // The one stored value that cannot be re-derived: the snapshot records
      // the polygon's fingerprint, not the polygon. It is also the join key,
      // so changing `sha256(value.geometry)` would not merely mis-report a
      // field — it would dissolve the join and read as a full replacement of
      // the layer. That formula is frozen; a change to it needs a re-baselined
      // snapshot committed in the same PR.
      if (oldRow.geometryFingerprint !== newRow.geometryFingerprint) {
        changes.push({
          globalId: newRow.globalId,
          previousGlobalId,
          change: "geometry_changed",
          before: mapChangeFacts(oldRow),
          after: mapChangeFacts(newRow),
        });
        reportedSubstantiveChange = true;
      }
      // A pure re-key changed nothing an admin can act on, but it must still
      // appear, or the ledger would silently drop 14,656 records off both
      // sides of the comparison and read as a quiet day.
      if (!reportedSubstantiveChange && wasRekeyed) {
        changes.push({
          globalId: newRow.globalId,
          previousGlobalId,
          change: "rekeyed",
          before: mapChangeFacts(oldRow),
          after: mapChangeFacts(newRow),
        });
      }
    }

    for (const oldRow of removed) {
      changes.push({
        globalId: oldRow.globalId,
        previousGlobalId: null,
        change: "removed",
        before: mapChangeFacts(oldRow),
        after: null,
      });
    }
    for (const newRow of leftoverAfterById.values()) {
      changes.push({
        globalId: newRow.globalId,
        previousGlobalId: null,
        change: "added",
        before: null,
        after: mapChangeFacts(newRow),
      });
    }

    changes.sort(
      (a, b) =>
        a.globalId.localeCompare(b.globalId) ||
        CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change],
    );
  }

  return {
    schemaVersion: 1,
    sourceUrl: CHICAGO_ZONING_LAYER_URL,
    comparedFrom: previous?.source.sourceUpdatedThrough ?? null,
    comparedThrough: current.source.sourceUpdatedThrough,
    counts: {
      added: changes.filter((row) => row.change === "added").length,
      removed: changes.filter((row) => row.change === "removed").length,
      attributesChanged: changes.filter((row) => row.change === "attributes_changed").length,
      geometryChanged: changes.filter((row) => row.change === "geometry_changed").length,
      rekeyed,
    },
    changes,
  };
}

/** Ceiling on how much of the layer may be added+removed in one refresh
 * before the sync refuses to publish the result unreviewed.
 *
 * Calibrated from the data: a normal day moves a few hundred polygons, and
 * the largest genuine movement observed — the 2026-09-02 refresh, once
 * re-joined on geometry — was 330 added + 264 removed against 14,986
 * features, or 4.0%. 10% leaves better than 2x headroom over the busiest
 * real day while still catching the failure this bound exists for: the
 * GLOBALID rotation scored 200%. */
export const MAX_ZONING_MAP_CHURN_RATIO = 0.1;

export interface ZoningMapChurnAssessment {
  /** added + removed: records with no counterpart on the other side. */
  churned: number;
  /** Layer size the churn is measured against. */
  total: number;
  ratio: number;
  limit: number;
  withinBounds: boolean;
}

/**
 * Bound how much of the zoning layer a single refresh may claim changed.
 *
 * `added` and `removed` here are already the geometry-keyed numbers, so an
 * id rotation no longer inflates them — a trip means the City really did
 * republish a large share of the map, which is a thing a human must look at
 * before it reaches the admin ledger, not something to publish and hope.
 * A first-run baseline has nothing to compare against and never trips.
 */
export function assessZoningMapChurn(
  delta: ZoningMapDelta,
  previous: ZoningMapSnapshot | null,
  current: ZoningMapSnapshot,
  limit: number = MAX_ZONING_MAP_CHURN_RATIO,
): ZoningMapChurnAssessment {
  const churned = delta.counts.added + delta.counts.removed;
  const total = Math.max(previous?.featureCount ?? 0, current.featureCount);
  const ratio = total > 0 ? churned / total : 0;
  return {
    churned,
    total,
    ratio,
    limit,
    withinBounds: previous === null || total === 0 ? true : ratio <= limit,
  };
}

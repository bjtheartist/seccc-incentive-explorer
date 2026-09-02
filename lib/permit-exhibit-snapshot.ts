import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";
import { getSQL } from "@/lib/db";
import type {
  PermitExhibitResult,
  PermitExhibitZoningArchiveVintageRange,
} from "@/lib/permit-exhibit";

type SqlClient = NeonQueryFunction<false, false>;

export const PERMIT_EXHIBIT_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID_PATTERN = /^ps_[A-Za-z0-9_-]{24}$/;
export const PERMIT_EXHIBIT_SNAPSHOT_MAX_CREATES_PER_HOUR = 20;

export interface PermitExhibitSnapshotSourceVintages {
  permitDatasetUpdatedAt: string | null;
  parcelContextResolvedAt: string;
  boundaryContextResolvedAt: string;
  zoningRecordUpdatedAt: string | null;
  zoningArchive: PermitExhibitZoningArchiveVintageRange;
}

export interface PermitExhibitSnapshotDocument {
  schemaVersion: typeof PERMIT_EXHIBIT_SNAPSHOT_SCHEMA_VERSION;
  publicId: string;
  displayId: string;
  savedAt: string;
  appRevision: string;
  sourceVintages: PermitExhibitSnapshotSourceVintages;
  exhibit: PermitExhibitResult;
}

export interface PermitExhibitSnapshot extends PermitExhibitSnapshotDocument {
  contentHash: string;
}

export interface CreatePermitExhibitSnapshotInput {
  exhibit: PermitExhibitResult;
  requestId: string;
  sql?: SqlClient | null;
  now?: () => Date;
  publicId?: string;
  displaySuffix?: string;
  appRevision?: string;
}

export class PermitExhibitSnapshotStorageUnavailableError extends Error {
  constructor(message = "Permit exhibit snapshot storage is unavailable") {
    super(message);
    this.name = "PermitExhibitSnapshotStorageUnavailableError";
  }
}

export class PermitExhibitSnapshotCorruptError extends Error {
  constructor(message = "The saved permit exhibit failed its integrity check") {
    super(message);
    this.name = "PermitExhibitSnapshotCorruptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonicalize(item)));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

/** Stable JSON is the integrity envelope. Postgres JSONB may reorder object
 * keys, so a normal JSON.stringify() cannot be used to verify a later read. */
export function stablePermitExhibitSnapshotJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computePermitExhibitSnapshotHash(document: PermitExhibitSnapshotDocument): string {
  return createHash("sha256").update(stablePermitExhibitSnapshotJson(document)).digest("hex");
}

export function derivePermitExhibitSnapshotSourceVintages(
  exhibit: PermitExhibitResult,
): PermitExhibitSnapshotSourceVintages {
  return {
    permitDatasetUpdatedAt: exhibit.meta.datasetLastUpdate,
    parcelContextResolvedAt: exhibit.meta.snapshotDate,
    boundaryContextResolvedAt: exhibit.boundaryContext.asOfDate,
    zoningRecordUpdatedAt: exhibit.boundaryContext.zoningDistrict.recordUpdatedAt,
    zoningArchive: { ...exhibit.boundaryContext.archiveVintageRange },
  };
}

function chicagoDateStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}`;
}

function generatedPublicId(): string {
  return `ps_${randomBytes(18).toString("base64url")}`;
}

function generatedDisplaySuffix(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join("");
}

function currentAppRevision(): string {
  const revision =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA ||
    "local";
  return revision.trim().slice(0, 120) || "local";
}

export function buildPermitExhibitSnapshotDocument(
  input: Omit<CreatePermitExhibitSnapshotInput, "sql" | "requestId">,
): PermitExhibitSnapshotDocument {
  const savedAt = (input.now?.() ?? new Date()).toISOString();
  const publicId = input.publicId ?? generatedPublicId();
  if (!PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID_PATTERN.test(publicId)) {
    throw new Error("Permit exhibit snapshot publicId is invalid");
  }

  const suffix = (input.displaySuffix ?? generatedDisplaySuffix())
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  if (suffix.length < 4) throw new Error("Permit exhibit snapshot display suffix is invalid");

  const pin = input.exhibit.meta.subjectParcel.pin;
  return {
    schemaVersion: PERMIT_EXHIBIT_SNAPSHOT_SCHEMA_VERSION,
    publicId,
    displayId: `PX-${pin}-${chicagoDateStamp(new Date(savedAt))}-${suffix}`,
    savedAt,
    appRevision: (input.appRevision ?? currentAppRevision()).trim().slice(0, 120) || "local",
    sourceVintages: derivePermitExhibitSnapshotSourceVintages(input.exhibit),
    exhibit: input.exhibit,
  };
}

const nonEmptyString = z.string().min(1);
const nullableString = z.string().nullable();
const nonnegativeInteger = z.number().int().nonnegative();
const finiteNumber = z.number().finite();
const pin14 = z.string().regex(/^\d{14}$/);
// These keys are part of persisted schema v1. Keep them frozen here so a
// future live-map taxonomy rename cannot make an otherwise valid historical
// snapshot unreadable without an explicit snapshot-schema migration.
const PERMIT_EXHIBIT_SNAPSHOT_V1_MAP_TYPE_KEYS = [
  "express_permit_program",
  "easy_permit_process",
  "renovation_alteration",
  "signs",
  "new_construction",
  "elevator_equipment",
  "wrecking_demolition",
  "scaffolding",
  "reinstate_revoked_permit",
  "porch_construction",
  "permit_extension",
] as const;
const permitMapTypeKey = z.enum(PERMIT_EXHIBIT_SNAPSHOT_V1_MAP_TYPE_KEYS);

const isoDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
});
// Source timestamps can be canonical ISO or PostgreSQL's stable text form
// (`YYYY-MM-DD HH:mm:ss+00`). Preserve the source string in the hash while
// rejecting values the runtime cannot parse or display.
const sourceVintage = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const httpUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
});

const sharedPermitRowFields = {
  permitNumber: nonEmptyString,
  type: nonEmptyString,
  issueDate: isoDate.nullable(),
  estimatedCostSelfReported: finiteNumber.nullable(),
  status: nullableString,
  typeKey: permitMapTypeKey.nullable(),
  rawType: nullableString,
  workDescription: nullableString,
  milestone: nullableString,
  sourceRecordUrl: httpUrl.nullable(),
};

const PermitExhibitSubjectRowSchema = z.object({
  ...sharedPermitRowFields,
  matchMethod: z.enum(["pin_parcel", "address_exact", "proximity"]),
  matchConfidence: z.enum(["high", "medium", "low"]),
});

const PermitExhibitAreaRowSchema = z.object({
  ...sharedPermitRowFields,
  locatedVia: z.enum(["point", "address_only"]),
});

const ZoningArchiveSchema = z.object({
  earliest: sourceVintage.nullable(),
  latest: sourceVintage.nullable(),
  snapshotCount: nonnegativeInteger,
});

const PermitExhibitResultSchema = z
  .object({
    subject: z.array(PermitExhibitSubjectRowSchema),
    area: z.object({
      byYear: z.array(
        z.object({
          year: z.number().int().positive(),
          count: nonnegativeInteger,
        }),
      ),
      byType: z.array(
        z.object({
          key: permitMapTypeKey.nullable(),
          label: nonEmptyString,
          count: nonnegativeInteger,
        }),
      ),
      rows: z.array(PermitExhibitAreaRowSchema),
    }),
    boundaryContext: z.object({
      asOfDate: isoDate,
      parcelAddress: nullableString,
      zoningDistrict: z.object({
        status: z.enum(["resolved", "not_found", "unavailable"]),
        zoneClass: nullableString,
        recordUpdatedAt: sourceVintage.nullable(),
        sourceLabel: nonEmptyString,
        sourceUrl: httpUrl,
      }),
      tifDistricts: z.array(z.object({ key: nonEmptyString, name: nonEmptyString })),
      overlays: z.array(z.object({ key: nonEmptyString, name: nonEmptyString })),
      archiveVintageRange: ZoningArchiveSchema,
      limitNote: nonEmptyString,
    }),
    coverage: z.object({
      matchMethodBreakdown: z.object({
        pinParcel: nonnegativeInteger,
        addressExact: nonnegativeInteger,
        proximity: nonnegativeInteger,
      }),
      area: z.object({
        geolocatedCount: nonnegativeInteger,
        unlocatedCount: nonnegativeInteger,
        totalCount: nonnegativeInteger,
      }),
      coverageNote: nonEmptyString,
    }),
    meta: z.object({
      snapshotDate: isoDate,
      datasetLastUpdate: sourceVintage.nullable(),
      exhibitId: nonEmptyString,
      queryParams: z.object({
        pin: pin14,
        pinFormatted: nonEmptyString,
        radiusFt: z.number().int().refine((value) => [250, 500, 1000].includes(value)),
        filters: z.object({
          permitTypeKeys: z.array(permitMapTypeKey).optional(),
        }),
      }),
      sourceLabel: nonEmptyString,
      sourceUrl: httpUrl,
      sourcePortalUrl: httpUrl,
      historyWindow: z.literal("full_ingested_history"),
      ingestFloorDate: isoDate,
      costLabel: nonEmptyString,
      limitsBlock: z.array(nonEmptyString),
      exhibitIdFooter: nonEmptyString,
      subjectParcel: z.object({
        pin: pin14,
        pinFormatted: nonEmptyString,
        situsAddress: nullableString,
      }),
      // The row-cap marker (R2 finding 8). Optional, not required: documents
      // saved before the surfaces disclosed it have no such key, and a
      // complete exhibit stores `null`. Validated rather than merely tolerated
      // because the snapshot surfaces now RENDER it — an unchecked value here
      // would be an unchecked claim about the exhibit's own completeness.
      truncation: z
        .object({
          scope: z.enum(["subject", "area", "both"]),
          rowCap: z.number().int().positive(),
          notice: nonEmptyString,
        })
        .nullish(),
    }),
  })
  .superRefine((value, context) => {
    if (value.meta.queryParams.pin !== value.meta.subjectParcel.pin) {
      context.addIssue({ code: "custom", message: "Snapshot PINs do not agree" });
    }
    const actualPointRows = value.area.rows.filter((row) => row.locatedVia === "point").length;
    const actualAddressRows = value.area.rows.length - actualPointRows;
    if (
      value.coverage.area.geolocatedCount !== actualPointRows ||
      value.coverage.area.unlocatedCount !== actualAddressRows ||
      value.coverage.area.totalCount !== value.area.rows.length
    ) {
      context.addIssue({ code: "custom", message: "Snapshot area coverage does not agree with rows" });
    }
  });

const SnapshotSourceVintagesSchema = z.object({
  permitDatasetUpdatedAt: sourceVintage.nullable(),
  parcelContextResolvedAt: sourceVintage,
  boundaryContextResolvedAt: sourceVintage,
  zoningRecordUpdatedAt: sourceVintage.nullable(),
  zoningArchive: ZoningArchiveSchema,
});

function isPermitExhibitResultShape(value: unknown): value is PermitExhibitResult {
  return PermitExhibitResultSchema.safeParse(value).success;
}

function isSourceVintagesShape(value: unknown): value is PermitExhibitSnapshotSourceVintages {
  return SnapshotSourceVintagesSchema.safeParse(value).success;
}

function parseSnapshotDocument(value: unknown): PermitExhibitSnapshotDocument {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new PermitExhibitSnapshotCorruptError("The saved permit exhibit is not valid JSON");
    }
  }
  if (!isRecord(parsed)) throw new PermitExhibitSnapshotCorruptError();
  if (parsed.schemaVersion !== PERMIT_EXHIBIT_SNAPSHOT_SCHEMA_VERSION) {
    throw new PermitExhibitSnapshotCorruptError("The saved permit exhibit uses an unsupported schema version");
  }
  if (
    typeof parsed.publicId !== "string" ||
    !PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID_PATTERN.test(parsed.publicId) ||
    typeof parsed.displayId !== "string" ||
    !/^PX-\d{14}-\d{8}-[A-Z0-9]{4,8}$/.test(parsed.displayId) ||
    typeof parsed.savedAt !== "string" ||
    typeof parsed.appRevision !== "string" ||
    parsed.appRevision.length < 1 ||
    parsed.appRevision.length > 120 ||
    !isSourceVintagesShape(parsed.sourceVintages) ||
    !isPermitExhibitResultShape(parsed.exhibit)
  ) {
    throw new PermitExhibitSnapshotCorruptError();
  }
  try {
    asIso(parsed.savedAt);
  } catch {
    throw new PermitExhibitSnapshotCorruptError("The saved permit exhibit has an invalid timestamp");
  }
  return parsed as unknown as PermitExhibitSnapshotDocument;
}

export function decodePermitExhibitSnapshotRow(row: Record<string, unknown>): PermitExhibitSnapshot {
  const document = parseSnapshotDocument(row.snapshot_json);
  const storedHash = String(row.content_hash ?? "");
  const computedHash = computePermitExhibitSnapshotHash(document);
  const storedSavedAt = asIso(row.saved_at as string | Date);

  if (
    computedHash !== storedHash ||
    document.publicId !== String(row.public_id) ||
    document.displayId !== String(row.display_id) ||
    document.savedAt !== storedSavedAt ||
    document.schemaVersion !== Number(row.snapshot_schema_version) ||
    document.appRevision !== String(row.app_revision) ||
    document.exhibit.meta.subjectParcel.pin !== String(row.pin) ||
    document.exhibit.meta.queryParams.radiusFt !== Number(row.radius_ft)
  ) {
    throw new PermitExhibitSnapshotCorruptError();
  }

  return { ...document, contentHash: storedHash };
}

function requireSnapshotSQL(sqlOverride?: SqlClient | null): SqlClient {
  const sql = sqlOverride === undefined ? getSQL() : sqlOverride;
  if (!sql) throw new PermitExhibitSnapshotStorageUnavailableError();
  return sql;
}

function isMissingSnapshotTable(error: unknown): boolean {
  return error instanceof Error && /permit_exhibit_snapshots|does not exist/i.test(error.message);
}

export async function createPermitExhibitSnapshot(
  input: CreatePermitExhibitSnapshotInput,
): Promise<PermitExhibitSnapshot> {
  const document = buildPermitExhibitSnapshotDocument(input);
  // Validate the complete renderer contract before INSERT. An immutable row
  // must never be committed and only then discovered to be unreadable.
  parseSnapshotDocument(document);
  const sql = requireSnapshotSQL(input.sql);
  const contentHash = computePermitExhibitSnapshotHash(document);
  const pin = document.exhibit.meta.subjectParcel.pin;
  const radiusFt = document.exhibit.meta.queryParams.radiusFt;
  const snapshotJson = JSON.stringify(document);

  try {
    let rows = await sql`
      INSERT INTO permit_exhibit_snapshots (
        public_id, display_id, request_id, pin, radius_ft,
        snapshot_schema_version, saved_at, content_hash, app_revision, snapshot_json
      )
      VALUES (
        ${document.publicId}, ${document.displayId}, ${input.requestId}::uuid, ${pin}, ${radiusFt},
        ${document.schemaVersion}, ${document.savedAt}::timestamptz, ${contentHash},
        ${document.appRevision}, ${snapshotJson}::jsonb
      )
      ON CONFLICT (request_id) DO NOTHING
      RETURNING public_id, display_id, pin, radius_ft, snapshot_schema_version,
                saved_at, content_hash, app_revision, snapshot_json
    `;

    if (rows.length === 0) {
      rows = await sql`
        SELECT public_id, display_id, pin, radius_ft, snapshot_schema_version,
               saved_at, content_hash, app_revision, snapshot_json
        FROM permit_exhibit_snapshots
        WHERE request_id = ${input.requestId}::uuid
        LIMIT 1
      `;
    }
    if (rows.length === 0) throw new PermitExhibitSnapshotStorageUnavailableError();
    return decodePermitExhibitSnapshotRow(rows[0] as Record<string, unknown>);
  } catch (error) {
    if (error instanceof PermitExhibitSnapshotCorruptError) throw error;
    if (error instanceof PermitExhibitSnapshotStorageUnavailableError) throw error;
    throw new PermitExhibitSnapshotStorageUnavailableError(
      isMissingSnapshotTable(error)
        ? "Permit exhibit snapshot storage has not been migrated"
        : "Permit exhibit snapshot could not be saved",
    );
  }
}

export async function loadPermitExhibitSnapshot(
  publicId: string,
  sqlOverride?: SqlClient | null,
): Promise<PermitExhibitSnapshot | null> {
  if (!PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID_PATTERN.test(publicId)) return null;
  const sql = requireSnapshotSQL(sqlOverride);
  try {
    const rows = await sql`
      SELECT public_id, display_id, pin, radius_ft, snapshot_schema_version,
             saved_at, content_hash, app_revision, snapshot_json
      FROM permit_exhibit_snapshots
      WHERE public_id = ${publicId}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return decodePermitExhibitSnapshotRow(rows[0] as Record<string, unknown>);
  } catch (error) {
    if (error instanceof PermitExhibitSnapshotCorruptError) throw error;
    throw new PermitExhibitSnapshotStorageUnavailableError(
      isMissingSnapshotTable(error)
        ? "Permit exhibit snapshot storage has not been migrated"
        : "Permit exhibit snapshot could not be loaded",
    );
  }
}

export function permitExhibitSnapshotClientIdentifier(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip");
  if (address) return address;
  return `unknown:${(headers.get("user-agent") || "no-user-agent").slice(0, 180)}`;
}

export async function reservePermitExhibitSnapshotCreate(
  clientIdentifier: string,
  sqlOverride?: SqlClient | null,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const sql = requireSnapshotSQL(sqlOverride);
  const clientHash = createHash("sha256").update(clientIdentifier).digest("hex");
  try {
    await sql`
      DELETE FROM permit_exhibit_snapshot_attempts
      WHERE created_at < NOW() - INTERVAL '30 days'
    `;
    const rows = await sql`
      SELECT reserve_permit_exhibit_snapshot_attempt(
        ${clientHash},
        ${PERMIT_EXHIBIT_SNAPSHOT_MAX_CREATES_PER_HOUR}
      ) AS allowed
    `;
    return Boolean(rows[0]?.allowed)
      ? { allowed: true, retryAfterSeconds: 0 }
      : { allowed: false, retryAfterSeconds: 3600 };
  } catch (error) {
    throw new PermitExhibitSnapshotStorageUnavailableError(
      isMissingSnapshotTable(error)
        ? "Permit exhibit snapshot storage has not been migrated"
        : "Permit exhibit snapshot rate limit is unavailable",
    );
  }
}

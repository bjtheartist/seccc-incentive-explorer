import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getSQL } from "@/lib/db";
import { fetchOwnerClusters, loadStaticOwnerClusters, type OwnerCluster } from "@/lib/corridor-owners";
import { resolveConfidenceTier, type ConfidenceTier } from "@/lib/owner-confidence";
import { normalizeChecklist, type ChecklistItem } from "@/lib/workspace";

/**
 * The Owner File human layer — merges the recomputed-per-refresh
 * OwnerCluster spine (lib/corridor-owners.ts) with the small, prod-durable
 * human-authored tables from scripts/migrate-owner-file.ts
 * (owner_file_verifications / owner_file_notes / owner_file_outreach_events).
 *
 * Mirrors two established patterns:
 *  - Cluster lookup: static-export-first with a live-DB attempt first and
 *    the same 42P01/42703 schema-drift degrade as
 *    app/api/corridor/owners/route.ts (never a 500 — an Owner File that
 *    can't resolve its cluster degrades to "not found in this snapshot").
 *  - Human layer: the small-table pattern from scripts/migrate-workspace.ts
 *    (business_projects / saved_reports / watched_areas) — always live,
 *    never static-exported, since it is human-authored and prod-durable by
 *    design (docs/business-file/00-spec-overview.md §6).
 */

type SQL = NeonQueryFunction<false, false>;

/* ── Enumerations shared with the API routes' request validation ── */

export const OWNER_FILE_VERIFICATION_STATUSES = ["draft", "verified", "stale", "superseded"] as const;
export type OwnerFileVerificationStatus = (typeof OWNER_FILE_VERIFICATION_STATUSES)[number];

export const OWNER_FILE_NOTE_TYPES = [
  "entity_lookup",
  "transfer_observation",
  "distress_observation",
  "general",
] as const;
export type OwnerFileNoteType = (typeof OWNER_FILE_NOTE_TYPES)[number];

export const OWNER_FILE_OUTREACH_EVENT_TYPES = [
  "letter_generated",
  "letter_downloaded",
  "letter_mailed",
  "outcome_logged",
] as const;
export type OwnerFileOutreachEventType = (typeof OWNER_FILE_OUTREACH_EVENT_TYPES)[number];

export const OWNER_FILE_OUTREACH_OUTCOMES = [
  "no_response",
  "responded",
  "meeting_scheduled",
  "returned_undeliverable",
  "sold",
  "other",
] as const;
export type OwnerFileOutreachOutcome = (typeof OWNER_FILE_OUTREACH_OUTCOMES)[number];

export interface OwnerFileVerification {
  id: string;
  clusterKey: string;
  zip: string;
  pinsSnapshot: string[];
  ownerNameSnapshot: string | null;
  ownerMailingAddressSnapshot: string | null;
  exportGeneratedAt: string | null;
  verifierName: string;
  /**
   * Snapshot of the tier resolved at save time (via
   * lib/owner-confidence.ts resolveConfidenceTier), stored for audit/letter
   * evidentiary purposes. The tier shown on the page is always freshly
   * recomputed by getOwnerFile — this column is history, not the source of
   * truth for "what tier is this right now."
   */
  confidenceTier: ConfidenceTier | null;
  registeredAgentName: string | null;
  registeredAgentAddress: string | null;
  ilSosFileNumber: string | null;
  ilSosLookupUrl: string | null;
  taxpayerMailingAddressConfirmed: boolean | null;
  localVsAbsentee: string | null;
  checklist: ChecklistItem[];
  status: OwnerFileVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input to upsertOwnerFileVerification. `confidenceTier` must be computed by
 * the caller via resolveConfidenceTier — never accept it verbatim from a
 * client request body ("computed, not asserted" per the plan's governance
 * rails).
 */
export interface OwnerFileVerificationInput {
  clusterKey: string;
  zip: string;
  pinsSnapshot: string[];
  ownerNameSnapshot: string | null;
  ownerMailingAddressSnapshot: string | null;
  exportGeneratedAt: string | null;
  verifierName: string;
  confidenceTier: ConfidenceTier | null;
  registeredAgentName?: string | null;
  registeredAgentAddress?: string | null;
  ilSosFileNumber?: string | null;
  ilSosLookupUrl?: string | null;
  taxpayerMailingAddressConfirmed?: boolean | null;
  localVsAbsentee?: string | null;
  checklist?: ChecklistItem[];
  status?: OwnerFileVerificationStatus;
}

export interface OwnerFileNote {
  id: string;
  clusterKey: string;
  zip: string;
  authorName: string;
  noteType: OwnerFileNoteType;
  body: string;
  sourceUrl: string | null;
  createdAt: string;
}

export interface OwnerFileNoteInput {
  clusterKey: string;
  zip: string;
  authorName: string;
  noteType: OwnerFileNoteType;
  body: string;
  sourceUrl?: string | null;
}

export interface OwnerFileOutreachEvent {
  id: string;
  clusterKey: string;
  zip: string;
  verificationId: string | null;
  eventType: OwnerFileOutreachEventType;
  actorName: string | null;
  programIds: string[];
  outcome: OwnerFileOutreachOutcome | null;
  notes: string | null;
  occurredAt: string;
}

export interface OwnerFileOutreachEventInput {
  clusterKey: string;
  zip: string;
  verificationId?: string | null;
  eventType: OwnerFileOutreachEventType;
  actorName?: string | null;
  programIds?: string[];
  outcome?: OwnerFileOutreachOutcome | null;
  notes?: string | null;
}

export interface OwnerFile {
  cluster: OwnerCluster;
  verification: OwnerFileVerification | null;
  notes: OwnerFileNote[];
  outreachEvents: OwnerFileOutreachEvent[];
  /** Freshly recomputed via resolveConfidenceTier — the tier to display. */
  resolvedTier: ConfidenceTier;
}

/* ── Row mapping (defensive JSONB parsing — Neon can return JSONB either
   already-parsed or as a raw string depending on driver path) ── */

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringArray(value: unknown): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toVerification(row: Row): OwnerFileVerification {
  return {
    id: String(row.id),
    clusterKey: String(row.cluster_key),
    zip: String(row.zip),
    pinsSnapshot: stringArray(row.pins_snapshot),
    ownerNameSnapshot: (row.owner_name_snapshot as string | null) ?? null,
    ownerMailingAddressSnapshot: (row.owner_mailing_address_snapshot as string | null) ?? null,
    exportGeneratedAt: toIso(row.export_generated_at),
    verifierName: String(row.verifier_name ?? ""),
    confidenceTier: (row.confidence_tier as ConfidenceTier | null) ?? null,
    registeredAgentName: (row.registered_agent_name as string | null) ?? null,
    registeredAgentAddress: (row.registered_agent_address as string | null) ?? null,
    ilSosFileNumber: (row.il_sos_file_number as string | null) ?? null,
    ilSosLookupUrl: (row.il_sos_lookup_url as string | null) ?? null,
    taxpayerMailingAddressConfirmed: (row.taxpayer_mailing_address_confirmed as boolean | null) ?? null,
    localVsAbsentee: (row.local_vs_absentee as string | null) ?? null,
    checklist: normalizeChecklist(parseJson(row.checklist_json, [])),
    status: (row.status as OwnerFileVerificationStatus) ?? "draft",
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function toNote(row: Row): OwnerFileNote {
  return {
    id: String(row.id),
    clusterKey: String(row.cluster_key),
    zip: String(row.zip),
    authorName: String(row.author_name ?? ""),
    noteType: row.note_type as OwnerFileNoteType,
    body: String(row.body ?? ""),
    sourceUrl: (row.source_url as string | null) ?? null,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function toOutreachEvent(row: Row): OwnerFileOutreachEvent {
  return {
    id: String(row.id),
    clusterKey: String(row.cluster_key),
    zip: String(row.zip),
    verificationId: (row.verification_id as string | null) ?? null,
    eventType: row.event_type as OwnerFileOutreachEventType,
    actorName: (row.actor_name as string | null) ?? null,
    programIds: stringArray(row.program_ids),
    outcome: (row.outcome as OwnerFileOutreachOutcome | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    occurredAt: toIso(row.occurred_at) ?? new Date(0).toISOString(),
  };
}

/* ── Cluster lookup (static-export-first, DB fallback) ── */

/**
 * 42P01 = undefined table, 42703 = undefined column — cloned from
 * app/api/corridor/owners/route.ts's isMissingSchemaError so an Owner File
 * degrades to the static export (or "not found") instead of a 500 when the
 * parcels/ownership migrations haven't run on the live database.
 */
function isMissingSchemaError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "42P01" || code === "42703";
}

/** Generous cap — large enough that any cluster present in the export/live query is found. */
const OWNER_FILE_LOOKUP_LIMIT = 500;

/**
 * Resolve one OwnerCluster by (zip, clusterKey). Live DB first (refresh
 * branches carry full parcel/ownership data), then the committed static
 * export (corridor-metrics doctrine: prod DB holds no parcel data by
 * design), then null.
 */
/**
 * All OwnerClusters for a ZIP — the same data source
 * app/api/corridor/owners/route.ts serves (live DB first, then the
 * committed static export). Backs the Owner Files index page
 * (app/admin/owner-files/[zip]/page.tsx) and getOwnerCluster below.
 */
export async function listOwnerClusters(
  zip: string,
  limit: number = OWNER_FILE_LOOKUP_LIMIT
): Promise<OwnerCluster[]> {
  const sql = getSQL();
  if (sql) {
    try {
      const clusters = await fetchOwnerClusters(sql, zip, limit);
      if (clusters.length > 0) return clusters;
      // Live query succeeded but returned nothing (possibly because the
      // live DB legitimately has no parcel data, per doctrine) — fall
      // through to the static export below rather than reporting "no
      // clusters" prematurely.
    } catch (err) {
      if (!isMissingSchemaError(err)) {
        console.error("listOwnerClusters: live query failed, falling back to static export:", err);
      }
    }
  }

  return loadStaticOwnerClusters(zip, limit) ?? [];
}

/** Resolve one OwnerCluster by (zip, clusterKey) from listOwnerClusters. */
export async function getOwnerCluster(zip: string, clusterKey: string): Promise<OwnerCluster | null> {
  const clusters = await listOwnerClusters(zip, OWNER_FILE_LOOKUP_LIMIT);
  return clusters.find((cluster) => cluster.clusterKey === clusterKey) ?? null;
}

/* ── Human layer: verifications ── */

export async function getOwnerFileVerification(
  sql: SQL,
  clusterKey: string
): Promise<OwnerFileVerification | null> {
  const rows = await sql`
    SELECT * FROM owner_file_verifications WHERE cluster_key = ${clusterKey} LIMIT 1
  `;
  return rows.length > 0 ? toVerification(rows[0] as Row) : null;
}

/** Upsert-by-cluster_key. `input.confidenceTier` must already be server-computed (see OwnerFileVerificationInput). */
export async function upsertOwnerFileVerification(
  sql: SQL,
  input: OwnerFileVerificationInput
): Promise<OwnerFileVerification> {
  const checklistJson = JSON.stringify(input.checklist ?? []);
  const status = input.status ?? "draft";

  const rows = await sql`
    INSERT INTO owner_file_verifications (
      cluster_key, zip, pins_snapshot, owner_name_snapshot, owner_mailing_address_snapshot,
      export_generated_at, verifier_name, confidence_tier, registered_agent_name,
      registered_agent_address, il_sos_file_number, il_sos_lookup_url,
      taxpayer_mailing_address_confirmed, local_vs_absentee, checklist_json, status
    ) VALUES (
      ${input.clusterKey}, ${input.zip}, ${input.pinsSnapshot}::text[], ${input.ownerNameSnapshot},
      ${input.ownerMailingAddressSnapshot}, ${input.exportGeneratedAt}, ${input.verifierName},
      ${input.confidenceTier}, ${input.registeredAgentName ?? null}, ${input.registeredAgentAddress ?? null},
      ${input.ilSosFileNumber ?? null}, ${input.ilSosLookupUrl ?? null},
      ${input.taxpayerMailingAddressConfirmed ?? null}, ${input.localVsAbsentee ?? null},
      ${checklistJson}::jsonb, ${status}
    )
    ON CONFLICT (cluster_key) DO UPDATE SET
      zip = EXCLUDED.zip,
      pins_snapshot = EXCLUDED.pins_snapshot,
      owner_name_snapshot = EXCLUDED.owner_name_snapshot,
      owner_mailing_address_snapshot = EXCLUDED.owner_mailing_address_snapshot,
      export_generated_at = EXCLUDED.export_generated_at,
      verifier_name = EXCLUDED.verifier_name,
      confidence_tier = EXCLUDED.confidence_tier,
      registered_agent_name = EXCLUDED.registered_agent_name,
      registered_agent_address = EXCLUDED.registered_agent_address,
      il_sos_file_number = EXCLUDED.il_sos_file_number,
      il_sos_lookup_url = EXCLUDED.il_sos_lookup_url,
      taxpayer_mailing_address_confirmed = EXCLUDED.taxpayer_mailing_address_confirmed,
      local_vs_absentee = EXCLUDED.local_vs_absentee,
      checklist_json = EXCLUDED.checklist_json,
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING *
  `;
  return toVerification(rows[0] as Row);
}

/* ── Human layer: notes (append-only) ── */

export async function listOwnerFileNotes(sql: SQL, clusterKey: string): Promise<OwnerFileNote[]> {
  const rows = await sql`
    SELECT * FROM owner_file_notes WHERE cluster_key = ${clusterKey} ORDER BY created_at DESC
  `;
  return rows.map((row) => toNote(row as Row));
}

export async function addOwnerFileNote(sql: SQL, input: OwnerFileNoteInput): Promise<OwnerFileNote> {
  const rows = await sql`
    INSERT INTO owner_file_notes (cluster_key, zip, author_name, note_type, body, source_url)
    VALUES (
      ${input.clusterKey}, ${input.zip}, ${input.authorName}, ${input.noteType},
      ${input.body}, ${input.sourceUrl ?? null}
    )
    RETURNING *
  `;
  return toNote(rows[0] as Row);
}

/* ── Human layer: outreach events (append-only) ── */

export async function listOutreachEvents(sql: SQL, clusterKey: string): Promise<OwnerFileOutreachEvent[]> {
  const rows = await sql`
    SELECT * FROM owner_file_outreach_events WHERE cluster_key = ${clusterKey} ORDER BY occurred_at DESC
  `;
  return rows.map((row) => toOutreachEvent(row as Row));
}

export async function addOutreachEvent(
  sql: SQL,
  input: OwnerFileOutreachEventInput
): Promise<OwnerFileOutreachEvent> {
  const programIdsJson = JSON.stringify(input.programIds ?? []);
  const rows = await sql`
    INSERT INTO owner_file_outreach_events (
      cluster_key, zip, verification_id, event_type, actor_name, program_ids, outcome, notes
    ) VALUES (
      ${input.clusterKey}, ${input.zip}, ${input.verificationId ?? null}, ${input.eventType},
      ${input.actorName ?? null}, ${programIdsJson}::jsonb, ${input.outcome ?? null}, ${input.notes ?? null}
    )
    RETURNING *
  `;
  return toOutreachEvent(rows[0] as Row);
}

/* ── Merged view model ── */

/**
 * The full Owner File: cluster facts (static-export-first / DB fallback)
 * merged with the always-live human layer. Returns null only when the
 * cluster itself can't be resolved for this (zip, clusterKey) — a missing
 * human layer (unmigrated tables, or simply no verification yet) degrades
 * to empty/null fields rather than failing the whole page.
 */
export async function getOwnerFile(zip: string, clusterKey: string): Promise<OwnerFile | null> {
  const cluster = await getOwnerCluster(zip, clusterKey);
  if (!cluster) return null;

  let verification: OwnerFileVerification | null = null;
  let notes: OwnerFileNote[] = [];
  let outreachEvents: OwnerFileOutreachEvent[] = [];

  const sql = getSQL();
  if (sql) {
    try {
      [verification, notes, outreachEvents] = await Promise.all([
        getOwnerFileVerification(sql, clusterKey),
        listOwnerFileNotes(sql, clusterKey),
        listOutreachEvents(sql, clusterKey),
      ]);
    } catch (err) {
      if (!isMissingSchemaError(err)) {
        console.error("getOwnerFile: human layer query failed, degrading to no verification yet:", err);
      }
      // owner_file_verifications/notes/outreach_events may not be migrated
      // yet on this database (scripts/migrate-owner-file.ts is
      // approval-gated, see docs/business-file/00-spec-overview.md §6) —
      // an Owner File with no human layer yet is a valid, expected state,
      // never a 500.
      verification = null;
      notes = [];
      outreachEvents = [];
    }
  }

  return {
    cluster,
    verification,
    notes,
    outreachEvents,
    resolvedTier: resolveConfidenceTier(cluster, verification, notes),
  };
}

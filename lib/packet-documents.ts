/**
 * Database access for packet_documents (the Business File document layer).
 *
 * Every query is scoped by BOTH packet id and user id so ownership is re-checked
 * at the row level on every call — the same discipline the existing packet
 * routes use. Nothing here reads a feature flag or touches Blob storage; the
 * routes gate those concerns before calling in.
 */

import type { getSQL } from "./db";

type SQL = NonNullable<ReturnType<typeof getSQL>>;
type DatabaseRow = Record<string, unknown>;

export const DOCUMENT_STATUSES = ["uploaded", "confirmed_current", "superseded"] as const;
export type PacketDocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface PacketDocumentView {
  id: string;
  taskId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: PacketDocumentStatus;
  uploadedAt: string;
  retentionExpiresAt: string;
}

function isoOrEmpty(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeStatus(value: unknown): PacketDocumentStatus {
  return DOCUMENT_STATUSES.includes(value as PacketDocumentStatus)
    ? (value as PacketDocumentStatus)
    : "uploaded";
}

export function toDocumentView(row: DatabaseRow): PacketDocumentView {
  return {
    id: String(row.id),
    taskId: String(row.task_id ?? ""),
    originalName: String(row.original_name ?? ""),
    contentType: String(row.content_type ?? ""),
    sizeBytes: Number(row.size_bytes ?? 0),
    status: normalizeStatus(row.status),
    uploadedAt: isoOrEmpty(row.uploaded_at),
    retentionExpiresAt: isoOrEmpty(row.retention_expires_at),
  };
}

/** Load a packet the user owns (for validating uploads against its tasks). */
export async function loadOwnedPacket(
  sql: SQL,
  packetId: string,
  userId: string,
): Promise<DatabaseRow | null> {
  const rows = await sql`
    SELECT id, tasks_json, program_id, program_name, goal_type
    FROM incentive_preparation_packets
    WHERE id = ${packetId} AND user_id = ${userId}
    LIMIT 1
  `;
  return rows.length ? (rows[0] as DatabaseRow) : null;
}

/** List every document on a packet, newest first (includes superseded). */
export async function listPacketDocuments(
  sql: SQL,
  packetId: string,
  userId: string,
): Promise<DatabaseRow[]> {
  const rows = await sql`
    SELECT *
    FROM packet_documents
    WHERE packet_id = ${packetId} AND user_id = ${userId}
    ORDER BY uploaded_at DESC
  `;
  return rows as DatabaseRow[];
}

export async function getPacketDocument(
  sql: SQL,
  packetId: string,
  documentId: string,
  userId: string,
): Promise<DatabaseRow | null> {
  const rows = await sql`
    SELECT *
    FROM packet_documents
    WHERE id = ${documentId} AND packet_id = ${packetId} AND user_id = ${userId}
    LIMIT 1
  `;
  return rows.length ? (rows[0] as DatabaseRow) : null;
}

/**
 * Mark a task's active documents superseded (single-file replace), excluding the
 * just-inserted document. Called AFTER the new row exists so a failed upload
 * never leaves the task with its prior document superseded and no replacement.
 */
export async function supersedeOtherTaskDocuments(
  sql: SQL,
  params: { packetId: string; taskId: string; userId: string; exceptId: string },
): Promise<void> {
  await sql`
    UPDATE packet_documents
    SET status = 'superseded'
    WHERE packet_id = ${params.packetId}
      AND user_id = ${params.userId}
      AND task_id = ${params.taskId}
      AND id <> ${params.exceptId}
      AND status <> 'superseded'
  `;
}

export async function insertPacketDocument(
  sql: SQL,
  params: {
    userId: string;
    packetId: string;
    taskId: string;
    originalName: string;
    blobPath: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<DatabaseRow> {
  const rows = await sql`
    INSERT INTO packet_documents (
      user_id, packet_id, task_id, original_name, blob_path, content_type, size_bytes
    ) VALUES (
      ${params.userId}, ${params.packetId}, ${params.taskId}, ${params.originalName},
      ${params.blobPath}, ${params.contentType}, ${params.sizeBytes}
    )
    RETURNING *
  `;
  return rows[0] as DatabaseRow;
}

/**
 * User-driven status change (uploaded ↔ confirmed_current). Superseded rows are
 * excluded so a replaced document can never be resurrected into a second active
 * file on a single-file requirement.
 */
export async function updateDocumentStatus(
  sql: SQL,
  params: { packetId: string; documentId: string; userId: string; status: PacketDocumentStatus },
): Promise<DatabaseRow | null> {
  const rows = await sql`
    UPDATE packet_documents
    SET status = ${params.status}
    WHERE id = ${params.documentId}
      AND packet_id = ${params.packetId}
      AND user_id = ${params.userId}
      AND status <> 'superseded'
    RETURNING *
  `;
  return rows.length ? (rows[0] as DatabaseRow) : null;
}

export async function deletePacketDocumentRow(
  sql: SQL,
  params: { packetId: string; documentId: string; userId: string },
): Promise<void> {
  await sql`
    DELETE FROM packet_documents
    WHERE id = ${params.documentId}
      AND packet_id = ${params.packetId}
      AND user_id = ${params.userId}
  `;
}

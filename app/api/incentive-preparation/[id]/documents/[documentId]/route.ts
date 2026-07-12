import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import { isDocumentsEnabled } from "@/lib/document-flags";
import { deleteDocumentBlob } from "@/lib/documents";
import {
  deletePacketDocumentRow,
  getPacketDocument,
  listPacketDocuments,
  toDocumentView,
  updateDocumentStatus,
} from "@/lib/packet-documents";

type Params = { params: Promise<{ id: string; documentId: string }> };

// The user may confirm a document is current or reopen it. 'superseded' is
// system-managed (set on single-file replace) and is not user-settable here.
const USER_SETTABLE_STATUSES = ["uploaded", "confirmed_current"] as const;

/**
 * PATCH confirms document currency (honesty ruling: user confirmation is the
 * record — uploading never auto-confirms currency).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!isDocumentsEnabled()) {
    return NextResponse.json({ error: "Document uploads are not enabled" }, { status: 503 });
  }
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id, documentId } = await params;
  const body = await req.json().catch(() => null);
  const status = body && typeof body.status === "string" ? body.status.trim() : "";
  if (!USER_SETTABLE_STATUSES.includes(status as (typeof USER_SETTABLE_STATUSES)[number])) {
    return NextResponse.json({ error: "Valid status is required" }, { status: 400 });
  }

  const updated = await updateDocumentStatus(sql, {
    packetId: id,
    documentId,
    userId,
    status: status as (typeof USER_SETTABLE_STATUSES)[number],
  });
  if (!updated) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const rows = await listPacketDocuments(sql, id, userId);
  return NextResponse.json({
    document: toDocumentView(updated),
    documents: rows.map(toDocumentView),
  });
}

/** DELETE hard-deletes the blob and the row after the user confirms. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!isDocumentsEnabled()) {
    return NextResponse.json({ error: "Document uploads are not enabled" }, { status: 503 });
  }
  const sql = getSQL();
  if (!sql) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id, documentId } = await params;
  const doc = await getPacketDocument(sql, id, documentId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // Delete the blob first; deleting the row only after the blob is gone avoids
  // orphaning storage (blob delete is idempotent, so a retry is safe).
  await deleteDocumentBlob(String(doc.blob_path));
  await deletePacketDocumentRow(sql, { packetId: id, documentId, userId });

  const rows = await listPacketDocuments(sql, id, userId);
  return NextResponse.json({ deleted: true, documents: rows.map(toDocumentView) });
}

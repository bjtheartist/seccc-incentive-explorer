import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import { isDocumentsEnabled } from "@/lib/document-flags";
import { specAcceptsKind, isDocumentKindTask, acceptedKindsLabel } from "@/lib/document-spec";
import { buildBlobPath, storeDocumentBlob, validateUpload } from "@/lib/documents";
import { normalizePreparationTasks } from "@/lib/incentive-preparation";
import {
  insertPacketDocument,
  listPacketDocuments,
  loadOwnedPacket,
  supersedeOtherTaskDocuments,
  toDocumentView,
} from "@/lib/packet-documents";

type Params = { params: Promise<{ id: string }> };

function parseTasks(value: unknown) {
  if (typeof value === "string") {
    try {
      return normalizePreparationTasks(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return normalizePreparationTasks(value);
}

export async function GET(_req: NextRequest, { params }: Params) {
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

  const { id } = await params;
  const packet = await loadOwnedPacket(sql, id, userId);
  if (!packet) {
    return NextResponse.json({ error: "Preparation packet not found" }, { status: 404 });
  }

  const rows = await listPacketDocuments(sql, id, userId);
  return NextResponse.json({ documents: rows.map(toDocumentView) });
}

export async function POST(req: NextRequest, { params }: Params) {
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

  const { id } = await params;
  const packet = await loadOwnedPacket(sql, id, userId);
  if (!packet) {
    return NextResponse.json({ error: "Preparation packet not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "A multipart form upload is required" }, { status: 400 });
  }
  const file = form.get("file");
  const taskId = typeof form.get("taskId") === "string" ? String(form.get("taskId")).trim() : "";
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  if (!(file instanceof Blob) || typeof (file as File).name !== "string") {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const upload = file as File;

  const validation = validateUpload({ name: upload.name, type: upload.type, size: upload.size });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const task = parseTasks(packet.tasks_json).find((candidate) => candidate.id === taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found in packet" }, { status: 400 });
  }
  if (!isDocumentKindTask(task)) {
    return NextResponse.json(
      { error: "This task does not accept document uploads" },
      { status: 400 },
    );
  }

  const spec = task.documentSpec;
  if (spec && !specAcceptsKind(spec, validation.kind)) {
    return NextResponse.json(
      { error: `This requirement accepts ${acceptedKindsLabel(spec)}.` },
      { status: 400 },
    );
  }

  const path = buildBlobPath({ userId, packetId: id, taskId, kind: validation.kind });
  const stored = await storeDocumentBlob({
    path,
    body: upload,
    contentType: validation.contentType,
    sizeBytes: upload.size,
  });

  const inserted = await insertPacketDocument(sql, {
    userId,
    packetId: id,
    taskId,
    originalName: upload.name,
    blobPath: stored.blobPath,
    contentType: stored.contentType,
    sizeBytes: stored.sizeBytes,
  });

  // Single-file requirement (no spec, or spec.multi === false): the new upload
  // replaces any prior document on this task. Done AFTER the insert so a failed
  // upload never leaves the task with its prior document superseded and none
  // active. Two racing uploads can, in the worst interleaving, supersede each
  // other — the fail-safe direction (the attached count drops and the next
  // upload recovers) rather than two active files on a single-file requirement.
  const multi = spec?.multi ?? false;
  if (!multi) {
    await supersedeOtherTaskDocuments(sql, {
      packetId: id,
      taskId,
      userId,
      exceptId: String(inserted.id),
    });
  }

  const rows = await listPacketDocuments(sql, id, userId);
  return NextResponse.json(
    { document: toDocumentView(inserted), documents: rows.map(toDocumentView) },
    { status: 201 },
  );
}

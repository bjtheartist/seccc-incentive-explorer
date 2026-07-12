import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import { isDocumentsEnabled } from "@/lib/document-flags";
import { readDocumentBlob } from "@/lib/documents";
import { getPacketDocument } from "@/lib/packet-documents";

type Params = { params: Promise<{ id: string; documentId: string }> };

/**
 * ASCII-only fallback filename for Content-Disposition. Header values must be
 * Latin-1 (undici throws a TypeError on higher code points), and quotes,
 * backslashes, and control characters could break or inject into the header, so
 * everything outside printable ASCII is replaced. The original name is kept for
 * capable clients via the RFC 5987 `filename*` parameter built alongside this.
 */
function asciiFilename(value: string): string {
  const cleaned = value
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 200);
  return cleaned.trim() || "document";
}

/** Percent-encode a filename for the RFC 5987 `filename*=UTF-8''` parameter. */
function rfc5987Filename(value: string): string {
  return encodeURIComponent(value.slice(0, 200)).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Authenticated, ownership-checked download. Private blobs have no public URL;
 * the file is only reachable by streaming it through this route after the
 * packet + document ownership check passes.
 */
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

  const { id, documentId } = await params;
  const doc = await getPacketDocument(sql, id, documentId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const blob = await readDocumentBlob(String(doc.blob_path));
  if (!blob || blob.statusCode !== 200 || !blob.stream) {
    return NextResponse.json({ error: "Document is no longer available" }, { status: 404 });
  }

  const rawName = String(doc.original_name || "document");
  const contentType = String(doc.content_type || blob.blob.contentType || "application/octet-stream");
  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": contentType,
      // Force a download and never let the browser sniff the type.
      "Content-Disposition": `attachment; filename="${asciiFilename(rawName)}"; filename*=UTF-8''${rfc5987Filename(rawName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

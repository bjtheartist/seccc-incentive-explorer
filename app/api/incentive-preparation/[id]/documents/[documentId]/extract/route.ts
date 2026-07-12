import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/current-user";
import { getSQL } from "@/lib/db";
import { isDocumentExtractEnabled } from "@/lib/document-flags";
import { readDocumentBlobBuffer } from "@/lib/documents";
import { extractDocumentSuggestions } from "@/lib/document-extraction";
import { getPacketDocument } from "@/lib/packet-documents";

type Params = { params: Promise<{ id: string; documentId: string }> };

/**
 * Assistive extraction. Returns SUGGESTED profile field values for the user to
 * review and apply through the existing edit flow. Never writes to the profile
 * or packet. Gated by AI_GATEWAY_API_KEY + DOCUMENTS_EXTRACT_ENABLED (which also
 * requires the document feature itself to be on).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!isDocumentExtractEnabled()) {
    return NextResponse.json({ error: "Document extraction is not enabled" }, { status: 503 });
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

  const buffer = await readDocumentBlobBuffer(String(doc.blob_path));
  if (!buffer) {
    return NextResponse.json({ error: "Document is no longer available" }, { status: 404 });
  }

  const result = await extractDocumentSuggestions({
    buffer,
    contentType: String(doc.content_type || ""),
    originalName: String(doc.original_name || ""),
  });

  return NextResponse.json(result);
}

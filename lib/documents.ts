/**
 * Server-side document storage for the Business File document layer.
 *
 * Storage is Vercel Blob with PRIVATE access: blobs are never publicly
 * reachable and are served only through an auth + ownership-checked download
 * route. Filenames are randomized and the blob path is scoped by user id, so a
 * path never leaks the original name and is not guessable across users.
 *
 * Every function here assumes the caller has already verified the feature flag
 * (isDocumentsEnabled) and packet ownership. Nothing in this module talks to
 * the database.
 */

import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { MAX_DOCUMENT_BYTES } from "./document-flags";
import {
  contentTypeForKind,
  documentKindFromContentType,
  extensionForKind,
  type DocumentKind,
} from "./document-spec";

export interface UploadCandidate {
  name: string;
  type: string;
  size: number;
}

export type UploadValidation =
  | { ok: true; kind: DocumentKind; contentType: string }
  | { ok: false; error: string };

/**
 * Validate an incoming file against the global allowlist and size cap. This is
 * the server-side gate; the spec's acceptedTypes narrow further at the route.
 */
export function validateUpload(file: UploadCandidate): UploadValidation {
  if (!file.name || !file.name.trim()) {
    return { ok: false, error: "A file name is required." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "The file is empty." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `The file exceeds the ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB limit.`,
    };
  }
  const kind = documentKindFromContentType(file.type, file.name);
  if (!kind) {
    return {
      ok: false,
      error: "Unsupported file type. Allowed types: PDF, PNG, JPG, WEBP, DOCX.",
    };
  }
  return { ok: true, kind, contentType: contentTypeForKind(kind) };
}

/**
 * Build a private, user-scoped, randomized blob path. The original filename is
 * never part of the path (it is kept only in the DB `original_name` column).
 */
export function buildBlobPath(params: {
  userId: string;
  packetId: string;
  taskId: string;
  kind: DocumentKind;
}): string {
  const random = randomUUID();
  const ext = extensionForKind(params.kind);
  // Segments are drawn from server-controlled ids (never user filenames).
  return `business-file/${params.userId}/${params.packetId}/${params.taskId}/${random}.${ext}`;
}

export interface StoredBlob {
  blobPath: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Upload a validated document to the private Blob store and return the stored
 * path. `addRandomSuffix` is off because the path already carries a UUID;
 * `allowOverwrite` is off so a path collision is a hard error rather than a
 * silent clobber.
 */
export async function storeDocumentBlob(params: {
  path: string;
  body: Blob | ArrayBuffer | Buffer;
  contentType: string;
  sizeBytes: number;
}): Promise<StoredBlob> {
  const result = await put(params.path, params.body, {
    access: "private",
    contentType: params.contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return {
    blobPath: result.pathname,
    contentType: params.contentType,
    sizeBytes: params.sizeBytes,
  };
}

/** Fetch a private blob's stream + metadata for the download route. */
export async function readDocumentBlob(blobPath: string) {
  return get(blobPath, { access: "private" });
}

/** Read a private blob fully into a Buffer (used by extraction). */
export async function readDocumentBlobBuffer(blobPath: string): Promise<Buffer | null> {
  const result = await get(blobPath, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Hard-delete a blob by path. Idempotent: deleting a missing blob is a no-op. */
export async function deleteDocumentBlob(blobPath: string): Promise<void> {
  await del(blobPath);
}

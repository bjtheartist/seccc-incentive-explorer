/**
 * Application-specific document schemas ("documentSpec") and the shared
 * allowlist of accepted document kinds.
 *
 * A documentSpec describes what a program asks for on a single document task —
 * a stable id, a human label (the requirement text), which kinds are accepted,
 * and whether more than one file is allowed. It lets each document task validate
 * what is attached against what the program requested and surfaces a neutral
 * count ("1 of 2 requested files attached"). Specs are derived ONLY from a
 * program's existing requiredDocs / verificationSteps text; where that text is
 * vague the spec is generic (any accepted type, single file).
 *
 * This module is pure (no Blob SDK, no DB) so it is shared by the preparation
 * engine, the API routes, and the client.
 */

/** The uploadable document kinds. This is the global allowlist. */
export const DOCUMENT_KINDS = ["pdf", "png", "jpg", "webp", "docx"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const DOCUMENT_KIND_SET = new Set<string>(DOCUMENT_KINDS);

/** The single canonical content type stored for each kind. */
const KIND_CONTENT_TYPE: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const KIND_EXTENSION: Record<DocumentKind, string> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpg",
  webp: "webp",
  docx: "docx",
};

/** Map an incoming content type (with filename fallback) to an allowed kind. */
const CONTENT_TYPE_KIND: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const EXTENSION_KIND: Record<string, DocumentKind> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  webp: "webp",
  docx: "docx",
};

export interface DocumentSpec {
  /** Stable id for the requested document (slug of the requirement text). */
  id: string;
  /** Human requirement text, e.g. "Two contractor bids for proposed work". */
  label: string;
  /**
   * Accepted kinds. An EMPTY array means "any accepted type" — the generic spec
   * used when the requirement text does not name a file format (the common case:
   * requirement text almost never specifies pdf vs image).
   */
  acceptedTypes: DocumentKind[];
  /** Whether more than one file may be attached for this requirement. */
  multi: boolean;
}

export function contentTypeForKind(kind: DocumentKind): string {
  return KIND_CONTENT_TYPE[kind];
}

export function extensionForKind(kind: DocumentKind): string {
  return KIND_EXTENSION[kind];
}

function fileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Resolve an allowed kind from a content type, falling back to the filename
 * extension when the browser sends a generic/absent content type. Returns null
 * for anything outside the allowlist.
 */
export function documentKindFromContentType(
  contentType: unknown,
  fileName: unknown = "",
): DocumentKind | null {
  const normalizedType =
    typeof contentType === "string" ? contentType.split(";")[0].trim().toLowerCase() : "";
  const byType = CONTENT_TYPE_KIND[normalizedType];
  if (byType) return byType;

  const ext = typeof fileName === "string" ? fileExtension(fileName) : "";
  return EXTENSION_KIND[ext] ?? null;
}

function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && DOCUMENT_KIND_SET.has(value);
}

/** True when the given kind is allowed by the spec (empty acceptedTypes = any). */
export function specAcceptsKind(spec: DocumentSpec, kind: DocumentKind): boolean {
  return spec.acceptedTypes.length === 0 || spec.acceptedTypes.includes(kind);
}

/** Human list of accepted kinds for UI copy ("PDF, image" style is left to callers). */
export function acceptedKindsLabel(spec: DocumentSpec): string {
  if (spec.acceptedTypes.length === 0) return "Any accepted file type";
  return spec.acceptedTypes.map((kind) => kind.toUpperCase()).join(", ");
}

/**
 * The `accept` attribute for a file input restricted to the given kinds (the
 * full allowlist when none are given). Includes every extension alias that maps
 * to an accepted kind so e.g. ".jpeg" files stay pickable for "jpg".
 */
export function acceptAttributeForKinds(
  kinds: readonly DocumentKind[] = DOCUMENT_KINDS,
): string {
  const allowed = new Set(kinds.length > 0 ? kinds : DOCUMENT_KINDS);
  return Object.entries(EXTENSION_KIND)
    .filter(([, kind]) => allowed.has(kind))
    .map(([ext]) => `.${ext}`)
    .join(",");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parse/validate a documentSpec from untrusted JSON (programs.json or a stored
 * task). Returns null when it lacks a usable id + label.
 */
export function normalizeDocumentSpec(value: unknown): DocumentSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeText(record.id);
  const label = normalizeText(record.label);
  if (!id || !label) return null;

  const rawTypes = Array.isArray(record.acceptedTypes) ? record.acceptedTypes : [];
  const acceptedTypes: DocumentKind[] = [];
  for (const entry of rawTypes) {
    const kind = typeof entry === "string" ? entry.toLowerCase() : entry;
    if (isDocumentKind(kind) && !acceptedTypes.includes(kind)) {
      acceptedTypes.push(kind);
    }
  }

  return {
    id,
    label,
    acceptedTypes,
    multi: record.multi === true,
  };
}

/**
 * A task is "document-kind" — able to hold attachments — when it either carries
 * a documentSpec (program-requested document) or is currently a needs_document
 * collection task. Used identically on server and client.
 */
export function isDocumentKindTask(task: {
  status?: string | null;
  documentSpec?: DocumentSpec | null;
}): boolean {
  return Boolean(task.documentSpec) || task.status === "needs_document";
}

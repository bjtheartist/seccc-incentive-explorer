/**
 * Feature-flag + policy constants for the Business File document layer.
 *
 * This module is intentionally dependency-free (no @vercel/blob, no DB) so the
 * hot packet routes can read the flags without pulling the Blob SDK into their
 * bundle. The document feature is OFF by default: with nothing provisioned the
 * upload UI renders nothing and every document endpoint returns 503, so this PR
 * merges with zero behavior change until the env vars below are set.
 */

/** Hard cap on a single uploaded document (10 MB). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Default retention horizon for a stored document, in months. */
export const DOCUMENT_RETENTION_MONTHS = 18;

/**
 * Copy shown against every extraction result. Extraction is assistive only —
 * it never writes to the profile or packet; the user reviews and applies
 * suggestions through the existing edit flows.
 */
export const SUGGESTION_DISCLAIMER =
  "Suggested from your document — review before applying.";

/**
 * Uploads/list/delete/download are enabled only when the operator has both
 * turned the feature on AND provisioned a Blob store token. Either missing =
 * off (endpoints 503, UI hidden).
 */
export function isDocumentsEnabled(): boolean {
  return (
    process.env.DOCUMENTS_ENABLED === "true" &&
    Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  );
}

/**
 * Extraction layers a second gate on top of uploads: a gateway key AND an
 * explicit opt-in. Extraction cannot run without uploads (there is nothing to
 * extract from), so this requires isDocumentsEnabled() as well.
 */
export function isDocumentExtractEnabled(): boolean {
  return (
    isDocumentsEnabled() &&
    Boolean(process.env.AI_GATEWAY_API_KEY) &&
    process.env.DOCUMENTS_EXTRACT_ENABLED === "true"
  );
}

/**
 * Size limits for the report-email pathway — the ONE definition, shared by the
 * client helper (lib/report-email.ts) and the route that receives the upload
 * (app/api/email-report/route.ts), so the two can never disagree about what
 * fits.
 *
 * R2 finding 9. The route's zod schema allowed a `pdfBase64` of up to 6,000,000
 * characters and its request ceiling was 6,500,000 bytes — BOTH above Vercel's
 * 4.5MB request-body limit. Anything in that band never reached the handler at
 * all: the platform rejected the request first, so the route's own careful
 * "Report attachment is too large." 413 was unreachable for exactly the
 * payloads it was written for, and the browser saw an opaque platform error
 * instead. Every ceiling here now sits BELOW the platform's.
 */

/**
 * Vercel's hard request-body limit for a serverless function. Not ours to
 * change — everything below is derived from it.
 */
export const VERCEL_BODY_LIMIT_BYTES = 4_500_000;

/**
 * Largest whole request body we will accept, leaving headroom under the
 * platform limit for the JSON envelope and the ~15 non-PDF fields.
 */
export const MAX_REQUEST_BYTES = 4_200_000;

/**
 * Largest base64 `pdfBase64` string we will accept. Base64 inflates by 4/3, so
 * this admits a PDF of just under MAX_PDF_BYTES while leaving ~200KB of the
 * request budget for every other field.
 */
export const MAX_PDF_BASE64_CHARS = 4_000_000;

/** Largest DECODED PDF, derived from the base64 ceiling above (3/4 of it). */
export const MAX_PDF_BYTES = Math.floor((MAX_PDF_BASE64_CHARS * 3) / 4);

/**
 * What to tell someone whose report genuinely will not fit in an email.
 *
 * Deliberately not "please try again": retrying sends the same bytes and fails
 * the same way. The report is still downloadable — that is the honest next
 * step, and it is the one this copy names.
 */
export const REPORT_TOO_LARGE_MESSAGE =
  "This report is too large to email. Download the PDF instead — the download has no size limit.";

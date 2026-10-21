import { __resetPrivateDataCacheForTests, loadPrivateJson } from "./private-data";
import type { ExemptionEavs, ExemptionUniverse } from "./vacancy-index";

/**
 * Loader for the private, admin-only EXEMPTION ANOMALY referral packet
 * (data/private/exemption-anomalies.json — see data/private/README.md: served
 * only through gated APIs/pages, never moved into public/). This is the
 * parcel-level REFERRAL PACKET for the Treasurer / Clerk / Assessor: each row
 * is a vacant parcel still carrying an occupancy-premised exemption — a RECORD
 * ANOMALY warranting official review, never an assertion of fraud, intent,
 * death, or wrongdoing.
 *
 * NO owner names or mailing addresses ever appear in this file (the export
 * asserts the absence of the forbidden substrings before writing, mirroring the
 * public-JSON anonymization assert). The committed-private precedent is
 * data/private/owner-clusters-geo.json; this file ships and is read exactly the
 * same way — through lib/private-data.ts (local file in dev/tests/CI, private
 * Vercel Blob in production; data/private/** is EXCLUDED from Next's output
 * file tracing) — and is reachable only behind the admin gate on
 * app/vacancy/[zip]/page.tsx.
 */

/** One parcel-level referral row (private). Anonymized: NO owner name/mailing —
 * only the PIN, address, class, exemption EAVs, and last recorded transfer, so
 * the reviewing office can pull the parcel and adjudicate. */
export interface ExemptionReferralRow {
  pin: string;
  address: string | null;
  classCode: string | null;
  universe: ExemptionUniverse;
  exemptions: ExemptionEavs;
  taxYear: number;
  /** Latest recorded transfer date (YYYY-MM-DD) or null (no MyDec record — a
   * floor, since MyDec coverage begins ~2009). */
  latestTransferDate: string | null;
}

/** The private referral packet: per-ZIP arrays of referral rows. */
export interface ExemptionReferralFile {
  generatedAt: string;
  taxYear: number;
  /** ZIP → the parcel-level anomaly rows for that edition. */
  byZip: Record<string, ExemptionReferralRow[]>;
}

const DATA_FILENAME = "exemption-anomalies.json";

// Module-level cache, read once per process.
// `undefined` = not attempted yet; a settled promise of the packet or of `null`
// (attempted and the file is absent or unparseable — a legitimate state before
// the export has been generated). Cached as a promise because the read is async
// now: lib/private-data.ts resolves the file from disk locally and from a
// private Vercel Blob in production.
let cache: Promise<ExemptionReferralFile | null> | undefined = undefined;

function isValidFile(value: unknown): value is ExemptionReferralFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExemptionReferralFile>;
  return !!candidate.byZip && typeof candidate.byZip === "object";
}

/**
 * Read and parse the private referral packet once per process, caching the
 * result. Returns `null` if the file does not exist (or fails to parse) rather
 * than throwing, so the gated page can degrade to a clean "not yet available"
 * section instead of erroring.
 */
export function loadExemptionReferralFile(): Promise<ExemptionReferralFile | null> {
  if (cache !== undefined) return cache;
  cache = loadPrivateJson<unknown>(DATA_FILENAME)
    .then((parsed) => (isValidFile(parsed) ? parsed : null))
    .catch(() => null);
  return cache;
}

/** The referral rows for one ZIP, or `[]` when the packet is absent or the ZIP
 * carries no anomalies. */
export async function exemptionReferralRowsForZip(zip: string): Promise<ExemptionReferralRow[]> {
  const file = await loadExemptionReferralFile();
  return file?.byZip[zip] ?? [];
}

/** Test-only: reset the module cache so tests can re-read the file. */
export function __resetExemptionReferralCacheForTests(): void {
  cache = undefined;
  __resetPrivateDataCacheForTests();
}

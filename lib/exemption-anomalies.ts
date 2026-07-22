import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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
 * same way — readFileSync + existsSync guard + module cache + process.cwd()
 * path, so it is bundled into the Vercel deployment via file tracing but is
 * reachable only behind the admin gate on app/vacancy/[zip]/page.tsx.
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

const DATA_PATH = path.join(process.cwd(), "data/private/exemption-anomalies.json");

// Module-level cache, read once per process.
// `undefined` = not attempted yet; `null` = attempted and file is absent or
// unparseable (a legitimate state before the export has been generated).
let cache: ExemptionReferralFile | null | undefined = undefined;

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
export function loadExemptionReferralFile(): ExemptionReferralFile | null {
  if (cache !== undefined) return cache;
  try {
    if (!existsSync(DATA_PATH)) {
      cache = null;
      return cache;
    }
    const raw = readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    cache = isValidFile(parsed) ? parsed : null;
  } catch {
    cache = null;
  }
  return cache;
}

/** The referral rows for one ZIP, or `[]` when the packet is absent or the ZIP
 * carries no anomalies. */
export function exemptionReferralRowsForZip(zip: string): ExemptionReferralRow[] {
  const file = loadExemptionReferralFile();
  return file?.byZip[zip] ?? [];
}

/** Test-only: reset the module cache so tests can re-read the file. */
export function __resetExemptionReferralCacheForTests(): void {
  cache = undefined;
}

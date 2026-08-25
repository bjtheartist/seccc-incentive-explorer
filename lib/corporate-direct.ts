/**
 * Loader for the corporate-direct + CME-corroboration curated inputs
 * (source-plan steps 6-8, first seed release — see
 * docs/data/corporate-giving-source-plan.md).
 *
 * This module is a SEED, not a live source. It reads the three curated CSVs
 * under data/curated/investment-inputs/, parses + zod-validates every row
 * against the plan's `CorporateGivingInput` schema, and exposes typed
 * accessors. It does NOT read the canonical community-investment export (the
 * private data file the exporter writes elsewhere in the repo), does NOT
 * import the community-investment loader module, and is not wired into any
 * analysis layer or UI — surfacing these rows into the canonical export or
 * its Sankey is a follow-up decision, per the plan's ingestion sequence
 * (step 5, explicitly out of scope here). See
 * lib/__tests__/corporate-direct.test.ts's canonical-firewall block for the
 * regression guard.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const INPUT_DIR = path.join(process.cwd(), "data", "curated", "investment-inputs");

const AWARDS_CSV = "corporate_direct_awards.csv";
const COUNT_ONLY_CSV = "corporate_direct_count_only.csv";
const CME_CSV = "corporate_cme_corroboration.csv";

// ── Schema (mirrors docs/data/corporate-giving-source-plan.md's
//    CorporateGivingInput interface exactly) ─────────────────────────────

export const CORPORATE_GIVING_VEHICLES = [
  "corporate_foundation",
  "charitable_trust",
  "operating_company",
  "company_program",
  "unknown",
] as const;

export const CORPORATE_GIVING_AMOUNT_EVIDENCE = [
  "recipient_exact",
  "program_fixed_per_recipient",
  "aggregate_only",
  "cap_only",
  "unavailable",
] as const;

export const CORPORATE_GIVING_SUPPORT_KINDS = [
  "cash_grant",
  "in_kind",
  "sponsorship",
  "mixed",
  "unknown",
] as const;

export const CORPORATE_GIVING_LOCATION_BASES = [
  "source_award_site",
  "source_recipient_address",
  "official_business_license_match",
  "recipient_hq_only",
  "city_only",
  "unavailable",
] as const;

export const CORPORATE_GIVING_DUPLICATE_STATES = [
  "clear",
  "linked_same_award",
  "possible",
  "unreviewed",
] as const;

export const CORPORATE_GIVING_REVIEW_STATES = ["ready", "hold", "quarantined"] as const;

/** Empty-string-as-null: every curated CSV cell round-trips through a plain
 * string; a blank cell means the field is genuinely absent at the source,
 * never a fabricated zero/empty value. */
const nullableText = z
  .string()
  .transform((v) => (v.trim() === "" ? null : v))
  .nullable();

const nullableInt = z
  .string()
  .transform((v) => (v.trim() === "" ? null : Number(v)))
  .pipe(z.number().int().nullable());

const nullableAmount = z
  .string()
  .transform((v) => (v.trim() === "" ? null : Number(v)))
  .pipe(z.number().nonnegative().nullable());

export const CorporateGivingInputSchema = z.object({
  sourceRecordId: z.string().min(1),
  sourceProgram: z.string().min(1),
  sourceUrl: z.string().min(1),
  sourcePublishedAt: nullableText,
  sourceCheckedAt: z.string().min(1),

  payerName: z.string().min(1),
  payerEin: nullableText,
  parentCompany: z.string().min(1),
  vehicle: z.enum(CORPORATE_GIVING_VEHICLES),

  recipient: z.string().min(1),
  awardYear: nullableInt,
  amountAwarded: nullableAmount,
  amountEvidence: z.enum(CORPORATE_GIVING_AMOUNT_EVIDENCE),
  supportKind: z.enum(CORPORATE_GIVING_SUPPORT_KINDS),
  purpose: nullableText,

  publishedAddress: nullableText,
  publishedCity: nullableText,
  publishedState: nullableText,
  publishedPostalCode: nullableText,
  locationBasis: z.enum(CORPORATE_GIVING_LOCATION_BASES),
  locationSourceUrl: nullableText,
  locationSourceRecordId: nullableText,

  possibleDuplicateOf: nullableText,
  duplicateState: z.enum(CORPORATE_GIVING_DUPLICATE_STATES),
  reviewState: z.enum(CORPORATE_GIVING_REVIEW_STATES),
  reviewNote: nullableText,
});

export type CorporateGivingInput = z.infer<typeof CorporateGivingInputSchema>;

// ── CSV parsing (self-contained; mirrors the quote-handling rules used by
//    scripts/export-community-investment.ts's parseDelimited, but this
//    module intentionally does not import from scripts/ — lib/ is read by
//    application code, scripts/ is the export/build layer) ────────────────

export class CorporateDirectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorporateDirectParseError";
  }
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field.length === 0) {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; \n branch handles the row break
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Decode HTML entities exactly once (e.g. "A&amp;B Auto Transport" ->
 * "A&B Auto Transport"). No other name normalization is applied — a
 * decoded string is not re-decoded, re-cased, or trimmed of anything beyond
 * the entity sequence itself. */
export function decodeHtmlEntitiesOnce(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, ent: string) => {
    if (ent[0] === "#") {
      const codePoint = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
      mdash: "—",
      ndash: "–",
      rsquo: "’",
      lsquo: "‘",
      rdquo: "”",
      ldquo: "“",
    };
    return named[ent] ?? match;
  });
}

const ENTITY_BEARING_FIELDS = ["payerName", "parentCompany", "recipient", "purpose", "sourceProgram", "reviewNote"] as const;

function decodeRowEntities(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...record };
  for (const field of ENTITY_BEARING_FIELDS) {
    if (typeof out[field] === "string") {
      out[field] = decodeHtmlEntitiesOnce(out[field]);
    }
  }
  return out;
}

export function parseCorporateGivingCsv(csvText: string, sourceFile: string): CorporateGivingInput[] {
  const rows = parseCsvText(csvText);
  if (rows.length === 0) {
    throw new CorporateDirectParseError(`${sourceFile} is empty (no header row).`);
  }
  const headers = rows[0];
  const records: CorporateGivingInput[] = [];
  for (let i = 1; i < rows.length; i++) {
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = rows[i][idx] ?? "";
    });
    const decoded = decodeRowEntities(raw);
    const result = CorporateGivingInputSchema.safeParse(decoded);
    if (!result.success) {
      throw new CorporateDirectParseError(
        `${sourceFile} row ${i + 1} (sourceRecordId=${raw.sourceRecordId ?? "?"}) failed validation: ${result.error.message}`,
      );
    }
    records.push(result.data);
  }
  return records;
}

// ── Static-only loaders (module-level cache, read once per process — mirrors
//    lib/community-investment.ts's loadCommunityInvestment) ────────────────

let awardsCache: CorporateGivingInput[] | null | undefined;
let countOnlyCache: CorporateGivingInput[] | null | undefined;
let cmeCache: CorporateGivingInput[] | null | undefined;

function loadCsv(fileName: string): CorporateGivingInput[] | null {
  const absPath = path.join(INPUT_DIR, fileName);
  if (!existsSync(absPath)) return null;
  const text = readFileSync(absPath, "utf8");
  return parseCorporateGivingCsv(text, fileName);
}

/** Ready, dollar-bearing corporate-direct award rows (Comcast RISE 2021 +
 * Bank of America 2022 Neighborhood Builders + Bank of America / After
 * School Matters). Every row here has a non-null amountAwarded. */
export function corporateDirectAwards(): CorporateGivingInput[] {
  if (awardsCache === undefined) awardsCache = loadCsv(AWARDS_CSV);
  return awardsCache ?? [];
}

/** Count-only corporate-direct rows (Exelon roster, ComEd program
 * recipients, Chicago Bulls Charities, Chicago Sports Alliance). Every row
 * here has a null amountAwarded by design — these establish documented
 * corporate activity but must never enter a dollar total. */
export function corporateDirectCountOnly(): CorporateGivingInput[] {
  if (countOnlyCache === undefined) countOnlyCache = loadCsv(COUNT_ONLY_CSV);
  return countOnlyCache ?? [];
}

/** CME Group Foundation roster corroboration rows. reviewState is "hold" on
 * every row: this is a corroboration stream against the already-canonical
 * CME Group Foundation 990 rows, never an additive dollar source. */
export function cmeCorroboration(): CorporateGivingInput[] {
  if (cmeCache === undefined) cmeCache = loadCsv(CME_CSV);
  return cmeCache ?? [];
}

/** Test-only: reset the module caches so tests can re-read files after
 * mutating fixtures on disk. */
export function __resetCorporateDirectCacheForTests(): void {
  awardsCache = undefined;
  countOnlyCache = undefined;
  cmeCache = undefined;
}

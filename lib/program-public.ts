/**
 * lib/program-public.ts — the structured public projection of one internal
 * catalog record (build-spec.md section 1.2; audit F4/F5; consult item 2).
 *
 * Every public program surface should render from PublicProgramView (a
 * structured DTO, NOT prose strings) instead of the raw internal Program
 * record. The DTO deliberately never carries `program.whoQualifies` — raw
 * catalog prose must not leak into a public claim surface. Instead,
 * `screening.publishedCriteria` holds the structured criterion descriptions
 * from `eligibilityRules[]`, paired with `links.administeringAgency`, so a
 * consumer can only render them under a "Published criteria — confirm with
 * <administering agency>" frame (that framing sentence itself is a PR2
 * rendering concern; PR1's job is to make the un-framed raw string
 * unreachable from this DTO).
 *
 * PR1 ships this module as a producer only — no consumer imports it yet.
 * PR2 migrates ProgramsCatalog, program pages, /api/programs, report-engine,
 * StartHere, concierge, etc. onto it (see docs/eligibility-claims-
 * acceptance.md, F4/F5/F6/F7/F9 rows).
 */
import type {
  BenefitTermsStatus,
  IntakeStatus,
  LocationRelation,
  Program,
  ProgramLevel,
  ProgramNextWindow,
} from "./types";
import type { PersonaId } from "./personas";

export const PROGRAMS_PUBLIC_SCHEMA_VERSION = 1 as const;

export interface PublicProgramView {
  id: string;
  name: string;
  level: ProgramLevel;
  statusBadge: {
    state: IntakeStatus;
    asOfDate: string;
  };
  intake: {
    status: IntakeStatus;
    nextWindow: ProgramNextWindow;
  };
  benefit: {
    /** Display string (e.g. "Up to $100,000") — never claimed to be a project estimate. */
    summary: string;
    termsStatus: BenefitTermsStatus;
    /** The one binding qualifier sentence-fragment — see benefitQualifier(). */
    qualifier: string;
  };
  screening: {
    locationRelation: LocationRelation;
    /** Structured criterion descriptions (from eligibilityRules[]) — never raw whoQualifies. */
    publishedCriteria: string[];
  };
  links: {
    url: string | null;
    sourceUrl: string | null;
    /** First contact's agency name — the "<administering agency>" a consumer should name in its own copy. */
    administeringAgency: string | null;
  };
  personas: PersonaId[];
  zoneKey: string | null;
}

export interface PublicProgramsEnvelope {
  schemaVersion: typeof PROGRAMS_PUBLIC_SCHEMA_VERSION;
  generatedAt: string;
  catalogRevision: string;
  programs: PublicProgramView[];
}

const OPEN_INTAKE_STATES: ReadonlySet<IntakeStatus> = new Set(["open", "rolling"]);
const CLOSED_ROUND_INTAKE_STATES: ReadonlySet<IntakeStatus> = new Set([
  "closed",
  "lapsed",
  "pending",
]);

/**
 * The ONE place the binding benefit-qualifier copy (build-spec.md 1.2) is
 * generated, so every public surface says the same thing:
 *
 *   open/rolling            -> "Current published terms as of <statusAsOf>"
 *   closed/lapsed/pending   -> "Most recently published round offered …"
 *                              + "(no round currently open as of <statusAsOf>)"
 *   unknown                 -> (not specified by the spec's two buckets;
 *                              see docs/eligibility-claims-acceptance.md
 *                              "Decisions" — never defaults toward open/
 *                              current language)
 */
export function benefitQualifier(
  intakeStatus: IntakeStatus,
  benefitSummary: string | null | undefined,
  statusAsOf: string
): string {
  if (OPEN_INTAKE_STATES.has(intakeStatus)) {
    return `Current published terms as of ${statusAsOf}`;
  }
  if (CLOSED_ROUND_INTAKE_STATES.has(intakeStatus)) {
    const summary = benefitSummary?.trim();
    const offered = summary
      ? `Most recently published round offered ${summary}.`
      : "Most recently published round terms are on file.";
    return `${offered} (No round currently open as of ${statusAsOf}.)`;
  }
  // intakeStatus === "unknown" (or any future value the two buckets above
  // don't cover) — explicitly not a determination either way.
  return `Intake status not established from published sources as of ${statusAsOf}.`;
}

/**
 * Map one internal catalog record to its public projection. `asOf` is the
 * fallback "as of" date used only when the record itself has no
 * `statusAsOf` (defensive — every one of the 71 catalog records has one as
 * of PR1; DB-backed Program objects elsewhere in the app may not).
 */
export function toPublicProgramView(record: Program, asOf: string): PublicProgramView {
  const statusAsOf = record.statusAsOf ?? asOf;
  const intakeStatus: IntakeStatus = record.intakeStatus ?? "unknown";
  const benefitTermsStatus: BenefitTermsStatus = record.benefitTermsStatus ?? "unknown";
  const locationRelation: LocationRelation = record.locationRelation ?? "none";
  const nextWindow: ProgramNextWindow = record.nextWindow ?? { expected: null, note: null };

  const publishedCriteria = (record.eligibilityRules ?? [])
    .map((rule) => rule.description)
    .filter((description): description is string => Boolean(description && description.trim()));

  const primaryContact = record.contacts?.[0];

  return {
    id: record.id,
    name: record.name,
    level: record.level,
    statusBadge: { state: intakeStatus, asOfDate: statusAsOf },
    intake: { status: intakeStatus, nextWindow },
    benefit: {
      summary: record.benefitRange ?? "",
      termsStatus: benefitTermsStatus,
      qualifier: benefitQualifier(intakeStatus, record.benefitRange, statusAsOf),
    },
    screening: { locationRelation, publishedCriteria },
    links: {
      url: record.url || null,
      sourceUrl: record.sourceUrl || null,
      administeringAgency: primaryContact?.agency ?? null,
    },
    personas: record.personas ?? [],
    zoneKey: record.zoneKey || null,
  };
}

/**
 * Build the versioned envelope written to public/data/programs-public.json.
 * `catalogRevision` is the caller's responsibility (hash of the exact raw
 * bytes read from data/programs-internal.json) so this function stays a
 * pure mapping over already-parsed records — see scripts/export-public-
 * programs.ts and lib/__tests__/program-public.test.ts (which both call it
 * directly, so the "regen + diff" CI check never spawns a child process).
 */
export function buildPublicProgramsEnvelope(
  records: Program[],
  catalogRevision: string,
  generatedAt: string
): PublicProgramsEnvelope {
  return {
    schemaVersion: PROGRAMS_PUBLIC_SCHEMA_VERSION,
    generatedAt,
    catalogRevision,
    programs: records.map((record) => toPublicProgramView(record, generatedAt)),
  };
}

/**
 * ISO 8601 UTC timestamp exactly matching `Date.prototype.toISOString()`'s
 * output shape (`YYYY-MM-DDTHH:mm:ss.sssZ`) — every `generatedAt`/
 * `checkedAt` in this codebase is produced that way.
 */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * review1 R11: the shape regex alone accepts calendar-impossible
 * timestamps like `2026-02-30T00:00:00.000Z` or an out-of-range hour like
 * `2026-08-13T24:00:00.000Z`, because `Date.parse`/`new Date(...)` silently
 * NORMALIZES them (Feb 30 -> Mar 2; hour 24 -> next day, hour 0) instead of
 * rejecting them — `Date.parse` succeeding is not evidence the input was
 * ever a real, valid instant. The authoritative check is a round trip:
 * feed the string back through `toISOString()` and require it comes back
 * byte-for-byte identical. A real `toISOString()` output round-trips by
 * construction; any value the Date constructor had to normalize does not.
 */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_TIMESTAMP_RE.test(value)) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString() === value;
}

/**
 * Full envelope-shape validation (review1 R7) — used by BOTH
 * scripts/export-public-programs.ts's `--check` and
 * lib/__tests__/program-public.test.ts's regen-diff test, so the two
 * checks can never silently drift apart. Validates `schemaVersion`,
 * `catalogRevision`, `generatedAt` (presence + ISO shape), and that
 * `programs` is an array — deliberately excludes ONLY exact `generatedAt`
 * *equality* between two envelopes (that field legitimately changes on
 * every run) from whatever comparison the caller layers on top.
 */
export function isValidPublicProgramsEnvelopeShape(value: unknown): value is PublicProgramsEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== PROGRAMS_PUBLIC_SCHEMA_VERSION) return false;
  if (typeof v.catalogRevision !== "string" || v.catalogRevision.length === 0) return false;
  if (!isIsoTimestamp(v.generatedAt)) return false;
  if (!Array.isArray(v.programs)) return false;
  return true;
}

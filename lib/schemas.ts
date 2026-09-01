import { z } from "zod";

/* ── Contact ──────────────────────────────── */

export const ProgramContactSchema = z.object({
  agency: z.string(),
  abbreviation: z.string(),
  phone: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional(),
  role: z.string().optional(),
});

/* ── Eligibility Rule ─────────────────────── */

export const EligibilityRuleSchema = z.object({
  criterion: z.string(),
  description: z.string(),
  verifiedBy: z.enum(["location", "survey", "manual", "none"]),
  required: z.boolean(),
});

/* ── Application Portal ───────────────────── */

export const ApplicationPortalSchema = z.object({
  type: z.enum(["submittable", "web", "pdf", "email", "in_person"]),
  label: z.string(),
  url: z.string(),
  language: z.enum(["en", "es"]).optional(),
  notes: z.string().optional(),
});

/* ── Verification / Next-Step ─────────────── */

export const VerificationStepSchema = z.object({
  label: z.string(),
  agency: z.string(),
  url: z.string(),
  kind: z.enum(["certification", "reporting", "filing", "preapproval", "consent"]),
  appliesBefore: z.enum(["application", "purchase", "construction", "annual"]).optional(),
  note: z.string().optional(),
});

const ProgramDeadlineEntrySchema = z.object({
  label: z.string().optional(),
  date: z.string(),
  cutoffAt: z.string().optional(),
});

const DocumentSpecSchema = z.object({
  id: z.string(),
  label: z.string(),
  acceptedTypes: z.array(z.enum(["pdf", "png", "jpg", "webp", "docx"])),
  multi: z.boolean(),
});

/* ── Eligibility-claims foundation (2026-08) ─────────────────────────
 * See lib/types.ts (IntakeStatus / BenefitTermsStatus / LocationRelation /
 * ProgramNextWindow) and docs/eligibility-claims-acceptance.md. Optional
 * here (not every Program-shaped object in the codebase is a catalog
 * record — see lib/types.ts's Program.intakeStatus comment); catalog
 * completeness is enforced by lib/__tests__/program-schema.test.ts, not
 * by this schema being required.
 */

export const IntakeStatusSchema = z.enum([
  "open", "rolling", "closed", "lapsed", "pending", "unknown",
]);

export const BenefitTermsStatusSchema = z.enum([
  "current", "historical", "conditional", "unknown",
]);

export const LocationRelationSchema = z.enum([
  "required", "preference", "proxy", "contextual", "none",
]);

export const ProgramNextWindowSchema = z.object({
  expected: z.string().nullable(),
  note: z.string().nullable(),
});

/* ── Program ──────────────────────────────── */

export const ProgramSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.enum([
    "city", "county", "state", "federal", "utility",
    "City", "County", "State", "Federal", "Utility", "Nonprofit / CDFI",
  ]),
  zoneKey: z.string().nullable().optional(),
  summary: z.string(),
  whoQualifies: z.string().optional(),
  benefits: z.array(z.string()).optional().default([]),
  howToApply: z.array(z.string()).optional().default([]),
  requiredDocs: z.array(z.string()).optional().default([]),
  contact: z.string().optional().default(""),
  url: z.string().optional().default(""),
  contacts: z.array(ProgramContactSchema).optional().default([]),
  eligibilityRules: z.array(EligibilityRuleSchema).optional().default([]),
  lastVerifiedAt: z.string().nullable().optional(),
  benefitRange: z.string().optional(),
  fastestConfirmingStep: z.string().optional(),
  // ── Phase 1 (2026-05-21) additions ─────────
  status: z.enum([
    "active", "current", "changed", "verify", "sunset", "pending", "lapsed",
  ]).optional(),
  sourceUrl: z.string().optional(),
  applicationPortals: z.array(ApplicationPortalSchema).optional().default([]),
  verificationSteps: z.array(VerificationStepSchema).optional().default([]),
  boundaryDisclaimer: z.string().optional(),
  expirationNote: z.string().optional(),
  suspensionNote: z.string().optional(),
  sunsetWarning: z.string().optional(),
  oz2Note: z.string().optional(),
  redesignatedAreaWarning: z.string().optional(),
  adjacentCapitalNote: z.string().optional(),
  deadlines: z.array(ProgramDeadlineEntrySchema).optional(),
  oneTime: z.boolean().optional(),
  expiresOn: z.string().optional(),
  recurring: z.boolean().optional(),
  personas: z.array(z.enum(["all", "starting", "growing", "developer", "supporter"])).optional(),
  documentSpecs: z.array(DocumentSpecSchema).optional(),
  // ── Eligibility-claims foundation (2026-08) ──
  intakeStatus: IntakeStatusSchema.optional(),
  statusAsOf: z.string().optional(),
  benefitTermsStatus: BenefitTermsStatusSchema.optional(),
  locationRelation: LocationRelationSchema.optional(),
  nextWindow: ProgramNextWindowSchema.optional(),
});

/* ── Stacking Rule ────────────────────────── */

export const StackingRuleSchema = z.object({
  id: z.string(),
  programId: z.string(),
  otherProgramId: z.string(),
  relationship: z.enum(["can", "cannot", "conditional", "unknown"]),
  scope: z.string(),
  conditionsJson: z.any().nullable(),
  reason: z.string(),
  authoritySource: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  lastVerifiedAt: z.string().nullable(),
});

/* ── Survey Answers ───────────────────────── */

export const SurveyAnswersSchema = z.object({
  industry: z.string().optional(),
  property: z.string().optional(),
  activities: z.array(z.string()).optional(),
  size: z.string().optional(),
});

/* ── Safe parse helper (drop invalid + count) ─ */

/**
 * Validate every item against `schema`, keeping the parsed values and DROPPING
 * the ones that fail.
 *
 * This used to push the raw, unvalidated item into the result on a parse
 * failure and call that "graceful degradation". It was the opposite: the
 * return type is `T[]`, so every caller — `lib/data.ts`, `/api/programs`,
 * `/api/stacking` — received objects typed as validated `Program` /
 * `StackingRule` records that had never passed validation, and then read
 * fields off them that the schema exists to guarantee. A record missing
 * `summary` or carrying a `level` outside the enum reached the report engine
 * and the public program surfaces indistinguishable from a good one; the only
 * trace was a per-item `console.warn` in a log nobody reads. Dropping is the
 * honest degradation: a malformed record is not a program, and a short list of
 * real records beats a full list containing fiction.
 *
 * A single summary line is logged when anything was dropped — one line naming
 * the count and the first failure, instead of N lines of noise.
 */
export function safeParseArray<T>(
  schema: z.ZodType<T>,
  data: unknown[],
  label: string
): T[] {
  const results: T[] = [];
  let dropped = 0;
  let firstIssue: string | null = null;

  for (const item of data) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data);
      continue;
    }
    dropped += 1;
    if (firstIssue === null) {
      const issue = parsed.error.issues?.[0];
      const path = issue?.path?.length ? issue.path.join(".") : "(root)";
      firstIssue = `${path}: ${issue?.message ?? "unknown error"}`;
    }
  }

  if (dropped > 0) {
    console.warn(
      `[${label}] dropped ${dropped} of ${data.length} invalid item(s) — first failure ${firstIssue}`
    );
  }

  return results;
}

import { z } from "zod";

/* ── Contact ──────────────────────────────── */

export const ProgramContactSchema = z.object({
  agency: z.string(),
  abbreviation: z.string(),
  phone: z.string(),
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

/* ── Program ──────────────────────────────── */

export const ProgramSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.enum(["city", "county", "state", "federal", "City", "County", "State", "Federal"]),
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

/* ── Safe parse helper (warn + passthrough) ─ */

export function safeParseArray<T>(
  schema: z.ZodType<T>,
  data: unknown[],
  label: string
): T[] {
  const results: T[] = [];
  for (const item of data) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data);
    } else {
      console.warn(
        `[${label}] Validation warning for item:`,
        parsed.error.issues?.[0]?.message ?? "unknown error"
      );
      // Graceful degradation: include the raw item
      results.push(item as T);
    }
  }
  return results;
}

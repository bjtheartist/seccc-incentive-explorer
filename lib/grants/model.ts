import { z } from "zod";
import {
  businessStructures,
  spaceArrangements,
  classificationFor,
  isNaicsCriterion,
  naicsMatches,
  normalizeApplicantClassification,
} from "./classification";

export const cadenceLabels = {
  time_bound: "One-time deadline",
  recurring: "Recurring / rolling",
  hybrid: "Recurring with application windows",
  unknown: "Timing to verify",
} as const;
export const fundingLabels = {
  grant: "Cash grant",
  reimbursement: "Reimbursement",
  tax_benefit: "Tax benefit",
  loan: "Loan",
  in_kind: "In-kind support",
} as const;
export const reviewLabels = {
  unverified: "Needs verification",
  in_review: "In review",
  verified: "Verified",
  archived: "Archived",
} as const;
export const roles = ["landlord", "operator", "tenant", "any"] as const;
export const entities = [
  "for_profit",
  "nonprofit",
  "individual",
  "any",
] as const;
export const stages = ["pre_opening", "operating", "any"] as const;
const text = z.string().trim().max(4000);
const name = z.string().trim().min(1).max(200);
const tags = z.array(z.string().trim().min(1).max(100)).max(30);
export const sourceUrl = z
  .string()
  .max(2000)
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443")
    );
  }, "Use an HTTPS URL without credentials or a custom port");
const instant = z.iso.datetime({ offset: true }).nullable();
const ownerId = z.string().max(200).nullable().default(null);
const common = { ownerId, notes: text.default(""), tags: tags.default([]) };

export const programSchema = z.object({
  name,
  sponsor: name,
  sponsorType: z.enum(["public", "philanthropic", "corporate", "community"]),
  fundingType: z.enum(
    Object.keys(fundingLabels) as [
      keyof typeof fundingLabels,
      ...Array<keyof typeof fundingLabels>,
    ],
  ),
  cadence: z.enum(
    Object.keys(cadenceLabels) as [
      keyof typeof cadenceLabels,
      ...Array<keyof typeof cadenceLabels>,
    ],
  ),
  sourceUrl,
  description: text.default(""),
  archived: z.boolean().default(false),
  ...common,
});
export const roundSchema = z
  .object({
    programId: name,
    catalogId: z.string().max(200).nullable().default(null),
    name,
    availability: z.enum(["unknown", "announced", "open", "rolling", "closed"]),
    opensAt: instant.default(null),
    closesAt: instant.default(null),
    timezone: z
      .string()
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Use an IANA timezone")
      .default("America/Chicago"),
    amount: z.string().max(300).default("Amount to verify"),
    review: z
      .enum(["unverified", "in_review", "verified", "archived"])
      .default("unverified"),
    evidenceUrl: sourceUrl,
    evidence: text.default(""),
    verifiedAt: instant.default(null),
    nextReviewAt: instant.default(null),
    rules: z.object({
      roles: z.array(z.enum(roles)).default([]),
      entities: z.array(z.enum(entities)).default([]),
      stages: z.array(z.enum(stages)).default([]),
      industries: tags.default([]),
      businessTypes: tags.default([]),
      businessStructures: z
        .array(
          z.enum(["any", ...Object.keys(businessStructures)] as [
            string,
            ...string[],
          ]),
        )
        .max(30)
        .default([]),
      naicsCodes: z
        .array(
          z
            .string()
            .refine(isNaicsCriterion, "Use a valid 2022 NAICS code or any"),
        )
        .max(30)
        .default([]),
      spaceArrangements: z
        .array(
          z.enum(["any", ...Object.keys(spaceArrangements)] as [
            string,
            ...string[],
          ]),
        )
        .max(30)
        .default([]),
      geography: tags.default([]),
      costs: tags.default([]),
      exclusions: text.default(""),
      requirements: text.default(""),
    }),
    ...common,
  })
  .superRefine((r, ctx) => {
    if (
      r.opensAt &&
      r.closesAt &&
      Date.parse(r.opensAt) >= Date.parse(r.closesAt)
    )
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "Deadline must be after opening",
      });
    if (r.availability === "open" && !r.closesAt)
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message:
          "A time-bound open round needs a deadline; use rolling for continuous intake",
      });
    if (
      r.review === "verified" &&
      (!r.evidence.trim() || !r.verifiedAt || !r.nextReviewAt)
    )
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message:
          "Verification needs evidence, a verification date, and a next review date",
      });
    if (r.verifiedAt && Date.parse(r.verifiedAt) > Date.now() + 60_000)
      ctx.addIssue({
        code: "custom",
        path: ["verifiedAt"],
        message: "Verification cannot be in the future",
      });
    if (
      r.verifiedAt &&
      r.nextReviewAt &&
      Date.parse(r.nextReviewAt) <= Date.parse(r.verifiedAt)
    )
      ctx.addIssue({
        code: "custom",
        path: ["nextReviewAt"],
        message: "Next review must follow verification",
      });
  });
export const applicantSchema = z.preprocess(
  normalizeApplicantClassification,
  z
    .object({
      name,
      businessStructure: z
        .enum(
          Object.keys(businessStructures) as [
            keyof typeof businessStructures,
            ...Array<keyof typeof businessStructures>,
          ],
        )
        .default("unknown"),
      spaceArrangement: z
        .enum(
          Object.keys(spaceArrangements) as [
            keyof typeof spaceArrangements,
            ...Array<keyof typeof spaceArrangements>,
          ],
        )
        .default("unknown"),
      naicsCode: z
        .string()
        .refine(
          (v) => !!classificationFor(v),
          "Select a valid six-digit 2022 NAICS business type",
        )
        .nullable()
        .default(null),
      naicsEdition: z.literal("2022").default("2022"),
      industryCode: z.string().default(""),
      legacyBusinessType: z.string().max(200).default(""),
      legacyIndustry: z.string().max(200).default(""),
      businessType: z.string().trim().max(200).default(""),
      primaryGoal: z.string().trim().max(500).default(""),
      intakeDate: z.iso.date().nullable().default(null),
      targetDate: z.iso.date().nullable().default(null),
      fundingTypes: z
        .array(
          z.enum(["grant", "reimbursement", "tax_benefit", "loan", "in_kind"]),
        )
        .max(5)
        .default(["grant", "reimbursement", "tax_benefit", "loan", "in_kind"]),
      reimbursementReady: z.enum(["yes", "no", "unknown"]).default("unknown"),
      role: z.enum(["landlord", "operator", "unknown"]),
      entity: z.enum(["for_profit", "nonprofit", "individual", "unknown"]),
      stage: z.enum(["pre_opening", "operating", "unknown"]),
      geography: tags.default([]),
      industry: z.string().max(200).default(""),
      address: z.string().max(400).default(""),
      project: text.default(""),
      costs: tags.default([]),
      budget: z.string().max(200).default(""),
      factsSource: text.default(""),
      archived: z.boolean().default(false),
      ...common,
    })
    .superRefine((a, ctx) => {
      // Older profiles may lack intake metadata. Once a dated intake is recorded,
      // require the minimum information the team needs to maintain it.
      if (a.intakeDate)
        for (const key of ["primaryGoal"] as const) {
          if (!a[key].trim())
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: `${key} is required for a dated intake`,
            });
        }
    }),
);
export const sourceSchema = z.object({
  name,
  url: sourceUrl,
  kind: z.enum(["directory", "program"]),
  programId: z.string().max(200).nullable().default(null),
  intervalDays: z.number().int().min(1).max(90).default(7),
  enabled: z.boolean().default(true),
  ...common,
});
export const matchSchema = z.object({
  applicantId: name,
  roundId: name,
  status: z
    .enum([
      "candidate",
      "needs_information",
      "ready_for_review",
      "approved",
      "not_eligible",
      "archived",
    ])
    .default("candidate"),
  rationale: text.default(""),
  questions: text.default(""),
  nextAction: text.default(""),
  roundVersion: z.number().int().min(1),
  applicantVersion: z.number().int().min(1),
  ...common,
});
export const schemas = {
  programs: programSchema,
  rounds: roundSchema,
  applicants: applicantSchema,
  sources: sourceSchema,
  matches: matchSchema,
};
export type Resource = keyof typeof schemas;
export type Program = z.infer<typeof programSchema>;
export type Round = z.infer<typeof roundSchema>;
export type Applicant = z.infer<typeof applicantSchema>;
export type GrantSource = z.infer<typeof sourceSchema>;
export type Match = z.infer<typeof matchSchema>;
export type GrantRecord<T> = {
  id: string;
  data: T;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};
export type Member = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "editor" | "viewer";
};
export type Finding = {
  id: string;
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  kind: "discovered" | "changed";
  excerpt: string;
  previousExcerpt: string | null;
  snapshotId: string;
  state: "pending" | "dismissed" | "converted";
  createdAt: string;
};
export type SourceHealth = {
  id: string;
  checkedAt: string | null;
  nextScanAt: string;
  lastStatus: string;
  lastError: string | null;
};
export type Activity = {
  id: string;
  resource: string;
  recordId: string;
  action: string;
  actor: string;
  at: string;
};
export interface WorkspaceData {
  programs: GrantRecord<Program>[];
  rounds: GrantRecord<Round>[];
  applicants: GrantRecord<Applicant>[];
  sources: GrantRecord<GrantSource>[];
  matches: GrantRecord<Match>[];
  findings: Finding[];
  sourceHealth: SourceHealth[];
  members: Member[];
  activity: Activity[];
  member: Member;
  scheduledScanning: boolean;
}

export function roundState(
  r: Round,
  now = new Date(),
): "unverified" | "upcoming" | "open" | "rolling" | "closed" | "archived" {
  if (r.review === "archived") return "archived";
  if (r.closesAt && Date.parse(r.closesAt) <= now.getTime()) return "closed";
  if (r.availability === "closed") return "closed";
  if (
    r.review !== "verified" ||
    !r.verifiedAt ||
    !r.nextReviewAt ||
    Date.parse(r.nextReviewAt) <= now.getTime()
  )
    return "unverified";
  if (r.opensAt && Date.parse(r.opensAt) > now.getTime()) return "upcoming";
  if (r.availability === "open" || r.availability === "rolling")
    return r.availability;
  return r.availability === "announced" ? "upcoming" : "unverified";
}

/** A transparent screening aid. No score implies award probability or confirmed eligibility. */
export function screenMatch(a: Applicant, r: Round, now = new Date()) {
  a = applicantSchema.parse(a);
  const reasons: string[] = [],
    gaps: string[] = [],
    exclusions: string[] = [];
  const test = (label: string, actual: string[], allowed: string[]) => {
    if (!allowed.length) gaps.push(`${label}: program rules need review`);
    else if (allowed.includes("any"))
      reasons.push(`${label}: unrestricted in recorded rules`);
    else if (!actual.length || actual.includes("unknown"))
      gaps.push(`${label}: applicant information needed`);
    else if (
      actual.some((v) =>
        allowed.some((x) => x.toLowerCase() === v.toLowerCase()),
      )
    )
      reasons.push(`${label}: recorded criteria align`);
    else if (label === "Geography")
      gaps.push(
        "Geographic eligibility is not established by the recorded facts",
      );
    else exclusions.push(`${label}: does not match recorded criteria`);
  };
  const applicantRoles =
    a.spaceArrangement === "leases" ? [a.role, "tenant"] : [a.role];
  if (
    a.role === "operator" &&
    a.spaceArrangement === "unknown" &&
    r.rules.roles.includes("tenant") &&
    !r.rules.roles.includes("operator") &&
    !r.rules.roles.includes("any")
  )
    gaps.push(
      "Applicant role: confirm whether the operator leases the project space",
    );
  else test("Applicant role", applicantRoles, r.rules.roles);
  test("Entity", [a.entity], r.rules.entities);
  test("Business stage", [a.stage], r.rules.stages);
  if (r.rules.spaceArrangements?.length)
    test("Space arrangement", [a.spaceArrangement], r.rules.spaceArrangements);
  test(
    "Business structure",
    [a.businessStructure],
    r.rules.businessStructures ?? [],
  );
  const textCriterion = (label: string, actual: string, allowed: string[]) => {
    if (!allowed.length) gaps.push(`${label}: program rules need review`);
    else if (allowed.includes("any"))
      reasons.push(`${label}: unrestricted in recorded rules`);
    else if (
      actual.trim() &&
      actual.trim().toLowerCase() !== "unknown" &&
      allowed.some((x) => x.toLowerCase() === actual.trim().toLowerCase())
    )
      reasons.push(`${label}: recorded criteria align`);
    else
      gaps.push(
        `${label}: confirm fit against the program's recorded categories`,
      );
  };
  if (r.rules.naicsCodes?.length) {
    if (r.rules.naicsCodes.includes("any"))
      reasons.push("NAICS industry: unrestricted in recorded rules");
    else if (!a.naicsCode)
      gaps.push("NAICS industry: confirm the business's six-digit code");
    else if (
      r.rules.naicsCodes.some((code) => naicsMatches(a.naicsCode!, code))
    )
      reasons.push(
        `NAICS industry: ${a.naicsCode} matches recorded code criteria`,
      );
    else
      exclusions.push("NAICS industry: does not match recorded code criteria");
  } else
    textCriterion(
      "Industry",
      a.industry || a.legacyIndustry,
      r.rules.industries ?? [],
    );
  if (r.rules.businessTypes?.length)
    gaps.push(
      "Legacy business-type criteria need staff review and conversion to structure or NAICS codes",
    );
  test("Geography", a.geography, r.rules.geography);
  test("Project costs", a.costs, r.rules.costs);
  if (
    !r.rules.costs.includes("any") &&
    a.costs.some((c) =>
      r.rules.costs.some((x) => x.toLowerCase() === c.toLowerCase()),
    ) &&
    a.costs.some(
      (c) => !r.rules.costs.some((x) => x.toLowerCase() === c.toLowerCase()),
    )
  )
    gaps.push(
      "Only some project costs align; separate eligible and non-eligible expenses",
    );
  const state = roundState(r, now);
  if (state === "closed" || state === "archived")
    exclusions.push("Round is closed or archived");
  else if (state !== "open" && state !== "rolling")
    gaps.push("Current application availability needs review");
  if (!a.factsSource.trim())
    gaps.push("Applicant facts need a source or confirmation note");
  if (r.rules.exclusions || r.rules.requirements)
    gaps.push("Review all additional requirements and exclusions manually");
  return {
    result: exclusions.length
      ? "not_eligible"
      : gaps.length
        ? "needs_information"
        : "candidate",
    reasons,
    gaps,
    exclusions,
  } as const;
}

export function matchNeedsReview(
  m: Match,
  a: GrantRecord<Applicant>,
  r: GrantRecord<Round>,
  now = new Date(),
) {
  return (
    m.applicantVersion !== a.version ||
    m.roundVersion !== r.version ||
    !["open", "rolling"].includes(roundState(r.data, now))
  );
}

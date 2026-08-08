import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_CERTIFICATION_TASK_ID,
  PREPARATION_PACKET_STATUSES,
  PREPARATION_TASK_OWNERS,
  PREPARATION_TASK_STATUSES,
  buildPreparationTasks,
  buildProfileSnapshot,
  calculateFoundationTimeline,
  calculatePreparationTimeline,
  calculatePreparationTimelines,
  canApplicantUpdateTask,
  computeFoundationRefresh,
  isFoundationScopeTask,
  mergePreparationProgramTasks,
  normalizePreparationTasks,
  summarizePreparationStatus,
  summarizeProfileFoundation,
  type BusinessProfileInput,
  type JsonValue,
  type PreparationTask,
} from "../incentive-preparation";
import type { GoalType } from "../workspace";

const GOAL_TYPES: GoalType[] = [
  "improve-storefront",
  "buy-equipment",
  "hire-staff",
  "expand-location",
  "open-relocate",
  "acquire-vacant-property",
  "development-feasibility",
];

const COMPLETE_PROFILE: BusinessProfileInput = {
  legalName: "South Shore Supply LLC",
  dbaName: "South Shore Supply",
  physicalAddress: "9000 S Commercial Ave, Chicago, IL 60617",
  mailingAddress: "PO Box 170, Chicago, IL 60617",
  contactName: "Jordan Lee",
  contactEmail: "jordan@example.com",
  contactPhone: "312-555-0134",
  entityType: "LLC",
  formationDate: "2021-03-15",
  industry: "Retail",
  naicsCode: "444240",
  employeeCount: 8,
  ownershipNotes: "Applicant-owned business",
  licenses: [{ type: "business", status: "active" }],
  fieldProvenance: {
    legalName: { source: "applicant", confirmedAt: "2026-07-01" },
  },
};

function preparationTask(
  id: string,
  overrides: Partial<PreparationTask> = {}
): PreparationTask {
  return {
    id,
    title: id,
    description: "Application preparation task",
    status: "needs_document",
    owner: "business",
    category: "goal",
    dependsOn: [],
    estimatedMinWeeks: 1,
    estimatedMaxWeeks: 1,
    ...overrides,
  };
}

describe("incentive preparation domain values", () => {
  it("exports the required task statuses, owners, and packet summaries", () => {
    expect(PREPARATION_TASK_STATUSES).toEqual([
      "needs_document",
      "needs_owner_answer",
      "needs_advisor",
      "external_dependency",
      "requires_certification",
      "complete",
    ]);
    expect(PREPARATION_TASK_OWNERS).toEqual([
      "business",
      "advisor",
      "accountant",
      "landlord",
      "local_partner",
      "program_administrator",
    ]);
    expect(PREPARATION_PACKET_STATUSES).toEqual([
      "foundation_complete",
      "needs_information",
      "waiting_on_others",
      "needs_advisor",
      "requires_certification",
      "ready_to_submit",
    ]);
  });
});

describe("buildPreparationTasks", () => {
  const expectedGoalTaskIds: Record<GoalType, string[]> = {
    "improve-storefront": [
      "storefront-improvement-scope",
      "storefront-contractor-materials",
    ],
    "buy-equipment": ["equipment-use-plan", "equipment-vendor-materials"],
    "hire-staff": ["staffing-plan", "workforce-records"],
    "expand-location": ["expansion-scope", "expansion-project-materials"],
    "open-relocate": ["opening-relocation-plan", "opening-relocation-materials"],
    "acquire-vacant-property": [
      "vacant-property-acquisition-plan",
      "vacant-property-due-diligence",
    ],
    "development-feasibility": [
      "development-concept",
      "development-feasibility-materials",
    ],
  };

  it.each(GOAL_TYPES)("builds the common foundation and the %s overlay", (goalType) => {
    const tasks = buildPreparationTasks({
      goalType,
      programId: "sbif",
      programName: "Small Business Improvement Fund",
      profile: COMPLETE_PROFILE,
    });
    const ids = tasks.map((task) => task.id);
    const foundation = tasks.filter((task) => task.category === "foundation");

    expect(foundation.map((task) => task.id)).toEqual([
      "foundation-business-identity",
      "foundation-addresses",
      "foundation-authorized-contact",
    ]);
    expect(foundation.every((task) => task.status === "complete")).toBe(true);
    expect(tasks.filter((task) => task.category === "goal").map((task) => task.id)).toEqual(
      expectedGoalTaskIds[goalType]
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(tasks.every((task) => task.dependsOn.every((id) => ids.includes(id)))).toBe(true);
    expect(tasks.every((task) => task.programId === "sbif")).toBe(true);
    expect(tasks.every((task) => task.programName === "Small Business Improvement Fund")).toBe(
      true
    );

    const certification = tasks.at(-1);
    expect(certification).toMatchObject({
      id: OFFICIAL_CERTIFICATION_TASK_ID,
      status: "requires_certification",
      owner: "business",
      category: "certification",
      applicantOnly: true,
      completionAuthority: "applicant_or_authorized_representative",
    });
    expect(certification?.dependsOn).toEqual(tasks.slice(0, -1).map((task) => task.id));
    expect(canApplicantUpdateTask(certification!)).toBe(false);
  });

  it("keeps incomplete profile fields in the applicant information stage", () => {
    const tasks = buildPreparationTasks({
      goalType: "buy-equipment",
      profile: { legalName: "Incomplete Business" },
    });

    expect(tasks.slice(0, 3).map((task) => task.status)).toEqual([
      "needs_owner_answer",
      "needs_owner_answer",
      "needs_owner_answer",
    ]);
    expect(summarizePreparationStatus(tasks)).toBe("needs_information");
  });

  it("adds the required outside parties to every preparation graph", () => {
    for (const goalType of GOAL_TYPES) {
      const tasks = buildPreparationTasks({ goalType, profile: COMPLETE_PROFILE });

      expect(tasks).toContainEqual(
        expect.objectContaining({
          id: "accountant-financials",
          owner: "accountant",
          status: "external_dependency",
        })
      );
      expect(tasks).toContainEqual(
        expect.objectContaining({
          id: "tax-good-standing",
          status: "external_dependency",
        })
      );
      expect(tasks).toContainEqual(
        expect.objectContaining({
          id: "program-application-requirements",
          owner: "program_administrator",
        })
      );
      expect(tasks).toContainEqual(
        expect.objectContaining({
          id: "advisor-application-review",
          owner: "advisor",
          status: "needs_advisor",
        })
      );
    }
  });

  it("scopes accountant-reviewed financials to the business identity only", () => {
    for (const goalType of GOAL_TYPES) {
      const tasks = buildPreparationTasks({ goalType, profile: COMPLETE_PROFILE });
      const financials = tasks.find((task) => task.id === "accountant-financials");
      // The continuity document is program-agnostic: it depends only on the
      // business identity, no longer on the goal task.
      expect(financials?.dependsOn).toEqual(["foundation-business-identity"]);
    }
  });

  it("adds site control, zoning, and consent-aware local support only to site goals", () => {
    const siteGoals: GoalType[] = [
      "improve-storefront",
      "expand-location",
      "open-relocate",
      "acquire-vacant-property",
      "development-feasibility",
    ];
    const nonSiteGoals: GoalType[] = ["buy-equipment", "hire-staff"];

    for (const goalType of siteGoals) {
      const tasks = buildPreparationTasks({ goalType, profile: COMPLETE_PROFILE });
      expect(tasks).toContainEqual(
        expect.objectContaining({ id: "landlord-site-control", owner: "landlord" })
      );
      expect(tasks).toContainEqual(
        expect.objectContaining({ id: "zoning-permits", owner: "program_administrator" })
      );
      const supportLetter = tasks.find((task) => task.id === "local-support-letter");
      expect(supportLetter).toMatchObject({
        owner: "local_partner",
        status: "external_dependency",
      });
      expect(supportLetter?.description).toMatch(/explicit consent/i);
    }

    for (const goalType of nonSiteGoals) {
      const ids = buildPreparationTasks({ goalType, profile: COMPLETE_PROFILE }).map(
        (task) => task.id
      );
      expect(ids).not.toContain("landlord-site-control");
      expect(ids).not.toContain("zoning-permits");
      expect(ids).not.toContain("local-support-letter");
    }
  });

  it("uses program-preparation framing without scores or incentive totals", () => {
    const tasks = buildPreparationTasks({
      goalType: "hire-staff",
      profile: COMPLETE_PROFILE,
    });
    const serialized = JSON.stringify(tasks).toLowerCase();

    expect(serialized).toContain("application preparation");
    expect(serialized).toContain("selected program");
    expect(serialized).not.toMatch(/numeric score|possible incentive dollars|guaranteed award/);
    expect(serialized).not.toMatch(/\$[0-9]/);
    expect(tasks.some((task) => "score" in task)).toBe(false);
    expect(tasks.some((task) => "amount" in task)).toBe(false);
  });

  it("adds the selected program's maintained document and verification steps", () => {
    const tasks = buildPreparationTasks({
      goalType: "improve-storefront",
      programId: "sbif",
      programName: "Small Business Improvement Fund",
      programRequiredDocs: [
        "Proof of property ownership or lease",
        "Contractor bids",
        "Contractor bids",
      ],
      programVerificationSteps: [
        {
          label: "Confirm the current application window",
          agency: "Chicago DPD",
          kind: "preapproval",
          appliesBefore: "application",
          note: "Funding windows are district-specific.",
        },
      ],
      profile: COMPLETE_PROFILE,
    });

    const documentTasks = tasks.filter((task) => task.id.startsWith("program-document-"));
    const verificationTasks = tasks.filter((task) =>
      task.id.startsWith("program-verification-")
    );

    expect(documentTasks).toHaveLength(2);
    expect(documentTasks[0]).toMatchObject({
      title: "Collect program document: Proof of property ownership or lease",
      status: "needs_document",
      programId: "sbif",
    });
    expect(verificationTasks).toHaveLength(1);
    expect(verificationTasks[0]).toMatchObject({
      title: "Confirm program step: Confirm the current application window",
      owner: "program_administrator",
      status: "external_dependency",
    });
    expect(verificationTasks[0].description).toContain("Funding windows are district-specific");
  });
});

describe("calculatePreparationTimeline", () => {
  it("calculates the min/max dependency chain, critical path, owners, and parallel work", () => {
    const tasks = [
      preparationTask("start", {
        estimatedMinWeeks: 1,
        estimatedMaxWeeks: 2,
      }),
      preparationTask("short-branch", {
        owner: "local_partner",
        dependsOn: ["start"],
        estimatedMinWeeks: 1,
        estimatedMaxWeeks: 1,
      }),
      preparationTask("long-branch", {
        owner: "accountant",
        status: "external_dependency",
        dependsOn: ["start"],
        estimatedMinWeeks: 2,
        estimatedMaxWeeks: 4,
      }),
      preparationTask("review", {
        owner: "advisor",
        status: "needs_advisor",
        dependsOn: ["short-branch", "long-branch"],
        estimatedMinWeeks: 0.5,
        estimatedMaxWeeks: 1,
      }),
    ];

    const timeline = calculatePreparationTimeline(tasks, new Date("2026-07-01T18:00:00Z"));

    expect(timeline).toMatchObject({
      asOfDate: "2026-07-01",
      estimatedMinWeeks: 3.5,
      estimatedMaxWeeks: 7,
      estimatedWeeks: { min: 3.5, max: 7 },
      earliestRealisticDate: "2026-08-19",
      criticalPathTaskIds: ["start", "long-branch", "review"],
      owners: ["business", "local_partner", "accountant", "advisor"],
    });
    expect(timeline.parallelizableWork).toContainEqual(["short-branch", "long-branch"]);
    expect(timeline.parallelizableTaskIds).toEqual(["short-branch", "long-branch"]);
    expect(timeline).not.toHaveProperty("score");
  });

  it("treats completed work as elapsed rather than adding it to the remaining range", () => {
    const timeline = calculatePreparationTimeline(
      [
        preparationTask("already-done", {
          status: "complete",
          estimatedMinWeeks: 4,
          estimatedMaxWeeks: 8,
        }),
        preparationTask("remaining", {
          dependsOn: ["already-done"],
          estimatedMinWeeks: 2,
          estimatedMaxWeeks: 3,
        }),
      ],
      "2026-07-10"
    );

    expect(timeline.estimatedWeeks).toEqual({ min: 2, max: 3 });
    expect(timeline.earliestRealisticDate).toBe("2026-07-31");
    expect(timeline.owners).toEqual(["business"]);
  });

  it("returns a zero-length timeline for no work", () => {
    expect(calculatePreparationTimeline([], "2026-07-10")).toEqual({
      asOfDate: "2026-07-10",
      estimatedMinWeeks: 0,
      estimatedMaxWeeks: 0,
      estimatedWeeks: { min: 0, max: 0 },
      earliestRealisticDate: "2026-07-10",
      criticalPathTaskIds: [],
      owners: [],
      parallelizableWork: [],
      parallelizableTaskIds: [],
    });
  });

  it("rejects circular dependencies instead of returning a misleading date", () => {
    const tasks = [
      preparationTask("a", { dependsOn: ["b"] }),
      preparationTask("b", { dependsOn: ["a"] }),
    ];

    expect(() => calculatePreparationTimeline(tasks, "2026-07-10")).toThrow(/acyclic/i);
  });

  it("rejects an invalid as-of date", () => {
    expect(() => calculatePreparationTimeline([], "not-a-date")).toThrow(/valid date/i);
  });
});

describe("Business File scope split", () => {
  it("counts foundation categories and continuity documents as Business File scope", () => {
    expect(
      isFoundationScopeTask({ id: "foundation-business-identity", category: "foundation" })
    ).toBe(true);
    expect(
      isFoundationScopeTask({ id: "foundation-addresses", category: "foundation" })
    ).toBe(true);
    expect(
      isFoundationScopeTask({ id: "accountant-financials", category: "dependency" })
    ).toBe(true);
    expect(
      isFoundationScopeTask({ id: "tax-good-standing", category: "dependency" })
    ).toBe(true);
    expect(
      isFoundationScopeTask({ id: "storefront-improvement-scope", category: "goal" })
    ).toBe(false);
    expect(
      isFoundationScopeTask({ id: "program-application-requirements", category: "dependency" })
    ).toBe(false);
    expect(
      isFoundationScopeTask({ id: OFFICIAL_CERTIFICATION_TASK_ID, category: "certification" })
    ).toBe(false);
  });

  it("keeps goal, program, and certification work off the foundation critical path", () => {
    const tasks = buildPreparationTasks({
      goalType: "improve-storefront",
      programName: "Small Business Improvement Fund",
      profile: { legalName: "Incomplete Business" },
    });
    const foundation = calculateFoundationTimeline(tasks, "2026-07-10");
    const foundationIds = new Set(
      tasks.filter((task) => isFoundationScopeTask(task)).map((task) => task.id)
    );

    expect(foundation.criticalPathTaskIds.length).toBeGreaterThan(0);
    for (const id of foundation.criticalPathTaskIds) {
      expect(foundationIds.has(id)).toBe(true);
    }
    expect(foundation.criticalPathTaskIds).not.toContain("storefront-improvement-scope");
    expect(foundation.criticalPathTaskIds).not.toContain("program-application-requirements");
    expect(foundation.criticalPathTaskIds).not.toContain(OFFICIAL_CERTIFICATION_TASK_ID);
  });

  it("reports zero remaining foundation work once the Business File basics are complete", () => {
    const tasks = buildPreparationTasks({
      goalType: "buy-equipment",
      profile: COMPLETE_PROFILE,
    }).map((task) =>
      isFoundationScopeTask(task) ? { ...task, status: "complete" as const } : task
    );

    const foundation = calculateFoundationTimeline(tasks, "2026-07-10");
    expect(foundation.estimatedWeeks).toEqual({ min: 0, max: 0 });
    expect(foundation.estimatedMaxWeeks).toBe(0);
  });

  it("returns both timelines, with the application timeline equal to the full-set timeline", () => {
    const tasks = buildPreparationTasks({
      goalType: "improve-storefront",
      programName: "Small Business Improvement Fund",
      profile: COMPLETE_PROFILE,
    });
    const timelines = calculatePreparationTimelines(tasks, "2026-07-10");
    const application = calculatePreparationTimeline(tasks, "2026-07-10");
    const foundation = calculateFoundationTimeline(tasks, "2026-07-10");

    expect(Object.keys(timelines).sort()).toEqual(["application", "foundation"]);
    expect(timelines.application.estimatedMaxWeeks).toBe(application.estimatedMaxWeeks);
    expect(timelines.application.criticalPathTaskIds).toEqual(
      application.criticalPathTaskIds
    );
    expect(timelines.foundation.estimatedMaxWeeks).toBe(foundation.estimatedMaxWeeks);
    expect(timelines.application.estimatedMaxWeeks).toBeGreaterThanOrEqual(
      timelines.foundation.estimatedMaxWeeks
    );
  });
});

describe("foundation-first Business File packets", () => {
  it("emits only the program-agnostic foundation scope when no goal is given", () => {
    const tasks = buildPreparationTasks({ profile: COMPLETE_PROFILE });

    expect(tasks.map((task) => task.id)).toEqual([
      "foundation-business-identity",
      "foundation-addresses",
      "foundation-authorized-contact",
      "accountant-financials",
      "tax-good-standing",
    ]);
    // Every emitted task banks into the Business File scope.
    expect(tasks.every((task) => isFoundationScopeTask(task))).toBe(true);
    // No goal, program, or certification work leaks in.
    expect(tasks.some((task) => task.category === "goal")).toBe(false);
    expect(tasks.some((task) => task.category === "certification")).toBe(false);
    expect(tasks.some((task) => task.id === OFFICIAL_CERTIFICATION_TASK_ID)).toBe(false);
    // No program context is attached until a program is chosen.
    expect(tasks.every((task) => task.programId === undefined)).toBe(true);
    expect(tasks.every((task) => task.programName === undefined)).toBe(true);
    // The dependency graph is closed within the foundation subset.
    const ids = new Set(tasks.map((task) => task.id));
    expect(tasks.every((task) => task.dependsOn.every((id) => ids.has(id)))).toBe(true);
  });

  it("reports foundation_complete for a foundation-only packet with a complete profile", () => {
    const tasks = buildPreparationTasks({ profile: COMPLETE_PROFILE }).map((task) =>
      isFoundationScopeTask(task) ? { ...task, status: "complete" as const } : task
    );
    expect(summarizePreparationStatus(tasks)).toBe("foundation_complete");
  });

  it("treats an explicit null goal the same as omitting it", () => {
    const withNull = buildPreparationTasks({ goalType: null, profile: COMPLETE_PROFILE });
    const omitted = buildPreparationTasks({ profile: COMPLETE_PROFILE });
    expect(withNull.map((task) => task.id)).toEqual(omitted.map((task) => task.id));
  });
});

describe("mergePreparationProgramTasks", () => {
  const foundationOnly = buildPreparationTasks({ profile: COMPLETE_PROFILE });

  function freshProgramTasks() {
    return buildPreparationTasks({
      goalType: "improve-storefront",
      programId: "sbif",
      programName: "Small Business Improvement Fund",
      profile: COMPLETE_PROFILE,
    });
  }

  it("layers program tasks in while preserving user-set foundation statuses", () => {
    // The owner confirmed financials on the foundation-only packet.
    const existing = foundationOnly.map((task) =>
      task.id === "accountant-financials"
        ? { ...task, status: "complete" as const }
        : task
    );

    const merged = mergePreparationProgramTasks(existing, freshProgramTasks());
    const mergedIds = merged.map((task) => task.id);

    // Preserved user status survives the merge.
    expect(merged.find((task) => task.id === "accountant-financials")?.status).toBe(
      "complete"
    );
    // New program/goal/certification tasks are added.
    expect(mergedIds).toContain("storefront-improvement-scope");
    expect(mergedIds).toContain("program-application-requirements");
    expect(mergedIds).toContain(OFFICIAL_CERTIFICATION_TASK_ID);
    // Foundation tasks are not duplicated.
    expect(new Set(mergedIds).size).toBe(mergedIds.length);
    expect(mergedIds.filter((id) => id === "accountant-financials")).toHaveLength(1);
    // Dependencies stay closed and certification is last.
    const validIds = new Set(mergedIds);
    expect(merged.every((task) => task.dependsOn.every((id) => validIds.has(id)))).toBe(
      true
    );
    expect(merged.at(-1)?.id).toBe(OFFICIAL_CERTIFICATION_TASK_ID);
  });

  it("matches a fresh full build when no foundation status was changed", () => {
    const merged = mergePreparationProgramTasks(foundationOnly, freshProgramTasks());
    const fresh = normalizePreparationTasks(freshProgramTasks());
    expect(merged).toEqual(fresh);
  });

  it("is idempotent across a repeated merge", () => {
    const existing = foundationOnly.map((task) =>
      task.id === "tax-good-standing"
        ? { ...task, status: "complete" as const }
        : task
    );
    const once = mergePreparationProgramTasks(existing, freshProgramTasks());
    const twice = mergePreparationProgramTasks(once, freshProgramTasks());
    expect(twice).toEqual(once);
    expect(twice.find((task) => task.id === "tax-good-standing")?.status).toBe("complete");
  });

  it("preserves a user status set on a program task across a re-merge", () => {
    const merged = mergePreparationProgramTasks(foundationOnly, freshProgramTasks());
    const withProgress = merged.map((task) =>
      task.id === "program-application-requirements"
        ? { ...task, status: "complete" as const }
        : task
    );
    const reMerged = mergePreparationProgramTasks(withProgress, freshProgramTasks());
    expect(
      reMerged.find((task) => task.id === "program-application-requirements")?.status
    ).toBe("complete");
  });

  it("never carries a stale status onto the protected certification task", () => {
    const tampered = mergePreparationProgramTasks(foundationOnly, freshProgramTasks()).map(
      (task) =>
        task.id === OFFICIAL_CERTIFICATION_TASK_ID
          ? { ...task, status: "complete" as const }
          : task
    );
    const reMerged = mergePreparationProgramTasks(tampered, freshProgramTasks());
    expect(reMerged.find((task) => task.id === OFFICIAL_CERTIFICATION_TASK_ID)?.status).toBe(
      "requires_certification"
    );
  });
});

describe("certification protection and normalization", () => {
  it("sanitizes persisted tasks, removes invalid dependencies, and moves certification last", () => {
    const normalized = normalizePreparationTasks([
      {
        id: OFFICIAL_CERTIFICATION_TASK_ID,
        title: "Submit",
        status: "complete",
        owner: "advisor",
        category: "certification",
        dependsOn: ["work"],
        estimatedMinWeeks: -1,
        estimatedMaxWeeks: -2,
      },
      {
        id: "work",
        title: "  Collect records  ",
        description: "  Records  ",
        status: "needs_document",
        owner: "business",
        category: "goal",
        dependencies: ["work", "missing", "work"],
        estimatedWeeks: { min: 2, max: 1 },
      },
      { id: "work", title: "Duplicate" },
      { id: "missing-title" },
      null,
    ]);

    expect(normalized.map((task) => task.id)).toEqual([
      "work",
      OFFICIAL_CERTIFICATION_TASK_ID,
    ]);
    expect(normalized[0]).toMatchObject({
      title: "Collect records",
      description: "Records",
      dependsOn: [],
      estimatedMinWeeks: 2,
      estimatedMaxWeeks: 2,
    });
    expect(normalized[1]).toMatchObject({
      status: "requires_certification",
      owner: "business",
      category: "certification",
      applicantOnly: true,
      completionAuthority: "applicant_or_authorized_representative",
      estimatedMinWeeks: 0,
      estimatedMaxWeeks: 0,
    });
    expect(canApplicantUpdateTask(normalized[0])).toBe(true);
    expect(canApplicantUpdateTask(normalized[1])).toBe(false);
  });

  it("never lets the generic applicant helper complete official certification", () => {
    const certification = preparationTask(OFFICIAL_CERTIFICATION_TASK_ID, {
      status: "complete",
      category: "certification",
      applicantOnly: true,
      completionAuthority: "applicant_or_authorized_representative",
    });
    const normalized = normalizePreparationTasks([certification])[0];

    expect(normalized.status).toBe("requires_certification");
    expect(canApplicantUpdateTask(certification)).toBe(false);
    expect(canApplicantUpdateTask(normalized)).toBe(false);
  });

  it("permits applicants to track any non-certification task", () => {
    expect(canApplicantUpdateTask(preparationTask("business-task"))).toBe(true);
    expect(
      canApplicantUpdateTask(preparationTask("advisor-task", { owner: "advisor" }))
    ).toBe(true);
    expect(
      canApplicantUpdateTask(
        preparationTask("separate-certification", { status: "requires_certification" })
      )
    ).toBe(false);
  });

  it("returns an empty list for non-array persisted values", () => {
    expect(normalizePreparationTasks(null)).toEqual([]);
    expect(normalizePreparationTasks({ tasks: [] })).toEqual([]);
  });
});

describe("summarizePreparationStatus", () => {
  it.each([
    [[], "needs_information"],
    [[preparationTask("info")], "needs_information"],
    [
      [preparationTask("outside", { status: "external_dependency", owner: "landlord" })],
      "waiting_on_others",
    ],
    [[preparationTask("advisor", { status: "needs_advisor", owner: "advisor" })], "needs_advisor"],
    [[preparationTask("certify", { status: "requires_certification" })], "requires_certification"],
    [[preparationTask("foundation", { status: "complete", category: "foundation" })], "foundation_complete"],
  ] as const)("summarizes %# as %s", (tasks, expected) => {
    expect(summarizePreparationStatus([...tasks])).toBe(expected);
  });

  it("reports ready_to_submit when only official certification remains", () => {
    const tasks = [
      preparationTask("prepared", { status: "complete" }),
      preparationTask(OFFICIAL_CERTIFICATION_TASK_ID, {
        status: "requires_certification",
        category: "certification",
      }),
    ];

    expect(summarizePreparationStatus(tasks)).toBe("ready_to_submit");
  });

  it("keeps applicant information ahead of outside waiting in a mixed queue", () => {
    expect(
      summarizePreparationStatus([
        preparationTask("answer", { status: "needs_owner_answer" }),
        preparationTask("outside", {
          status: "external_dependency",
          owner: "program_administrator",
        }),
      ])
    ).toBe("needs_information");
  });
});

describe("buildProfileSnapshot", () => {
  it("normalizes and deeply detaches the immutable JSON snapshot", () => {
    const licenses: BusinessProfileInput["licenses"] = [
      { type: "retail", details: { active: true } },
    ];
    const fieldProvenance: NonNullable<BusinessProfileInput["fieldProvenance"]> = {
      legalName: { source: "applicant" },
    };
    const profile: BusinessProfileInput = {
      ...COMPLETE_PROFILE,
      legalName: "  South Shore Supply LLC  ",
      contactEmail: "  OWNER@EXAMPLE.COM ",
      employeeCount: 8.9,
      licenses,
      fieldProvenance,
    };

    const snapshot = buildProfileSnapshot(profile);
    (licenses as Array<Record<string, unknown>>)[0].type = "changed";
    (fieldProvenance.legalName as Record<string, JsonValue>).source = "changed";
    profile.legalName = "Changed Business";

    expect(snapshot).toMatchObject({
      legalName: "South Shore Supply LLC",
      contactEmail: "owner@example.com",
      employeeCount: 8,
      licenses: [{ type: "retail", details: { active: true } }],
      fieldProvenance: { legalName: { source: "applicant" } },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.licenses)).toBe(true);
    expect(Object.isFrozen(snapshot.fieldProvenance.legalName)).toBe(true);
    expect(() => {
      (snapshot as { legalName: string | null }).legalName = "Mutation";
    }).toThrow();
  });

  it("uses JSON-safe defaults for missing or invalid profile values", () => {
    expect(
      buildProfileSnapshot({
        employeeCount: Number.NaN,
        licenses: Number.POSITIVE_INFINITY,
      })
    ).toEqual({
      legalName: null,
      dbaName: null,
      physicalAddress: null,
      mailingAddress: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      entityType: null,
      formationDate: null,
      industry: null,
      naicsCode: null,
      employeeCount: null,
      ownershipNotes: null,
      licenses: [],
      fieldProvenance: {},
    });
  });
});

describe("incentive preparation migration", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "scripts/migrate-incentive-preparation.ts"),
    "utf8"
  );

  it("creates the required preparation, request, and draft tables with their complete column contract", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS business_profiles/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS incentive_preparation_packets/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS incentive_support_requests/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS incentive_support_request_drafts/);

    const requiredColumns = [
      "legal_name",
      "dba_name",
      "physical_address",
      "mailing_address",
      "contact_name",
      "contact_email",
      "contact_phone",
      "entity_type",
      "formation_date",
      "industry",
      "naics_code",
      "employee_count",
      "ownership_notes",
      "licenses_json",
      "field_provenance_json",
      "business_profile_id",
      "project_id",
      "saved_report_id",
      "program_id",
      "program_name",
      "goal_type",
      "project_address",
      "tasks_json",
      "timeline_json",
      "profile_snapshot_json",
      "target_organization",
      "request_type",
      "requested_help",
      "consent_scope_json",
      "consented_at",
    ];
    for (const column of requiredColumns) {
      expect(migration).toMatch(new RegExp("\\b" + column + "\\b"));
    }
  });

  it("uses cascading ownership FKs, nullable workspace links, pending consent, and immutable snapshots", () => {
    expect(migration).toMatch(/user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/g);
    expect(migration).toMatch(
      /business_profile_id TEXT NOT NULL REFERENCES business_profiles\(id\) ON DELETE CASCADE/
    );
    expect(migration).toMatch(
      /project_id TEXT REFERENCES business_projects\(id\) ON DELETE SET NULL/
    );
    expect(migration).toMatch(
      /saved_report_id TEXT REFERENCES saved_reports\(id\) ON DELETE SET NULL/
    );
    expect(migration).toMatch(
      /packet_id TEXT NOT NULL REFERENCES incentive_preparation_packets\(id\) ON DELETE CASCADE/
    );
    expect(migration).toContain("status TEXT NOT NULL DEFAULT 'pending'");
    expect(migration).toContain("prevent_incentive_packet_profile_snapshot_update");
    expect(migration).toContain("profile_snapshot_json is immutable");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_incentive_packets_profile_id");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_incentive_support_requests_packet_id");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_incentive_support_drafts_packet_id");
  });

  it("relaxes goal_type and program_name to nullable for foundation-first packets", () => {
    expect(migration).toMatch(
      /ALTER TABLE incentive_preparation_packets ALTER COLUMN goal_type DROP NOT NULL/
    );
    expect(migration).toMatch(
      /ALTER TABLE incentive_preparation_packets ALTER COLUMN program_name DROP NOT NULL/
    );
  });
});

describe("summarizeProfileFoundation", () => {
  it("counts the three profile-derived foundation groups a complete profile satisfies", () => {
    expect(summarizeProfileFoundation(COMPLETE_PROFILE)).toEqual({
      confirmed: 3,
      total: 3,
    });
  });

  it("counts only the groups whose live fields are all present", () => {
    // Contact group is missing contactPhone; identity is missing naicsCode.
    const partial: BusinessProfileInput = {
      legalName: "South Shore Supply LLC",
      entityType: "LLC",
      formationDate: "2021-03-15",
      industry: "Retail",
      naicsCode: null,
      physicalAddress: "9000 S Commercial Ave",
      mailingAddress: "PO Box 170",
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      contactPhone: null,
    };
    expect(summarizeProfileFoundation(partial)).toEqual({ confirmed: 1, total: 3 });
  });

  it("never returns a percentage or readiness signal — only neutral counts", () => {
    const summary = summarizeProfileFoundation({});
    expect(summary).toEqual({ confirmed: 0, total: 3 });
    expect(Object.keys(summary).sort()).toEqual(["confirmed", "total"]);
  });
});

describe("computeFoundationRefresh", () => {
  it("flags a foundation task the live profile now covers but the packet has not confirmed", () => {
    const tasks = buildPreparationTasks({ profile: {} });
    // Live profile now has full identity/address/contact facts.
    const refresh = computeFoundationRefresh(tasks, COMPLETE_PROFILE);

    expect(refresh.newlyCoveredTaskIds).toEqual(
      expect.arrayContaining([
        "foundation-business-identity",
        "foundation-addresses",
        "foundation-authorized-contact",
      ])
    );
    const identity = refresh.items.find(
      (item) => item.taskId === "foundation-business-identity"
    );
    expect(identity).toMatchObject({ liveProfileSatisfies: true, newlyCovered: true });
  });

  it("does not flag a task the user already confirmed complete", () => {
    const tasks = buildPreparationTasks({ profile: {} }).map((task) =>
      task.id === "foundation-business-identity"
        ? { ...task, status: "complete" as const }
        : task
    );
    const refresh = computeFoundationRefresh(tasks, COMPLETE_PROFILE);
    expect(refresh.newlyCoveredTaskIds).not.toContain("foundation-business-identity");
    const identity = refresh.items.find(
      (item) => item.taskId === "foundation-business-identity"
    );
    // Still reported, but not offered as a confirm affordance.
    expect(identity).toMatchObject({ liveProfileSatisfies: true, newlyCovered: false });
  });

  it("never marks a task as newly covered when the live profile is still incomplete", () => {
    const tasks = buildPreparationTasks({ profile: {} });
    const refresh = computeFoundationRefresh(tasks, {});
    expect(refresh.newlyCoveredTaskIds).toEqual([]);
    expect(refresh.items.every((item) => item.newlyCovered === false)).toBe(true);
  });

  it("skips continuity documents, which the live profile cannot vouch for", () => {
    const tasks = buildPreparationTasks({ profile: COMPLETE_PROFILE });
    const refresh = computeFoundationRefresh(tasks, COMPLETE_PROFILE);
    const continuityIds = refresh.items.map((item) => item.taskId);
    expect(continuityIds).not.toContain("accountant-financials");
    expect(continuityIds).not.toContain("tax-good-standing");
  });
});

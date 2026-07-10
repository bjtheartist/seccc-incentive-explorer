import { describe, expect, it } from "vitest";
import {
  extractPreparationPacket,
  extractPreparationSupportRequests,
} from "../types";

describe("preparation API normalization", () => {
  const payload = {
    packet: {
      id: "packet-1",
      title: "Incentive Preparation Packet",
      businessProfileId: "profile-1",
      programId: "sbif",
      programName: "Small Business Improvement Fund",
      goalType: "improve-storefront",
      status: "waiting_on_others",
      timeline: {
        estimatedWeeks: { min: 4, max: 6 },
        earliestRealisticDate: "2026-08-21",
        criticalPathTaskIds: ["lease", "review"],
      },
      tasks: [
        {
          id: "lease",
          title: "Document site control",
          description: "Collect the current lease.",
          status: "external_dependency",
          owner: "landlord",
          category: "dependency",
        },
        {
          id: "official-certification-submission",
          title: "Complete official certification and submission",
          status: "requires_certification",
          owner: "business",
          category: "certification",
          applicantOnly: true,
        },
      ],
      profileSnapshot: {
        legalName: "South Shore Supply LLC",
        physicalAddress: "9000 S Commercial Ave, Chicago, IL 60617",
      },
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
    profile: {
      id: "profile-1",
      legalName: "South Shore Supply LLC",
      physicalAddress: "9000 S Commercial Ave, Chicago, IL 60617",
      contactName: "Jordan Lee",
      contactEmail: "jordan@example.com",
      formationDate: "2021-03-15",
    },
    supportRequests: [
      {
        id: "support-1",
        targetOrganization: "Southeast Chicago Chamber of Commerce",
        requestedHelp: "Review the landlord letter requirement.",
        consentScope: ["business_profile", "packet"],
        status: "pending",
      },
    ],
  };

  it("preserves qualitative task states, program context, and profile facts", () => {
    const packet = extractPreparationPacket(payload);

    expect(packet).toMatchObject({
      id: "packet-1",
      primaryGoal: "improve-storefront",
      selectedProgram: {
        programId: "sbif",
        label: "Small Business Improvement Fund",
      },
      preparationStatus: "waiting_on_others",
      estimatedWeekRange: "4-6 weeks",
      earliestRealisticDate: "2026-08-21",
      criticalPath: ["lease", "review"],
      businessProfile: {
        id: "profile-1",
        legalBusinessName: "South Shore Supply LLC",
        formationDate: "2021-03-15",
      },
    });
    expect(packet?.tasks[0]).toMatchObject({
      status: "external_dependency",
      mutable: true,
    });
    expect(packet?.tasks[1]).toMatchObject({
      status: "requires_certification",
      isCertification: true,
      mutable: false,
    });
  });

  it("normalizes consented support scopes", () => {
    expect(extractPreparationSupportRequests(payload)).toEqual([
      expect.objectContaining({
        id: "support-1",
        dataScopes: ["business_profile", "packet"],
        status: "pending",
      }),
    ]);
  });
});

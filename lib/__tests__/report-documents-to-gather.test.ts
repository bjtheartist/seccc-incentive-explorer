import { describe, expect, it } from "vitest";
import {
  buildDocumentsToGather,
  buildProgramLinkedDocumentsToGather,
  documentOwnerLabel,
} from "@/lib/report-documents-to-gather";
import {
  CONFIRMED_PROGRAMS_SECTION_ID,
  type GeneratedReport,
} from "@/lib/report-engine";

describe("buildDocumentsToGather", () => {
  it("returns the real Business File foundation-scope tasks — identity, addresses, contact, financials, tax/good-standing", () => {
    const rows = buildDocumentsToGather();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("foundation-business-identity");
    expect(ids).toContain("foundation-addresses");
    expect(ids).toContain("foundation-authorized-contact");
    // Continuity tasks (accountant-owned) are real, reusable Business File
    // tasks too — not invented for this surface.
    expect(rows.some((r) => r.owner === "accountant")).toBe(true);
  });

  it("carries the task registry's own title/description — never invented copy", () => {
    const rows = buildDocumentsToGather();
    const identity = rows.find((r) => r.id === "foundation-business-identity")!;
    expect(identity.title).toBe("Confirm the business identity");
    expect(identity.description).toMatch(/legal name/i);
  });

  it("formats a real time estimate range, never a fabricated single number", () => {
    const rows = buildDocumentsToGather();
    for (const row of rows) {
      expect(row.estimatedWeeks).toMatch(/^~/);
    }
  });
});

describe("documentOwnerLabel", () => {
  it("maps every PreparationTaskOwner to a readable label", () => {
    expect(documentOwnerLabel("business")).toBe("You");
    expect(documentOwnerLabel("accountant")).toBe("Your accountant");
  });
});

describe("buildProgramLinkedDocumentsToGather", () => {
  function lensedReport(documents = true): GeneratedReport {
    const explanation = (docs: string[]) => ({
      whyItAppears: ["Mapped to this address"],
      knownFromPublicData: [],
      basedOnUserAnswers: [],
      stillToConfirm: [],
      currentDocumentsToGather: docs,
      confirmWith: [],
    });
    return {
      title: "Location report",
      subtitle: "",
      reportType: "site-incentives",
      generatedAt: "2026-08-23T00:00:00.000Z",
      summary: "",
      sections: [
        {
          id: CONFIRMED_PROGRAMS_SECTION_ID,
          title: "Programs for your goal",
          description: "",
          items: [
            {
              label: "Program A",
              value: "",
              programId: "a",
              matchExplanation: explanation(documents ? ["Project budget", "Contractor bids"] : []),
            },
          ],
        },
        {
          title: "Also at this address",
          description: "",
          collapsedByPersona: true,
          items: [
            {
              label: "Program B",
              value: "",
              programId: "b",
              matchExplanation: explanation(documents ? ["project budget", "Lease"] : []),
            },
            {
              label: "Program C",
              value: "",
              programId: "c",
              matchExplanation: explanation([]),
            },
            {
              label: "Program D",
              value: "",
              programId: "d",
              matchExplanation: explanation(["Hidden fourth document"]),
            },
          ],
        },
      ],
      recommendedActions: [],
      metadata: { address: "100 E Test St" },
    } as GeneratedReport;
  }

  it("aggregates exact published document requirements across the same three programs surfaced in the summary", () => {
    const rows = buildProgramLinkedDocumentsToGather(lensedReport());
    const budget = rows.find((row) => row.title === "Project budget");

    expect(budget?.programReferences).toEqual([
      { programId: "a", label: "Program A" },
      { programId: "b", label: "Program B" },
    ]);
    expect(rows.some((row) => row.title === "Hidden fourth document")).toBe(false);
    expect(rows.every((row) => row.whyLine?.includes("published program record"))).toBe(true);
  });

  it("labels the reusable Business File foundation honestly when surfaced programs publish no document list", () => {
    const rows = buildProgramLinkedDocumentsToGather(lensedReport(false));

    expect(rows.some((row) => row.id === "foundation-business-identity")).toBe(true);
    expect(rows[0].programReferences).toHaveLength(3);
    expect(rows[0].whyLine).toMatch(/not a program-specific requirement/i);
  });
});

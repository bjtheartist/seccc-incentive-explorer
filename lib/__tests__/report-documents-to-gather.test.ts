import { describe, expect, it } from "vitest";
import { buildDocumentsToGather, documentOwnerLabel } from "@/lib/report-documents-to-gather";

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

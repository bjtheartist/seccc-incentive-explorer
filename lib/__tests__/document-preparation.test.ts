import { describe, expect, it } from "vitest";
import {
  buildPreparationTasks,
  normalizePreparationTasks,
  type BusinessProfileInput,
} from "../incentive-preparation";
import type { DocumentSpec } from "../document-spec";

const PROFILE: BusinessProfileInput = {
  legalName: "South Shore Supply LLC",
  physicalAddress: "9000 S Commercial Ave",
  contactName: "Jordan Lee",
  contactEmail: "jordan@example.com",
};

const SPECS: DocumentSpec[] = [
  { id: "bids", label: "Two contractor bids for proposed work", acceptedTypes: [], multi: true },
  { id: "w9", label: "W-9 form", acceptedTypes: ["pdf"], multi: false },
];

describe("documentSpec attachment in buildPreparationTasks", () => {
  it("attaches the matching spec to the generated program-document task", () => {
    const tasks = buildPreparationTasks({
      goalType: "improve-storefront",
      programId: "sbif",
      programName: "SBIF",
      programRequiredDocs: ["Two contractor bids for proposed work", "W-9 form"],
      programDocumentSpecs: SPECS,
      profile: PROFILE,
    });

    const bidsTask = tasks.find((task) => task.title.includes("Two contractor bids"));
    const w9Task = tasks.find((task) => task.title.includes("W-9 form"));
    expect(bidsTask?.documentSpec).toEqual(SPECS[0]);
    expect(w9Task?.documentSpec).toEqual(SPECS[1]);
    expect(bidsTask?.status).toBe("needs_document");
  });

  it("leaves document tasks specless when the program has no schema", () => {
    const tasks = buildPreparationTasks({
      goalType: "improve-storefront",
      programName: "Some program",
      programRequiredDocs: ["Some document"],
      profile: PROFILE,
    });
    const docTask = tasks.find((task) => task.title.includes("Some document"));
    expect(docTask?.documentSpec).toBeUndefined();
  });

  it("preserves documentSpec through normalization (stored/reloaded tasks)", () => {
    const tasks = buildPreparationTasks({
      goalType: "improve-storefront",
      programName: "SBIF",
      programRequiredDocs: ["W-9 form"],
      programDocumentSpecs: SPECS,
      profile: PROFILE,
    });
    const roundTripped = normalizePreparationTasks(JSON.parse(JSON.stringify(tasks)));
    const w9Task = roundTripped.find((task) => task.title.includes("W-9 form"));
    expect(w9Task?.documentSpec).toEqual(SPECS[1]);
  });
});

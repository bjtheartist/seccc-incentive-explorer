import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getAllPrograms } from "@/lib/programs-data";
import { resolveAvailability, type ProgramAvailability } from "@/lib/program-gating";
import type { Program } from "@/lib/types";
import { ProgramCatalogActions } from "@/components/programs/ProgramCatalogActions";
import { ProgramDocumentRequirements } from "@/components/programs/ProgramDocumentRequirements";

function program(programId: string): Program {
  const result = getAllPrograms().find((item) => item.id === programId);
  if (!result) throw new Error(`Missing test program: ${programId}`);
  return result;
}

function requiredDocs(programId: string): string[] {
  return program(programId).requiredDocs;
}

function renderActions(
  item: Program,
  availability: ProgramAvailability,
): string {
  return renderToStaticMarkup(
    <ProgramCatalogActions
      program={item}
      availability={availability}
      linkHealth={new Map()}
    />,
  );
}

describe("program catalog document rendering", () => {
  it("renders SSA guidance as notes without an empty required checklist", () => {
    const html = renderToStaticMarkup(
      <ProgramDocumentRequirements requiredDocs={requiredDocs("ssa")} />,
    );

    expect(html).not.toContain("Required Documents");
    expect(html).toContain("Document notes");
    expect(html).toContain("No application needed — benefits are automatic by location");
    expect(html).toContain(
      "Contact your SSA delegate agency for any sub-program requirements",
    );
  });

  it("keeps Small Business Source documents separate from its guidance", () => {
    const html = renderToStaticMarkup(
      <ProgramDocumentRequirements requiredDocs={requiredDocs("smallBizSource")} />,
    );
    const requiredStart = html.indexOf("Required Documents");
    const notesStart = html.indexOf("Document notes");

    expect(requiredStart).toBeGreaterThanOrEqual(0);
    expect(notesStart).toBeGreaterThan(requiredStart);
    expect(html.slice(requiredStart, notesStart)).toContain(
      "Bring any existing business plans or financials to advising sessions",
    );
    expect(html.slice(requiredStart, notesStart)).not.toContain(
      "No formal documents required to get started",
    );
    expect(html.slice(notesStart)).toContain(
      "No formal documents required to get started",
    );
  });
});

describe("program catalog availability actions", () => {
  const ccsap = program("ccsa");

  it("keeps the sourced Submittable action immediately before the cutoff", () => {
    const html = renderActions(
      ccsap,
      resolveAvailability(ccsap, new Date("2026-08-21T16:59:59.999-05:00")),
    );

    expect(html).toContain("Apply via Submittable");
    expect(html).toContain(
      "cocdpd.submittable.com/submit/6c22d8c7-4140-4f40-9054-9cb98ebc5104",
    );
    expect(html).not.toContain("/submit/343419/");
    expect(html).toContain("Official Source");
  });

  it.each([
    [
      "window-closed",
      resolveAvailability(ccsap, new Date("2026-08-21T17:00:00.001-05:00")),
    ],
    [
      "lapsed",
      {
        state: "lapsed-notice",
        note: "Statutory authority has lapsed.",
      } satisfies ProgramAvailability,
    ],
  ])("replaces %s application commands with the official status path", (_, availability) => {
    const html = renderActions(ccsap, availability);

    expect(html).not.toContain("Apply via Submittable");
    expect(html).not.toContain("cocdpd.submittable.com/submit/");
    expect(html).toContain("Verify current status");
    expect(html).toContain(ccsap.sourceUrl);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getAllPrograms } from "@/lib/programs-data";
import { ProgramDocumentRequirements } from "@/components/programs/ProgramDocumentRequirements";

function requiredDocs(programId: string): string[] {
  const program = getAllPrograms().find((item) => item.id === programId);
  if (!program) throw new Error(`Missing test program: ${programId}`);
  return program.requiredDocs;
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

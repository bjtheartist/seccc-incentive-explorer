import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/seo/SnapshotCTA", () => ({
  SnapshotCTA: function SnapshotCTA() {
    return null;
  },
}));

import { getAllPrograms, programSlug } from "@/lib/programs-data";
import ProgramExplainerPage from "./page";

async function renderProgram(programId: string): Promise<string> {
  const program = getAllPrograms().find((item) => item.id === programId);
  if (!program) throw new Error(`Missing test program: ${programId}`);
  const page = await ProgramExplainerPage({
    params: Promise.resolve({ slug: programSlug(program) }),
  });
  return renderToStaticMarkup(page).replaceAll("&#x27;", "'");
}

describe("program detail document rendering", () => {
  it("renders SSA guidance as notes when there are no required documents", async () => {
    const html = await renderProgram("ssa");

    expect(html).not.toContain("What you'll need");
    expect(html).toContain("Document notes");
    expect(html).toContain("No application needed — benefits are automatic by location");
    expect(html).toContain(
      "Contact your SSA delegate agency for any sub-program requirements",
    );
  });

  it("keeps Small Business Source documents out of its notes surface", async () => {
    const html = await renderProgram("smallBizSource");
    const requiredStart = html.indexOf("What you'll need");
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

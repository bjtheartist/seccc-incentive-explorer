import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/seo/SnapshotCTA", () => ({
  SnapshotCTA: function SnapshotCTA() {
    return null;
  },
}));

import { getAllPrograms, programSlug } from "@/lib/programs-data";
import type { Program } from "@/lib/types";
import { ProgramApplicationSection } from "@/components/programs/ProgramApplicationSection";
import ProgramExplainerPage from "./page";

function program(programId: string): Program {
  const result = getAllPrograms().find((item) => item.id === programId);
  if (!result) throw new Error(`Missing test program: ${programId}`);
  return result;
}

async function renderProgram(programId: string): Promise<string> {
  const item = program(programId);
  const page = await ProgramExplainerPage({
    params: Promise.resolve({ slug: programSlug(item) }),
  });
  return renderToStaticMarkup(page).replaceAll("&#x27;", "'");
}

function renderApplication(programId: string, now: Date): string {
  return renderToStaticMarkup(
    <ProgramApplicationSection program={program(programId)} now={now} />,
  ).replaceAll("&#x27;", "'");
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

describe("program detail availability rendering", () => {
  it("keeps AHSAP application guidance through its date-only deadline", () => {
    const html = renderApplication(
      "ahsap",
      new Date("2026-09-05T23:59:59.999-05:00"),
    );

    expect(html).toContain("How to apply");
    expect(html).toContain("Fastest first move");
    expect(html).toContain("before the September 5 deadline");
  });

  it("replaces AHSAP deadline-driven application copy after September 5", () => {
    const html = renderApplication(
      "ahsap",
      new Date("2026-09-06T00:00:00.001-05:00"),
    );

    expect(html).not.toContain("How to apply");
    expect(html).not.toContain("Fastest first move");
    expect(html).not.toContain("before the September 5 deadline");
    expect(html).toMatch(/applications currently closed/i);
    expect(html).toContain("Verify current status on the official source");
    expect(html).toContain("https://www.cookcountyassessoril.gov/affordable-housing");
  });

  it("replaces suspended intake copy with the sourced status and verification path", () => {
    const html = renderApplication("dataCenter", new Date("2026-08-10T12:00:00-05:00"));

    expect(html).not.toContain("How to apply");
    expect(html).not.toContain("Fastest first move");
    expect(html).toMatch(/new applications are not being processed/i);
    expect(html).toContain("Verify current status on the official source");
  });

  it("does not bake active application copy into a time-gated static page", async () => {
    const html = await renderProgram("ahsap");

    expect(html).not.toContain("Fastest first move");
    expect(html).toContain("Check current status");
    expect(html).toContain("Verify current status on the official source");
  });
});

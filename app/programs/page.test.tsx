import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { getAllPrograms } from "@/lib/programs-data";
import { resolveAvailability, type ProgramAvailability } from "@/lib/program-gating";
import type { Program } from "@/lib/types";
import { ProgramCatalogActions } from "@/components/programs/ProgramCatalogActions";
import { ProgramCatalogGuidance } from "@/components/programs/ProgramCatalogGuidance";
import { ProgramDocumentRequirements } from "@/components/programs/ProgramDocumentRequirements";
import ProgramsCatalog from "@/components/programs/ProgramsCatalog";
import { dynamic } from "./page";

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
  linkHealth: Map<string, "ok" | "broken"> = new Map(
    (item.applicationPortals || []).map((portal) => [
      `${item.id}:${portal.url}`,
      "ok" as const,
    ]),
  ),
): string {
  return renderToStaticMarkup(
    <ProgramCatalogActions
      program={item}
      availability={availability}
      linkHealth={linkHealth}
    />,
  );
}

describe("program catalog document rendering", () => {
  it("renders useful program content in the initial HTML without a client data fetch", () => {
    const html = renderToStaticMarkup(
      <ProgramsCatalog initialNowIso="2026-08-10T12:00:00.000Z" />,
    );

    expect(html).toContain("Incentive Programs");
    expect(html).toContain(program("ccsa").name);
    expect(html).toContain(program("smallBizSource").name);
  });

  it("resolves availability per request and excludes expired programs from server HTML", () => {
    const html = renderToStaticMarkup(
      <ProgramsCatalog initialNowIso="2028-01-26T12:00:00.000Z" />,
    );

    expect(dynamic).toBe("force-dynamic");
    expect(html).not.toContain(program("sbaDisasterEidl").name);
  });

  it("uses the Chicago calendar date supplied by the server for the printable sheet", () => {
    const html = renderToStaticMarkup(
      <ProgramsCatalog initialNowIso="2026-08-11T02:30:00.000Z" />,
    );

    expect(html).toContain("Generated 2026-08-10");
    expect(html).not.toContain("Generated 2026-08-11");
  });

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

  it.each([
    ["loading or unknown", new Map<string, "ok" | "broken">()],
    [
      "known broken",
      new Map<string, "ok" | "broken">(
        (ccsap.applicationPortals || []).map((portal) => [
          `${ccsap.id}:${portal.url}`,
          "broken",
        ]),
      ),
    ],
  ])("withholds application links when link health is %s", (_, linkHealth) => {
    const html = renderActions(
      ccsap,
      resolveAvailability(ccsap, new Date("2026-08-21T16:59:59.999-05:00")),
      linkHealth,
    );

    expect(html).not.toContain("Apply via Submittable");
    expect(html).not.toContain("cocdpd.submittable.com/submit/");
    expect(html).toContain("Official Source");
    expect(html).toContain(ccsap.sourceUrl);
  });
});

describe("program catalog availability guidance", () => {
  const ccsap = program("ccsa");

  it("renders application steps only for an active program", () => {
    const html = renderToStaticMarkup(
      <ProgramCatalogGuidance
        program={ccsap}
        availability={resolveAvailability(
          ccsap,
          new Date("2026-08-21T16:59:59.999-05:00"),
        )}
      />,
    );

    expect(html).toContain("How to Apply");
    expect(html).toContain(ccsap.howToApply[0]);
  });

  it.each([
    [
      "window closed",
      resolveAvailability(ccsap, new Date("2026-08-21T17:00:00.001-05:00")),
    ],
    [
      "lapsed",
      {
        state: "lapsed-notice",
        note: "Statutory authority has lapsed.",
      } satisfies ProgramAvailability,
    ],
    [
      "expired",
      {
        state: "expired",
        note: "Program availability ended.",
      } satisfies ProgramAvailability,
    ],
    ["unresolved during hydration", undefined],
  ])("replaces %s application commands with source verification", (_, availability) => {
    const html = renderToStaticMarkup(
      <ProgramCatalogGuidance
        program={ccsap}
        availability={availability}
      />,
    );

    expect(html).not.toContain("How to Apply");
    for (const step of ccsap.howToApply) expect(html).not.toContain(step);
    expect(html).toContain("Verify on the official source");
    expect(html).toContain(ccsap.sourceUrl);
  });
});

/**
 * build-spec.md 2.2/2.4 (audit F3/F4): ProgramsCatalog is the "programs
 * catalog + print matrix" surface named directly in the M0 registry
 * (lib/public-claim-surfaces.ts, id "programs-catalog"). Renders
 * synchronously from a build-time static import of data/programs-internal.json
 * (no client data fetch — see app/programs/page.test.tsx's "without a
 * client data fetch" invariant, which this file must not break), so this
 * test also uses renderToStaticMarkup with real catalog fixtures rather
 * than mocking fetch.
 *
 * Under test:
 *   1. No "eligibility gate"/"unlock"/"apply once" framing (F3).
 *   2. Status-aware header count — "available" only counts open/rolling
 *      intake (F4) — and a status label next to a lapsed program's name in
 *      the printable matrix.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { getAllPrograms } from "@/lib/programs-data";
import type { Program } from "@/lib/types";
import ProgramsCatalog from "../ProgramsCatalog";

function program(programId: string): Program {
  const result = getAllPrograms().find((item) => item.id === programId);
  if (!result) throw new Error(`Missing test program: ${programId}`);
  return result;
}

function renderCatalog(initialNowIso: string): string {
  return renderToStaticMarkup(<ProgramsCatalog initialNowIso={initialNowIso} />);
}

describe("ProgramsCatalog — status-aware public rendering", () => {
  it("never uses unlock/gate/access framing (F3)", () => {
    const html = renderCatalog("2026-08-13T12:00:00.000Z");
    const lower = html.toLowerCase();
    expect(lower).not.toContain("eligibility gate");
    expect(html).not.toContain("Apply once your address sits inside the right zone");
    expect(html).toContain("location signal");
  });

  it("the header's open-intake count excludes lapsed/closed/pending programs (F4)", () => {
    const html = renderCatalog("2026-08-13T12:00:00.000Z");
    const allPrograms = getAllPrograms();
    const openCount = allPrograms.filter(
      (p) => p.intakeStatus === "open" || p.intakeStatus === "rolling",
    ).length;
    expect(openCount).toBeGreaterThan(0);
    expect(openCount).toBeLessThan(allPrograms.length);
    expect(html).toContain(
      `${openCount} with an intake window currently open or rolling`,
    );
  });

  it("shows a status label next to a lapsed program's name in the printable matrix", () => {
    const html = renderCatalog("2026-08-13T12:00:00.000Z");
    const lapsed = program("catalystGrant");
    expect(lapsed.intakeStatus).toBe("lapsed");
    // The matrix repeats the program name; the status label sits immediately
    // after it in the same list item.
    const nameIndex = html.indexOf(lapsed.name);
    expect(nameIndex).toBeGreaterThan(-1);
    expect(html.slice(nameIndex, nameIndex + lapsed.name.length + 200)).toContain("Lapsed");
  });

  it("does not label an open/rolling program's matrix row with a status flag", () => {
    const html = renderCatalog("2026-08-13T12:00:00.000Z");
    const open = program("nof");
    expect(open.intakeStatus).toBe("rolling");
    const nameIndex = html.indexOf(open.name);
    expect(nameIndex).toBeGreaterThan(-1);
    expect(html.slice(nameIndex, nameIndex + open.name.length + 200)).not.toContain("· Lapsed");
    expect(html.slice(nameIndex, nameIndex + open.name.length + 200)).not.toContain("· Closed");
  });
});

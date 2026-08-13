import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/seo/SnapshotCTA", () => ({
  SnapshotCTA: function SnapshotCTA() {
    return null;
  },
}));

import { getAllPrograms, programSlug } from "@/lib/programs-data";
import { resolveAvailability } from "@/lib/program-gating";
import type { Program } from "@/lib/types";
import { ProgramApplicationSection } from "@/components/programs/ProgramApplicationSection";
import ProgramExplainerPage, {
  generateMetadata,
  generateStaticParams,
} from "./page";

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
    expect(html).not.toContain(`How do I apply for ${program("ahsap").name}?`);
    expect(html).toContain("Check current status");
    expect(html).toContain("Verify current status on the official source");
  });

  it("omits currently expired programs from static params and marks their metadata noindex", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2035-01-01T12:00:00-06:00"));

    try {
      const now = new Date();
      const expired = getAllPrograms().filter(
        (item) => resolveAvailability(item, now).state === "expired",
      );
      expect(expired.length).toBeGreaterThan(0);

      const params = await generateStaticParams();
      const generatedSlugs = new Set(params.map((item) => item.slug));
      for (const item of expired) {
        expect(generatedSlugs.has(programSlug(item))).toBe(false);
      }

      const metadata = await generateMetadata({
        params: Promise.resolve({ slug: programSlug(expired[0]) }),
      });
      expect(metadata).toMatchObject({
        robots: { index: false, follow: false },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * build-spec.md 2.2/2.4 (audit F3/F4/F5): the program detail page must not
 * (a) frame a mapped boundary as an "unlock"/eligibility gate, (b) render a
 * closed/lapsed program's dollar amount as a current pill without status
 * context, or (c) render raw catalog `whoQualifies` prose unframed.
 */
describe("program detail page — status-aware public rendering (audit F3/F4/F5)", () => {
  it("never uses unlock/gate/access framing for a location-boundary program (F3)", async () => {
    const html = await renderProgram("nof");
    const lower = html.toLowerCase();
    expect(lower).not.toContain("unlocks");
    expect(lower).not.toContain("eligibility gate");
    expect(html).toContain("location signal");
  });

  it("does not render a closed program's dollar figure as an unqualified current pill (F4/F5)", async () => {
    const html = await renderProgram("catalystGrant");
    expect(html).toContain("No round currently open");
    // The qualifier sentence (from lib/program-public.ts's benefitQualifier)
    // must actually be present, not just the bare dollar figure.
    expect(html).toMatch(/most recently published round offered/i);
    expect(html).toMatch(/no round currently open as of/i);
  });

  it("shows the current-terms qualifier for an open/rolling program, not a bare 'as of' void", async () => {
    const html = await renderProgram("nof");
    expect(html).toMatch(/current published terms as of/i);
  });

  it("frames published criteria with the administering-agency confirm line rather than raw whoQualifies (F8-adjacent DTO rule)", async () => {
    const html = await renderProgram("nof");
    expect(html).toMatch(/published criteria — confirm with/i);
  });

  it("omits a lapsed program's benefits from the FAQ JSON-LD (F4 minimal fix)", async () => {
    const item = program("catalystGrant");
    const page = await ProgramExplainerPage({
      params: Promise.resolve({ slug: programSlug(item) }),
    });
    const html = renderToStaticMarkup(page);
    const jsonLdMatch = html.match(/"program-faq-jsonld"[\s\S]*?<script[^>]*>([\s\S]*?)<\/script>/);
    // Fall back to scanning all JSON-LD script tags if the id-first regex misses the DOM order.
    const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1],
    );
    const combined = jsonLdMatch ? jsonLdMatch[1] : scripts.join("\n");
    expect(combined).not.toMatch(/what can .* support/i);
  });
});

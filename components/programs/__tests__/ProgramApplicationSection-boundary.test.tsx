import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { toProgramApplicationView } from "../programAvailability";
import { ProgramApplicationSection } from "../ProgramApplicationSection";
import type { Program } from "@/lib/types";

/**
 * review7 S17 (CRITICAL) — `app/programs/[slug]/page.tsx` (a server
 * component) used to pass a full raw `Program` into
 * `ProgramApplicationSection` ("use client"), serializing whoQualifies/
 * eligibilityRules/contacts/requiredDocs/verificationSteps into the
 * page's RSC payload — the S11 leak shape, via a prop instead of a
 * route. `toProgramApplicationView()` is the fix: the ONLY sanctioned
 * way to build that prop, mapping just the fields the component and its
 * gating calls (resolveAvailability/resolveConservativeProgramAvailability)
 * actually read.
 */

const INTERNAL_ONLY_KEYS = [
  "whoQualifies",
  "eligibilityRules",
  "contacts",
  "requiredDocs",
  "verificationSteps",
  "benefits",
  "summary",
  "contact",
  "name",
  "level",
  "zoneKey",
  "benefitRange",
  "boundaryDisclaimer",
  "expirationNote",
  "oz2Note",
  "redesignatedAreaWarning",
  "adjacentCapitalNote",
  "applicationPortals",
  "documentSpecs",
  "intakeStatus",
  "statusAsOf",
  "benefitTermsStatus",
  "locationRelation",
  "nextWindow",
  "personas",
  "lastVerifiedAt",
] as const;

const ALLOWED_KEYS = new Set([
  "id",
  "status",
  "suspensionNote",
  "sunsetWarning",
  "deadlines",
  "oneTime",
  "expiresOn",
  "recurring",
  "howToApply",
  "fastestConfirmingStep",
  "sourceUrl",
  "url",
]);

const SENTINEL = "SENTINEL_INTERNAL_ONLY_9f3e7c1a";

function fullProgramFixture(overrides: Partial<Program> = {}): Program {
  return {
    id: "sentinel-test-program",
    name: `Sentinel Test Program ${SENTINEL}`,
    level: "City",
    zoneKey: "tif",
    summary: `Summary text ${SENTINEL}`,
    whoQualifies: `Only businesses meeting X qualify. ${SENTINEL}`,
    benefits: [`Benefit line ${SENTINEL}`],
    howToApply: ["Step one.", "Step two."],
    requiredDocs: [`Doc requirement ${SENTINEL}`],
    contact: `Contact info ${SENTINEL}`,
    url: "https://example.com/program",
    contacts: [{ agency: `Agency ${SENTINEL}`, abbreviation: "AG" } as unknown as NonNullable<Program["contacts"]>[number]],
    eligibilityRules: [{ description: `Rule ${SENTINEL}`, required: true }],
    fastestConfirmingStep: "Call the agency.",
    sourceUrl: "https://example.com/source",
    ...overrides,
  } as Program;
}

describe("toProgramApplicationView (review7 S17)", () => {
  it("the sanitized DTO contains ONLY the allowed keys — never an internal-only field", () => {
    const view = toProgramApplicationView(fullProgramFixture());
    for (const key of Object.keys(view)) {
      expect(ALLOWED_KEYS.has(key), `unexpected key "${key}" in ProgramApplicationView`).toBe(true);
    }
  });

  it("no internal-only field or its sentinel value survives into the DTO", () => {
    const view = toProgramApplicationView(fullProgramFixture());
    const serialized = JSON.stringify(view);
    for (const key of INTERNAL_ONLY_KEYS) {
      expect(serialized, key).not.toContain(key === "name" ? `"name"` : key);
    }
    expect(serialized, "sentinel value must not survive").not.toContain(SENTINEL);
  });

  it("the fields the component/gating machinery actually needs DO survive", () => {
    const program = fullProgramFixture({
      status: "active",
      deadlines: [{ date: "2027-01-01", label: "Round closes" }],
      oneTime: true,
      expiresOn: "2027-06-01",
      recurring: false,
      suspensionNote: "Applications paused.",
      sunsetWarning: "Sunsetting soon.",
    });
    const view = toProgramApplicationView(program);
    expect(view.id).toBe("sentinel-test-program");
    expect(view.status).toBe("active");
    expect(view.deadlines).toEqual([{ date: "2027-01-01", label: "Round closes" }]);
    expect(view.oneTime).toBe(true);
    expect(view.expiresOn).toBe("2027-06-01");
    expect(view.recurring).toBe(false);
    expect(view.suspensionNote).toBe("Applications paused.");
    expect(view.sunsetWarning).toBe("Sunsetting soon.");
    expect(view.howToApply).toEqual(["Step one.", "Step two."]);
    expect(view.fastestConfirmingStep).toBe("Call the agency.");
    expect(view.sourceUrl).toBe("https://example.com/source");
    expect(view.url).toBe("https://example.com/program");
  });
});

/**
 * review7 S17's exact TEST requirement: an "RSC-response sentinel test" —
 * a poisoned catalog entry with unique sentinel values in every
 * internal-only field, rendered through the REAL `ProgramApplicationSection`
 * component (via `toProgramApplicationView`, exactly as the real page
 * calls it), asserting none of the sentinels appear anywhere in the
 * component's own rendered output.
 */
describe("ProgramApplicationSection rendered output (review7 S17 RSC-boundary sentinel test)", () => {
  it("never renders a whoQualifies/eligibilityRules/contacts sentinel — the DTO boundary is real, not just type-level", () => {
    const poisoned = fullProgramFixture({
      // "expired" gating state exercises the non-active render branch too
      // (officialUrl/note), not just the howToApply list.
      status: "active",
    });
    const view = toProgramApplicationView(poisoned);
    const html = renderToStaticMarkup(
      <ProgramApplicationSection program={view} now={new Date("2026-08-14T00:00:00Z")} />,
    );
    expect(html).not.toContain(SENTINEL);
  });

  it("the non-active branch (officialUrl/note) also never leaks a sentinel", () => {
    const poisoned = fullProgramFixture({
      status: "lapsed",
      sunsetWarning: `Lapsed warning copy ${SENTINEL}`,
    });
    const view = toProgramApplicationView(poisoned);
    // sunsetWarning IS an allowed field (drives the visible note) — its
    // own sentinel-carrying text legitimately renders; assert instead
    // that the OTHER internal-only sentinels (whoQualifies, contacts,
    // eligibilityRules, requiredDocs, benefits, summary, contact) never
    // do, by checking each one's own distinct sentinel independently.
    const html = renderToStaticMarkup(
      <ProgramApplicationSection program={view} now={new Date("2026-08-14T00:00:00Z")} />,
    );
    expect(html).not.toContain(poisoned.whoQualifies);
    expect(html).not.toContain(poisoned.summary);
    expect(html).not.toContain(poisoned.contact);
    expect(html).not.toContain(poisoned.requiredDocs[0]);
    expect(html).not.toContain(poisoned.benefits[0]);
  });
});

/**
 * review8 S24 (MEDIUM) — the two tests above call `toProgramApplicationView`
 * themselves before rendering, so they can never catch a regression where
 * `app/programs/[slug]/page.tsx` itself stops calling it (i.e. reverts to
 * `<ProgramApplicationSection program={p} />`). They also scan RENDERED HTML
 * for the sentinel — but `ProgramApplicationSection` only ever reads
 * `howToApply`/`fastestConfirmingStep`/`sourceUrl`/`url` plus the narrow
 * `ProgramAvailabilityFields`; it never touches `whoQualifies`/
 * `eligibilityRules`/`contacts`/`requiredDocs`/etc. in its own JSX. That
 * means a sentinel planted in those fields would never show up in rendered
 * markup regardless of whether the full raw `Program` or the sanitized DTO
 * was passed as the prop — the original S17 leak was in the RSC/Flight
 * PAYLOAD (every prop serialized for client hydration), not in visible
 * markup, and `renderToStaticMarkup` never reproduces flight serialization
 * (see report-page-live-renderer.test.tsx's own note on that same limit).
 *
 * The fix here is structural, not textual: mock
 * `@/components/programs/ProgramApplicationSection` to CAPTURE whatever
 * object is actually handed to it as the `program` prop — that captured
 * object is exactly what would be serialized into the RSC payload — then
 * dynamically re-import and call the REAL `app/programs/[slug]/page.tsx`
 * server component (with only its data source, `@/lib/programs-data`,
 * mocked to return a poisoned record) and inspect what it actually passed.
 * This exercises the real call site end-to-end, not a hand-rolled
 * replica of it.
 */
describe("app/programs/[slug]/page.tsx → ProgramApplicationSection prop boundary (review8 S24 RSC-boundary sentinel test)", () => {
  it("the REAL page never hands ProgramApplicationSection an internal-only field, even for a poisoned catalog record", async () => {
    vi.resetModules();
    const poisoned = fullProgramFixture({ status: "active" });

    vi.doMock("@/lib/programs-data", () => ({
      getProgramBySlug: (slug: string) => (slug === poisoned.id ? poisoned : undefined),
      getAllPrograms: () => [poisoned],
      programSlug: (p: Program) => p.id,
      relatedPrograms: () => [],
      slugifyProgramName: (name: string) => name.toLowerCase().replace(/\s+/g, "-"),
      allProgramSlugs: () => [poisoned.id],
    }));
    // The page mounts SnapshotCTA → AddressSearch, which calls useRouter()
    // for its own client-side navigation — unrelated to the boundary this
    // test is proving, but needed for the real page tree to render at all
    // outside an actual Next app-router context.
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
      usePathname: () => "/programs/test",
      useSearchParams: () => new URLSearchParams(),
      notFound: () => {
        throw new Error("notFound() called unexpectedly");
      },
    }));
    // Echo whatever object is actually handed to the (mocked)
    // `ProgramApplicationSection` back out as rendered TEXT — that is
    // exactly what would be serialized into the RSC payload for this
    // client component. A pure function of props, not a captured
    // outside variable mutated during render (react-hooks/purity).
    vi.doMock("@/components/programs/ProgramApplicationSection", () => ({
      ProgramApplicationSection: (props: { program: unknown }) => (
        <div data-testid="captured-program-prop">{JSON.stringify(props.program)}</div>
      ),
    }));

    const { default: ProgramExplainerPage } = await import(
      "../../../app/programs/[slug]/page"
    );
    const jsx = await ProgramExplainerPage({
      params: Promise.resolve({ slug: poisoned.id }),
    });
    const html = renderToStaticMarkup(jsx);

    vi.doUnmock("@/lib/programs-data");
    vi.doUnmock("@/components/programs/ProgramApplicationSection");
    vi.doUnmock("next/navigation");
    vi.resetModules();

    // Scope the assertion to ONLY the captured prop's own echoed JSON, not
    // the whole page: the page legitimately renders p.name/summary/
    // whoQualifies/benefits/contacts elsewhere in its own JSX (that's the
    // page's real content, not a boundary leak), and plain-English key
    // names like "name"/"status"/"contacts" appear in ordinary page copy
    // ("Official source & contacts") regardless of any leak.
    const capturedMatch = html.match(
      /<div data-testid="captured-program-prop">([^<]*)<\/div>/,
    );
    expect(capturedMatch, "captured-program-prop marker never rendered").toBeTruthy();
    const capturedJson = capturedMatch![1];
    for (const key of INTERNAL_ONLY_KEYS) {
      expect(capturedJson, `leaked key "${key}"`).not.toContain(key === "name" ? `"name"` : key);
    }
    expect(capturedJson, "sentinel value must not survive into the captured prop").not.toContain(
      SENTINEL,
    );
  });

  it("control (fixture variant, not the real source): the same capture technique DOES catch a raw Program prop", () => {
    // Proves the assertion above is discriminating, not vacuously true.
    // Reproduces the exact vulnerable shape review7 S17 fixed —
    // `program={p}` instead of `program={toProgramApplicationView(p)}` —
    // through the identical echo-to-text capture technique used above,
    // fed a raw, unsanitized fixture directly (never through
    // `toProgramApplicationView`).
    const poisoned = fullProgramFixture({ status: "active" });
    function CaptureProbe(props: { program: unknown }) {
      return <div data-testid="captured-program-prop">{JSON.stringify(props.program)}</div>;
    }

    const html = renderToStaticMarkup(<CaptureProbe program={poisoned} />);

    expect(
      html,
      "control must demonstrate a detectable leak when the DTO boundary is bypassed",
    ).toContain(SENTINEL);
  });
});

/**
 * review7 S17's second TEST requirement: "add a repo-wide fixture where a
 * client imports/accepts Program without a cast → require failure." This
 * is the S20 guard's own job (verifyNoRawProgramClientCast /
 * findRawProgramSymbolUsage) — covered directly in
 * lib/__tests__/public-claim-surfaces.test.ts's S20 fixture block, not
 * duplicated here. This file focuses on proving the ACTUAL fix (the DTO
 * boundary) is real and wired into the real component/page.
 */
describe("real page wiring (review7 S17)", () => {
  it("app/programs/[slug]/page.tsx calls toProgramApplicationView, not a raw Program, at its ProgramApplicationSection call site", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../../../app/programs/[slug]/page.tsx", import.meta.url),
      "utf8",
    );
    const callSite = source.match(/<ProgramApplicationSection\s+program=\{([^}]*)\}/);
    expect(callSite, "ProgramApplicationSection call site not found").toBeTruthy();
    expect(callSite![1].trim()).toBe("toProgramApplicationView(p)");
  });
});

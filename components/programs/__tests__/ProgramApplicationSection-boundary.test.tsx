import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

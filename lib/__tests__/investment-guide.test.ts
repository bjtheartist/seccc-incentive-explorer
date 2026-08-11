import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIRST_VISIT_GUIDE_STORAGE_KEY,
} from "@/lib/first-visit-guide";
import {
  INVESTMENT_GUIDE_STORAGE_KEY,
  INVESTMENT_GUIDE_VERSION,
  INVESTMENT_TOUR_STEPS,
  readInvestmentGuidePreference,
  writeInvestmentGuidePreference,
} from "@/lib/investment-guide";

function memoryStorage(initial: Record<string, string> = {}) {
  const values: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, next: string) => {
      values[key] = next;
    },
    snapshot: () => ({ ...values }),
  };
}

describe("investment guide storage key isolation", () => {
  it("uses a key wholly separate from the public tour's key", () => {
    expect(INVESTMENT_GUIDE_STORAGE_KEY).not.toBe(FIRST_VISIT_GUIDE_STORAGE_KEY);
    expect(INVESTMENT_GUIDE_STORAGE_KEY).toBe("cie:investment-guide");
  });

  it("completing the investment tour never writes the public tour's key", () => {
    const storage = memoryStorage();
    writeInvestmentGuidePreference(storage, "completed");

    expect(storage.snapshot()[INVESTMENT_GUIDE_STORAGE_KEY]).toBeDefined();
    expect(storage.snapshot()[FIRST_VISIT_GUIDE_STORAGE_KEY]).toBeUndefined();
  });

  it("skipping the investment tour never writes the public tour's key either", () => {
    const storage = memoryStorage();
    writeInvestmentGuidePreference(storage, "skipped");

    expect(storage.snapshot()[INVESTMENT_GUIDE_STORAGE_KEY]).toBeDefined();
    expect(storage.snapshot()[FIRST_VISIT_GUIDE_STORAGE_KEY]).toBeUndefined();
  });

  it("a pre-existing public-tour preference is untouched by reading or writing the investment key", () => {
    const storage = memoryStorage({
      [FIRST_VISIT_GUIDE_STORAGE_KEY]: JSON.stringify({
        version: 1,
        status: "completed",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    });

    expect(readInvestmentGuidePreference(storage)).toBeNull();
    writeInvestmentGuidePreference(storage, "completed");
    expect(JSON.parse(storage.snapshot()[FIRST_VISIT_GUIDE_STORAGE_KEY])).toEqual({
      version: 1,
      status: "completed",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
  });
});

describe("investment guide preference", () => {
  it("persists a versioned completion", () => {
    const storage = memoryStorage();
    const preference = writeInvestmentGuidePreference(storage, "completed");

    expect(preference.version).toBe(INVESTMENT_GUIDE_VERSION);
    expect(preference.status).toBe("completed");
    expect(JSON.parse(storage.snapshot()[INVESTMENT_GUIDE_STORAGE_KEY])).toEqual(preference);
  });

  it("recognizes completed and skipped preferences for the current version", () => {
    for (const status of ["completed", "skipped"] as const) {
      const storage = memoryStorage({
        [INVESTMENT_GUIDE_STORAGE_KEY]: JSON.stringify({
          version: INVESTMENT_GUIDE_VERSION,
          status,
          updatedAt: "2026-08-11T12:00:00.000Z",
        }),
      });
      expect(readInvestmentGuidePreference(storage)?.status).toBe(status);
    }
  });

  it("reopens after a version change and tolerates malformed or blocked storage", () => {
    const old = memoryStorage({
      [INVESTMENT_GUIDE_STORAGE_KEY]: JSON.stringify({
        version: INVESTMENT_GUIDE_VERSION - 1,
        status: "completed",
        updatedAt: "x",
      }),
    });
    expect(readInvestmentGuidePreference(old)).toBeNull();
    expect(
      readInvestmentGuidePreference(memoryStorage({ [INVESTMENT_GUIDE_STORAGE_KEY]: "not-json" })),
    ).toBeNull();
    expect(
      readInvestmentGuidePreference({
        getItem() {
          throw new Error("storage blocked");
        },
      }),
    ).toBeNull();
  });
});

const investmentPageSource = readFileSync(
  new URL("../../app/investment/page.tsx", import.meta.url),
  "utf8",
);
const communityRankingSource = readFileSync(
  new URL("../../components/investment/CommunityRankingList.tsx", import.meta.url),
  "utf8",
);
const pinControlsSource = readFileSync(
  new URL("../../components/investment/PinControls.tsx", import.meta.url),
  "utf8",
);

describe("investment tour step definitions", () => {
  it("defines six unique, source-honest steps", () => {
    expect(INVESTMENT_TOUR_STEPS).toHaveLength(6);
    expect(new Set(INVESTMENT_TOUR_STEPS.map((step) => step.key)).size).toBe(6);
    expect(new Set(INVESTMENT_TOUR_STEPS.map((step) => step.selector)).size).toBe(6);
  });

  it("anchors every data-tour selector to an attribute that actually exists on the page", () => {
    // Canary test: every step whose selector is a bare `[data-tour="..."]`
    // hook must find that literal attribute in app/investment/page.tsx —
    // the only file in this change's fence that may carry it.
    for (const step of INVESTMENT_TOUR_STEPS) {
      const match = /^\[data-tour="([^"]+)"\]$/.exec(step.selector);
      if (!match) continue;
      expect(investmentPageSource, step.key).toContain(`data-tour="${match[1]}"`);
    }
  });

  it("scopes the pin-button and filter-box selectors under a real data-tour hook", () => {
    // These two steps ride a compound selector instead of their own
    // data-tour attribute: CommunityRankingList.tsx and PinControls.tsx
    // render the filter input and the per-row pin button, and neither file
    // is in this change's edit fence. Prove the compound selector still
    // resolves to something real: the base hook exists on the page, and the
    // structural fragment (aria-pressed / type="search") still exists in the
    // component that renders it.
    const pinStep = INVESTMENT_TOUR_STEPS.find((step) => step.key === "pin-button");
    if (!pinStep) throw new Error("pin-button step missing");
    expect(pinStep.selector).toContain('[data-tour="investment-community-ranking"]');
    expect(investmentPageSource).toContain('data-tour="investment-community-ranking"');
    expect(pinControlsSource).toContain("aria-pressed");

    expect(communityRankingSource).toContain('type="search"');
  });

  it("keeps the ranking step's target as the section that contains the filter box", () => {
    const rankingStep = INVESTMENT_TOUR_STEPS.find((step) => step.key === "community-ranking");
    expect(rankingStep?.selector).toBe('[data-tour="investment-community-ranking"]');
  });
});

/** Every string the tour renders, labelled so a failure names the offending field. */
function tourCopyFields(): Array<[string, string]> {
  return INVESTMENT_TOUR_STEPS.flatMap((step): Array<[string, string]> => [
    [`${step.key}.title`, step.title],
    [`${step.key}.description`, step.description],
  ]);
}

describe("investment tour copy boundaries", () => {
  it("carries no hardcoded dataset totals, dollar figures, or record counts", () => {
    // Same falsifiable ban as the public tour's guard: any digit anywhere in
    // frozen tour copy goes stale the moment the underlying data refreshes.
    // Improved over the original pattern by also rejecting spelled-out
    // magnitude words and symbol-only quantities that a plain \d test can
    // miss if a future edit swaps a digit for a word or a symbol (e.g. "a
    // dozen communities", "$$", "%") — the intent is "no quantity claims",
    // not just "no digit characters".
    const bannedQuantityWords =
      /\b(dozen|hundred|thousand|million|billion|percent)\b|[$%]|\d/i;
    for (const [field, text] of tourCopyFields()) {
      expect(text, field).not.toMatch(bannedQuantityWords);
    }
  });

  it("never promises an outcome the page cannot give", () => {
    for (const [field, text] of tourCopyFields()) {
      expect(text, field).not.toMatch(
        /official determination|guarantee|pre-?approv|you qualify|confirmed receipt/i,
      );
    }
  });

  it("names only the compare cap the product actually enforces (two to four)", () => {
    const pinStep = INVESTMENT_TOUR_STEPS.find((step) => step.key === "pin-button");
    expect(pinStep?.description).toMatch(/two and four/i);
    expect(pinStep?.description).not.toMatch(/\d/);
  });

  it("only claims the printable brief and full profile that the start-here copy already promises", () => {
    const aboutData = INVESTMENT_TOUR_STEPS.find((step) => step.key === "about-data");
    expect(aboutData?.description).toMatch(/full funding profile/i);
    expect(aboutData?.description).toMatch(/print brief/i);
    // The claim must be checkable against the page's own copy, not invented.
    expect(investmentPageSource).toContain("Print brief");
  });
});

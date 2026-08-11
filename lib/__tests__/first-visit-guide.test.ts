import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIRST_VISIT_GUIDE_STEPS,
  FIRST_VISIT_GUIDE_STORAGE_KEY,
  FIRST_VISIT_GUIDE_VERSION,
  SAMPLE_REPORT_URL,
  SPOTLIGHT_HOME_STEPS,
  SPOTLIGHT_REPORT_STEPS,
  readFirstVisitGuidePreference,
  shouldAutoOpenFirstVisitGuide,
  writeFirstVisitGuidePreference,
} from "@/lib/first-visit-guide";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => (key === FIRST_VISIT_GUIDE_STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === FIRST_VISIT_GUIDE_STORAGE_KEY) value = next;
    },
    current: () => value,
  };
}

describe("first visit guide preference", () => {
  it("persists a versioned completion without collecting identity", () => {
    const storage = memoryStorage();
    const preference = writeFirstVisitGuidePreference(storage, "completed");

    expect(preference.version).toBe(FIRST_VISIT_GUIDE_VERSION);
    expect(preference.status).toBe("completed");
    expect(JSON.parse(storage.current() || "{}")).toEqual(preference);
    expect(storage.current()).not.toContain("email");
  });

  it("recognizes completed and skipped preferences for the current version", () => {
    for (const status of ["completed", "skipped"] as const) {
      const storage = memoryStorage(
        JSON.stringify({
          version: FIRST_VISIT_GUIDE_VERSION,
          status,
          updatedAt: "2026-08-08T12:00:00.000Z",
        }),
      );
      expect(readFirstVisitGuidePreference(storage)?.status).toBe(status);
    }
  });

  it("reopens after a version change and tolerates malformed or blocked storage", () => {
    const old = memoryStorage(
      JSON.stringify({ version: FIRST_VISIT_GUIDE_VERSION - 1, status: "completed", updatedAt: "x" }),
    );
    expect(readFirstVisitGuidePreference(old)).toBeNull();
    expect(readFirstVisitGuidePreference(memoryStorage("not-json"))).toBeNull();
    expect(
      readFirstVisitGuidePreference({
        getItem() {
          throw new Error("storage blocked");
        },
      }),
    ).toBeNull();
  });
});

describe("first visit guide placement", () => {
  it("auto-opens on public discovery routes", () => {
    for (const pathname of ["/", "/map", "/programs", "/vacancy/60617/cases"]) {
      expect(shouldAutoOpenFirstVisitGuide(pathname)).toBe(true);
    }
  });

  it("stays out of learning, reports, authentication, workspaces, and admin tools", () => {
    for (const pathname of ["/learn", "/report", "/report/abc", "/login", "/workspace/projects/1", "/admin"]) {
      expect(shouldAutoOpenFirstVisitGuide(pathname)).toBe(false);
    }
  });

  it("provides a stable media key for each future walkthrough segment", () => {
    expect(FIRST_VISIT_GUIDE_STEPS).toHaveLength(4);
    expect(new Set(FIRST_VISIT_GUIDE_STEPS.map((step) => step.walkthroughKey)).size).toBe(4);
  });

  it("defines unique, source-honest targets for the live spotlight tour", () => {
    const allSteps = [...SPOTLIGHT_HOME_STEPS, ...SPOTLIGHT_REPORT_STEPS];
    expect(allSteps).toHaveLength(6);
    expect(new Set(allSteps.map((step) => step.key)).size).toBe(6);
    expect(new Set(allSteps.map((step) => step.selector)).size).toBe(6);

    const copy = allSteps.map((step) => step.description).join(" ");
    expect(copy).toContain("public records");
    expect(copy).toContain("not eligibility determinations");
    expect(copy).toContain("verification links");
  });
});

/** Every string either tour renders, labelled so a failure names the offending field. */
function tourCopyFields(): Array<[string, string]> {
  return [
    ...[...SPOTLIGHT_HOME_STEPS, ...SPOTLIGHT_REPORT_STEPS].flatMap(
      (step): Array<[string, string]> => [
        [`spotlight.${step.key}.title`, step.title],
        [`spotlight.${step.key}.description`, step.description],
      ],
    ),
    ...FIRST_VISIT_GUIDE_STEPS.flatMap(
      (step): Array<[string, string]> => [
        [`guide.${step.walkthroughKey}.eyebrow`, step.eyebrow],
        [`guide.${step.walkthroughKey}.title`, step.title],
        [`guide.${step.walkthroughKey}.description`, step.description],
        [`guide.${step.walkthroughKey}.takeaway`, step.takeaway],
      ],
    ),
  ];
}

describe("first visit tour copy boundaries", () => {
  it("carries no hardcoded program, investment, or vacancy totals", () => {
    // Totals move with every data refresh, and this copy ships as a frozen constant, so
    // any digit in it goes stale silently. Banning digits outright is what makes the
    // guard falsifiable: a phrasing check ("N programs") misses "24 incentive programs",
    // "$3.1B", and "20+", which are the drifts actually worth catching. Spell small
    // counts out instead, the way "up to three goals" already does.
    for (const [field, text] of tourCopyFields()) {
      expect(text, field).not.toMatch(/\d/);
    }
  });

  it("never promises an outcome the Explorer cannot give", () => {
    for (const [field, text] of tourCopyFields()) {
      expect(text, field).not.toMatch(/official determination|guarantee|pre-?approv|you qualify/i);
    }
  });

  it("names only the inputs the highlighted address search can resolve", () => {
    // The first stop highlights <AddressSearch />, which resolves a street address or a
    // business name. Naming a PIN, parcel, or ward walks the visitor into its
    // "Address not found." error by following the tour's own instruction.
    const [addressStep] = SPOTLIGHT_HOME_STEPS;
    expect(`${addressStep.title} ${addressStep.description}`).not.toMatch(
      /\bPINs?\b|parcel (number|id)|\bward\b/i,
    );
  });
});

describe("spotlight load failure", () => {
  it("does not persist a guide preference when driver.js fails to load", () => {
    // A failed dynamic import is a load failure, not a dismissal. Persisting a "skipped"
    // preference there suppresses the welcome guide on that browser permanently, with no
    // error shown, so the failure path must leave storage untouched. Asserted against the
    // source because the failure is a chunk-load race no unit render can reproduce.
    const source = readFileSync(
      new URL("../../components/onboarding/FirstVisitSpotlight.tsx", import.meta.url),
      "utf8",
    );
    // Scoped to the catch that guards the dynamic import; earlier catches in the file
    // handle session storage and are allowed to stay silent.
    const [, afterImport] = source.split('await import("driver.js")');
    if (!afterImport) throw new Error("FirstVisitSpotlight no longer imports driver.js lazily");

    const failurePath = /\}\s*catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\n {4}\}/.exec(afterImport);
    if (!failurePath) throw new Error("FirstVisitSpotlight no longer catches a start failure");

    expect(failurePath[1]).not.toContain("recordOutcome(");
    expect(failurePath[1]).not.toContain("writeFirstVisitGuidePreference(");
  });
});

const globalsCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

/**
 * The rgba ink of a spotlight popover rule, composited over the popover background.
 * driver.js paints the popover #fff and app/globals.css overrides only the foreground,
 * so white is the real backdrop for these tokens.
 */
function popoverInkContrastOnWhite(className: string) {
  const rule = new RegExp(String.raw`\.cie-driver-popover \.${className}\s*\{([^}]*)\}`).exec(
    globalsCss,
  );
  if (!rule) throw new Error(`app/globals.css no longer styles .${className}`);

  const ink = /color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rule[1]);
  if (!ink) throw new Error(`.${className} no longer sets an rgba color; update this guard`);

  const alpha = Number(ink[4]);
  const channels = [Number(ink[1]), Number(ink[2]), Number(ink[3])].map(
    (channel) => (channel * alpha + 255 * (1 - alpha)) / 255,
  );
  const weights = [0.2126, 0.7152, 0.0722];
  const luminance = channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * weights[index];
  }, 0);

  return 1.05 / (luminance + 0.05);
}

describe("spotlight popover legibility", () => {
  it("keeps overridden popover text and controls at or above WCAG AA", () => {
    // driver.js ships #727272 progress text (4.81:1). The bureau override replaced it
    // with a lighter ink, which is a regression the override introduced rather than an
    // inherited one, so hold the override to the same bar: 4.5:1 for the 9px progress
    // text (1.4.3) and for the close button, which is the only in-popover dismiss.
    expect(popoverInkContrastOnWhite("driver-popover-progress-text")).toBeGreaterThanOrEqual(4.5);
    expect(popoverInkContrastOnWhite("driver-popover-close-btn")).toBeGreaterThanOrEqual(4.5);
    expect(popoverInkContrastOnWhite("driver-popover-description")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the sample handoff inside the tour's no-email promise", () => {
    expect(SAMPLE_REPORT_URL).toContain("source=welcome_tour");
    expect(SAMPLE_REPORT_URL).toContain("instant=true");
  });
});

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { renderToStaticMarkup } from "react-dom/server";

import LearnPage, { metadata } from "../learn/page";
import sitemap from "../sitemap";
import FAQPage from "../faq/page";
import ProgramsCatalog from "@/components/programs/ProgramsCatalog";
import { LEARNING_LESSONS, LEARNING_MODULES } from "@/lib/learning-pathway";

/**
 * Render tests for the Learning Pathway, per CLAUDE.md's rule that a
 * user-visible claim needs a test that reaches the behavior through the
 * real entry point. Everything asserted here is asserted against the page
 * component the route actually renders — not against the lesson data, and
 * not by grepping source.
 */

/** A localStorage double we can inspect, break, and pre-seed. */
function installStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const mock = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn(() => null),
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
  return { mock, store };
}

const STORAGE_KEY = "cie:learning-pathway:checks:v1";
const CELEBRATION_KEY = "cie:learning-pathway:celebrated:v1";

/** Every lesson answered — the state that unlocks the completion panel. */
function allTwelveAnswered(): string {
  const answers: Record<string, string> = {};
  for (const lesson of LEARNING_LESSONS) {
    answers[lesson.id] = lesson.check.options.find((o) => o.correct)!.key;
  }
  return JSON.stringify(answers);
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("/learn renders the whole pathway in one page", () => {
  it("shows all three module headings and all twelve lesson titles", () => {
    render(<LearnPage />);

    for (const learningModule of LEARNING_MODULES) {
      expect(
        screen.getByRole("heading", { name: learningModule.title }),
        `module heading: ${learningModule.title}`,
      ).toBeTruthy();
    }

    expect(LEARNING_LESSONS).toHaveLength(12);
    for (const lesson of LEARNING_LESSONS) {
      expect(
        screen.getByRole("heading", { name: lesson.title }),
        `lesson heading: ${lesson.title}`,
      ).toBeTruthy();
    }
  });

  it("gives every lesson a deep-linkable id and every module a tab", () => {
    const { container } = render(<LearnPage />);

    for (const lesson of LEARNING_LESSONS) {
      expect(container.querySelector(`#${lesson.id}`), lesson.id).toBeTruthy();
    }

    const nav = screen.getByRole("navigation", { name: /pathway modules/i });
    for (const learningModule of LEARNING_MODULES) {
      const tab = within(nav).getByRole("link", { name: learningModule.navLabel });
      expect(tab.getAttribute("href")).toBe(`#${learningModule.id}`);
      expect(container.querySelector(`#${learningModule.id}`)).toBeTruthy();
    }
  });

  it("carries no second header and no iframe — the reason the page was rebuilt", () => {
    const { container } = render(<LearnPage />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByText(/Return to report/i)).toBeNull();
  });

  it("keeps the closing CTA that turns the lessons into a site-specific start", () => {
    render(<LearnPage />);
    const cta = screen.getByRole("link", { name: /run an address report/i });
    expect(cta.getAttribute("href")).toBe("/report");
  });
});

describe("the twelve checks and the progress count", () => {
  it("starts at zero and counts up when a lesson is checked", () => {
    render(<LearnPage />);
    expect(screen.getByText("0 of 12 checks complete")).toBeTruthy();

    const first = LEARNING_LESSONS[0];
    fireEvent.click(screen.getByRole("button", { name: /A.*Department of Buildings, before anything else/ }));

    expect(screen.getByText("1 of 12 checks complete")).toBeTruthy();
    // The explanation is revealed whichever option was picked.
    expect(
      screen.getByText(/There is no separate zoning certificate to obtain/),
    ).toBeTruthy();
    expect(first.id).toBe("zoning-is-not-a-form");
  });

  it("writes the answer to localStorage and restores it on a later render", () => {
    const { mock, store } = installStorage();

    render(<LearnPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /B.*Inside the business license application/ }),
    );
    expect(screen.getByText("1 of 12 checks complete")).toBeTruthy();

    expect(mock.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toEqual({
      "zoning-is-not-a-form": "B",
    });

    // Fresh render, same visitor: the count and the revealed answer return.
    cleanup();
    render(<LearnPage />);
    expect(screen.getByText("1 of 12 checks complete")).toBeTruthy();
    expect(
      screen.getByText(/There is no separate zoning certificate to obtain/),
    ).toBeTruthy();
  });

  it("degrades to no progress when localStorage throws instead of failing to render", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("site data blocked");
      },
    });

    render(<LearnPage />);
    expect(screen.getByText("0 of 12 checks complete")).toBeTruthy();
    expect(screen.getByRole("heading", { name: LEARNING_LESSONS[0].title })).toBeTruthy();

    // Answering still works in-session; only persistence is lost.
    fireEvent.click(
      screen.getByRole("button", { name: /B.*Inside the business license application/ }),
    );
    expect(screen.getByText("1 of 12 checks complete")).toBeTruthy();
  });

  it("ignores stored entries that are not real lessons or real options", () => {
    installStorage({
      [STORAGE_KEY]: JSON.stringify({
        "zoning-is-not-a-form": "B",
        "a-lesson-that-does-not-exist": "A",
        "read-the-table": "Z",
      }),
    });

    render(<LearnPage />);
    expect(screen.getByText("1 of 12 checks complete")).toBeTruthy();
  });
});

describe("the completion state", () => {
  it("is absent until all twelve checks are answered", () => {
    installStorage({
      [STORAGE_KEY]: JSON.stringify({ "zoning-is-not-a-form": "B" }),
    });
    render(<LearnPage />);

    expect(screen.queryByText(/Pathway complete/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /take the incentive quiz/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /explore the map/i })).toBeNull();
  });

  it("appears after the twelfth check with both next steps", () => {
    installStorage({ [STORAGE_KEY]: allTwelveAnswered() });
    render(<LearnPage />);

    expect(screen.getByText("12 of 12 checks complete")).toBeTruthy();
    expect(screen.getByText(/Pathway complete/i)).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /All 12 checks answered/i }),
    ).toBeTruthy();

    expect(
      screen.getByRole("link", { name: /take the incentive quiz/i }).getAttribute("href"),
    ).toBe("/quiz");
    expect(
      screen.getByRole("link", { name: /explore the map/i }).getAttribute("href"),
    ).toBe("/map");
  });

  it("appears when the visitor answers the twelfth check in-session", () => {
    const seeded: Record<string, string> = {};
    for (const lesson of LEARNING_LESSONS.slice(0, 11)) {
      seeded[lesson.id] = lesson.check.options.find((o) => o.correct)!.key;
    }
    installStorage({ [STORAGE_KEY]: JSON.stringify(seeded) });

    render(<LearnPage />);
    expect(screen.getByText("11 of 12 checks complete")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /take the incentive quiz/i })).toBeNull();

    const last = LEARNING_LESSONS[11];
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(last.check.options[0].text) }),
    );

    expect(screen.getByText("12 of 12 checks complete")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /take the incentive quiz/i }).getAttribute("href"),
    ).toBe("/quiz");
    expect(
      screen.getByRole("link", { name: /explore the map/i }).getAttribute("href"),
    ).toBe("/map");
  });
});

describe("the skyline celebration", () => {
  /** Seed eleven of twelve, so one click completes the pathway. */
  function seedEleven(): Record<string, string> {
    const seeded: Record<string, string> = {};
    for (const lesson of LEARNING_LESSONS.slice(0, 11)) {
      seeded[lesson.id] = lesson.check.options.find((o) => o.correct)!.key;
    }
    return seeded;
  }

  function answerTwelfth() {
    const last = LEARNING_LESSONS[11];
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(last.check.options[0].text) }),
    );
  }

  function installMatchMedia(prefersReducedMotion: boolean) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: prefersReducedMotion && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  beforeEach(() => {
    installMatchMedia(false);
  });

  it("pops up when the twelfth check is answered in-session", () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify(seedEleven()) });
    render(<LearnPage />);

    expect(screen.queryByRole("dialog")).toBeNull();

    answerTwelfth();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("skyline-celebration-title");
    expect(
      within(dialog).getByRole("heading", { name: "You made it to the top." }),
    ).toBeTruthy();
    expect(within(dialog).getByText("All twelve lessons, done.")).toBeTruthy();
    // Focus is on the close control, not left behind on the lesson option.
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: /close/i }),
    );
    // The page's own completion state stays underneath, unblocked.
    expect(
      screen.getByRole("link", { name: /take the incentive quiz/i }).getAttribute("href"),
    ).toBe("/quiz");
  });

  it("does not pop up on a page load that already has all twelve stored", () => {
    const { store } = installStorage({ [STORAGE_KEY]: allTwelveAnswered() });
    render(<LearnPage />);

    expect(screen.getByText("12 of 12 checks complete")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Arriving finished silently claims the flag, so a later re-render
    // cannot surface it either.
    expect(store.get(CELEBRATION_KEY)).toBe("1");
  });

  it("unmounts on close and records that it was shown", () => {
    const { store } = installStorage({ [STORAGE_KEY]: JSON.stringify(seedEleven()) });
    render(<LearnPage />);
    answerTwelfth();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(store.get(CELEBRATION_KEY)).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.get(CELEBRATION_KEY)).toBe("1");
  });

  it("also dismisses on Escape and on a click outside the card", () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify(seedEleven()) });
    const { unmount } = render(<LearnPage />);
    answerTwelfth();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    installStorage({ [STORAGE_KEY]: JSON.stringify(seedEleven()) });
    render(<LearnPage />);
    answerTwelfth();
    fireEvent.mouseDown(screen.getByTestId("skyline-celebration-overlay"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("re-arms after a progress reset, and animates only when motion is welcome", () => {
    // A visitor who arrives part-way through has had the flag cleared, so
    // finishing again earns the card again.
    const { store } = installStorage({
      [STORAGE_KEY]: JSON.stringify(seedEleven()),
      [CELEBRATION_KEY]: "1",
    });
    render(<LearnPage />);
    expect(store.get(CELEBRATION_KEY)).toBeUndefined();

    answerTwelfth();
    expect(screen.getByRole("dialog").className).toContain("skyline-anim");
  });

  it("renders the finished skyline with no animating class under reduced motion", () => {
    installMatchMedia(true);
    installStorage({ [STORAGE_KEY]: JSON.stringify(seedEleven()) });
    render(<LearnPage />);
    answerTwelfth();

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).not.toContain("skyline-anim");
    // Still a skyline: the buildings render, they just do not move.
    expect(dialog.querySelectorAll("polygon.skyline-building, .skyline-building").length)
      .toBeGreaterThan(0);
  });
});

describe("the page stays unlisted", () => {
  it("tells crawlers not to index or follow it", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe("Learning Pathway");
  });

  it("is absent from the sitemap", () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.filter((entry) => /\/learn(\/|$|\?)/.test(entry.url)),
    ).toHaveLength(0);
  });
});
describe("the two entry points", () => {
  it("the FAQ's 'Still have questions?' card ends with the Learning Pathway button", () => {
    render(<FAQPage />);
    const link = screen.getByRole("link", { name: /Learning Pathway/i });
    expect(link.getAttribute("href")).toBe("/learn");
    // A button, not the page's primary CTA: outlined pill, no icon, and
    // the Call Us block above it keeps the solid navy treatment.
    expect(link.className).toContain("rounded-full");
    expect(link.className).toContain("border");
    expect(link.querySelector("svg")).toBeNull();
    expect(
      screen.getByText("Twelve short lessons on zoning, permits, and licenses."),
    ).toBeTruthy();
  });

  it("the program directory carries the same button beneath the quiz card", () => {
    const html = renderToStaticMarkup(
      <ProgramsCatalog initialNowIso="2026-08-10T12:00:00.000Z" />,
    );
    expect(html).toContain('href="/learn"');
    expect(html).toContain("Learning Pathway");
    expect(html).toContain("Twelve short lessons on zoning, permits, and licenses.");
  });
});

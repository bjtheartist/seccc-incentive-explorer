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
describe("the two quiet entry points", () => {
  it("the FAQ's 'Still have questions?' card ends with the one muted line", () => {
    render(<FAQPage />);
    const link = screen.getByRole("link", { name: /There's a longer answer\./ });
    expect(link.getAttribute("href")).toBe("/learn");
    // Not navigation: plain text, no button role, no icon.
    expect(link.tagName).toBe("A");
    expect(link.querySelector("svg")).toBeNull();
  });

  it("the program directory carries the same line beneath the quiz card", () => {
    const html = renderToStaticMarkup(
      <ProgramsCatalog initialNowIso="2026-08-10T12:00:00.000Z" />,
    );
    expect(html).toContain('href="/learn"');
    expect(html).toContain("There&#x27;s a longer answer.");
  });
});

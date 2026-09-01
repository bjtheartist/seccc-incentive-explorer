// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync } from "node:fs";
import path from "node:path";

import SegmentError from "../error";
import GlobalError from "../global-error";

/**
 * R1 finding 2 — error boundaries.
 *
 * Before this change the repository contained ZERO error.tsx,
 * global-error.tsx, or ErrorBoundary of any kind. An uncaught render error
 * anywhere in the app fell through to Next's own built-in screen: a stack
 * trace in development, an unbranded "something went wrong" in production,
 * with no retry and no way back.
 *
 * These are minimal by design — a boundary that is itself elaborate is a
 * boundary that can fail — so what is worth pinning is the CONTRACT: both
 * files exist, both are client components (they take `reset`, which only
 * exists on the client), the copy is honest and does not blame the reader,
 * and the retry really calls `reset`.
 */

const REPO_ROOT = path.join(__dirname, "..", "..");

function boom(): Error & { digest?: string } {
  return Object.assign(new Error("kaboom"), { digest: "abc123" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the boundaries exist at all — the gap this finding names", () => {
  it("app/error.tsx and app/global-error.tsx are both present", () => {
    expect(existsSync(path.join(REPO_ROOT, "app", "error.tsx"))).toBe(true);
    expect(existsSync(path.join(REPO_ROOT, "app", "global-error.tsx"))).toBe(true);
  });
});

describe("app/error.tsx — the route-segment boundary", () => {
  it("states the failure honestly, without blaming the reader", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SegmentError error={boom()} reset={() => {}} />);

    expect(screen.getByText(/This page didn.t load/)).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).toContain("Nothing you did caused it");
    expect(body).toContain("nothing you entered was lost");
    // Never a finding, never eligibility-shaped, never a raw internal message.
    expect(body).not.toMatch(/eligib|qualif/i);
    expect(body).not.toContain("kaboom");
  });

  it("surfaces the digest as a reference the reader can quote, not as a stack trace", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SegmentError error={boom()} reset={() => {}} />);
    expect(document.body.textContent).toContain("Reference abc123");
  });

  it("omits the reference line entirely when there is no digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SegmentError error={new Error("no digest")} reset={() => {}} />);
    expect(document.body.textContent).not.toContain("Reference");
  });

  it("the retry button actually calls reset — the way forward is real", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<SegmentError error={boom()} reset={reset} />);

    fireEvent.click(screen.getByText("Try again"));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("logs the real error for engineering while showing the reader the honest copy", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SegmentError error={boom()} reset={() => {}} />);
    expect(spy).toHaveBeenCalled();
  });

  it("always leaves a link out of the failed segment", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SegmentError error={boom()} reset={() => {}} />);
    const link = screen.getByText("Back to the start").closest("a");
    expect(link?.getAttribute("href")).toBe("/");
  });
});

describe("app/global-error.tsx — the root boundary", () => {
  /**
   * This one replaces the whole document, so its markup is asserted through a
   * static render: jsdom relocates a nested <html>/<body> when mounted, which
   * would hide exactly the structure that matters here.
   */
  function markup(reset = () => {}): string {
    return renderToStaticMarkup(<GlobalError error={boom()} reset={reset} />);
  }

  it("supplies its own html and body, because the failed root layout cannot", () => {
    const html = markup();
    expect(html).toContain("<html");
    expect(html).toContain("<body");
  });

  it("styles itself inline — it must render with no stylesheet and no webfont", () => {
    const html = markup();
    expect(html).toMatch(/<body[^>]*style="[^"]*background/);
    // A class-based style would depend on globals.css, which is exactly what
    // may have failed to load.
    expect(html).not.toContain("class=");
  });

  it("states the failure honestly and never blames the reader", () => {
    const html = markup();
    expect(html).toContain("The Explorer didn");
    expect(html).toContain("Nothing you did caused it");
    expect(html).toContain("nothing you entered was lost");
    expect(html).not.toContain("kaboom");
    expect(html).not.toMatch(/eligib|qualif/i);
  });

  it("offers a plain anchor home — it cannot rely on the router either", () => {
    const html = markup();
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to the start");
  });

  it("its retry button calls reset — the way forward is real", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<GlobalError error={boom()} reset={reset} />);
    fireEvent.click(screen.getByText("Try again"));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

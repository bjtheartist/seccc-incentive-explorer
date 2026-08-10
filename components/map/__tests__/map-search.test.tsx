import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import MapSearch from "../MapSearch";

/**
 * Cover for the map search dropdown's mobile-tap path — and, alongside it, an
 * explicit statement of what this file does NOT observe, because a good half of
 * it is not a render test.
 *
 * WHAT IS COVERED, and it is worth being exact about which is which:
 *
 *   - First paint, asserted against actual rendered markup: the wrapper's own
 *     classes, and the absence of the results container before any search has
 *     resolved.
 *
 *   - The OPENED dropdown, also asserted against actual rendered markup. The
 *     list is gated on `open && results.length > 0`, both of which only a
 *     resolved fetch sets, and MapSearch exposes no prop that forces the branch
 *     the way FirstVisitGuideDialog takes `screen`/`step`. `renderWithState`
 *     below reaches it anyway by seeding the four `useState` slots — no DOM
 *     environment and no e2e run needed. This is what catches a guard mutated to
 *     `{false && (`, which would hide the list from every user on every device;
 *     the parsed-source checks below all stay green through that mutation, so
 *     they cannot stand in for it.
 *
 *   - Structure of the opened dropdown, asserted against the PARSED SOURCE of
 *     MapSearch.tsx rather than a render: which element carries which class, and
 *     what contains what. These earn their place because they catch the two
 *     regressions that actually broke taps on mobile — moving the pointerdown
 *     guard off an ancestor of the suggestion rows, and dropping the dropdown's
 *     stacking context — neither of which changes the emitted markup of a single
 *     element, and both of which an earlier version of this file, searching for
 *     class strings anywhere in the HTML or raw file text, missed.
 *
 * WHAT REMAINS UNCOVERED. Everything that needs events to fire. This repo has no
 * DOM environment — no jsdom, no happy-dom, no testing-library — so the only
 * render available is `renderToStaticMarkup`, which is markup and no listeners.
 * Nothing here dispatches a pointerdown or a click, so no test proves the
 * pointerdown guard actually stops the map from eating a tap, that `handleSelect`
 * fires, or that the outside-click effect closes the list; the structural checks
 * below assert only that the wiring is in the right place, not that it works. The
 * debounce and both fetches are likewise unobserved, as is any real tap on a real
 * device. Closing those needs a DOM environment or a spec in tests/e2e, where
 * Playwright already runs against this app.
 */

const SOURCE_PATH = join(process.cwd(), "components/map/MapSearch.tsx");

interface JsxNode {
  tag: string;
  testId: string | null;
  classes: string[];
  /** Expression source for each `{...}` attribute, keyed by attribute name. */
  handlers: Record<string, string>;
  parent: JsxNode | null;
}

/**
 * Every JSX element in the file, each linked to its enclosing element.
 *
 * Note this walks the syntax tree, so an element appears here whether or not any
 * condition wrapping it can ever be true — which is why the checks built on it
 * cannot speak to whether the dropdown renders. The seeded render below is what
 * covers that.
 */
function parseJsxTree(path: string): JsxNode[] {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes: JsxNode[] = [];

  const visit = (node: ts.Node, parent: JsxNode | null) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    let enclosing = parent;

    if (opening) {
      const element: JsxNode = {
        tag: opening.tagName.getText(file),
        testId: null,
        classes: [],
        handlers: {},
        parent,
      };
      for (const attribute of opening.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(file);
        const value = attribute.initializer;
        if (!value) continue;
        if (ts.isStringLiteral(value)) {
          if (name === "data-testid") element.testId = value.text;
          if (name === "className") element.classes = value.text.split(/\s+/).filter(Boolean);
        } else if (ts.isJsxExpression(value) && value.expression) {
          element.handlers[name] = value.expression.getText(file);
        }
      }
      nodes.push(element);
      enclosing = element;
    }

    node.forEachChild((child) => visit(child, enclosing));
  };

  visit(file, null);
  return nodes;
}

const jsx = parseJsxTree(SOURCE_PATH);

function byTestId(testId: string): JsxNode {
  const found = jsx.filter((node) => node.testId === testId);
  expect(found, `exactly one element with data-testid="${testId}"`).toHaveLength(1);
  return found[0];
}

function ancestors(node: JsxNode): JsxNode[] {
  const chain: JsxNode[] = [];
  for (let current = node.parent; current; current = current.parent) chain.push(current);
  return chain;
}

function descendantsOf(node: JsxNode): JsxNode[] {
  return jsx.filter((candidate) => ancestors(candidate).includes(node));
}

/** The numeric Tailwind stacking level, e.g. `z-[70]` -> 70. */
function zIndex(node: JsxNode): number {
  const token = node.classes.find((value) => /^z-\[\d+\]$/.test(value));
  expect(token, `${node.testId ?? node.tag} carries a z-[n] class`).toBeDefined();
  return Number(token!.slice(3, -1));
}

/** The class list React actually emitted on the element, not the whole page. */
function renderedClasses(html: string, testId: string): string[] {
  const tag = html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0];
  expect(tag, `rendered element with data-testid="${testId}"`).toBeDefined();
  return (tag!.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
}

describe("MapSearch first paint", () => {
  const html = renderToStaticMarkup(<MapSearch onResult={() => {}} />);

  it("puts the stacking and pointer context on the search wrapper itself", () => {
    expect(renderedClasses(html, "map-search")).toEqual(
      expect.arrayContaining(["z-[60]", "isolate", "pointer-events-auto"]),
    );
  });

  it("renders the input but no results list before a search has resolved", () => {
    // Evidence that the list is gated at all: rendered unconditionally, an empty
    // panel would sit over the map from page load. That it opens on a resolved
    // search is a separate claim, proven by the seeded render further down.
    expect(html).toContain('data-testid="map-search"');
    expect(html).toContain("Enter an address to explore incentives");
    expect(html).not.toContain('data-testid="map-search-results"');
  });
});

describe("MapSearch dropdown structure (parsed source, not a render)", () => {
  const wrapper = byTestId("map-search");
  const results = byTestId("map-search-results");
  const suggestions = descendantsOf(results).filter((node) => node.tag === "button");

  it("keeps the suggestion rows inside the element that swallows the map's pointerdown", () => {
    // The map canvas listens for pointerdown to pan/close panels. Whatever
    // element stops that propagation has to CONTAIN the rows, or a tap on a
    // suggestion is eaten by the map before the click ever fires.
    const guard = ancestors(results).find((node) =>
      /stopPropagation\(\)/.test(node.handlers.onPointerDown ?? ""),
    );

    expect(guard, "a pointerdown guard above the results list").toBeDefined();
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(ancestors(suggestion)).toContain(guard);
    }
  });

  it("gives every suggestion row its own selection handler", () => {
    for (const suggestion of suggestions) {
      expect(suggestion.handlers.onClick).toMatch(/handleSelect\(/);
      expect(suggestion.classes).toEqual(
        expect.arrayContaining(["pointer-events-auto", "touch-manipulation"]),
      );
    }
  });

  it("declares the dropdown above the wrapper rather than under it", () => {
    expect(results.classes).toContain("pointer-events-auto");
    expect(zIndex(results)).toBeGreaterThan(zIndex(wrapper));
  });
});

const SUGGESTIONS = [
  // No apostrophes or angle brackets: React entity-escapes those on the way out,
  // so a raw `toContain` on the label would fail for reasons unrelated to the guard.
  { lat: 41.75, lon: -87.58, label: "Bronzeville Winery — 4420 S Cottage Grove", type: "business" as const },
  { lat: 41.76, lon: -87.59, label: "7900 S Cottage Grove Ave", type: "address" as const },
];

/**
 * Render MapSearch with its four `useState` slots seeded, in the order they are
 * called in the component body: query, results, loading, open.
 *
 * `useRef`/`useEffect`/`useCallback` come from `importOriginal()` and stay real,
 * so React's server dispatcher still drives the render. Only the state hooks are
 * substituted, which is the one thing a static render cannot otherwise reach:
 * `open` is set exclusively by a resolved fetch, and MapSearch exposes no prop
 * that forces it.
 */
async function renderWithState(seeds: unknown[]): Promise<string> {
  vi.resetModules();
  vi.doMock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>();
    let slot = 0;
    return { ...actual, useState: () => [seeds[slot++], () => {}] };
  });
  const { default: Seeded } = await import("../MapSearch");
  const html = renderToStaticMarkup(<Seeded onResult={() => {}} />);
  vi.doUnmock("react");
  vi.resetModules();
  return html;
}

describe("MapSearch dropdown render (state seeded, real render)", () => {
  it("mounts the suggestion list once a search has resolved", async () => {
    const html = await renderWithState(["79th", SUGGESTIONS, false, true]);

    expect(html).toContain('data-testid="map-search-results"');
    for (const suggestion of SUGGESTIONS) {
      expect(html).toContain(suggestion.label);
    }
  });

  it("emits one tappable row per result", async () => {
    const html = await renderWithState(["79th", SUGGESTIONS, false, true]);
    const rows = html.match(/touch-manipulation/g) ?? [];
    expect(rows).toHaveLength(SUGGESTIONS.length);
  });

  it("keeps the list closed while `open` is false even with results in hand", async () => {
    const html = await renderWithState(["79th", SUGGESTIONS, false, false]);
    expect(html).not.toContain('data-testid="map-search-results"');
  });
});

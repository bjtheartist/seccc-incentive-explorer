// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { resolveTourAnchor } from "@/lib/map-guide";

function visible(element: HTMLElement, width = 100, height = 40) {
  Object.defineProperty(element, "offsetWidth", { value: width });
  element.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height }) as DOMRect;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("map tour anchors", () => {
  it("selects the visible mobile control when its desktop match is hidden", () => {
    document.body.innerHTML = '<button data-tour="layers">Desktop</button><button data-tour="layers">Mobile</button>';
    const mobile = document.querySelectorAll<HTMLButtonElement>("button")[1];
    visible(mobile);
    expect(resolveTourAnchor('[data-tour="layers"]')).toBe(mobile);
  });

  it("uses the visible menu as the report-link fallback", () => {
    document.body.innerHTML = '<a data-tour="report">Report</a><button data-tour="menu">Menu</button>';
    const menu = document.querySelector<HTMLButtonElement>("button")!;
    visible(menu);
    expect(resolveTourAnchor('[data-tour="report"], [data-tour="menu"]')).toBe(menu);
  });

  it("does not spotlight absent or hidden controls", () => {
    document.body.innerHTML = '<button data-tour="layers" hidden>Layers</button>';
    expect(resolveTourAnchor('[data-tour="layers"]')).toBeNull();
    expect(resolveTourAnchor('[data-tour="missing"]')).toBeNull();
  });
});

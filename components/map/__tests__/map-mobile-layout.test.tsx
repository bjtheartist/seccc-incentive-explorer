// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MapSearch from "../MapSearch";
import MapSnapshotPanel from "../MapSnapshotPanel";
import { DEFAULT_STATS } from "../map-helpers";

afterEach(cleanup);

function classTokens(element: Element): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

function spacingRem(tokens: string[], prefix: "top" | "h"): number {
  const token = tokens.find((value) => new RegExp(`^${prefix}-\\d+$`).test(value));
  expect(token, `an unprefixed ${prefix}-<spacing> class`).toBeDefined();
  return Number(token!.split("-")[1]) / 4;
}

function snapshotClearanceRem(tokens: string[]): number {
  const token = tokens.find((value) => /^max-h-\[calc\(100%-\d+rem\)\]$/.test(value));
  expect(token, "a mobile max-height that reserves space above the sheet").toBeDefined();
  return Number(token!.match(/100%-(\d+)rem/)![1]);
}

describe("mobile map overlay layout", () => {
  it("keeps the location sheet below the search bar with a visible gap", () => {
    render(
      <div>
        <MapSearch onResult={() => {}} />
        <MapSnapshotPanel
          areaStats={DEFAULT_STATS}
          snapshotLabel="Near West Side map point"
          snapshotPrograms={[]}
          snapshotTifFinance={null}
          tifFinanceLoading={false}
          zoningInfo={null}
          isGeneratingSnapshot={false}
          onClose={() => {}}
          onDrawArea={() => {}}
          onGenerateSnapshot={() => {}}
        />
      </div>,
    );

    const search = screen.getByTestId("map-search");
    const input = screen.getByRole("textbox");
    const snapshot = screen.getByRole("complementary", { name: "Location Snapshot" });

    const searchBottomRem =
      spacingRem(classTokens(search), "top") + spacingRem(classTokens(input), "h");
    const panelTopClearanceRem = snapshotClearanceRem(classTokens(snapshot));

    expect(panelTopClearanceRem - searchBottomRem).toBeGreaterThanOrEqual(1);
  });

  it("preserves the existing desktop snapshot height rule", () => {
    render(
      <MapSnapshotPanel
        areaStats={DEFAULT_STATS}
        snapshotLabel="Near West Side map point"
        snapshotPrograms={[]}
        snapshotTifFinance={null}
        tifFinanceLoading={false}
        zoningInfo={null}
        isGeneratingSnapshot={false}
        onClose={() => {}}
        onDrawArea={() => {}}
        onGenerateSnapshot={() => {}}
      />,
    );

    expect(classTokens(screen.getByRole("complementary", { name: "Location Snapshot" }))).toContain(
      "md:max-h-[calc(100%-4rem)]",
    );
  });
});

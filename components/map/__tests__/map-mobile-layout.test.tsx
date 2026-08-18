// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MapSearch from "../MapSearch";
import MapSnapshotPanel from "../MapSnapshotPanel";
import { DEFAULT_STATS } from "../map-helpers";
import {
  DESKTOP_DOSSIER_WRAPPER_CLASS,
  MOBILE_DOSSIER_TOP_REM,
  MOBILE_DOSSIER_WRAPPER_CLASS,
  MOBILE_OVERLAY_GAP_REM,
  MOBILE_SEARCH_HEIGHT_REM,
  MOBILE_SEARCH_TOP_REM,
  tailwindSpacingRem,
} from "../map-overlay-layout";

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

  // ── The tapped-pin dossier card (MapDossierCard, mounted by MapView in the
  //    top band on phones). It once shared `top-16` with the search bar, so the
  //    search field covered the tapped location's title on every phone. These
  //    tests pin the contract in components/map/map-overlay-layout.ts to the
  //    REAL classes MapSearch renders, so neither side can drift alone. ──────
  describe("mobile dossier card vs. search bar", () => {
    it("MapSearch's real mobile classes match the layout contract constants", () => {
      render(<MapSearch onResult={() => {}} />);
      const search = screen.getByTestId("map-search");
      const input = screen.getByRole("textbox");
      expect(spacingRem(classTokens(search), "top")).toBe(MOBILE_SEARCH_TOP_REM);
      expect(spacingRem(classTokens(input), "h")).toBe(MOBILE_SEARCH_HEIGHT_REM);
    });

    it("the mobile dossier wrapper class encodes the contract's top offset (Tailwind literal must equal the constant)", () => {
      expect(tailwindSpacingRem(MOBILE_DOSSIER_WRAPPER_CLASS, "top")).toBe(MOBILE_DOSSIER_TOP_REM);
      expect(MOBILE_DOSSIER_WRAPPER_CLASS.split(/\s+/)).toContain("absolute");
    });

    it("keeps the dossier card's top edge at least the contract gap below the search bar's bottom edge", () => {
      render(<MapSearch onResult={() => {}} />);
      const search = screen.getByTestId("map-search");
      const input = screen.getByRole("textbox");
      const searchBottomRem = spacingRem(classTokens(search), "top") + spacingRem(classTokens(input), "h");
      const dossierTopRem = tailwindSpacingRem(MOBILE_DOSSIER_WRAPPER_CLASS, "top");
      expect(dossierTopRem).not.toBeNull();
      expect(dossierTopRem! - searchBottomRem).toBeGreaterThanOrEqual(MOBILE_OVERLAY_GAP_REM);
    });

    it("the desktop wrapper stays centered and never inherits the mobile top offset", () => {
      const tokens = DESKTOP_DOSSIER_WRAPPER_CLASS.split(/\s+/);
      expect(tokens).toContain("top-1/2");
      expect(tokens).toContain("-translate-y-1/2");
      expect(tailwindSpacingRem(DESKTOP_DOSSIER_WRAPPER_CLASS, "top")).toBeNull();
    });
  });
});

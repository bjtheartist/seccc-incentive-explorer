import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY,
  filterRecordsByPublicInvestmentOverlays,
  isPublicInvestmentOverlayId,
  isPublicInvestmentSourceId,
  loadStoredPublicInvestmentOverlayVisibility,
  parsePublicInvestmentOverlayVisibility,
  PUBLIC_INVESTMENT_OVERLAY_IDS,
  PUBLIC_INVESTMENT_OVERLAYS,
  PUBLIC_INVESTMENT_OVERLAYS_STORAGE_KEY,
  PUBLIC_INVESTMENT_SOURCE_BY_OVERLAY_ID,
  PUBLIC_INVESTMENT_SOURCE_IDS,
  publicInvestmentOverlayIdForSource,
  serializePublicInvestmentOverlayVisibility,
  shouldKeepRecipientsPanelOpen,
  storePublicInvestmentOverlayVisibility,
  visiblePublicInvestmentSourceIds,
  withPublicInvestmentOverlayVisibility,
  type PublicInvestmentOverlayVisibility,
} from "@/lib/public-investment-overlays";

function fakeSessionStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
    },
  };
}

describe("public investment overlay config", () => {
  it("defines four independent admin-only overlays that default off", () => {
    expect(PUBLIC_INVESTMENT_OVERLAY_IDS).toEqual([
      "county_relief_awards",
      "state_recovery_awards",
      "federal_restaurant_relief",
      "state_capital_projects",
    ]);
    expect(PUBLIC_INVESTMENT_OVERLAYS.map(({ id, label, adminOnly, defaultVisible }) => ({
      id,
      label,
      adminOnly,
      defaultVisible,
    }))).toEqual([
      {
        id: "county_relief_awards",
        label: "County relief awards",
        adminOnly: true,
        defaultVisible: false,
      },
      {
        id: "state_recovery_awards",
        label: "Illinois recovery grants",
        adminOnly: true,
        defaultVisible: false,
      },
      {
        id: "federal_restaurant_relief",
        label: "Restaurant relief grants",
        adminOnly: true,
        defaultVisible: false,
      },
      {
        id: "state_capital_projects",
        label: "State capital projects",
        adminOnly: true,
        defaultVisible: false,
      },
    ]);
    expect(DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY).toEqual({
      county_relief_awards: false,
      state_recovery_awards: false,
      federal_restaurant_relief: false,
      state_capital_projects: false,
    });
  });

  it("maps each overlay to its canonical source family", () => {
    expect(PUBLIC_INVESTMENT_SOURCE_IDS).toEqual([
      "cook-source-2023",
      "illinois-b2b",
      "sba-rrf",
      "dceo-capital",
    ]);
    expect(PUBLIC_INVESTMENT_SOURCE_BY_OVERLAY_ID).toEqual({
      county_relief_awards: "cook-source-2023",
      state_recovery_awards: "illinois-b2b",
      federal_restaurant_relief: "sba-rrf",
      state_capital_projects: "dceo-capital",
    });
    expect(publicInvestmentOverlayIdForSource("cook-source-2023")).toBe(
      "county_relief_awards",
    );
    expect(publicInvestmentOverlayIdForSource("dceo-capital")).toBe(
      "state_capital_projects",
    );
    expect(publicInvestmentOverlayIdForSource("illinois-b2b")).toBe(
      "state_recovery_awards",
    );
    expect(publicInvestmentOverlayIdForSource("sba-rrf")).toBe(
      "federal_restaurant_relief",
    );
    expect(publicInvestmentOverlayIdForSource("tif")).toBeNull();
  });

  it("guards overlay and source IDs", () => {
    expect(isPublicInvestmentOverlayId("county_relief_awards")).toBe(true);
    expect(isPublicInvestmentOverlayId("megaprojects")).toBe(false);
    expect(isPublicInvestmentSourceId("dceo-capital")).toBe(true);
    expect(isPublicInvestmentSourceId("dceo-grants")).toBe(false);
  });

  it("uses historical context copy rather than opportunity or dollar promises", () => {
    const descriptions = Object.fromEntries(
      PUBLIC_INVESTMENT_OVERLAYS.map((overlay) => [
        overlay.id,
        overlay.description,
      ]),
    );
    const county = descriptions.county_relief_awards;
    const stateRecovery = descriptions.state_recovery_awards;
    const restaurant = descriptions.federal_restaurant_relief;
    const state = descriptions.state_capital_projects;
    expect(county).toContain("Historical");
    expect(county).toContain("not an active funding opportunity");
    expect(stateRecovery).toContain("Historical");
    expect(stateRecovery).toContain("not an active opportunity");
    expect(restaurant).toContain("Historical");
    expect(restaurant).toContain("not a current opportunity");
    expect(state).toContain("appropriations");
    expect(state).toContain("not an active funding opportunity");
    expect(state).toContain("expected incentive dollars");
  });
});

describe("public investment overlay persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns fresh default state for missing storage and SSR", () => {
    const first = loadStoredPublicInvestmentOverlayVisibility();
    const second = parsePublicInvestmentOverlayVisibility(null);
    expect(first).toEqual(DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY);
    expect(second).toEqual(DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY);
    expect(first).not.toBe(DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY);
    expect(second).not.toBe(DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY);
  });

  it("falls back safely for corrupted stored state", () => {
    expect(parsePublicInvestmentOverlayVisibility("{nope")).toEqual(
      DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY,
    );
    expect(parsePublicInvestmentOverlayVisibility("[]")).toEqual(
      DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY,
    );
    expect(parsePublicInvestmentOverlayVisibility('"true"')).toEqual(
      DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY,
    );
  });

  it("keeps valid fields and defaults malformed or missing fields", () => {
    expect(
      parsePublicInvestmentOverlayVisibility(
        JSON.stringify({
          county_relief_awards: true,
          state_capital_projects: "1",
          unknown_overlay: true,
        }),
      ),
    ).toEqual({
      county_relief_awards: true,
      state_recovery_awards: false,
      federal_restaurant_relief: false,
      state_capital_projects: false,
    });
  });

  it("round-trips canonical serialized state", () => {
    const state: PublicInvestmentOverlayVisibility = {
      county_relief_awards: true,
      state_recovery_awards: true,
      federal_restaurant_relief: false,
      state_capital_projects: true,
    };
    expect(parsePublicInvestmentOverlayVisibility(
      serializePublicInvestmentOverlayVisibility(state),
    )).toEqual(state);
  });

  it("round-trips session state and removes the all-off default", () => {
    const { values, storage } = fakeSessionStorage();
    vi.stubGlobal("window", { sessionStorage: storage });

    const enabled = withPublicInvestmentOverlayVisibility(
      loadStoredPublicInvestmentOverlayVisibility(),
      "county_relief_awards",
      true,
    );
    storePublicInvestmentOverlayVisibility(enabled);

    expect(values.get(PUBLIC_INVESTMENT_OVERLAYS_STORAGE_KEY)).toBe(
      '{"county_relief_awards":true,"state_recovery_awards":false,"federal_restaurant_relief":false,"state_capital_projects":false}',
    );
    expect(loadStoredPublicInvestmentOverlayVisibility()).toEqual(enabled);

    storePublicInvestmentOverlayVisibility({
      county_relief_awards: false,
      state_recovery_awards: false,
      federal_restaurant_relief: false,
      state_capital_projects: false,
    });
    expect(values.has(PUBLIC_INVESTMENT_OVERLAYS_STORAGE_KEY)).toBe(false);
  });

  it("falls back or no-ops when sessionStorage is blocked", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(loadStoredPublicInvestmentOverlayVisibility()).toEqual(
      DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY,
    );
    expect(() =>
      storePublicInvestmentOverlayVisibility({
        county_relief_awards: true,
        state_recovery_awards: false,
        federal_restaurant_relief: false,
        state_capital_projects: false,
      }),
    ).not.toThrow();
  });
});

describe("public investment source filtering", () => {
  const records = [
    { id: "existing", source: "tif" },
    { id: "county", source: "cook-source-2023" },
    { id: "state-recovery", source: "illinois-b2b" },
    { id: "restaurant", source: "sba-rrf" },
    { id: "state", source: "dceo-capital" },
  ];

  it("leaves existing sources untouched while both new overlays default off", () => {
    expect(
      filterRecordsByPublicInvestmentOverlays(
        records,
        DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY,
      ).map((record) => record.id),
    ).toEqual(["existing"]);
    expect(
      visiblePublicInvestmentSourceIds(DEFAULT_PUBLIC_INVESTMENT_OVERLAY_VISIBILITY),
    ).toEqual([]);
  });

  it("filters each source family independently", () => {
    const countyOnly: PublicInvestmentOverlayVisibility = {
      county_relief_awards: true,
      state_recovery_awards: false,
      federal_restaurant_relief: false,
      state_capital_projects: false,
    };
    const stateOnly: PublicInvestmentOverlayVisibility = {
      county_relief_awards: false,
      state_recovery_awards: false,
      federal_restaurant_relief: false,
      state_capital_projects: true,
    };

    expect(
      filterRecordsByPublicInvestmentOverlays(records, countyOnly).map(
        (record) => record.id,
      ),
    ).toEqual(["existing", "county"]);
    expect(
      filterRecordsByPublicInvestmentOverlays(records, stateOnly).map(
        (record) => record.id,
      ),
    ).toEqual(["existing", "state"]);
    expect(visiblePublicInvestmentSourceIds(countyOnly)).toEqual(["cook-source-2023"]);
    expect(visiblePublicInvestmentSourceIds(stateOnly)).toEqual(["dceo-capital"]);
  });

  it("toggles state and federal recovery families independently", () => {
    const stateRecoveryOnly: PublicInvestmentOverlayVisibility = {
      county_relief_awards: false,
      state_recovery_awards: true,
      federal_restaurant_relief: false,
      state_capital_projects: false,
    };
    const restaurantOnly: PublicInvestmentOverlayVisibility = {
      county_relief_awards: false,
      state_recovery_awards: false,
      federal_restaurant_relief: true,
      state_capital_projects: false,
    };
    expect(
      filterRecordsByPublicInvestmentOverlays(records, stateRecoveryOnly).map(
        (record) => record.id,
      ),
    ).toEqual(["existing", "state-recovery"]);
    expect(
      filterRecordsByPublicInvestmentOverlays(records, restaurantOnly).map(
        (record) => record.id,
      ),
    ).toEqual(["existing", "restaurant"]);
  });

  it("includes both source families without changing input order", () => {
    const allVisible: PublicInvestmentOverlayVisibility = {
      county_relief_awards: true,
      state_recovery_awards: true,
      federal_restaurant_relief: true,
      state_capital_projects: true,
    };
    expect(
      filterRecordsByPublicInvestmentOverlays(records, allVisible).map(
        (record) => record.id,
      ),
    ).toEqual(["existing", "county", "state-recovery", "restaurant", "state"]);
    expect(visiblePublicInvestmentSourceIds(allVisible)).toEqual([
      "cook-source-2023",
      "illinois-b2b",
      "sba-rrf",
      "dceo-capital",
    ]);
  });
});

describe("recipients-panel teardown gate", () => {
  const ALL_ON: PublicInvestmentOverlayVisibility = {
    county_relief_awards: true,
    state_recovery_awards: true,
    federal_restaurant_relief: true,
    state_capital_projects: true,
  };
  const open = (over: Partial<Parameters<typeof shouldKeepRecipientsPanelOpen>[0]> = {}) =>
    shouldKeepRecipientsPanelOpen({
      adminSessionActive: true,
      communityInvestmentVisible: true,
      overlays: ALL_ON,
      sourceId: "cook-source-2023",
      ...over,
    });

  it("keeps an authorized panel open for every name-bearing recovery source", () => {
    expect(open({ sourceId: "cook-source-2023" })).toBe(true);
    expect(open({ sourceId: "illinois-b2b" })).toBe(true);
  });

  it("closes when the panel's OWN overlay is switched off", () => {
    // Cook names must not survive unchecking "County relief awards"…
    expect(
      open({ overlays: { ...ALL_ON, county_relief_awards: false } }),
    ).toBe(false);
    // …and B2B names must not survive unchecking "Illinois recovery grants".
    expect(
      open({
        sourceId: "illinois-b2b",
        overlays: { ...ALL_ON, state_recovery_awards: false },
      }),
    ).toBe(false);
  });

  it("is NOT closed by an unrelated overlay toggling", () => {
    expect(
      open({
        sourceId: "cook-source-2023",
        overlays: { ...ALL_ON, state_recovery_awards: false, state_capital_projects: false },
      }),
    ).toBe(true);
  });

  it("closes when Community Investment is switched off entirely", () => {
    expect(open({ communityInvestmentVisible: false })).toBe(false);
  });

  it("closes when the admin session drops", () => {
    expect(open({ adminSessionActive: false })).toBe(false);
    // Session loss wins even with every overlay still checked on.
    expect(open({ adminSessionActive: false, overlays: ALL_ON })).toBe(false);
  });

  it("fails closed for a source with no overlay bound to it", () => {
    // Nothing on screen could switch these off, so they must never stay open.
    expect(open({ sourceId: "foundation" })).toBe(false);
    expect(open({ sourceId: "" })).toBe(false);
  });
});

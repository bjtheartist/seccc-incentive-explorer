import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadInvestmentSession,
  patchInvestmentSession,
  clearInvestmentSession,
  sessionFromQuery,
  sessionToMapQuery,
  mapHrefForSession,
  funderTypeRecordFromSession,
  sessionFunderTypesFromRecord,
  INVESTMENT_SESSION_STORAGE_KEY,
} from "@/lib/investment-session";
import type { FunderType } from "@/lib/community-investment";

/**
 * The shared Investment working session (Sol #1) — the one small context that
 * follows the admin across map ↔ analysis ↔ compare. Persistence is sessionStorage
 * (stubbed here with a Map, exactly like the view-mode toggle test); the pure
 * URL/record helpers are exercised without a store.
 */

function stubStore() {
  const store = new Map<string, string>();
  vi.stubGlobal("CustomEvent", class {});
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("investment-session persistence", () => {
  it("returns the empty session on SSR (no window)", () => {
    expect(loadInvestmentSession()).toEqual({});
  });

  it("round-trips communityArea + yearWindow", () => {
    stubStore();
    patchInvestmentSession({ communityArea: "South Shore", yearWindow: "2020-2021" });
    expect(loadInvestmentSession()).toEqual({ communityArea: "South Shore", yearWindow: "2020-2021" });
  });

  it("stores the default year window ('all') as absence, not a value", () => {
    const store = stubStore();
    patchInvestmentSession({ communityArea: "Loop", yearWindow: "all" });
    const raw = store.get(INVESTMENT_SESSION_STORAGE_KEY) ?? "{}";
    expect(JSON.parse(raw)).toEqual({ communityArea: "Loop" });
    expect(loadInvestmentSession().yearWindow).toBeUndefined();
  });

  it("patches independently — updating yearWindow keeps communityArea", () => {
    stubStore();
    patchInvestmentSession({ communityArea: "Austin" });
    patchInvestmentSession({ yearWindow: "2024-2026" });
    expect(loadInvestmentSession()).toEqual({ communityArea: "Austin", yearWindow: "2024-2026" });
  });

  it("collapses the FULL funder-type set to 'all' (absent), keeps a strict subset", () => {
    stubStore();
    const all: FunderType[] = ["government", "philanthropic", "private_development"];
    patchInvestmentSession({ funderTypes: all });
    expect(loadInvestmentSession().funderTypes).toBeUndefined();

    patchInvestmentSession({ funderTypes: ["government"] });
    expect(loadInvestmentSession().funderTypes).toEqual(["government"]);
  });

  it("preserves an EMPTY funder-type set (none-selected), distinct from 'all'", () => {
    stubStore();
    patchInvestmentSession({ funderTypes: [] });
    expect(loadInvestmentSession().funderTypes).toEqual([]);
  });

  it("ignores a malformed stored blob and yields the empty session", () => {
    const store = stubStore();
    store.set(INVESTMENT_SESSION_STORAGE_KEY, "{not json");
    expect(loadInvestmentSession()).toEqual({});
  });

  it("clears the whole session", () => {
    const store = stubStore();
    patchInvestmentSession({ communityArea: "Englewood", yearWindow: "2022-2023" });
    clearInvestmentSession();
    expect(store.has(INVESTMENT_SESSION_STORAGE_KEY)).toBe(false);
    expect(loadInvestmentSession()).toEqual({});
  });
});

describe("investment-session URL helpers", () => {
  it("builds the map deep-link query, omitting default/absent context", () => {
    const q = sessionToMapQuery({ communityArea: "South Shore", yearWindow: "2020-2021" });
    expect(q.get("investment")).toBe("1");
    expect(q.get("area")).toBe("South Shore");
    expect(q.get("year")).toBe("2020-2021");
    expect(q.get("types")).toBeNull();
  });

  it("serializes a funder-type subset into types=", () => {
    const q = sessionToMapQuery({ funderTypes: ["government", "philanthropic"] });
    expect(q.get("types")).toBe("government,philanthropic");
  });

  it("mapHrefForSession lets an explicit area override the session's", () => {
    const href = mapHrefForSession({ communityArea: "Loop", yearWindow: "2024-2026" }, "Woodlawn");
    expect(href.startsWith("/map?")).toBe(true);
    const params = new URLSearchParams(href.slice("/map?".length));
    expect(params.get("area")).toBe("Woodlawn");
    expect(params.get("year")).toBe("2024-2026");
  });

  it("parses context out of a query (area/year/types), dropping an invalid year", () => {
    const params = new URLSearchParams("investment=1&area=Gage%20Park&year=2020-2021&types=government");
    expect(sessionFromQuery(params)).toEqual({
      communityArea: "Gage Park",
      yearWindow: "2020-2021",
      funderTypes: ["government"],
    });

    const bad = new URLSearchParams("investment=1&year=1999");
    expect(sessionFromQuery(bad).yearWindow).toBeUndefined();
  });

  it("treats a full type set in the query as 'all' (funderTypes absent)", () => {
    const full = new URLSearchParams("types=government,philanthropic,private_development");
    expect(sessionFromQuery(full).funderTypes).toBeUndefined();
  });

  it("treats an empty or malformed types= as the 'all types' default, never a blank layer", () => {
    // A clipped shared link ending in `&types=` — no valid token → all types on.
    const empty = new URLSearchParams("types=");
    expect(sessionFromQuery(empty).funderTypes).toBeUndefined();

    // A truncated token (`&types=phi`) or purely-unknown tokens → still all on,
    // rather than the empty subset that would filter every dot off the map.
    const truncated = new URLSearchParams("types=phi");
    expect(sessionFromQuery(truncated).funderTypes).toBeUndefined();

    const garbage = new URLSearchParams("types=foo,bar");
    expect(sessionFromQuery(garbage).funderTypes).toBeUndefined();

    // A single VALID token is still honored as a real subset.
    const one = new URLSearchParams("types=philanthropic");
    expect(sessionFromQuery(one).funderTypes).toEqual(["philanthropic"]);
  });
});

describe("investment-session map-record bridge", () => {
  it("undefined funderTypes → every checkbox on", () => {
    expect(funderTypeRecordFromSession(undefined)).toEqual({
      government: true,
      philanthropic: true,
      private_development: true,
    });
  });

  it("a subset → only those checkboxes on", () => {
    expect(funderTypeRecordFromSession(["philanthropic"])).toEqual({
      government: false,
      philanthropic: true,
      private_development: false,
    });
  });

  it("record → session collapses the full set to undefined, keeps a subset", () => {
    expect(
      sessionFunderTypesFromRecord({ government: true, philanthropic: true, private_development: true }),
    ).toBeUndefined();
    expect(
      sessionFunderTypesFromRecord({ government: true, philanthropic: false, private_development: false }),
    ).toEqual(["government"]);
  });
});

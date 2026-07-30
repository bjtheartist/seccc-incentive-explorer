/**
 * STARRED LOCATIONS store — identity, persistence, and the shared-machine wipe.
 *
 * The wipe is the load-bearing behavior: the same hardening the Investment
 * working set already ships (components/investment/local-store.ts +
 * SessionGuard.tsx). A departing admin's saved shortlist must not survive on a
 * shared browser once the httpOnly session cookie is gone.
 *
 * Runs without jsdom (the repo has none) against a minimal localStorage +
 * window stub, matching the node-environment convention of the other suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STARRED_SITES_EVENT,
  STARRED_SITES_KEY,
  STARRED_RING,
  clearStarredSites,
  getStarredServerSnapshot,
  getStarredSnapshot,
  isSiteStarred,
  readStarredKeys,
  readStarredSites,
  removeStarredSite,
  siteStarKey,
  toggleStarredSite,
} from "@/lib/vacancy-starred";
import { OWNER_TYPE_COLORS } from "@/lib/owner-classify";

// ── Minimal browser stub ─────────────────────────────────────────────────────

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const events: string[] = [];
const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  events.length = 0;
  const storage = new MemoryStorage();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: storage,
    dispatchEvent: (e: { type: string }) => {
      events.push(e.type);
      return true;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    CustomEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  };
  // The store constructs CustomEvent from the global scope.
  (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  }
});

function store(): MemoryStorage {
  return (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
}

const SITE = {
  address: "4048 W MADISON ST",
  pin: "16104250200000",
  zip: "60624",
  propertyType: "vacant_land" as const,
};

// ── Identity ─────────────────────────────────────────────────────────────────

describe("siteStarKey", () => {
  it("prefers the county PIN, so the map dot and the directory row agree", () => {
    expect(siteStarKey({ pin: "16104250200000", address: "4048 W MADISON ST" })).toBe(
      "pin:16104250200000",
    );
    // A formatted PIN and its digits-only form are the same site.
    expect(siteStarKey({ pin: "16-10-425-020-0000", address: "x" })).toBe("pin:16104250200000");
  });

  it("falls back to the normalized address for a 311 row with no PIN", () => {
    expect(siteStarKey({ pin: null, address: "  4048   w madison st " })).toBe(
      "addr:4048 W MADISON ST",
    );
  });

  it("returns '' for a record with no identity at all (not starrable)", () => {
    expect(siteStarKey({ pin: null, address: null })).toBe("");
    expect(siteStarKey({ pin: "", address: "   " })).toBe("");
  });

  it("distinguishes the three separate PINs sharing one street address", () => {
    const keys = new Set(
      ["16104250200000", "16104250210000", "16104250220000"].map((pin) =>
        siteStarKey({ pin, address: "4048 W MADISON ST" }),
      ),
    );
    expect(keys.size).toBe(3);
  });
});

// ── Persistence ──────────────────────────────────────────────────────────────

describe("toggleStarredSite", () => {
  it("stars, persists, and reads back", () => {
    toggleStarredSite(SITE);
    expect(readStarredSites()).toHaveLength(1);
    expect(isSiteStarred("pin:16104250200000")).toBe(true);
    expect(readStarredKeys().has("pin:16104250200000")).toBe(true);
    expect(store().getItem(STARRED_SITES_KEY)).toContain("16104250200000");
  });

  it("unstars on a second toggle and removes the key entirely when empty", () => {
    toggleStarredSite(SITE);
    toggleStarredSite(SITE);
    expect(readStarredSites()).toEqual([]);
    expect(store().getItem(STARRED_SITES_KEY)).toBeNull();
  });

  it("is a no-op for an unidentifiable record rather than a phantom entry", () => {
    toggleStarredSite({ address: "", pin: null, zip: "60624", propertyType: null });
    expect(readStarredSites()).toEqual([]);
  });

  it("dispatches the change event so the map halo and the directory stay in sync", () => {
    toggleStarredSite(SITE);
    expect(events).toContain(STARRED_SITES_EVENT);
  });

  it("keeps a starred entry anonymized — classification fields only, no owner name", () => {
    toggleStarredSite(SITE);
    const raw = store().getItem(STARRED_SITES_KEY)!.toLowerCase();
    expect(raw).not.toContain("ownername");
    expect(raw).not.toContain("taxpayer");
    expect(Object.keys(readStarredSites()[0]).sort()).toEqual([
      "address",
      "key",
      "pin",
      "propertyType",
      "zip",
    ]);
  });
});

describe("removeStarredSite", () => {
  it("removes exactly one entry", () => {
    toggleStarredSite(SITE);
    toggleStarredSite({ ...SITE, pin: "16104250210000" });
    removeStarredSite("pin:16104250200000");
    expect(readStarredSites().map((s) => s.key)).toEqual(["pin:16104250210000"]);
  });
});

// ── Defensive reads ──────────────────────────────────────────────────────────

describe("readStarredSites", () => {
  it("yields the empty set for hand-edited garbage rather than throwing", () => {
    store().setItem(STARRED_SITES_KEY, "{not json");
    expect(readStarredSites()).toEqual([]);
    store().setItem(STARRED_SITES_KEY, JSON.stringify({ nope: true }));
    expect(readStarredSites()).toEqual([]);
  });

  it("drops malformed entries and dedupes by key", () => {
    store().setItem(
      STARRED_SITES_KEY,
      JSON.stringify([
        null,
        7,
        { address: "" },
        { key: "pin:1", address: "A", pin: "1", zip: "60624", propertyType: "vacant_land" },
        { key: "pin:1", address: "A dup", pin: "1", zip: "60624", propertyType: "vacant_land" },
      ]),
    );
    const list = readStarredSites();
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe("A");
  });

  it("reconstructs a missing key from the record's own fields", () => {
    store().setItem(
      STARRED_SITES_KEY,
      JSON.stringify([{ address: "4048 W MADISON ST", pin: null, zip: "60624" }]),
    );
    expect(readStarredSites()[0].key).toBe("addr:4048 W MADISON ST");
  });

  it("never throws when storage itself is unavailable", () => {
    const win = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window;
    vi.spyOn(win.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStarredSites()).toEqual([]);
    vi.restoreAllMocks();
  });
});

// ── Shared-machine wipe ──────────────────────────────────────────────────────

describe("clearStarredSites", () => {
  it("wipes every saved location (the 401-probe and explicit-Clear path)", () => {
    toggleStarredSite(SITE);
    toggleStarredSite({ ...SITE, pin: "16104250210000" });
    expect(readStarredSites()).toHaveLength(2);

    clearStarredSites();

    expect(readStarredSites()).toEqual([]);
    expect(store().getItem(STARRED_SITES_KEY)).toBeNull();
    expect(events).toContain(STARRED_SITES_EVENT);
  });

  it("leaves nothing recoverable in raw storage after the wipe", () => {
    toggleStarredSite(SITE);
    clearStarredSites();
    const raw = JSON.stringify(store());
    expect(raw).not.toContain("16104250200000");
    expect(raw).not.toContain("MADISON");
  });
});

// ── useSyncExternalStore contract ────────────────────────────────────────────

describe("snapshots", () => {
  it("is referentially stable while the data is unchanged", () => {
    toggleStarredSite(SITE);
    expect(getStarredSnapshot()).toBe(getStarredSnapshot());
  });

  it("mints a new reference when the set actually changes", () => {
    const before = getStarredSnapshot();
    toggleStarredSite(SITE);
    expect(getStarredSnapshot()).not.toBe(before);
  });

  it("is empty on the server so SSR and first paint agree", () => {
    expect(getStarredServerSnapshot()).toEqual([]);
  });
});

// ── Palette ──────────────────────────────────────────────────────────────────

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

const linearize = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** WCAG relative luminance for an #rrggbb string. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** CIELAB (D65) — contrast ratio alone cannot tell two same-luminance hues
 *  apart, which is exactly the failure mode for a gold ring beside a red one. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linearize);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Everything already painted on the Property Map. */
const MAP_PALETTE: Record<string, string> = {
  ...OWNER_TYPE_COLORS,
  distressRed: "#DC2626",
  clusterInk: "#111111",
  cardInk: "#0C1B33",
  anchorSlate: "#475569",
};

describe("STARRED_RING", () => {
  it("is not literally any color already on the map", () => {
    const taken = Object.values(MAP_PALETTE).map((c) => c.toUpperCase());
    expect(taken).not.toContain(STARRED_RING.toUpperCase());
  });

  it("is perceptually distinct (ΔE ≥ 25) from every owner-type fill and every ring already drawn", () => {
    for (const [name, color] of Object.entries(MAP_PALETTE)) {
      expect(
        deltaE(STARRED_RING, color),
        `starred ring is too close to ${name} (${color})`,
      ).toBeGreaterThanOrEqual(25);
    }
  });

  it("separates from the tax-sale red in LUMINANCE too — the two are concentric on a starred distressed parcel", () => {
    // The amber first reached for (#B45309) sits at 1.04:1 against #DC2626 and
    // blurs into it at dot scale; the shipped color must not.
    expect(contrastRatio(STARRED_RING, "#DC2626")).toBeGreaterThan(1.5);
  });

  it("clears the 3:1 WCAG floor for a graphical object on the light basemap", () => {
    // mapbox light-v11 land is ~#f8f4f0; white is the strictest case.
    expect(contrastRatio(STARRED_RING, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(STARRED_RING, "#F8F4F0")).toBeGreaterThanOrEqual(3);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OWNER_CLUSTERS_VISIBLE_STORAGE_KEY,
  loadStoredOwnerClustersVisible,
  storeOwnerClustersVisible,
} from "../owner-clusters-toggle";

/**
 * Regression guard for the live-verified 2026-07-16 bug: the admin
 * "Ownership clusters" toggle silently reset to OFF during the demo flow.
 * Mechanism (reproduced with Playwright): the flow hard-navigates —
 * map → search → snapshot → "Generate report" (window.location.href =
 * /report?... in MapView's handleGenerateSnapshot) → Back — which reloads
 * /map, REMOUNTS MapView, and resets every useState to its initial value.
 * The fix backs the toggle with sessionStorage (lib/personas.ts pattern):
 * the useState initializer re-reads storage on every mount, so the state
 * survives any remount/reload within the tab.
 */

function fakeSessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("owner-clusters toggle persistence", () => {
  it("defaults to false with no window (SSR/node)", () => {
    expect(loadStoredOwnerClustersVisible()).toBe(false);
  });

  it("survives a remount: store(true) then a fresh initializer read returns true", () => {
    vi.stubGlobal("window", { sessionStorage: fakeSessionStorage() });

    // User toggles the admin layer on…
    storeOwnerClustersVisible(true);
    // …the demo flow hard-navigates to /report and back; MapView remounts
    // and its useState initializer re-reads storage — this call IS that read.
    expect(loadStoredOwnerClustersVisible()).toBe(true);
    // And again on any number of subsequent remounts.
    expect(loadStoredOwnerClustersVisible()).toBe(true);
  });

  it("toggling off clears the stored key (off is the default, mirroring personas)", () => {
    const storage = fakeSessionStorage();
    vi.stubGlobal("window", { sessionStorage: storage });

    storeOwnerClustersVisible(true);
    expect(storage.getItem(OWNER_CLUSTERS_VISIBLE_STORAGE_KEY)).toBe("1");
    storeOwnerClustersVisible(false);
    expect(storage.getItem(OWNER_CLUSTERS_VISIBLE_STORAGE_KEY)).toBeNull();
    expect(loadStoredOwnerClustersVisible()).toBe(false);
  });

  it("treats garbage stored values as off", () => {
    const storage = fakeSessionStorage();
    storage.setItem(OWNER_CLUSTERS_VISIBLE_STORAGE_KEY, "definitely");
    vi.stubGlobal("window", { sessionStorage: storage });
    expect(loadStoredOwnerClustersVisible()).toBe(false);
  });

  it("never throws when the store is blocked (private mode / full quota)", () => {
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
    expect(loadStoredOwnerClustersVisible()).toBe(false);
    expect(() => storeOwnerClustersVisible(true)).not.toThrow();
  });

  /**
   * Wiring guard: the persistence only helps if MapView actually (a) seeds
   * its state from storage on mount and (b) persists every user toggle. A
   * revert to a plain `useState(false)` would silently reintroduce the bug
   * while every unit test above still passes — so pin the wiring here.
   */
  it("MapView seeds the toggle from storage and persists changes through the legend setter", () => {
    const src = readFileSync(
      path.join(process.cwd(), "components/map/MapView.tsx"),
      "utf8"
    );
    expect(src).toMatch(/useState<boolean>\(\(\)\s*=>\s*\n?\s*loadStoredOwnerClustersVisible\(\)/);
    expect(src).toContain("storeOwnerClustersVisible(value)");
    expect(src).toContain("onSetOwnerClustersVisible={setOwnerClustersVisiblePersistent}");
  });
});

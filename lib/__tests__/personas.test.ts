import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONA,
  loadStoredPersona,
  normalizePersona,
  personaFromSearch,
  personaShareParam,
  PERSONA_STORAGE_KEY,
  resolveInitialPersona,
  storePersona,
} from "@/lib/personas";

describe("normalizePersona", () => {
  it("passes through valid ids and defaults everything else to 'all'", () => {
    expect(normalizePersona("developer")).toBe("developer");
    expect(normalizePersona("starting")).toBe("starting");
    expect(normalizePersona("nonsense")).toBe(DEFAULT_PERSONA);
    expect(normalizePersona(null)).toBe(DEFAULT_PERSONA);
    expect(normalizePersona(undefined)).toBe(DEFAULT_PERSONA);
  });
});

describe("URL round-trip", () => {
  it("reads ?persona= from a query string or URLSearchParams", () => {
    expect(personaFromSearch("?persona=developer")).toBe("developer");
    expect(personaFromSearch(new URLSearchParams("persona=starting"))).toBe(
      "starting",
    );
    expect(personaFromSearch("?persona=bogus")).toBe(DEFAULT_PERSONA);
    expect(personaFromSearch("")).toBe(DEFAULT_PERSONA);
    expect(personaFromSearch(null)).toBe(DEFAULT_PERSONA);
  });

  it("omits the default lens from the share param but round-trips the rest", () => {
    expect(personaShareParam("all")).toBeNull();
    expect(personaShareParam("developer")).toBe("developer");
    // A forwarded link opens in its sender's lens.
    const param = personaShareParam("growing");
    expect(personaFromSearch(`?persona=${param}`)).toBe("growing");
  });
});

// ─── sessionStorage (mock a window; the lib is otherwise SSR-safe) ────

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function mockWindow(): MemoryStorage {
  const storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { sessionStorage: storage };
  return storage;
}

describe("sessionStorage persistence", () => {
  it("is SSR-safe: no window means 'all' and a silent no-op store", () => {
    expect(typeof window).toBe("undefined");
    expect(loadStoredPersona()).toBe(DEFAULT_PERSONA);
    expect(() => storePersona("developer")).not.toThrow();
  });

  it("round-trips a non-default lens and clears on 'all'", () => {
    const storage = mockWindow();
    storePersona("developer");
    expect(storage.getItem(PERSONA_STORAGE_KEY)).toBe("developer");
    expect(loadStoredPersona()).toBe("developer");

    storePersona("all");
    expect(storage.getItem(PERSONA_STORAGE_KEY)).toBeNull();
    expect(loadStoredPersona()).toBe(DEFAULT_PERSONA);
  });
});

describe("resolveInitialPersona", () => {
  it("prefers an explicit URL lens over the stored session choice", () => {
    mockWindow();
    storePersona("starting");
    expect(resolveInitialPersona("?persona=developer")).toBe("developer");
  });

  it("falls back to the session choice when the URL is silent", () => {
    mockWindow();
    storePersona("growing");
    expect(resolveInitialPersona("")).toBe("growing");
  });
});

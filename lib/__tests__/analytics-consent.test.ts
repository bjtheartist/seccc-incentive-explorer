import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsAllowed,
  parseAnalyticsConsent,
  readAnalyticsConsent,
  writeAnalyticsConsent,
} from "@/lib/analytics-consent";
import { trackEvent } from "@/lib/analytics-events";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

let cookieJar: string[];
const fetchMock = vi.fn(() => Promise.resolve(new Response("{}")));

beforeEach(() => {
  cookieJar = [];
  const doc = {
    get cookie() { return cookieJar.join("; "); },
    set cookie(value: string) {
      const pair = value.split(";")[0];
      const name = pair.split("=")[0];
      cookieJar = cookieJar.filter((c) => !c.startsWith(`${name}=`)).concat(pair);
    },
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    location: { protocol: "https:", search: "" },
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("CustomEvent", class { constructor(public type: string) {} });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analytics consent", () => {
  it("only accepts on/off", () => {
    expect(parseAnalyticsConsent("off")).toBe("off");
    expect(parseAnalyticsConsent("maybe")).toBeNull();
    expect(parseAnalyticsConsent(undefined)).toBeNull();
  });

  it("is allowed by default (opt-out model) and sends events", () => {
    expect(readAnalyticsConsent()).toBeNull();
    expect(analyticsAllowed()).toBe(true);
    trackEvent("search_performed", { source: "test" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opting out stops trackEvent and removes the page-view session id", () => {
    window.localStorage.setItem("cie_traffic_session_id", "abc");
    writeAnalyticsConsent("off");

    expect(readAnalyticsConsent()).toBe("off");
    expect(window.localStorage.getItem("cie_traffic_session_id")).toBeNull();
    trackEvent("search_performed", { source: "test" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Global Privacy Control blocks analytics even without a banner choice", () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true });
    expect(analyticsAllowed()).toBe(false);
    trackEvent("search_performed", { source: "test" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

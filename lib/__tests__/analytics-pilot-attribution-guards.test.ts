import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRACTITIONER_VALIDATION_PREVIEW_PARAM,
  trackEvent,
} from "../analytics-events";
import { PRACTITIONER_VALIDATION_CASES } from "../practitioner-validation";

const CAMPAIGN_SESSION_KEY = "cie_practitioner_validation_campaign";
const PILOT_CAMPAIGN = PRACTITIONER_VALIDATION_CASES[0].campaign;

function stubBrowser(initialSession: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(initialSession));
  const location = { search: "" };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });

  vi.stubGlobal("window", {
    location,
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  vi.stubGlobal("fetch", fetchMock);

  const metadataOf = (call: number) =>
    JSON.parse(String(fetchMock.mock.calls[call][1]?.body)).metadata;

  return { location, values, fetchMock, metadataOf };
}

describe("practitioner validation attribution guards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a non-pilot campaign instead of replacing it with the stored pilot campaign", () => {
    const { fetchMock, metadataOf, values } = stubBrowser({
      [CAMPAIGN_SESSION_KEY]: PILOT_CAMPAIGN,
    });

    // Same tab, later visit: a QR flyer code carries its own attribution.
    trackEvent("start_page_viewed", {
      source: "qr-63rd",
      metadata: { campaign: "qr-63rd-flyer" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(metadataOf(0).campaign).toBe("qr-63rd-flyer");
    expect(values.get(CAMPAIGN_SESSION_KEY)).toBeUndefined();
  });

  it("does not restore stale pilot attribution after an explicit non-pilot event", () => {
    const { fetchMock, metadataOf, values } = stubBrowser({
      [CAMPAIGN_SESSION_KEY]: PILOT_CAMPAIGN,
    });

    trackEvent("start_page_viewed", {
      source: "start_page",
      metadata: { campaign: "direct" },
    });
    trackEvent("support_resource_viewed", {
      metadata: { organizationCount: 3 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(metadataOf(0).campaign).toBe("direct");
    expect(metadataOf(1)).not.toHaveProperty("campaign");
    expect(values.get(CAMPAIGN_SESSION_KEY)).toBeUndefined();
  });

  it("keeps a non-pilot UTM campaign from inheriting a stored pilot campaign", () => {
    const { fetchMock, metadataOf, values } = stubBrowser({
      [CAMPAIGN_SESSION_KEY]: PILOT_CAMPAIGN,
    });

    trackEvent("site_page_viewed", {
      source: "site_traffic",
      metadata: { utmCampaign: "organic-launch" },
    });
    trackEvent("support_resource_viewed", {
      metadata: { organizationCount: 3 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(metadataOf(0)).toMatchObject({ utmCampaign: "organic-launch" });
    expect(metadataOf(0)).not.toHaveProperty("campaign");
    expect(metadataOf(1)).not.toHaveProperty("campaign");
    expect(values.get(CAMPAIGN_SESSION_KEY)).toBeUndefined();
  });

  it("clears stale pilot attribution when a non-pilot campaign is present only in the URL", () => {
    const { location, metadataOf, values } = stubBrowser({
      [CAMPAIGN_SESSION_KEY]: PILOT_CAMPAIGN,
    });
    location.search = "?utm_campaign=organic-launch";

    trackEvent("support_resource_viewed", {
      metadata: { organizationCount: 3 },
    });

    expect(metadataOf(0)).not.toHaveProperty("campaign");
    expect(values.get(CAMPAIGN_SESSION_KEY)).toBeUndefined();
  });

  it("normalizes a recognized pilot UTM campaign into dashboard campaign metadata", () => {
    const { metadataOf, values } = stubBrowser();

    trackEvent("site_page_viewed", {
      source: "site_traffic",
      metadata: { utmCampaign: PILOT_CAMPAIGN },
    });

    expect(metadataOf(0)).toMatchObject({
      utmCampaign: PILOT_CAMPAIGN,
      campaign: PILOT_CAMPAIGN,
    });
    expect(values.get(CAMPAIGN_SESSION_KEY)).toBe(PILOT_CAMPAIGN);
  });

  it("does not count a plain /start visit in a previously pilot-tagged tab as a pilot start", () => {
    const { metadataOf } = stubBrowser({ [CAMPAIGN_SESSION_KEY]: PILOT_CAMPAIGN });

    // "direct" is /start's fallback when no campaign parameter is present; the
    // panel counts starts as visits to a facilitated case link, and this is not one.
    trackEvent("start_page_viewed", {
      source: "start_page",
      metadata: { campaign: "direct" },
    });

    expect(metadataOf(0).campaign).toBe("direct");
  });

  it("still resolves the pilot campaign for events that carry no campaign of their own", () => {
    const { metadataOf } = stubBrowser({ [CAMPAIGN_SESSION_KEY]: PILOT_CAMPAIGN });

    trackEvent("support_resource_viewed", { metadata: { organizationCount: 3 } });

    expect(metadataOf(0).campaign).toBe(PILOT_CAMPAIGN);
  });

  it("keeps an operator preview of a case link out of that case's funnel for the whole tab", () => {
    const { location, values, metadataOf } = stubBrowser();
    location.search = `?utm_source=validation-equipment&utm_campaign=${PILOT_CAMPAIGN}&${PRACTITIONER_VALIDATION_PREVIEW_PARAM}=1`;

    trackEvent("start_page_viewed", {
      source: "validation-equipment",
      metadata: { campaign: PILOT_CAMPAIGN },
    });
    // The flag only rides the first URL; later navigations in the tab drop it.
    location.search = "";
    trackEvent("search_performed", { metadata: { campaign: PILOT_CAMPAIGN } });
    trackEvent("support_resource_viewed", { metadata: { organizationCount: 3 } });

    expect(metadataOf(0).campaign).not.toBe(PILOT_CAMPAIGN);
    expect(metadataOf(1).campaign).not.toBe(PILOT_CAMPAIGN);
    expect(metadataOf(2)).not.toHaveProperty("campaign");
    expect(values.get(CAMPAIGN_SESSION_KEY)).toBeUndefined();
  });

  it("drops a pilot campaign a preview tab had already stored", () => {
    const { location, values, metadataOf } = stubBrowser({
      [CAMPAIGN_SESSION_KEY]: PILOT_CAMPAIGN,
    });
    location.search = `?${PRACTITIONER_VALIDATION_PREVIEW_PARAM}=1`;

    trackEvent("site_page_viewed", { metadata: { path: "/start" } });

    expect(metadataOf(0)).not.toHaveProperty("campaign");
    expect(values.get(CAMPAIGN_SESSION_KEY)).toBeUndefined();
  });
});

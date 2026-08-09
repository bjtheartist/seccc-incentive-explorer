import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "../analytics-events";
import { PRACTITIONER_VALIDATION_CASES } from "../practitioner-validation";

describe("practitioner validation analytics attribution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a named campaign through same-session support and request events", () => {
    const campaign = PRACTITIONER_VALIDATION_CASES[0].campaign;
    const values = new Map<string, string>();
    const location = { search: `?campaign=${campaign}` };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });

    vi.stubGlobal("window", {
      location,
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    trackEvent("support_resource_viewed", {
      metadata: { organizationCount: 3 },
    });
    location.search = "";
    trackEvent("preparation_support_requested", {
      metadata: { requestType: "materials_review" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.metadata).toMatchObject({ campaign, organizationCount: 3 });
    expect(secondBody.metadata).toMatchObject({ campaign, requestType: "materials_review" });
  });
});

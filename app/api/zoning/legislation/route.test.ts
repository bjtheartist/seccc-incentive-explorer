import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const MATTER_ID = "14999C67-FD08-F111-8406-001DD80D78DD";

function request(query = "") {
  return new NextRequest(`http://localhost/api/zoning/legislation?${query}`);
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rawMatter() {
  return {
    matterId: MATTER_ID,
    recordNumber: "O2026-0023281",
    fileYear: 2026,
    status: "90-Final",
    subStatus: "Passed",
    title: "Zoning Reclassification Map No. 11-H at 4000 N Lincoln Ave",
    introductionDate: "2026-02-18T16:00:00+00:00",
    finalActionDate: "2026-05-20T15:00:00+00:00",
    lastPublicationDate: "2026-07-15T15:21:51+00:00",
    controllingBody: "City Council",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/zoning/legislation", () => {
  it("requires an exact City-published identifier", async () => {
    const res = await GET(request());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ status: "invalid_request" });
  });

  it("returns normalized official legislative history", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => response(rawMatter()));
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(request(`matterId=${MATTER_ID}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=900");
    await expect(res.json()).resolves.toMatchObject({
      status: "available",
      matter: {
        matterId: MATTER_ID,
        lifecycle: "adopted",
        kind: "map_amendment",
      },
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/matter/${MATTER_ID}`);
  });

  it("distinguishes an official not-found response from source failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ message: "not found" }, 404)));
    const res = await GET(request("recordNumber=O2026-0023281"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ status: "not_found", matter: null });
  });

  it("fails closed when the source response is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ matterId: MATTER_ID })));
    const res = await GET(request(`matterId=${MATTER_ID}`));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await expect(res.json()).resolves.toMatchObject({ status: "unavailable", matter: null });
  });
});

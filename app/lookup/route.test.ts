import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/lookup", () => {
  it("redirects a typed address into an instant location snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return Response.json({
          lat: 41.73683,
          lon: -87.57776,
          displayName: "8701 S Bennett Ave, Chicago, IL 60617",
        });
      })
    );

    const request = new NextRequest("https://example.com/lookup?addr=8701%20S%20Bennett");
    const response = await GET(request);
    const location = response.headers.get("location") ?? "";

    expect(response.status).toBe(307);
    expect(location).toContain("/report?instant=true");
    expect(location).toContain("lat=41.73683");
    expect(location).toContain("lon=-87.57776");
    expect(location).toContain("addr=8701+S+Bennett+Ave%2C+Chicago%2C+IL+60617");
  });

  it("preserves the entered address when geocoding does not find a match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Address not found" }, { status: 404 }))
    );

    const request = new NextRequest("https://example.com/lookup?address=not%20a%20place");
    const response = await GET(request);
    const location = response.headers.get("location") ?? "";

    expect(response.status).toBe(307);
    expect(location).toContain("/report?addr=not+a+place");
    expect(location).toContain("lookup=not-found");
  });

  it("sends empty lookups back to the homepage", async () => {
    const request = new NextRequest("https://example.com/lookup");
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/?lookup=missing-address");
  });
});

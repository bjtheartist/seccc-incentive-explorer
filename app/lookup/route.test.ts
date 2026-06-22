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

  it("carries whitelisted extension source into the instant report redirect", async () => {
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

    const request = new NextRequest(
      "https://example.com/lookup?addr=8701%20S%20Bennett&source=chrome-extension"
    );
    const response = await GET(request);
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe("/report");
    expect(location.searchParams.get("instant")).toBe("true");
    expect(location.searchParams.get("source")).toBe("chrome-extension");
  });

  it("drops unrecognized source values from redirects", async () => {
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

    const request = new NextRequest(
      "https://example.com/lookup?addr=8701%20S%20Bennett&source=anything-else"
    );
    const response = await GET(request);
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("source")).toBeNull();
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

  it("treats non-finite geocode payloads as not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          lat: "41.73683",
          lon: "-87.57776",
          displayName: "8701 S Bennett Ave, Chicago, IL 60617",
        })
      )
    );

    const request = new NextRequest(
      "https://example.com/lookup?addr=8701%20S%20Bennett&source=chrome-extension"
    );
    const response = await GET(request);
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe("/report");
    expect(location.searchParams.get("lookup")).toBe("not-found");
    expect(location.searchParams.get("source")).toBe("chrome-extension");
  });

  it("preserves the address and source when geocoding is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const request = new NextRequest(
      "https://example.com/lookup?addr=8701%20S%20Bennett&source=chrome-extension"
    );
    const response = await GET(request);
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe("/report");
    expect(location.searchParams.get("addr")).toBe("8701 S Bennett");
    expect(location.searchParams.get("lookup")).toBe("geocode-unavailable");
    expect(location.searchParams.get("source")).toBe("chrome-extension");
  });

  it("sends empty lookups back to the homepage", async () => {
    const request = new NextRequest("https://example.com/lookup");
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/?lookup=missing-address");
  });
});

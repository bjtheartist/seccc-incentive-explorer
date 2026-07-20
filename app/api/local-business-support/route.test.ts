import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("/api/local-business-support", () => {
  it("merges citywide legal resources into community-area support results", async () => {
    const request = new NextRequest("http://localhost/api/local-business-support?ca=46");
    const response = await GET(request);
    const payload = await response.json();

    const lane = payload.organizations.find((org: { name: string }) =>
      org.name.includes("Legal Aid for New Entrepreneurs")
    );

    expect(response.status).toBe(200);
    expect(payload.communityArea).toBe("South Chicago");
    expect(payload.organizationCount).toBe(payload.organizations.length);
    expect(payload.coverage.ssa).toBe(
      "SSA #5 Commercial Ave. (Calumet Area Industrial Commission)"
    );
    expect(
      payload.organizations.find(
        (org: { name: string }) => org.name === "Calumet Area Industrial Commission"
      )?.relationships
    ).toContain("ssa_provider");
    expect(
      payload.organizations.some(
        (org: { name: string }) => org.name === "South Chicago Parents and Friends, Inc."
      )
    ).toBe(false);
    expect(lane).toMatchObject({
      name: "Legal Aid for New Entrepreneurs (LANE)",
      website: "https://lanechicago.org/legal_help",
      relationships: ["legal_support"],
    });
    expect(payload.sourceUrls).toContain("https://lanechicago.org/legal_help");
  });
});

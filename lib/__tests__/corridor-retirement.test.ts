import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("retired Corridor Signals routes", () => {
  it("permanently redirects the index and ZIP pages to the main map", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/corridors",
          destination: "/map",
          permanent: true,
        },
        {
          source: "/corridors/:path*",
          destination: "/map",
          permanent: true,
        },
      ]),
    );
  });
});

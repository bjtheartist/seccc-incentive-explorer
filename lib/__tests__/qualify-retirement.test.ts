import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

/**
 * review9 gate finding F3 — the /qualify permanent redirect
 * (next.config.ts) was unpinned: deleting the redirect block left the
 * suite green. Same precedent as lib/__tests__/corridor-retirement.test.ts
 * for the earlier /corridors sunset.
 */
describe("retired Program Fit Questions surface", () => {
  it("permanently redirects /qualify to the homepage", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/qualify",
          destination: "/",
          permanent: true,
        },
      ]),
    );
  });
});

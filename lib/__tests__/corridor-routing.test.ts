import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Corridor Intelligence routing", () => {
  it("leaves the restored index accessible and redirects legacy ZIP links to the preview", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects?.some((rule) => rule.source === "/corridors" || rule.source === "/corridors/:path*")).toBe(false);
    expect(redirects).toContainEqual({ source: "/corridors/:zip", destination: "/corridors", permanent: false });
    expect(redirects).toContainEqual({ source: "/qualify", destination: "/", permanent: true });
  });
});

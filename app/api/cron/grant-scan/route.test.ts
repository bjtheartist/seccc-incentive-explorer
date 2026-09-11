import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";
vi.mock("@/lib/grants/scanner", () => ({
  scanSources: vi.fn(async () => ({ scanned: 0, results: [] })),
}));
afterEach(() => vi.unstubAllEnvs());
it("fails closed even in development when CRON_SECRET is missing", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect(
    (
      await GET(
        new Request("https://test/api/cron/grant-scan", {
          headers: { authorization: "Bearer undefined" },
        }),
      )
    ).status,
  ).toBe(401);
});
it("requires an explicit scanner activation flag", async () => {
  vi.stubEnv("CRON_SECRET", "secret");
  vi.stubEnv("GRANTS_SCAN_ENABLED", "");
  const r = await GET(
    new Request("https://test/api/cron/grant-scan", {
      headers: { authorization: "Bearer secret" },
    }),
  );
  expect(await r.json()).toMatchObject({ skipped: true });
});
it("runs authorized and activated scans", async () => {
  vi.stubEnv("CRON_SECRET", "secret");
  vi.stubEnv("GRANTS_SCAN_ENABLED", "true");
  const r = await GET(
    new Request("https://test/api/cron/grant-scan", {
      headers: { authorization: "Bearer secret" },
    }),
  );
  expect(await r.json()).toMatchObject({ scanned: 0 });
});

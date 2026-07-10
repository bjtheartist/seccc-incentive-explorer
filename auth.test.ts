import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("auth providers", () => {
  it("does not advertise Google when OAuth credentials are absent", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");

    const { authOptions } = await import("./auth");

    expect(authOptions.providers.map((provider) => provider.id)).toEqual([
      "credentials",
    ]);
  });

  it("enables Google only when both OAuth credentials are present", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");

    const { authOptions } = await import("./auth");

    expect(authOptions.providers.map((provider) => provider.id)).toEqual([
      "google",
      "credentials",
    ]);
  });
});

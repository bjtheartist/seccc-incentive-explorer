import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { redeemMock, configuredMock } = vi.hoisted(() => ({
  redeemMock: vi.fn(),
  configuredMock: vi.fn(),
}));

vi.mock("@/lib/investment-share-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investment-share-session")>()),
  isInvestmentShareConfigured: configuredMock,
}));
vi.mock("@/lib/investment-share-links-storage", () => ({
  InvestmentShareLinkStorageUnavailableError: class InvestmentShareLinkStorageUnavailableError extends Error {},
  redeemInvestmentShareLink: redeemMock,
}));

import { GET } from "./route";
import { InvestmentShareLinkStorageUnavailableError } from "@/lib/investment-share-links-storage";

function open(token = "raw-token") {
  return GET(new NextRequest(`http://localhost/investment/share/${token}`), {
    params: Promise.resolve({ token }),
  });
}

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret";
  configuredMock.mockReset().mockReturnValue(true);
  redeemMock.mockReset();
});

describe("GET /investment/share/[token]", () => {
  it("exchanges a live token for a signed partner cookie and lands on the analysis", async () => {
    redeemMock.mockResolvedValue({
      id: "5",
      label: "Partner",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      revokedAt: "",
    });
    const response = await open();
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("Location") || "").pathname).toBe("/investment");
    const cookie = response.cookies.get("cie_investment_share");
    expect(cookie?.value.startsWith("5.")).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.maxAge).toBeGreaterThan(6 * 24 * 3600);
    expect(redeemMock).toHaveBeenCalledWith("raw-token");
  });

  it("sends an unknown, expired, or revoked token back to the gate with a notice and no cookie", async () => {
    redeemMock.mockResolvedValue(null);
    const response = await open("nope");
    const location = new URL(response.headers.get("Location") || "");
    expect(location.pathname).toBe("/investment");
    expect(location.searchParams.get("share")).toBe("invalid");
    expect(response.cookies.get("cie_investment_share")).toBeUndefined();
  });

  it("reports storage trouble as unavailable rather than invalid", async () => {
    redeemMock.mockRejectedValue(new InvestmentShareLinkStorageUnavailableError("down"));
    const location = new URL((await open()).headers.get("Location") || "");
    expect(location.searchParams.get("share")).toBe("unavailable");
  });

  it("refuses to mint sessions when no signing secret is configured", async () => {
    configuredMock.mockReturnValue(false);
    const location = new URL((await open()).headers.get("Location") || "");
    expect(location.searchParams.get("share")).toBe("unavailable");
    expect(redeemMock).not.toHaveBeenCalled();
  });
});

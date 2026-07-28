import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Print-brief GATE behavior. The page delegates its admin check to
 * getInvestmentAdminState() (the shared Owner Files gate). We mock that module
 * so we can drive the two gate branches without a request scope, and stub the
 * echarts-backed sankey so importing the page never loads the chart engine.
 */

vi.mock("@/app/investment/gate", () => ({
  getInvestmentAdminState: vi.fn(),
  InvestmentNotConfigured: function InvestmentNotConfigured() {
    return null;
  },
  InvestmentLoginForm: function InvestmentLoginForm() {
    return null;
  },
}));

vi.mock("@/components/investment/FunderFlowSankey", () => ({
  FunderFlowSankey: function FunderFlowSankey() {
    return null;
  },
}));

import * as gate from "@/app/investment/gate";
import Page from "./page";

const mockState = vi.mocked(gate.getInvestmentAdminState);

type GateProps = { redirectTo?: string; hasAuthError?: boolean };

function render(area = "South Shore", searchParams: Record<string, string> = {}) {
  return Page({
    params: Promise.resolve({ area }),
    searchParams: Promise.resolve(searchParams),
  }) as Promise<ReactElement<GateProps>>;
}

describe("GET /print/investment/[area] — gate", () => {
  beforeEach(() => {
    mockState.mockReset();
  });

  it("renders the not-configured screen when the admin gate is unset", async () => {
    mockState.mockResolvedValue({ configured: false, hasSession: false });
    const el = await render();
    expect(el.type).toBe(gate.InvestmentNotConfigured);
  });

  it("renders the password wall (no session) and never reaches the brief", async () => {
    mockState.mockResolvedValue({ configured: true, hasSession: false });
    const el = await render("South Shore");
    expect(el.type).toBe(gate.InvestmentLoginForm);
    // Redirects into the /investment tree (the login route only allows that path).
    expect(el.props.redirectTo).toBe("/investment/South Shore");
    expect(el.props.hasAuthError).toBe(false);
  });

  it("passes an error flag through to the password wall", async () => {
    mockState.mockResolvedValue({ configured: true, hasSession: false });
    const el = await render("South Shore", { error: "1" });
    expect(el.type).toBe(gate.InvestmentLoginForm);
    expect(el.props.hasAuthError).toBe(true);
  });
});

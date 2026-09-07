// @vitest-environment jsdom
import React, { lazy, Suspense } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadConversation, trackEvent } = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<React.ComponentType<{ pageContext: { pageLabel: string } }>>) => {
    const Component = lazy(async () => { loadConversation(); return { default: await loader() }; });
    return (props: { pageContext: { pageLabel: string } }) => <Suspense fallback={<span>Loading chat</span>}><Component {...props} /></Suspense>;
  },
}));
vi.mock("../ConciergeConversation", () => ({
  ConciergeConversation: ({ pageContext }: { pageContext: { pageLabel: string } }) => <div role="complementary">{pageContext.pageLabel}</div>,
}));
vi.mock("@/lib/analytics-events", () => ({ trackEvent }));
import { ConciergePanel } from "../ConciergePanel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: true }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("guide startup", () => {
  it("does not import chat until opened, then preserves it across page changes", async () => {
    const view = render(<ConciergePanel pageContext={{ route: "/map", pageLabel: "Map" }} />);
    const trigger = await screen.findByRole("button", { name: "Open Incentive Guide" });
    expect(loadConversation).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    expect(await screen.findByRole("complementary")).toBeTruthy();
    expect(loadConversation).toHaveBeenCalledTimes(1);
    view.rerender(<ConciergePanel pageContext={{ route: "/programs", pageLabel: "Programs" }} />);
    await waitFor(() => expect(screen.getByRole("complementary").textContent).toBe("Programs"));
    expect(loadConversation).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps a disabled guide out of the page", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) } as Response);
    render(<ConciergePanel pageContext={{ route: "/", pageLabel: "Home" }} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button")).toBeNull();
    expect(loadConversation).not.toHaveBeenCalled();
  });

  it("hides its launcher while a modal is open and restores it when closed", async () => {
    render(<ConciergePanel pageContext={{ route: "/report", pageLabel: "Report" }} />);
    await screen.findByRole("button", { name: "Open Incentive Guide" });
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    dialog.remove();
    await screen.findByRole("button", { name: "Open Incentive Guide" });
    expect(loadConversation).not.toHaveBeenCalled();
  });
});

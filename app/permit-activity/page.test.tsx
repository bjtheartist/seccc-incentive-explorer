// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PermitActivityLandingPage from "./page";

const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockReset();
});

afterEach(cleanup);

describe("Permit Activity neighborhood selection", () => {
  it("asks for a neighborhood before opening a community-area analysis", () => {
    render(<PermitActivityLandingPage />);

    expect(
      screen.getByRole("heading", { name: "What neighborhood do you want to view?" }),
    ).toBeTruthy();

    const selector = screen.getByRole("combobox", { name: "Neighborhood" });
    const openButton = screen.getByRole("button", { name: "View permit activity" });

    expect(screen.getAllByRole("option")).toHaveLength(78);
    expect((selector as HTMLSelectElement).value).toBe("");
    expect((openButton as HTMLButtonElement).disabled).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.change(selector, { target: { value: "o-hare" } });
    expect((openButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(openButton);

    expect(mockPush).toHaveBeenCalledWith("/permit-activity/o-hare");
  });
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CaseCardLink } from "@/components/vacancy/CaseCardLink";

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  window.history.replaceState(null, "", "/");
});

describe("CaseCardLink", () => {
  it("keeps current workspace filters and anchors the hydrated destination to the results", () => {
    window.history.replaceState(
      null,
      "",
      "/vacancy/60617?view=map&q=Commercial&universe=land&bounds=-87.6000%2C41.7000%2C-87.5000%2C41.8000",
    );

    render(
      <CaseCardLink
        zip="60617"
        caseKey="property-review"
        initialHref="/vacancy/60617?case=property-review#case-results"
        selected={false}
        className=""
      >
        Investigate a property
      </CaseCardLink>,
    );

    const link = screen.getByRole("link", { name: "Investigate a property" });
    fireEvent.mouseEnter(link);

    const destination =
      "/vacancy/60617?case=property-review&view=map&q=Commercial&universe=land&bounds=-87.6000%2C41.7000%2C-87.5000%2C41.8000#case-results";
    expect(link.getAttribute("href")).toBe(destination);

    fireEvent.click(link);
    expect(pushMock).toHaveBeenCalledWith(destination);
  });
});

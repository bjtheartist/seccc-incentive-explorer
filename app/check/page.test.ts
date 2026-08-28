import { beforeEach, describe, expect, it, vi } from "vitest";

const permanentRedirectMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  permanentRedirect: permanentRedirectMock,
}));

import RetiredCheckPage from "./page";
import { buildRetiredCheckDestination } from "@/lib/check-retirement";

describe("retired Quick Address Check pathway", () => {
  beforeEach(() => permanentRedirectMock.mockClear());

  it("sends a bare legacy route to the Site Incentive Analysis entry screen", () => {
    expect(buildRetiredCheckDestination({})).toBe("/report");
  });

  it("carries a resolved legacy point and its useful context into the report", () => {
    const destination = buildRetiredCheckDestination({
      lat: "41.74400",
      lon: "-87.57750",
      address: "9133 S Stony Island Ave",
      sector: "retail",
      sa: "encoded-survey",
    });
    const url = new URL(destination, "https://example.test");

    expect(url.pathname).toBe("/report");
    expect(url.searchParams.get("instant")).toBe("true");
    expect(url.searchParams.get("lat")).toBe("41.744");
    expect(url.searchParams.get("lon")).toBe("-87.5775");
    expect(url.searchParams.get("addr")).toBe("9133 S Stony Island Ave");
    expect(url.searchParams.get("sector")).toBe("retail");
    expect(url.searchParams.get("sa")).toBe("encoded-survey");
    expect(url.searchParams.get("src")).toBe("address_search");
  });

  it("does not start an instant report from incomplete or malformed coordinates", () => {
    expect(buildRetiredCheckDestination({ lat: "41.744" })).toBe("/report");
    expect(
      buildRetiredCheckDestination({ lat: "bad", lon: "-87.5775" }),
    ).toBe("/report");
  });

  it("does not start an instant report outside the retired Chicago coverage area", () => {
    expect(buildRetiredCheckDestination({ lat: "0", lon: "0" })).toBe(
      "/report",
    );
    expect(
      buildRetiredCheckDestination({ lat: "41.744", lon: "-87.49" }),
    ).toBe("/report");
  });

  it("permanently redirects the retired route", async () => {
    await RetiredCheckPage({
      searchParams: Promise.resolve({
        lat: "41.744",
        lon: "-87.5775",
        addr: "9133 S Stony Island Ave",
      }),
    });

    expect(permanentRedirectMock).toHaveBeenCalledOnce();
    expect(permanentRedirectMock).toHaveBeenCalledWith(
      "/report?instant=true&lat=41.744&lon=-87.5775&addr=9133+S+Stony+Island+Ave&src=address_search",
    );
  });
});

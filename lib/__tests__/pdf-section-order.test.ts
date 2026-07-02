import { describe, expect, it } from "vitest";
import { orderSectionsForPdf } from "../pdf-report";
import type { GeneratedReport } from "../report-engine";

function section(title: string): GeneratedReport["sections"][number] {
  return { title, items: [] };
}

describe("orderSectionsForPdf", () => {
  it("moves Your Support Network directly after Eligible Incentive Programs", () => {
    const input = [
      section("Site Overview"),
      section("Neighborhood Economic Context"),
      section("Incentive Density & Stacking"),
      section("Eligible Incentive Programs"),
      section("Additional Programs to Explore"),
      section("Required Documents"),
      section("Your Support Network"),
    ];
    const titles = orderSectionsForPdf(input).map((s) => s.title);
    expect(titles).toEqual([
      "Site Overview",
      "Neighborhood Economic Context",
      "Incentive Density & Stacking",
      "Eligible Incentive Programs",
      "Your Support Network",
      "Additional Programs to Explore",
      "Required Documents",
    ]);
  });

  it("puts Your Support Network first when Eligible Incentive Programs is absent", () => {
    const input = [
      section("Market Signal Summary"),
      section("Your Support Network"),
      section("Data Sources"),
    ];
    const titles = orderSectionsForPdf(input).map((s) => s.title);
    expect(titles[0]).toBe("Your Support Network");
    expect(titles).toHaveLength(3);
  });

  it("returns sections unchanged when there is no Support Network section", () => {
    const input = [section("A"), section("B"), section("C")];
    expect(orderSectionsForPdf(input).map((s) => s.title)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      section("Eligible Incentive Programs"),
      section("Required Documents"),
      section("Your Support Network"),
    ];
    const before = input.map((s) => s.title);
    orderSectionsForPdf(input);
    expect(input.map((s) => s.title)).toEqual(before);
  });
});

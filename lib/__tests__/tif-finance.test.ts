import { describe, expect, it } from "vitest";
import {
  mapTifAnnualFinanceRow,
  normalizeTifKey,
  parseTifNumber,
} from "@/lib/tif-finance";

describe("TIF finance helpers", () => {
  it("normalizes mixed source TIF ids to the City annual-report key", () => {
    expect(normalizeTifKey("T- 87")).toBe("T-087");
    expect(normalizeTifKey("T-087")).toBe("T-087");
    expect(normalizeTifKey("T-T-087")).toBe("T-087");
    expect(normalizeTifKey("87")).toBe("T-087");
    expect(normalizeTifKey("")).toBeNull();
  });

  it("parses currency-like values while preserving blanks as null", () => {
    expect(parseTifNumber("$1,234")).toBe(1234);
    expect(parseTifNumber("(1,234)")).toBe(-1234);
    expect(parseTifNumber("0")).toBe(0);
    expect(parseTifNumber("")).toBeNull();
    expect(parseTifNumber("not a number")).toBeNull();
  });

  it("maps annual report rows into conservative district finance context", () => {
    const context = mapTifAnnualFinanceRow(
      {
        tif_number: "T-087",
        tif_district: "Fullerton/Milwaukee",
        report_year: "2024",
        fund_balance: "63162041",
        property_tax_increment_current: "21911518",
        total_expenditure: "24619936",
        amount_designated_project_costs: "63011079",
        surplus_deficit: "150962",
      },
      {
        districtId: "T-087",
        rawDistrictId: "T- 87",
        districtName: "Fullerton/Milwaukee",
        expirationDate: "12/31/2027",
        boundaryWards: "1,26,30,31,35",
      }
    );

    expect(context.districtId).toBe("T-087");
    expect(context.rawDistrictId).toBe("T- 87");
    expect(context.reportYear).toBe(2024);
    expect(context.expirationYear).toBe(2027);
    expect(context.fundBalance).toBe(63162041);
    expect(context.amountDesignatedProjectCosts).toBe(63011079);
    expect(context.caution).toContain("Not proof of funding availability");
  });
});

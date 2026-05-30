import { describe, expect, it } from "vitest";
import {
  buildTifFinancialContext,
  normalizeTifNumber,
  parseTifMoney,
} from "../tif-financials";

describe("tif financial helpers", () => {
  it("normalizes city and boundary TIF number formats", () => {
    expect(normalizeTifNumber("T- 87")).toBe("T-087");
    expect(normalizeTifNumber("T-087")).toBe("T-087");
    expect(normalizeTifNumber("T-178")).toBe("T-178");
    expect(normalizeTifNumber("")).toBeNull();
  });

  it("parses reported money values without treating blanks as zero", () => {
    expect(parseTifMoney("44853370")).toBe(44853370);
    expect(parseTifMoney("$44,853,370")).toBe(44853370);
    expect(parseTifMoney("0")).toBe(0);
    expect(parseTifMoney("")).toBeNull();
  });

  it("builds conservative district-level context from annual report rows", () => {
    const context = buildTifFinancialContext(
      {
        tifNumber: "T-087",
        districtName: "Fullerton/Milwaukee",
        wards: "1,26,30,31,35",
        expirationDate: "12/31/2027",
      },
      {
        tif_number: "T-087",
        tif_district: "Fullerton/Milwaukee",
        report_year: "2024",
        fund_balance: "44853370",
        property_tax_increment_current: "1200000",
        total_expenditure: "900000",
        amount_designated_debt_obligations: "100000",
        amount_designated_project_costs: "700000",
        surplus_deficit: "0",
      }
    );

    expect(context).toMatchObject({
      districtName: "Fullerton/Milwaukee",
      tifNumber: "T-087",
      reportYear: 2024,
      fundBalance: 44853370,
      currentYearIncrement: 1200000,
      annualExpenditures: 900000,
      designatedDebtObligations: 100000,
      designatedProjectCosts: 700000,
      surplusDeficit: 0,
    });
    expect(context.caution).toContain("not a guarantee of funding availability");
  });
});

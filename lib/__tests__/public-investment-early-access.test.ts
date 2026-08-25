import { describe, expect, it } from "vitest";
import {
  PublicInvestmentEarlyAccessSchema,
  publicInvestmentEarlyAccessToCsv,
} from "@/lib/public-investment-early-access";

describe("PublicInvestmentEarlyAccessSchema", () => {
  it("captures and normalizes the required name, title, and email", () => {
    const parsed = PublicInvestmentEarlyAccessSchema.parse({
      name: "  Billy   N.  ",
      title: "  Executive   Director ",
      email: " BILLY@EXAMPLE.COM ",
    });

    expect(parsed).toMatchObject({
      name: "Billy N.",
      title: "Executive Director",
      email: "billy@example.com",
    });
  });

  it("rejects an incomplete contact", () => {
    expect(
      PublicInvestmentEarlyAccessSchema.safeParse({
        name: "Billy",
        title: "",
        email: "not-an-email",
      }).success,
    ).toBe(false);
  });

  it("exports formula-safe CSV", () => {
    const csv = publicInvestmentEarlyAccessToCsv([
      {
        name: "=IMPORTXML()",
        title: "Director",
        email: "billy@example.com",
        requestedAt: "2026-08-24T12:00:00.000Z",
      },
    ]);
    expect(csv).toContain('"\'=IMPORTXML()"');
    expect(csv).toContain('"Email Address"');
  });
});

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
      organization: "  South East   Chicago Commission ",
      useCase: "  Compare public and philanthropic funding patterns. ",
      email: " BILLY@EXAMPLE.COM ",
    });

    expect(parsed).toMatchObject({
      name: "Billy N.",
      title: "Executive Director",
      organization: "South East Chicago Commission",
      useCase: "Compare public and philanthropic funding patterns.",
      email: "billy@example.com",
    });
  });

  it("rejects an incomplete contact", () => {
    expect(
      PublicInvestmentEarlyAccessSchema.safeParse({
        name: "Billy",
        title: "",
        organization: "SECC",
        useCase: "Too short",
        email: "not-an-email",
      }).success,
    ).toBe(false);
  });

  it("exports formula-safe CSV", () => {
    const csv = publicInvestmentEarlyAccessToCsv([
      {
        name: "=IMPORTXML()",
        title: "Director",
        organization: "SECC",
        useCase: "Compare neighborhood funding patterns.",
        email: "billy@example.com",
        status: "approved",
        emailVerifiedAt: "2026-08-24T11:00:00.000Z",
        approvedAt: "2026-08-24T11:30:00.000Z",
        requestedAt: "2026-08-24T12:00:00.000Z",
      },
    ]);
    expect(csv).toContain('"\'=IMPORTXML()"');
    expect(csv).toContain('"Email Address"');
  });
});

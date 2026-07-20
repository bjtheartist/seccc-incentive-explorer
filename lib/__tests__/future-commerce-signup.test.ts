import { describe, expect, it } from "vitest";
import {
  FutureCommerceSignupSchema,
  futureCommerceSignupsToCsv,
} from "@/lib/future-commerce-signup";

describe("FutureCommerceSignupSchema", () => {
  it("normalizes the four requested contact and location fields", () => {
    const parsed = FutureCommerceSignupSchema.parse({
      email: "  OWNER@Example.com ",
      neighborhood: "  South   Chicago ",
      address: "  1234 E 87th Street  ",
      zipCode: "60617",
      consent: true,
    });

    expect(parsed).toMatchObject({
      email: "owner@example.com",
      neighborhood: "South Chicago",
      address: "1234 E 87th Street",
      zipCode: "60617",
      consent: true,
    });
  });

  it("requires explicit consent and a five-digit ZIP code", () => {
    const parsed = FutureCommerceSignupSchema.safeParse({
      email: "owner@example.com",
      neighborhood: "South Chicago",
      address: "1234 E 87th Street",
      zipCode: "6061",
      consent: false,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.zipCode).toBeDefined();
      expect(parsed.error.flatten().fieldErrors.consent).toBeDefined();
    }
  });
});

describe("futureCommerceSignupsToCsv", () => {
  it("exports the requested fields and neutralizes spreadsheet formulas", () => {
    const csv = futureCommerceSignupsToCsv([
      {
        email: "owner@example.com",
        neighborhood: '=HYPERLINK("https://example.com")',
        address: "1234 E 87th Street, Suite 2",
        zipCode: "60617",
        signedUpAt: "2026-07-20T18:00:00.000Z",
      },
    ]);

    expect(csv).toContain('"Email Address","Neighborhood","Business or Project Address","ZIP Code","Signed Up At"');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"1234 E 87th Street, Suite 2"');
  });
});

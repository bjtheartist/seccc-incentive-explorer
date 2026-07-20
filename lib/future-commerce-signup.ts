import { z } from "zod";

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .transform((value) => value.replace(/\s+/g, " "));

export const FUTURE_COMMERCE_CONSENT_VERSION = "future-commerce-2026-v1";
export const FUTURE_COMMERCE_SOURCE = "future-of-commerce-2026";

export const FutureCommerceSignupSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter an email address.")
    .max(254)
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  neighborhood: cleanText(2, 100),
  address: cleanText(5, 220),
  zipCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Enter a five-digit ZIP code."),
  consent: z.literal(true, {
    error: "Consent is required to join the email list.",
  }),
  website: z.string().max(200).optional().default(""),
});

export type FutureCommerceSignupInput = z.infer<typeof FutureCommerceSignupSchema>;

export interface FutureCommerceSignupCsvRow {
  email: string;
  neighborhood: string;
  address: string;
  zipCode: string;
  signedUpAt: string;
}

function csvCell(value: string): string {
  const flattened = value.replace(/[\r\n]+/g, " ").trim();
  const formulaSafe = /^[=+\-@]/.test(flattened) ? `'${flattened}` : flattened;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

export function futureCommerceSignupsToCsv(
  rows: FutureCommerceSignupCsvRow[],
): string {
  const lines = [
    ["Email Address", "Neighborhood", "Business or Project Address", "ZIP Code", "Signed Up At"],
    ...rows.map((row) => [
      row.email,
      row.neighborhood,
      row.address,
      row.zipCode,
      row.signedUpAt,
    ]),
  ];

  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

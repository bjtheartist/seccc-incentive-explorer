import { z } from "zod";

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .transform((value) => value.replace(/\s+/g, " "));

export const PUBLIC_INVESTMENT_EARLY_ACCESS_SOURCE =
  "public-investment-analysis-beta-2026";

export const PublicInvestmentEarlyAccessSchema = z.object({
  name: cleanText(2, 120),
  title: cleanText(2, 160),
  email: z
    .string()
    .trim()
    .min(1, "Enter an email address.")
    .max(254)
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  website: z.string().max(200).optional().default(""),
});

export type PublicInvestmentEarlyAccessInput = z.infer<
  typeof PublicInvestmentEarlyAccessSchema
>;

export interface PublicInvestmentEarlyAccessCsvRow {
  name: string;
  title: string;
  email: string;
  requestedAt: string;
}

function csvCell(value: string): string {
  const flattened = value.replace(/[\r\n]+/g, " ").trim();
  const formulaSafe = /^[=+\-@]/.test(flattened) ? `'${flattened}` : flattened;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

export function publicInvestmentEarlyAccessToCsv(
  rows: PublicInvestmentEarlyAccessCsvRow[],
): string {
  const lines = [
    ["Name", "Title", "Email Address", "Requested At"],
    ...rows.map((row) => [row.name, row.title, row.email, row.requestedAt]),
  ];

  return lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

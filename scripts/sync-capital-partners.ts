#!/usr/bin/env npx tsx
/**
 * Upsert the curated capital-partner registry into Postgres.
 *
 * SBA roles are factual directory metadata. They are not approval signals,
 * rankings, or estimates of financing available to a business.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/sync-capital-partners.ts
 *   npx tsx scripts/sync-capital-partners.ts --dry-run
 */

import { readFileSync } from "fs";
import { join } from "path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import {
  parseCapitalPartnerRegistry,
  type CapitalPartner,
  type PartnerProduct,
} from "../lib/capital-partners";

const DRY_RUN = process.argv.includes("--dry-run");
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const registryPath = join(process.cwd(), "data", "curated", "capital_partners.json");
const registry = parseCapitalPartnerRegistry(
  JSON.parse(readFileSync(registryPath, "utf8")) as unknown
);

type SqlClient = NeonQueryFunction<false, false>;

function validateRegistry(): void {
  const partnerIds = new Set<string>();
  const productIds = new Set<string>();

  for (const partner of registry.partners) {
    if (partnerIds.has(partner.id)) {
      throw new Error(`Duplicate partner id: ${partner.id}`);
    }
    partnerIds.add(partner.id);

    for (const product of partner.products) {
      if (productIds.has(product.id)) {
        throw new Error(`Duplicate product id: ${product.id}`);
      }
      productIds.add(product.id);
    }
  }
}

function cents(usd: number | undefined): number | null {
  return typeof usd === "number" && Number.isFinite(usd) ? Math.round(usd * 100) : null;
}

async function upsertPartner(
  sql: SqlClient,
  partner: CapitalPartner
): Promise<void> {
  await sql`
    INSERT INTO partners (
      id, name, partner_type, website, intake_url, contact_email, phone, address,
      lat, lon, report_types, requires_project_context, certifications, sba_roles,
      verification_status, source_url, source_date, last_verified_at, active, notes,
      updated_at
    )
    VALUES (
      ${partner.id},
      ${partner.name},
      ${partner.partnerType},
      ${partner.website ?? null},
      ${partner.intakeUrl ?? null},
      ${partner.contactEmail ?? null},
      ${partner.phone ?? null},
      ${partner.address ?? null},
      ${partner.lat ?? null},
      ${partner.lon ?? null},
      ${JSON.stringify(partner.reportTypes ?? [])}::jsonb,
      ${partner.requiresProjectContext ?? false},
      ${JSON.stringify(partner.certifications ?? [])}::jsonb,
      ${JSON.stringify(partner.sbaRoles ?? [])}::jsonb,
      ${partner.verificationStatus},
      ${partner.sourceUrl ?? null},
      ${partner.sourceDate ?? null},
      ${partner.lastVerifiedAt ?? null},
      ${partner.active !== false},
      ${partner.notes ?? null},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      partner_type = EXCLUDED.partner_type,
      website = EXCLUDED.website,
      intake_url = EXCLUDED.intake_url,
      contact_email = EXCLUDED.contact_email,
      phone = EXCLUDED.phone,
      address = EXCLUDED.address,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      report_types = EXCLUDED.report_types,
      requires_project_context = EXCLUDED.requires_project_context,
      certifications = EXCLUDED.certifications,
      sba_roles = EXCLUDED.sba_roles,
      verification_status = EXCLUDED.verification_status,
      source_url = EXCLUDED.source_url,
      source_date = EXCLUDED.source_date,
      last_verified_at = EXCLUDED.last_verified_at,
      active = EXCLUDED.active,
      notes = EXCLUDED.notes,
      updated_at = NOW()
  `;

  await sql`DELETE FROM partner_service_areas WHERE partner_id = ${partner.id}`;
  for (const area of partner.serviceAreas) {
    await sql`
      INSERT INTO partner_service_areas (partner_id, scope, area_value)
      VALUES (${partner.id}, ${area.scope}, ${area.value ?? ""})
      ON CONFLICT (partner_id, scope, area_value) DO NOTHING
    `;
  }

  for (const product of partner.products) {
    await upsertProduct(sql, partner.id, product);
  }
}

async function upsertProduct(
  sql: SqlClient,
  partnerId: string,
  product: PartnerProduct
): Promise<void> {
  await sql`
    INSERT INTO partner_products (
      id, partner_id, product_type, product_name, public_fit_note,
      project_types, proposed_uses, industries, min_amount_cents, max_amount_cents,
      verification_status, source_url, source_date, active, updated_at
    )
    VALUES (
      ${product.id},
      ${partnerId},
      ${product.productType},
      ${product.productName ?? null},
      ${product.publicFitNote ?? null},
      ${JSON.stringify(product.projectTypes ?? [])}::jsonb,
      ${JSON.stringify(product.proposedUses ?? [])}::jsonb,
      ${JSON.stringify(product.industries ?? [])}::jsonb,
      ${cents(product.minUsd)},
      ${cents(product.maxUsd)},
      ${product.verificationStatus ?? "unverified"},
      ${product.sourceUrl ?? null},
      ${product.sourceDate ?? null},
      ${product.active !== false},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      partner_id = EXCLUDED.partner_id,
      product_type = EXCLUDED.product_type,
      product_name = EXCLUDED.product_name,
      public_fit_note = EXCLUDED.public_fit_note,
      project_types = EXCLUDED.project_types,
      proposed_uses = EXCLUDED.proposed_uses,
      industries = EXCLUDED.industries,
      min_amount_cents = EXCLUDED.min_amount_cents,
      max_amount_cents = EXCLUDED.max_amount_cents,
      verification_status = EXCLUDED.verification_status,
      source_url = EXCLUDED.source_url,
      source_date = EXCLUDED.source_date,
      active = EXCLUDED.active,
      updated_at = NOW()
  `;
}

async function main(): Promise<void> {
  validateRegistry();

  const productCount = registry.partners.reduce(
    (total, partner) => total + partner.products.length,
    0
  );
  const serviceAreaCount = registry.partners.reduce(
    (total, partner) => total + partner.serviceAreas.length,
    0
  );

  if (DRY_RUN) {
    console.log(
      `Validated ${registry.partners.length} partners, ${productCount} products, and ${serviceAreaCount} service areas.`
    );
    return;
  }

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL or POSTGRES_URL environment variable is required");
  }

  const sql = neon(DATABASE_URL);
  for (const partner of registry.partners) {
    await upsertPartner(sql, partner);
  }

  console.log(
    `Synced ${registry.partners.length} partners, ${productCount} products, and ${serviceAreaCount} service areas.`
  );
}

main().catch((error) => {
  console.error("Capital partner sync failed:", error);
  process.exit(1);
});

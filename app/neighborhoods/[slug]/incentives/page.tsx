import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin, Phone, ExternalLink, Building2 } from "lucide-react";

import {
  findCommunityAreaBySlug,
  allNeighborhoodSlugs,
} from "@/lib/neighborhood-slugs";
import { pageMetadata, buildFaqJsonLd, buildTrailJsonLd } from "@/lib/seo";
import { getNeighborhoodPageData } from "@/lib/neighborhood-page-data";
import { getCorridorSignalsForCommunityArea } from "@/lib/neighborhood-corridor";
import { JsonLd } from "@/components/seo/JsonLd";
import { SnapshotCTA } from "@/components/seo/SnapshotCTA";
import { NeighborhoodSnapshotButton } from "@/components/seo/NeighborhoodSnapshotButton";
import { DataRow, ContextNotProofFootnote } from "@/components/corridors/CorridorSignalsUI";

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return allNeighborhoodSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const ca = findCommunityAreaBySlug(slug);
  if (!ca) {
    return pageMetadata({
      title: "Neighborhood Not Found",
      description:
        "Explore Chicago business incentives, vacancy signals, and local support by neighborhood.",
      path: `/neighborhoods/${slug}/incentives`,
    });
  }

  const description =
    `What business incentives are available in ${ca.name}, Chicago? Explore the ` +
    `incentive zones, vacant-property signals, local support organizations, and ` +
    `economic snapshot for ${ca.name} — then verify any address for free.`;

  return pageMetadata({
    // Layout appends "| Chicago Incentive Explorer" via the title template,
    // so the brand suffix is intentionally omitted here.
    title: `What Incentives Are Available in ${ca.name}?`,
    description: description.slice(0, 158),
    path: `/neighborhoods/${slug}/incentives`,
  });
}

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const VACANCY_TYPE_LABELS: Record<string, string> = {
  vacant_land: "Vacant land",
  vacant_building: "Vacant buildings",
  unknown: "Unclassified",
};

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]">
    {children}
  </span>
);

export default async function NeighborhoodIncentivesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ca = findCommunityAreaBySlug(slug);
  if (!ca) notFound();

  const data = await getNeighborhoodPageData(ca.id);
  const {
    anchors,
    support,
    vacancyCount,
    vacancyByType,
    census,
    zones,
    zoneCount,
  } = data;

  const corridorSignals = getCorridorSignalsForCommunityArea(ca.id);

  const orgNames = support?.organizations.map((o) => o.name) ?? [];
  const supportSummary =
    orgNames.length > 0
      ? orgNames.slice(0, 2).join(" and ")
      : "the South East Chicago Chamber of Commerce and citywide partners";

  const faqJsonLd = buildFaqJsonLd([
    {
      question: `What incentives are available in ${ca.name}?`,
      answer:
        zoneCount > 0
          ? `The center of ${ca.name} overlaps ${zoneCount} mapped incentive ${
              zoneCount === 1 ? "zone" : "zones"
            }${
              vacancyCount > 0
                ? `, and there are ${vacancyCount.toLocaleString()} tracked vacant ${
                    vacancyCount === 1 ? "property" : "properties"
                  } in the area`
                : ""
            }. Exact eligibility depends on the specific address — generate a free location snapshot to confirm.`
          : `Incentive eligibility in ${ca.name} depends on the specific address. ${
              vacancyCount > 0
                ? `There are ${vacancyCount.toLocaleString()} tracked vacant ${
                    vacancyCount === 1 ? "property" : "properties"
                  } in the area. `
                : ""
            }Generate a free location snapshot to see the zones for any parcel.`,
    },
    {
      question: `Where can a business in ${ca.name} get help applying?`,
      answer: `Local support is available through ${supportSummary}. These organizations help businesses navigate incentive programs, licensing, and corridor resources.`,
    },
  ]);

  const trailJsonLd = buildTrailJsonLd([
    { name: "Home", path: "/" },
    { name: "Neighborhoods", path: `/neighborhoods/${slug}/incentives` },
    { name: ca.name, path: `/neighborhoods/${slug}/incentives` },
  ]);

  return (
    <main className="bg-warm min-h-screen">
      <JsonLd data={faqJsonLd} id="faq-jsonld" />
      <JsonLd data={trailJsonLd} id="breadcrumb-jsonld" />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-warm bureau-grid">
        <div className="max-w-4xl mx-auto px-6 pt-10 pb-12 md:pt-14">
          {/* Breadcrumb */}
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-[12px] text-[#0C1B33]/50 mb-8 font-mono-bureau"
          >
            <Link href="/" className="hover:text-[#2563EB] transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3 h-3" />
            <Link
              href="/map"
              className="hover:text-[#2563EB] transition-colors"
            >
              Neighborhoods
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[#0C1B33]/80">{ca.name}</span>
          </nav>

          <Eyebrow>Neighborhood Incentive Profile</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h1 className="font-editorial text-3xl md:text-5xl text-[#0C1B33] leading-tight">
            Business Incentives in {ca.name}, Chicago
          </h1>
          <p className="text-[#0C1B33]/70 text-base md:text-lg mt-5 max-w-2xl leading-relaxed">
            {ca.name} sits within Chicago&apos;s layered landscape of public
            incentive programs. The neighborhood center overlaps{" "}
            <strong className="text-[#0C1B33]">
              {zoneCount} mapped incentive {zoneCount === 1 ? "zone" : "zones"}
            </strong>
            {vacancyCount > 0 ? (
              <>
                {" "}
                and shows{" "}
                <strong className="text-[#0C1B33]">
                  {vacancyCount.toLocaleString()} tracked vacant{" "}
                  {vacancyCount === 1 ? "property" : "properties"}
                </strong>
              </>
            ) : null}
            . Below is a discovery snapshot — local anchors, support
            organizations, and economic context — to help you orient before
            checking a specific address.
          </p>

          <div className="mt-8">
            <NeighborhoodSnapshotButton
              lat={ca.lat}
              lon={ca.lon}
              name={ca.name}
            />
            <p className="text-[12px] text-[#0C1B33]/45 mt-3 max-w-md leading-relaxed">
              This is a navigation tool, not an eligibility determination.
              Verify every program against your exact address.
            </p>
          </div>
        </div>
      </section>

      {/* ── Incentive zones ──────────────────────────────────────────── */}
      <section className="bg-blue-soft border-y border-[#0C1B33]/10">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <Eyebrow>Incentive zones overlapping this area</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
            {zoneCount} incentive {zoneCount === 1 ? "zone" : "zones"} at the{" "}
            {ca.name} center
          </h2>
          <p className="text-[#0C1B33]/55 text-sm mb-6 max-w-2xl leading-relaxed">
            Based on the neighborhood center point — verify the exact zones for
            your specific address with a free snapshot. Zone boundaries are
            irregular, so a parcel a few blocks away can qualify differently.
          </p>

          {zones.length > 0 ? (
            <ul className="flex flex-wrap gap-2.5">
              {zones.map((z) => (
                <li
                  key={z}
                  className="inline-flex items-center gap-2 rounded-full border border-[#0C1B33]/10 bg-white px-4 py-2 text-[13px] text-[#0C1B33]"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
                  {z}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[#0C1B33]/60 text-sm rounded-xl border border-[#0C1B33]/10 bg-white px-5 py-4 max-w-2xl leading-relaxed">
              The center point of {ca.name} doesn&apos;t fall inside a mapped
              incentive zone in our current data, but individual parcels may
              still qualify. Run a free snapshot on a specific address to be
              sure.
            </p>
          )}
        </div>
      </section>

      {/* ── Local support organizations (highest value) ──────────────── */}
      <section className="bg-warm">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <Eyebrow>Local support organizations</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
            Who can help a business in {ca.name}
          </h2>
          <p className="text-[#0C1B33]/55 text-sm mb-6 max-w-2xl leading-relaxed">
            These organizations work directly in or adjacent to {ca.name} and
            can help navigate incentive programs, licensing, and corridor
            resources.
            {support?.region ? ` Region: ${support.region}.` : ""}
          </p>

          {support && support.organizations.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {support.organizations.map((org) => (
                <div
                  key={org.name}
                  className="rounded-xl border border-[#0C1B33]/10 bg-white p-5 flex flex-col"
                >
                  <h3 className="font-editorial text-lg text-[#0C1B33] leading-snug">
                    {org.name}
                  </h3>
                  {org.type ? (
                    <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB] mt-1.5">
                      {org.type}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-col gap-2 text-sm">
                    {org.phone ? (
                      <a
                        href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
                        className="inline-flex items-center gap-2 text-[#0C1B33]/70 hover:text-[#2563EB] transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        {org.phone}
                      </a>
                    ) : null}
                    {org.website ? (
                      <a
                        href={org.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-[#0C1B33]/70 hover:text-[#2563EB] transition-colors break-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        {org.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[#0C1B33]/60 text-sm rounded-xl border border-[#0C1B33]/10 bg-white px-5 py-4 max-w-2xl leading-relaxed">
              No neighborhood-specific support partner is listed for {ca.name}{" "}
              yet. The South East Chicago Chamber of Commerce and citywide
              partners can still help — start with a free snapshot.
            </p>
          )}

          {support?.ssa ? (
            <p className="text-[12px] text-[#0C1B33]/45 mt-5 max-w-2xl leading-relaxed">
              <span className="font-mono-bureau uppercase tracking-[0.15em] text-[#0C1B33]/55">
                Special Service Area:
              </span>{" "}
              {support.ssa}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Vacant property signal ───────────────────────────────────── */}
      <section className="bg-blue-soft border-y border-[#0C1B33]/10">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <Eyebrow>Vacant property signal</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
            {vacancyCount > 0
              ? `${vacancyCount.toLocaleString()} tracked vacant ${
                  vacancyCount === 1 ? "property" : "properties"
                }`
              : "No tracked vacancies in this sample"}
          </h2>
          <p className="text-[#0C1B33]/55 text-sm mb-6 max-w-2xl leading-relaxed">
            Vacant and city-owned parcels often signal where reinvestment
            incentives and acquisition programs apply. Counts come from public
            vacancy datasets and are a directional signal, not a complete
            inventory.
          </p>

          {vacancyCount > 0 ? (
            <div className="flex flex-wrap gap-3">
              {Object.entries(vacancyByType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div
                    key={type}
                    className="inline-flex items-center gap-3 rounded-xl border border-[#0C1B33]/10 bg-white px-5 py-3"
                  >
                    <Building2 className="w-4 h-4 text-[#2563EB]" />
                    <span className="font-editorial text-xl text-[#0C1B33]">
                      {count.toLocaleString()}
                    </span>
                    <span className="text-[13px] text-[#0C1B33]/60">
                      {VACANCY_TYPE_LABELS[type] ?? type}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-[#0C1B33]/60 text-sm rounded-xl border border-[#0C1B33]/10 bg-white px-5 py-4 max-w-2xl leading-relaxed">
              Our current vacancy sample doesn&apos;t include parcels in{" "}
              {ca.name}. That doesn&apos;t mean there are none — explore the
              full map for parcel-level detail.
            </p>
          )}

          <Link
            href="/map"
            className="inline-flex items-center gap-1.5 mt-6 text-[13px] font-mono-bureau uppercase tracking-[0.1em] text-[#2563EB] hover:text-[#1d4ed8] transition-colors"
          >
            <MapPin className="w-3.5 h-3.5" />
            Explore parcels on the map
          </Link>
        </div>
      </section>

      {/* ── Economic snapshot ────────────────────────────────────────── */}
      <section className="bg-warm">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <Eyebrow>Economic snapshot</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
            Representative tract at the {ca.name} center
          </h2>
          <p className="text-[#0C1B33]/55 text-sm mb-6 max-w-2xl leading-relaxed">
            These figures come from the single census tract containing the
            neighborhood&apos;s center point — a representative reading, not a
            full neighborhood average. Conditions vary block to block.
          </p>

          {census ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Median household income"
                  value={
                    census.medianIncome != null ? usd(census.medianIncome) : "—"
                  }
                />
                <StatCard
                  label="Median home value"
                  value={
                    census.medianHomeValue != null
                      ? usd(census.medianHomeValue)
                      : "—"
                  }
                />
                <StatCard
                  label="Tract population"
                  value={
                    census.population != null
                      ? census.population.toLocaleString()
                      : "—"
                  }
                />
              </div>
              {census.tractName ? (
                <p className="text-[12px] text-[#0C1B33]/45 mt-4 font-mono-bureau">
                  Source tract: {census.tractName}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[#0C1B33]/60 text-sm rounded-xl border border-[#0C1B33]/10 bg-white px-5 py-4 max-w-2xl leading-relaxed">
              We couldn&apos;t match a representative census tract to the center
              of {ca.name}. Census context is available per-address in the full
              snapshot.
            </p>
          )}
        </div>
      </section>

      {/* ── Notable anchors ──────────────────────────────────────────── */}
      <section className="bg-blue-soft border-y border-[#0C1B33]/10">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <Eyebrow>Notable anchors</Eyebrow>
          <div className="accent-bar mt-3 mb-5" />
          <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
            Institutions anchoring {ca.name}
          </h2>
          <p className="text-[#0C1B33]/55 text-sm mb-6 max-w-2xl leading-relaxed">
            Anchor institutions — hospitals, colleges, development corporations,
            and corridor projects — concentrate jobs and reinvestment. These are
            the highest-scoring anchors identified for {ca.name}.
          </p>

          {anchors.length > 0 ? (
            <div className="grid gap-3">
              {anchors.map((a) => (
                <div
                  key={a.name}
                  className="rounded-xl border border-[#0C1B33]/10 bg-white p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <h3 className="font-editorial text-lg text-[#0C1B33] leading-snug">
                      {a.name}
                    </h3>
                    <p className="text-[13px] text-[#0C1B33]/55 mt-1">
                      {a.type}
                    </p>
                  </div>
                  {a.impactTier ? (
                    <span className="shrink-0 self-start sm:self-auto inline-flex items-center gap-2 rounded-full border border-[#0C1B33]/10 bg-[#EFF3FB] px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/70">
                      {a.impactTier} impact
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[#0C1B33]/60 text-sm rounded-xl border border-[#0C1B33]/10 bg-white px-5 py-4 max-w-2xl leading-relaxed">
              No scored anchor institutions are catalogued for {ca.name} yet.
            </p>
          )}
        </div>
      </section>

      {/* ── Corridor signals ──────────────────────────────────────────── */}
      {corridorSignals ? (
        <section className="bg-warm">
          <div className="max-w-4xl mx-auto px-6 py-12">
            <Eyebrow>Corridor signals</Eyebrow>
            <div className="accent-bar mt-3 mb-5" />
            <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mb-2">
              ZIP-level signals for {corridorSignals.zip}
            </h2>
            <p className="text-[#0C1B33]/55 text-sm mb-6 max-w-2xl leading-relaxed">
              {corridorSignals.zip} is the ZIP at the heart of {ca.name}
              {" "}— boundaries don&apos;t align exactly, so read these as
              neighborhood-level context, not a reading for a specific
              address.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              {corridorSignals.vacancy.vacancyRate != null ? (
                <DataRow
                  label="Properties flagged vacant"
                  value={`${Math.round(corridorSignals.vacancy.vacancyRate * 100)}% of property records`}
                  detail={`Share of property records in ZIP ${corridorSignals.zip} with a public vacancy indicator.`}
                />
              ) : null}
              {corridorSignals.turnover.openings != null &&
              corridorSignals.turnover.closures != null ? (
                <DataRow
                  label="Business license activity"
                  value={`${corridorSignals.turnover.openings.toLocaleString()} opened / ${corridorSignals.turnover.closures.toLocaleString()} closed in the last ${corridorSignals.windowMonths} months`}
                  detail={`Business licenses recorded as opened or closed in ZIP ${corridorSignals.zip}, shown separately so the direction is visible.`}
                />
              ) : null}
              {corridorSignals.permits.permitCount != null ? (
                <DataRow
                  label="Building permit activity"
                  value={`${corridorSignals.permits.permitCount.toLocaleString()} permits in the last ${corridorSignals.windowMonths} months`}
                  detail={
                    corridorSignals.permits.demolitionCount
                      ? `Building permits issued in ZIP ${corridorSignals.zip} in the last ${corridorSignals.windowMonths} months, including ${corridorSignals.permits.demolitionCount.toLocaleString()} demolition ${corridorSignals.permits.demolitionCount === 1 ? "permit" : "permits"}.`
                      : `Building permits issued in ZIP ${corridorSignals.zip} — a directional reinvestment signal, not a complete inventory.`
                  }
                />
              ) : null}
            </div>

            <div className="mt-4">
              <ContextNotProofFootnote />
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Conversion CTA ───────────────────────────────────────────── */}
      <section className="bg-warm">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <SnapshotCTA
            heading="Generate a Free Location Snapshot"
            sub={`Get the exact incentives for any address in ${ca.name}.`}
          />
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#0C1B33]/10 bg-white p-5">
      <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/50">
        {label}
      </p>
      <p className="font-editorial text-2xl md:text-3xl text-[#0C1B33] mt-2">
        {value}
      </p>
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { CLUSTERS_NOTE, loadVacancyIndex } from "@/lib/vacancy-index";
import {
  AREA_NEXT_STEPS,
  approxSqft,
  areaCoverageNote,
  opportunityAreaById,
  opportunitySummary,
  streetNameFromAddress,
  type OpportunityArea,
  type OpportunityAreaMember,
} from "@/lib/vacancy-opportunity-areas";
import { cookViewerUrl } from "@/lib/cook-viewer";
import { VacancySubNav } from "@/components/vacancy/VacancySubNav";
import { OPPORTUNITY_AREA_DISCLAIMER } from "@/lib/vacancy-public-labels";

export const dynamic = "force-dynamic";

const PROPERTY_LABEL: Record<string, string> = {
  vacant_land: "Vacant land",
  vacant_building: "Vacant building",
};

const MEMBER_ROW_CAP = 25;

function parseClusterId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function loadArea(zip: string, clusterIdRaw: string): { entry: ReturnType<typeof getPilotZipEntry>; area: OpportunityArea | null; asOf: string } {
  const entry = getPilotZipEntry(zip);
  const exportData = loadVacancyIndex();
  const edition = exportData?.editions[zip] ?? null;
  const clusterId = parseClusterId(clusterIdRaw);
  const area = edition && clusterId != null ? opportunityAreaById(edition, clusterId) : null;
  const asOf = exportData?.generatedAt
    ? new Date(exportData.generatedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  return { entry, area, asOf };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zip: string; clusterId: string }>;
}): Promise<Metadata> {
  const { zip, clusterId } = await params;
  const { entry, area } = loadArea(zip, clusterId);
  if (!entry || !area) return { title: "Revitalization File" };
  return {
    title: `Revitalization File — ${area.name} (${entry.primaryNeighborhood})`,
    description: `${area.siteCount} nearby vacant sites in ${entry.primaryNeighborhood} grouped for review. Early possibilities from public records, not availability listings.`,
  };
}

/** A simple, dependency-free SVG dot map of member coordinates + the area's
 * boundary box (no Mapbox, no external images). Honest: dots are the mapped
 * member sites; the box is the analytical cluster extent. */
function AreaBoundarySvg({ area }: { area: OpportunityArea }) {
  const pts = area.members.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon));
  if (pts.length === 0) return null;
  const [w, s, e, n] = area.bbox;
  const W = 320;
  const H = 200;
  const pad = 14;
  const spanLon = e - w || 1e-6;
  const spanLat = n - s || 1e-6;
  const x = (lon: number) => pad + ((lon - w) / spanLon) * (W - 2 * pad);
  const y = (lat: number) => pad + ((n - lat) / spanLat) * (H - 2 * pad);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Approximate footprint of ${area.name}: ${pts.length} mapped sites`}
      className="h-auto w-full max-w-[420px] border border-[#0C1B33]/10 bg-white"
    >
      <rect
        x={pad}
        y={pad}
        width={W - 2 * pad}
        height={H - 2 * pad}
        fill="none"
        stroke="#0C1B33"
        strokeOpacity={0.35}
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      {pts.map((m, i) => (
        <circle
          key={i}
          cx={x(m.lon)}
          cy={y(m.lat)}
          r={3}
          fill={m.propertyType === "vacant_building" ? "#8A8A8A" : "#0C1B33"}
          fillOpacity={0.8}
        />
      ))}
    </svg>
  );
}

/** Distinct member street names (from addresses), for the honest "streets in
 * this area" line — never a fabricated intersection. */
function distinctStreets(members: readonly OpportunityAreaMember[], limit = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of members) {
    const street = streetNameFromAddress(m.address);
    if (street && !seen.has(street)) {
      seen.add(street);
      out.push(street);
    }
  }
  return out.slice(0, limit);
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="flex items-baseline gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
        <span className="text-[#2563EB]">{n}</span> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Revitalization File — the public detail brief for one Opportunity Area. Eight
 * short sections (GPT-5.6 IA consult §2). All prose from fixed templates over
 * real fields; ownership appears only as a CATEGORY mix; no owner names.
 */
export default async function RevitalizationFilePage({
  params,
}: {
  params: Promise<{ zip: string; clusterId: string }>;
}) {
  const { zip, clusterId } = await params;
  const { entry, area, asOf } = loadArea(zip, clusterId);
  if (!entry || !area) notFound();

  const streets = distinctStreets(area.members);
  const memberRows = area.members.filter((m) => m.address && m.address.trim()).slice(0, MEMBER_ROW_CAP);
  const memberRowTotal = area.members.filter((m) => m.address && m.address.trim()).length;
  const ownershipShown = area.ownershipMix.filter((s) => s.count > 0);
  // Defect C: mapped-member-derived facts (size, zoning, per-site rows) cover
  // only the mapped members, not the full group, whenever the cap or a data
  // gap left some sites unmapped. Honest disclosure travels with those facts.
  const mappedOnly = area.memberCount < area.siteCount;
  const coverageNote = areaCoverageNote(area);

  const combinedSize =
    area.combinedKnownSqft > 0
      ? `about ${approxSqft(area.combinedKnownSqft).toLocaleString("en-US")} sq ft${
          area.sqftUnknownCount > 0 ? " (size partly unknown)" : ""
        }`
      : "Not recorded";
  const landBuilding = [
    area.vacantLandCount > 0 ? `${area.vacantLandCount} vacant land` : null,
    area.vacantBuildingCount > 0
      ? `${area.vacantBuildingCount} vacant ${area.vacantBuildingCount === 1 ? "building" : "buildings"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // ≤2 support-area indicators.
  const supportIndicators: string[] = [];
  if (area.incentiveSiteCount > 0) {
    supportIndicators.push(
      `${area.incentiveSiteCount} of ${area.memberCount} mapped sites intersect an incentive geography`,
    );
  }
  if (area.corridorContext) supportIndicators.push(`Near the ${area.corridorContext} corridor`);

  return (
    <div className="min-h-screen bg-[#FAF9F6] px-4 py-8 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <VacancySubNav zip={zip} active="areas" />

        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
          Revitalization File
        </span>
        <h1 className="mt-3 font-editorial text-[40px] leading-none sm:text-[52px]">{area.name}</h1>
        <p className="mt-3 font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
          {entry.primaryNeighborhood} · ZIP {zip} · {area.siteCount} sites
        </p>
        <p className="mt-4 max-w-2xl border-l-2 border-[#2563EB] pl-3 text-[12px] leading-relaxed text-[#0C1B33]/55">
          {OPPORTUNITY_AREA_DISCLAIMER}
        </p>

        {/* 1 · Opportunity summary */}
        <Section n="01" title="Opportunity summary">
          <p className="max-w-2xl text-[15px] leading-relaxed text-[#0C1B33]/85">
            {opportunitySummary(area)}
          </p>
        </Section>

        {/* 2 · Map and boundary */}
        <Section n="02" title="Map and boundary">
          <AreaBoundarySvg area={area} />
          {streets.length > 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/60">
              Streets in this area: {streets.join(", ")}.
            </p>
          )}
          <p className="mt-2">
            <Link
              href={`/vacancy/${zip}/map?area=${area.clusterId}`}
              className="font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
            >
              Show these sites on the property map →
            </Link>
          </p>
        </Section>

        {/* 3 · At a glance */}
        <Section n="03" title="At a glance">
          <dl className="grid grid-cols-1 gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-2">
            {[
              { label: "Parcels in the group", value: area.siteCount.toLocaleString("en-US") },
              {
                label: `Combined approximate area${mappedOnly ? " (mapped members)" : ""}`,
                value: combinedSize,
              },
              { label: "Land / building mix", value: landBuilding || "—" },
              {
                label: `Zoning (most common)${mappedOnly ? " (mapped members)" : ""}`,
                value: area.zoningGlossText ?? "Not recorded",
              },
            ].map((row) => (
              <div key={row.label} className="bg-white px-4 py-3">
                <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                  {row.label}
                </dt>
                <dd className="mt-1 text-[13px] text-[#0C1B33]/85">{row.value}</dd>
              </div>
            ))}
          </dl>
          {coverageNote && (
            <p className="mt-2.5 text-[10px] font-semibold leading-snug text-[#A45B00]">{coverageNote}</p>
          )}
          {supportIndicators.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12px] leading-relaxed text-[#0C1B33]/60">
              {supportIndicators.map((s) => (
                <li key={s}>• {s}</li>
              ))}
            </ul>
          )}
          {ownershipShown.length > 0 && (
            <div className="mt-4">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
                Ownership types in this group
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] text-[#0C1B33]/70">
                {ownershipShown.map((s) => (
                  <li key={s.ownerType}>
                    {s.count} of {area.siteCount} sites: {s.label} ownership type
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* 4 · What could happen here */}
        <Section n="04" title="What could happen here">
          <ul className="space-y-2 text-[13px] leading-relaxed text-[#0C1B33]/80">
            {area.scenarios.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-[#2563EB]">›</span>
                {s}
              </li>
            ))}
          </ul>
        </Section>

        {/* 5 · What needs checking */}
        <Section n="05" title="What needs checking">
          <ul className="space-y-2 text-[13px] leading-relaxed text-[#0C1B33]/80">
            {area.needsChecking.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-[#DC2626]">•</span>
                {s}
              </li>
            ))}
          </ul>
        </Section>

        {/* 6 · Suggested next steps */}
        <Section n="06" title="Suggested next steps">
          <ol className="space-y-3">
            {AREA_NEXT_STEPS.map((step, i) => (
              <li key={step.actor} className="flex items-baseline gap-3 border-t border-[#0C1B33]/10 pt-2">
                <span className="font-mono-bureau text-[12px] text-[#2563EB]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[13px] leading-snug text-[#0C1B33]/80">
                  <span className="font-semibold text-[#0C1B33]">{step.actor}:</span> {step.step}
                </span>
              </li>
            ))}
          </ol>
        </Section>

        {/* 7 · Properties in this area */}
        <Section n="07" title="Properties in this area">
          {coverageNote && (
            <p className="mb-3 text-[10px] font-semibold leading-snug text-[#A45B00]">
              {coverageNote} This table lists the mapped members only.
            </p>
          )}
          {memberRows.length === 0 ? (
            <p className="text-[12px] text-[#0C1B33]/45">
              Individual addresses are not yet available for this area.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
                <table className="w-full min-w-[520px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                      <th className="px-3 py-2.5">Address</th>
                      <th className="px-3 py-2.5">Type</th>
                      <th className="px-3 py-2.5">Ownership type</th>
                      <th className="px-3 py-2.5">Verify</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberRows.map((m, i) => {
                      const ownerLabel =
                        area.ownershipMix.find((s) => s.ownerType === m.ownerType)?.label ??
                        "Not yet classified";
                      const cook = cookViewerUrl(m.pin);
                      return (
                        <tr key={`${m.address}-${i}`} className="border-b border-[#0C1B33]/5 align-top last:border-b-0">
                          <td className="px-3 py-2.5 text-[12px] text-[#0C1B33]/80">{m.address}</td>
                          <td className="px-3 py-2.5 text-[12px] text-[#0C1B33]/60">
                            {PROPERTY_LABEL[m.propertyType] ?? "Vacant site"}
                          </td>
                          <td className="px-3 py-2.5 text-[12px] text-[#0C1B33]/70">{ownerLabel}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {cook ? (
                              <a
                                href={cook}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Opens Cook County's official parcel record in a new tab."
                                className="font-mono-bureau text-[10px] uppercase tracking-[0.06em] text-[#2563EB] hover:underline"
                              >
                                Parcel record ↗
                              </a>
                            ) : (
                              <span className="font-mono-bureau text-[10px] text-[#0C1B33]/30">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {memberRowTotal > memberRows.length && (
                <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                  Showing {memberRows.length} of {memberRowTotal} mapped addresses in this area
                </p>
              )}
              <p className="mt-2">
                <Link
                  href={`/vacancy/${zip}/directory?area=${area.clusterId}`}
                  className="font-mono-bureau text-[11px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
                >
                  View all in the directory →
                </Link>
              </p>
            </>
          )}
        </Section>

        {/* 8 · Sources and limitations */}
        <Section n="08" title="Sources and limitations">
          <div className="text-[12px] leading-relaxed text-[#0C1B33]/55">
            {asOf && <p>Records as of {asOf}.</p>}
            <p className="mt-1">
              This area is grouped by proximity from public records — nearby tracked vacant sites
              linked geographically, never by common ownership. Owner information appears only as a
              category mix; no owner names or mailing addresses are shown.
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
                Grouping methodology
              </summary>
              <p className="mt-1.5 text-[#0C1B33]/50">{CLUSTERS_NOTE}</p>
            </details>
          </div>
        </Section>
      </div>
    </div>
  );
}

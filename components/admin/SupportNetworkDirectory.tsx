"use client";

import { useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Mail,
  Phone,
  Search,
} from "lucide-react";
import type {
  SupportNetworkCoverageRole,
  SupportNetworkOrganization,
} from "@/lib/support-network-directory";

const LANE_LABELS: Record<string, string> = {
  business_navigation: "Business navigation",
  capital_readiness: "Capital preparation",
  small_business_capital: "Small-business capital",
  housing_homeownership: "Housing and homeownership",
  property_community_development: "Property and development",
  corridor_place_based: "Corridor and place-based",
  legal_support: "Legal support",
  workforce: "Workforce",
};

const COVERAGE_LABELS: Record<SupportNetworkCoverageRole, string> = {
  core_local: "Core local",
  citywide_specialist: "Citywide specialist",
  regional_option: "Regional option",
  verification_needed: "Verify before referral",
};

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatVerifiedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function ContactActions({
  email,
  phone,
  url,
  label,
}: {
  email?: string;
  phone?: string;
  url?: string;
  label: string;
}) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {email ? (
        <a
          href={`mailto:${email}`}
          title={`Email ${label}`}
          aria-label={`Email ${label}`}
          className="inline-flex size-8 items-center justify-center border border-[#0C1B33]/12 bg-white text-[#0C1B33]/45 transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          <Mail size={14} aria-hidden="true" />
        </a>
      ) : null}
      {phone ? (
        <a
          href={`tel:${phone.replace(/[^+\d]/g, "")}`}
          title={`Call ${label}`}
          aria-label={`Call ${label}`}
          className="inline-flex size-8 items-center justify-center border border-[#0C1B33]/12 bg-white text-[#0C1B33]/45 transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          <Phone size={14} aria-hidden="true" />
        </a>
      ) : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={`Open ${label}`}
          aria-label={`Open ${label}`}
          className="inline-flex size-8 items-center justify-center border border-[#0C1B33]/12 bg-white text-[#0C1B33]/45 transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

export function SupportNetworkDirectory({
  organizations,
  generatedAt,
}: {
  organizations: SupportNetworkOrganization[];
  generatedAt: string;
}) {
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState("all");
  const [coverageRole, setCoverageRole] = useState("all");

  const laneOptions = useMemo(
    () => [...new Set(organizations.flatMap((organization) => organization.supportLanes))].sort(),
    [organizations]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return organizations.filter((organization) => {
      if (lane !== "all" && !organization.supportLanes.includes(lane)) return false;
      if (coverageRole !== "all" && organization.coverageRole !== coverageRole) return false;
      if (!normalizedQuery) return true;

      const searchable = [
        organization.name,
        organization.organizationType,
        organization.geography,
        organization.bestFor,
        ...organization.supportLanes.map((item) => LANE_LABELS[item] || item),
        ...organization.keyContacts.flatMap((contact) => [contact.name, contact.role]),
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [coverageRole, lane, organizations, query]);

  const namedContactCount = organizations.reduce(
    (total, organization) => total + organization.keyContacts.length,
    0
  );
  const coreLocalCount = organizations.filter(
    (organization) => organization.coverageRole === "core_local"
  ).length;
  const verificationCount = organizations.filter(
    (organization) => organization.coverageRole === "verification_needed"
  ).length;

  const downloadCsv = () => {
    const header = [
      "Organization",
      "Type",
      "Coverage role",
      "Support lanes",
      "Geography",
      "Best for",
      "Key contacts",
      "Intake email",
      "Intake phone",
      "Intake URL",
      "Last verified",
      "Sources",
    ];
    const rows = filtered.map((organization) => [
      organization.name,
      organization.organizationType,
      COVERAGE_LABELS[organization.coverageRole],
      organization.supportLanes.map((item) => LANE_LABELS[item] || item).join("; "),
      organization.geography,
      organization.bestFor,
      organization.keyContacts
        .map((contact) => `${contact.name} - ${contact.role}`)
        .join("; "),
      organization.publicIntake.email || "",
      organization.publicIntake.phone || "",
      organization.publicIntake.url,
      organization.lastVerifiedAt,
      organization.sourceUrls.join("; "),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => csvCell(String(value))).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `support-network-directory-${generatedAt}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="grid border-y border-[#0C1B33]/10 bg-white sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Organizations", organizations.length],
          ["Named contacts", namedContactCount],
          ["Core local", coreLocalCount],
          ["Needs verification", verificationCount],
        ].map(([label, value]) => (
          <div
            key={label}
            className="border-b border-[#0C1B33]/8 px-5 py-4 last:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b-0"
          >
            <div className="font-mono-bureau text-[9px] uppercase tracking-[0.18em] text-[#0C1B33]/35">
              {label}
            </div>
            <div className="mt-2 font-editorial text-[30px] leading-none text-[#0C1B33]">
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-7 flex flex-col gap-3 border-b border-[#0C1B33]/10 pb-5 lg:flex-row lg:items-end">
        <label className="min-w-0 flex-1">
          <span className="mb-2 block font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/35">
            Search directory
          </span>
          <span className="relative block">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#0C1B33]/30"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Organization, contact, service, or geography"
              className="h-11 w-full border border-[#0C1B33]/12 bg-white pl-10 pr-3 text-[13px] outline-none placeholder:text-[#0C1B33]/25 focus:border-[#2563EB]"
            />
          </span>
        </label>

        <label className="min-w-[220px]">
          <span className="mb-2 block font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/35">
            Support lane
          </span>
          <select
            value={lane}
            onChange={(event) => setLane(event.target.value)}
            className="h-11 w-full border border-[#0C1B33]/12 bg-white px-3 text-[13px] outline-none focus:border-[#2563EB]"
          >
            <option value="all">All support lanes</option>
            {laneOptions.map((option) => (
              <option key={option} value={option}>
                {LANE_LABELS[option] || option}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-[205px]">
          <span className="mb-2 block font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/35">
            Network role
          </span>
          <select
            value={coverageRole}
            onChange={(event) => setCoverageRole(event.target.value)}
            className="h-11 w-full border border-[#0C1B33]/12 bg-white px-3 text-[13px] outline-none focus:border-[#2563EB]"
          >
            <option value="all">All network roles</option>
            {Object.entries(COVERAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex h-11 items-center justify-center gap-2 border border-[#0C1B33] bg-[#0C1B33] px-4 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#1E3054]"
        >
          <Download size={14} aria-hidden="true" />
          Export CSV
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-[#0C1B33]/35">
          Showing {filtered.length} of {organizations.length}
        </p>
        <p className="text-right text-[11px] text-[#0C1B33]/35">
          Directory updated {formatVerifiedDate(generatedAt)}
        </p>
      </div>

      <div className="mt-4 overflow-x-auto border border-[#0C1B33]/10 bg-white">
        <table className="w-full min-w-[1040px] table-fixed text-left">
          <thead>
            <tr className="border-b border-[#0C1B33]/10 bg-[#EFF3FB] font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">
              <th className="w-[200px] px-4 py-3 font-medium">Organization</th>
              <th className="w-[235px] px-4 py-3 font-medium">Best for</th>
              <th className="w-[200px] px-4 py-3 font-medium">Coverage</th>
              <th className="w-[225px] px-4 py-3 font-medium">Key contacts</th>
              <th className="w-[185px] px-4 py-3 font-medium">Public intake</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0C1B33]/7">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[13px] text-[#0C1B33]/35">
                  No contacts match those filters.
                </td>
              </tr>
            ) : (
              filtered.map((organization) => (
                <tr key={organization.id} className="align-top transition-colors hover:bg-[#FAF9F6]">
                  <td className="px-4 py-5">
                    <div className="text-[14px] font-semibold leading-snug text-[#0C1B33]">
                      {organization.name}
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/45">
                      {organization.organizationType}
                    </p>
                    <span
                      className={`mt-3 inline-block border px-2 py-1 font-mono-bureau text-[8px] uppercase tracking-[0.12em] ${
                        organization.coverageRole === "verification_needed"
                          ? "border-amber-500/30 bg-amber-50 text-amber-700"
                          : "border-[#2563EB]/20 bg-[#EFF3FB] text-[#2563EB]"
                      }`}
                    >
                      {COVERAGE_LABELS[organization.coverageRole]}
                    </span>
                  </td>
                  <td className="px-4 py-5">
                    <p className="text-[12px] leading-[1.65] text-[#0C1B33]/65">
                      {organization.bestFor}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {organization.supportLanes.map((item) => (
                        <span
                          key={item}
                          className="border border-[#0C1B33]/8 bg-[#FAF9F6] px-2 py-1 text-[9px] leading-tight text-[#0C1B33]/45"
                        >
                          {LANE_LABELS[item] || item}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-5">
                    <p className="text-[12px] leading-[1.65] text-[#0C1B33]/55">
                      {organization.geography}
                    </p>
                    <p className="mt-4 font-mono-bureau text-[8px] uppercase tracking-[0.12em] text-[#0C1B33]/30">
                      Sources verified {formatVerifiedDate(organization.lastVerifiedAt)}
                    </p>
                    <a
                      href={organization.sourceUrls[0]}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-[#2563EB] hover:underline"
                    >
                      Review sources
                      <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  </td>
                  <td className="px-4 py-5">
                    {organization.keyContacts.length ? (
                      <div className="divide-y divide-[#0C1B33]/7">
                        {organization.keyContacts.map((contact) => (
                          <div key={`${organization.id}-${contact.name}`} className="py-3 first:pt-0 last:pb-0">
                            <a
                              href={contact.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[12px] font-medium leading-snug text-[#0C1B33] hover:text-[#2563EB]"
                            >
                              {contact.name}
                            </a>
                            <p className="mt-1 text-[10px] leading-relaxed text-[#0C1B33]/40">
                              {contact.role}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] leading-relaxed text-[#0C1B33]/35">
                        Start with the published intake route. A named relationship contact still needs to be confirmed.
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-5">
                    {organization.publicIntake.email ? (
                      <a
                        href={`mailto:${organization.publicIntake.email}`}
                        className="block break-all text-[11px] text-[#2563EB] hover:underline"
                      >
                        {organization.publicIntake.email}
                      </a>
                    ) : null}
                    {organization.publicIntake.phone ? (
                      <a
                        href={`tel:${organization.publicIntake.phone.replace(/[^+\d]/g, "")}`}
                        className="mt-2 block text-[11px] text-[#0C1B33]/55 hover:text-[#2563EB]"
                      >
                        {organization.publicIntake.phone}
                      </a>
                    ) : null}
                    <ContactActions
                      email={organization.publicIntake.email}
                      phone={organization.publicIntake.phone}
                      url={organization.publicIntake.url}
                      label={organization.name}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

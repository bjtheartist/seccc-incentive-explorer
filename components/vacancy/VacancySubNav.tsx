import Link from "next/link";
import { PILOT_ZIPS, getPilotZipEntry } from "@/lib/pilot-zips";
import { VacancyIndexPdfButton } from "@/components/owner-file/VacancyIndexPdfButton";
import { NeighborhoodSelect } from "@/components/vacancy/NeighborhoodSelect";

/**
 * The consistent sub-navigation header shown on every /vacancy/[zip]* page — one
 * area workspace, five views (GPT-5.6 IA consult §3, plus the Case Workbench).
 * Server component: the active view is passed in, so no client hooks are
 * needed. The neighborhood switcher preserves the current view when switching
 * ZIPs (reuses the pilot-ZIP chip-row pattern from the admin Owner Files page).
 * The nine-pill row is desktop-only (`hidden md:flex`); mobile gets the
 * equivalent NeighborhoodSelect dropdown (`md:hidden`, defect E).
 */

export type VacancyView = "overview" | "areas" | "map" | "directory" | "cases";

const TABS: { key: VacancyView; label: string; href: (zip: string) => string }[] = [
  { key: "overview", label: "Overview", href: (z) => `/vacancy/${z}` },
  { key: "areas", label: "Opportunity Areas", href: (z) => `/vacancy/${z}/areas` },
  { key: "map", label: "Property Map", href: (z) => `/vacancy/${z}/map` },
  { key: "directory", label: "All Properties", href: (z) => `/vacancy/${z}/directory` },
  { key: "cases", label: "Case Workbench", href: (z) => `/vacancy/${z}/cases` },
];

export function hrefFor(view: VacancyView, zip: string): string {
  return (TABS.find((t) => t.key === view) ?? TABS[0]).href(zip);
}

export function VacancySubNav({ zip, active }: { zip: string; active: VacancyView }) {
  const entry = getPilotZipEntry(zip);
  const neighborhood = entry?.primaryNeighborhood ?? zip;

  return (
    <div className="mb-8 border-b border-[#0C1B33]/10 pb-4">
      {/* Breadcrumb + neighborhood switcher */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <nav className="flex items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/vacancy" className="hover:text-[#2563EB]">
            Chicago Vacant Sites
          </Link>
          <span>/</span>
          <span className="text-[#0C1B33]/80">{neighborhood}</span>
        </nav>
      </div>

      {/* Neighborhood switcher — preserves the active view. Desktop: the full
          nine-pill row. Mobile: an equivalent labeled <select> (defect E) —
          nine always-visible pill links don't fit small screens. */}
      <div className="mb-4 hidden flex-wrap gap-1.5 md:flex">
        {PILOT_ZIPS.map((e) => {
          const isActive = e.zip === zip;
          return (
            <Link
              key={e.zip}
              href={hrefFor(active, e.zip)}
              className={`px-2.5 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.06em] border transition-colors ${
                isActive
                  ? "bg-[#0C1B33] text-white border-[#0C1B33]"
                  : "bg-white text-[#0C1B33]/55 border-[#0C1B33]/15 hover:border-[#2563EB]/40 hover:text-[#2563EB]"
              }`}
            >
              {e.primaryNeighborhood}
            </Link>
          );
        })}
      </div>
      <div className="mb-4 md:hidden">
        <NeighborhoodSelect zip={zip} active={active} />
      </div>

      {/* Five-view tabs + Download area PDF */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {TABS.map((tab) => {
            const isActive = tab.key === active;
            return (
              <Link
                key={tab.key}
                href={tab.href(zip)}
                aria-current={isActive ? "page" : undefined}
                className={`border-b-2 pb-1 font-mono-bureau text-[11px] uppercase tracking-[0.14em] transition-colors ${
                  isActive
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#0C1B33]/45 hover:text-[#0C1B33]/80"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <VacancyIndexPdfButton zip={zip} neighborhood={neighborhood} source="vacancy_web_report" />
      </div>
    </div>
  );
}

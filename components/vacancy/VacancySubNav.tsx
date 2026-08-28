import Link from "next/link";
import { getPilotZipEntry } from "@/lib/pilot-zips";
import { VacancyIndexPdfButton } from "@/components/owner-file/VacancyIndexPdfButton";
import { NeighborhoodSelect } from "@/components/vacancy/NeighborhoodSelect";

/**
 * The consistent sub-navigation header shown on every /vacancy/[zip]* page — one
 * area workspace with three primary views. Property and opportunity-area routes
 * remain reachable from contextual links without competing in the top nav.
 * Server component: the active view is passed in, so no client hooks are
 * needed. The neighborhood switcher preserves the current view when switching
 * ZIPs. One labeled select is used at every viewport so the page does not begin
 * with nine competing neighborhood links on desktop and a different control on
 * mobile.
 */

export type VacancyView = "workbench" | "report" | "areas" | "map" | "directory";

const TABS: { key: VacancyView; label: string; href: (zip: string) => string }[] = [
  { key: "workbench", label: "Find Sites", href: (z) => `/vacancy/${z}` },
  { key: "report", label: "Report", href: (z) => `/vacancy/${z}/report` },
  { key: "map", label: "Map", href: (z) => `/vacancy/${z}/map` },
];

export function hrefFor(view: VacancyView, zip: string): string {
  switch (view) {
    case "report":
      return `/vacancy/${zip}/report`;
    case "areas":
      return `/vacancy/${zip}/areas`;
    case "map":
      return `/vacancy/${zip}/map`;
    case "directory":
      return `/vacancy/${zip}/directory`;
    case "workbench":
    default:
      return `/vacancy/${zip}`;
  }
}

export function VacancySubNav({ zip, active }: { zip: string; active: VacancyView }) {
  const entry = getPilotZipEntry(zip);
  const neighborhood = entry?.primaryNeighborhood ?? zip;

  return (
    <div className="mb-8 border-b border-[#0C1B33]/10 pb-4">
      {/* Breadcrumb + one neighborhood switcher at every viewport. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <nav className="flex items-center gap-1.5 font-mono-bureau text-[12px] text-[#0C1B33]/50">
          <Link href="/vacancy" className="hover:text-[#2563EB]">
            Chicago Vacant Sites
          </Link>
          <span>/</span>
          <span className="text-[#0C1B33]/80">{neighborhood}</span>
        </nav>
        <div className="w-full sm:w-64">
          <NeighborhoodSelect zip={zip} active={active} />
        </div>
      </div>

      {/* Three primary views + Download area PDF */}
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

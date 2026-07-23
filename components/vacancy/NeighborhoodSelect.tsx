"use client";

/**
 * Mobile neighborhood switcher (defect E) — the nine always-visible pill links
 * in VacancySubNav don't fit small screens. This renders the same nine pilot
 * ZIPs as a single labeled <select> that navigates via hrefFor(active, zip),
 * so switching neighborhoods on mobile preserves the current view exactly like
 * the desktop pill row does. VacancySubNav wraps the pill row in `hidden
 * md:flex` and this component in `md:hidden`.
 */

import { useRouter } from "next/navigation";
import { PILOT_ZIPS } from "@/lib/pilot-zips";
// Type-only import: VacancySubNav (a server component) imports this client
// component, so importing any runtime value back from it here would create a
// circular module reference across the server/client boundary. A type-only
// import is erased at compile time and carries no such risk. The href map
// itself is intentionally duplicated below (small, and it keeps this
// component import-free of VacancySubNav's server-only tree).
import type { VacancyView } from "@/components/vacancy/VacancySubNav";

const VIEW_HREF: Record<VacancyView, (zip: string) => string> = {
  overview: (zip) => `/vacancy/${zip}`,
  areas: (zip) => `/vacancy/${zip}/areas`,
  map: (zip) => `/vacancy/${zip}/map`,
  directory: (zip) => `/vacancy/${zip}/directory`,
  cases: (zip) => `/vacancy/${zip}/cases`,
};

function hrefFor(view: VacancyView, zip: string): string {
  return (VIEW_HREF[view] ?? VIEW_HREF.overview)(zip);
}

export function NeighborhoodSelect({ zip, active }: { zip: string; active: VacancyView }) {
  const router = useRouter();

  return (
    <label className="flex w-full flex-col gap-1">
      <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
        Neighborhood
      </span>
      <select
        aria-label="Neighborhood"
        value={zip}
        onChange={(event) => router.push(hrefFor(active, event.target.value))}
        className="w-full border border-[#0C1B33]/15 bg-white px-2.5 py-2 font-mono-bureau text-[11px] text-[#0C1B33]"
      >
        {PILOT_ZIPS.map((entry) => (
          <option key={entry.zip} value={entry.zip}>
            {entry.primaryNeighborhood} · {entry.zip}
          </option>
        ))}
      </select>
    </label>
  );
}

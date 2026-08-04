import { Suspense } from "react";
import type { Metadata } from "next";
import { QuickCheckClient } from "@/components/check/QuickCheckClient";

/**
 * /check — the Quick Address Check surface pinned in the global nav.
 *
 * `?lat=&lon=&address=` renders results; anything else renders address entry.
 * Not a redirect to /report: this page answers the two questions that need no
 * form (what geographies cover the point, what public activity is measured
 * around it) and then hands off. See components/check/QuickCheckClient.tsx.
 *
 * Server shell so the route carries its own metadata; the search-param read
 * lives in the client component behind Suspense, as Next requires.
 */

export const metadata: Metadata = {
  title: "Quick Address Check",
  description:
    "Check which mapped incentive geographies cover a Chicago address, plus the raw public activity measurements around it. No form, no login.",
};

export default function CheckPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[640px] px-5 pb-20 pt-14 sm:pt-20">
          <p className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/40">
            Quick address check
          </p>
          <p className="mt-2 text-[14.5px] text-[#0C1B33]/45">Loading…</p>
        </div>
      }
    >
      <QuickCheckClient />
    </Suspense>
  );
}

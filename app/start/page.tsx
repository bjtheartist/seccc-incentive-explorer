import type { Metadata } from "next";
import Link from "next/link";
import { AddressSearch } from "@/components/lookup/AddressSearch";
import { StartPageTracker } from "@/components/start/StartPageTracker";

/**
 * Focused activation landing page for presentations, QR codes, LinkedIn, and
 * partner outreach. One address box, one CTA, one promise. Intentionally
 * noindex (campaign page, not an SEO surface) and excluded from the sitemap.
 */
export const metadata: Metadata = {
  title: "Run a Free Chicago Location Snapshot",
  description:
    "Enter any Chicago address to see the incentives, zoning, vacancy signals, and local support partners that may apply — one free snapshot, no login.",
  robots: { index: false, follow: true },
};

export default function StartPage() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex items-center justify-center overflow-hidden bg-[#0C1B33] bureau-grid bureau-noise px-6 py-20">
      <StartPageTracker />

      <div className="relative z-10 w-full max-w-[680px] text-center">
        <div className="flex items-center justify-center gap-3 mb-7">
          <div className="accent-bar-light" />
          <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
            Chicago Incentive Explorer
          </span>
        </div>

        <h1 className="font-editorial text-4xl md:text-6xl text-white leading-[1.05] mb-5">
          Find what your <span className="text-[#2563EB]">address</span> unlocks.
        </h1>

        <p className="text-white/55 text-[15px] md:text-base max-w-[520px] mx-auto mb-9 leading-relaxed">
          Enter any Chicago address — see the incentives, zoning, vacancy
          signals, and local support partners that may apply. One free
          snapshot. No login.
        </p>

        <AddressSearch />

        <p className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-white/30 mt-6">
          On the next screen you can email or download your snapshot
        </p>

        <p className="text-white/30 text-[12px] mt-8">
          Built from public federal, state, county, and city data ·{" "}
          <Link
            href="/programs"
            className="underline underline-offset-4 hover:text-white/60 transition-colors"
          >
            Browse programs
          </Link>
        </p>
      </div>
    </div>
  );
}

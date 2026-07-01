"use client";

import Link from "next/link";
import { AddressSearch } from "@/components/lookup/AddressSearch";

/**
 * Reusable conversion block for SEO pages. A navy panel (so the dark-styled
 * AddressSearch reads as intentional) that routes visitors into the free
 * location snapshot. Used on program, neighborhood, and answer pages.
 */
export function SnapshotCTA({
  heading = "Generate a Free Location Snapshot",
  eyebrow = "Start with an address",
  sub,
}: {
  heading?: string;
  eyebrow?: string;
  sub?: string;
}) {
  return (
    <section className="bg-[#0C1B33] bureau-grid rounded-2xl px-6 py-10 md:px-10 md:py-12">
      <div className="max-w-[640px] mx-auto text-center">
        <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]">
          {eyebrow}
        </span>
        <h2 className="font-editorial text-2xl md:text-3xl text-white mt-3 mb-3">
          {heading}
        </h2>
        {sub && (
          <p className="text-white/50 text-sm mb-6 max-w-[460px] mx-auto leading-relaxed">
            {sub}
          </p>
        )}
        <div className={sub ? "" : "mt-6"}>
          <AddressSearch source="seo_cta" />
        </div>
        <div className="flex justify-center gap-6 mt-6">
          <Link
            href="/programs"
            className="text-[12px] text-white/40 hover:text-white/70 transition-colors border-b border-dashed border-white/15 pb-0.5"
          >
            Browse Programs
          </Link>
          <Link
            href="/map"
            className="text-[12px] text-white/40 hover:text-white/70 transition-colors border-b border-dashed border-white/15 pb-0.5"
          >
            Explore Map
          </Link>
        </div>
      </div>
    </section>
  );
}

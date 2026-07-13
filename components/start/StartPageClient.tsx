"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Map, Network, Search, Users } from "lucide-react";
import { AddressSearch } from "@/components/lookup/AddressSearch";
import { trackEvent } from "@/lib/analytics-events";

function cleanTrackingValue(value: string | null, fallback: string) {
  if (!value) return fallback;
  const cleaned = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

export function StartPageClient() {
  // QR/campaign attribution (EF5): parsed here for the page-view event, and
  // also threaded down into AddressSearch so it survives into the /report
  // redirect and the terminal snapshot/report event — previously this value
  // was captured only in start_page_viewed's metadata and dropped before it
  // ever reached a conversion event. Read via useSearchParams (not
  // window.location.search in an effect) so this is derived at render time
  // instead of a setState-in-effect.
  const searchParams = useSearchParams();
  const source = useMemo(
    () =>
      cleanTrackingValue(
        searchParams.get("source") || searchParams.get("utm_source"),
        "start_page",
      ),
    [searchParams],
  );
  const campaign = useMemo(
    () =>
      cleanTrackingValue(
        searchParams.get("campaign") || searchParams.get("utm_campaign") || searchParams.get("c"),
        "direct",
      ),
    [searchParams],
  );

  useEffect(() => {
    trackEvent("start_page_viewed", {
      source,
      metadata: {
        campaign,
      },
    });
  }, [source, campaign]);

  return (
    <main className="min-h-screen bg-[#0C1B33] text-white">
      <section className="relative overflow-hidden px-5 py-12 sm:px-8 sm:py-16">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-25"
          style={{ backgroundImage: "url('/chicago-map-hero.png')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C1B33]/75 via-[#0C1B33]/90 to-[#0C1B33]" />

        <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] max-w-[820px] flex-col justify-center">
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 border border-white/15 px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:border-white/30 hover:text-white/80"
            >
              CSIM
            </Link>
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.22em] text-white/35">
              Free Chicago location snapshot
            </span>
          </div>

          <div className="text-center">
            <h1 className="mx-auto max-w-[760px] font-editorial text-5xl font-normal leading-[0.95] text-white sm:text-6xl md:text-7xl">
              Check an address before the next conversation.
            </h1>
            <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-relaxed text-white/52 sm:text-base">
              Generate a free location snapshot with incentive zones, TIF and NOF
              context, site signals, and nearby support organizations tied to one
              Chicago address.
            </p>
          </div>

          <div className="mx-auto mt-9 w-full max-w-[660px]">
            <AddressSearch source={source} campaign={campaign} />
          </div>

          <div className="mx-auto mt-10 grid w-full max-w-[760px] gap-px bg-white/10 sm:grid-cols-3">
            {[
              {
                icon: Search,
                label: "Address first",
                copy: "Start with a real location, not a questionnaire.",
              },
              {
                icon: Network,
                label: "Public data",
                copy: "See mapped public incentive and site context in one place.",
              },
              {
                icon: Users,
                label: "Local support",
                copy: "Find organizations that can help interpret next steps.",
              },
            ].map((item) => (
              <div key={item.label} className="bg-[#0C1B33]/80 px-5 py-5 text-left">
                <item.icon className="mb-4 h-4 w-4 text-[#2563EB]" />
                <h2 className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-white/75">
                  {item.label}
                </h2>
                <p className="mt-2 text-[12px] leading-relaxed text-white/38">
                  {item.copy}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-5">
            <Link
              href="/map"
              className="inline-flex items-center gap-2 text-[12px] text-white/38 transition-colors hover:text-white/70"
            >
              <Map className="h-3.5 w-3.5" />
              Explore Map
            </Link>
            <Link
              href="/programs"
              className="inline-flex items-center gap-2 text-[12px] text-white/38 transition-colors hover:text-white/70"
            >
              Browse Programs
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

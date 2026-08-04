"use client";

import { AddressSearch } from "@/components/lookup/AddressSearch";
import { trackEvent } from "@/lib/analytics-events";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import {
  ArrowRight,
  Building2,
  ClipboardList,
  MapPin,
  Search,
} from "lucide-react";

/* ── Props (computed server-side from real data) ─────────────── */

interface LinkItem {
  name: string;
  slug: string;
}

interface AnswerLink {
  question: string;
  slug: string;
}

interface HomePageClientProps {
  stats: {
    programs: number;
    neighborhoods: number;
    zoneLayers: number;
    answers: number;
  };
  featuredPrograms: LinkItem[];
  featuredNeighborhoods: LinkItem[];
  featuredAnswers: AnswerLink[];
  tickerNames: string[];
}

/* ── Demo addresses (BJT-109 experiment: sample lookups for the
      visitor who doesn't have an address ready). Coordinates are
      fixed so the demo never depends on live geocoding. ────────── */

const DEMO_ADDRESSES = [
  {
    label: "South Chicago storefront",
    address: "8701 S Bennett Ave, Chicago, IL",
    lat: 41.73683,
    lon: -87.57776,
  },
  {
    label: "Englewood corridor",
    address: "6300 S Halsted St, Chicago, IL",
    lat: 41.77946,
    lon: -87.6445,
  },
  {
    label: "Downtown office",
    address: "203 N LaSalle St, Chicago, IL",
    lat: 41.88592,
    lon: -87.63295,
  },
] as const;

function DemoAddressChips() {
  const router = useRouter();

  const runDemo = (demo: (typeof DEMO_ADDRESSES)[number]) => {
    trackEvent("demo_address_clicked", {
      address: demo.address,
      lat: demo.lat,
      lon: demo.lon,
      source: "homepage_demo",
      metadata: { label: demo.label },
    });
    const params = new URLSearchParams({
      instant: "true",
      lat: demo.lat.toFixed(5),
      lon: demo.lon.toFixed(5),
      addr: demo.address,
      src: "demo-homepage",
    });
    router.push(`/report?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
      <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-white/30 mr-1">
        No address handy? Try
      </span>
      {DEMO_ADDRESSES.map((demo) => (
        <button
          key={demo.label}
          type="button"
          onClick={() => runDemo(demo)}
          className="group inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/15 bg-white/[0.04] rounded-full text-[11px] text-white/55 hover:text-white hover:border-[#2563EB] hover:bg-[#2563EB]/15 active:translate-y-px transition-all"
        >
          <MapPin className="w-3 h-3 text-[#2563EB] opacity-70 group-hover:opacity-100" />
          {demo.label}
        </button>
      ))}
    </div>
  );
}

/* ── Hero intent cards (WP1) ─────────────────────────────────────
      The three ways in, sitting directly under the address bar: type an
      address, hunt for space, or answer the survey. Copy is client-approved
      verbatim. On mobile they stack beneath the search bar, which stays
      above the fold on its own. ─────────────────────────────────── */

const INTENT_CARD_CLASS =
  "group flex h-full flex-col items-start gap-1.5 border border-[#0C1B33]/10 bg-white px-4 py-3.5 text-left shadow-[0_10px_30px_-24px_rgba(12,27,51,0.6)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#2563EB]/40 hover:shadow-[0_20px_40px_-24px_rgba(12,27,51,0.7)] active:translate-y-0";

function IntentCardFace({
  kicker,
  icon: Icon,
  title,
  subtitle,
}: {
  kicker: string;
  icon: typeof Search;
  title: string;
  subtitle: string;
}) {
  return (
    <>
      <span className="flex w-full items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" aria-hidden="true" />
        <span aria-hidden="true" className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30">
          {kicker}
        </span>
        <ArrowRight
          className="ml-auto h-3 w-3 shrink-0 text-[#0C1B33]/20 transition-all group-hover:translate-x-0.5 group-hover:text-[#2563EB]"
          aria-hidden="true"
        />
      </span>
      <span className="text-[13.5px] font-medium leading-snug text-[#0C1B33]">
        {title}
      </span>
      <span className="text-[11.5px] leading-relaxed text-[#0C1B33]/50">
        {subtitle}
      </span>
    </>
  );
}

function HeroIntentCards({ onCheckAddress, programCount }: { onCheckAddress: () => void; programCount: number }) {
  return (
    <div className="mx-auto mt-4 grid w-full max-w-[720px] gap-2.5 sm:mt-5 sm:grid-cols-3">
      <button type="button" onClick={onCheckAddress} className={INTENT_CARD_CLASS}>
        <IntentCardFace
          kicker="01"
          icon={Search}
          title="Check an Address"
          subtitle="Instant zone results for any Chicago address"
        />
      </button>
      <Link href="/vacancy" className={INTENT_CARD_CLASS}>
        <IntentCardFace
          kicker="02"
          icon={Building2}
          title="Find Commercial Space"
          subtitle="Vacant sites, zoning fit, and the incentive map"
        />
      </Link>
      <Link href="/qualify" className={INTENT_CARD_CLASS}>
        <IntentCardFace
          kicker="03"
          icon={ClipboardList}
          title="Take the Eligibility Survey"
          subtitle={`Four questions to match ${programCount} programs`}
        />
      </Link>
    </div>
  );
}

/* ── Section header (bureau index style) ─────────────────────── */

function SectionMark({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-4 mb-10">
      <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
        {n}
      </span>
      <div className="accent-bar" />
      <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50">
        {label}
      </span>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */

export function HomePageClient({
  stats,
  featuredPrograms,
  featuredNeighborhoods,
  featuredAnswers,
  tickerNames,
}: HomePageClientProps) {
  const heroSearchRef = useRef<HTMLDivElement>(null);

  /** "Check an Address" doesn't navigate — it hands the visitor the input. */
  const focusHeroSearch = useCallback(() => {
    const container = heroSearchRef.current;
    if (!container) return;
    container.scrollIntoView({ behavior: "smooth", block: "center" });
    container.querySelector("input")?.focus({ preventScroll: true });
  }, []);

  return (
    <div>
      {/* ═══ 01 · HERO — the address is the product ═══ */}
      <section className="relative min-h-[calc(100svh-3.5rem)] md:min-h-screen flex flex-col justify-center md:justify-end overflow-hidden bg-[#0C1B33] py-10 md:py-0">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat animate-hero-drift"
          style={{ backgroundImage: "url('/chicago-map-hero.png')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C1B33]/30 via-[#0C1B33]/60 to-[#0C1B33]" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0C1B33] via-[#0C1B33]/90 to-transparent" />

        {/* Status chip */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="absolute top-24 left-1/2 z-10 hidden -translate-x-1/2 sm:block"
        >
          <div className="inline-flex items-center gap-2.5 px-5 py-2.5 bg-black/30 backdrop-blur-xl border border-white/10 rounded-full">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono-bureau text-[11px] tracking-[0.1em] text-white/60">
              {stats.programs} programs · {stats.neighborhoods} community areas
              · free
            </span>
          </div>
        </motion.div>

        <div className="relative z-10 w-full max-w-[820px] mx-auto px-4 pb-4 pt-6 text-center sm:px-6 sm:pb-10 sm:pt-12 md:pb-16 md:pt-0">
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="font-editorial text-[2.45rem] sm:text-5xl md:text-6xl lg:text-7xl font-normal text-white leading-[0.96] sm:leading-[1] mb-3 sm:mb-4 break-words"
          >
            <span className="sm:hidden">
              Chicago
              <br />
              Incentives
            </span>
            <span className="hidden sm:inline">Find Chicago Incentives</span>
            <br />
            <span className="text-[#2563EB]">by Address</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="text-white/55 text-[13px] sm:text-[15px] max-w-[560px] mx-auto mb-4 sm:mb-7 leading-relaxed"
          >
            Enter a Chicago address to generate a free location snapshot from
            public data — TIF, NOF, and SBIF context, vacancy signals, and
            nearby local support partners.
          </motion.p>

          <motion.div
            ref={heroSearchRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
          >
            <AddressSearch source="homepage" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.85 }}
          >
            <HeroIntentCards onCheckAddress={focusHeroSearch} programCount={stats.programs} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.0 }}
          >
            <DemoAddressChips />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.2 }}
            className="font-mono-bureau text-[9px] tracking-[0.22em] uppercase text-white/25 mt-5"
          >
            Public federal · state · county · city data — no login, no fee
          </motion.p>
        </div>
      </section>

      {/* ═══ TICKER — every program, one strip ═══ */}
      <Link
        href="/programs"
        aria-label={`Browse all ${stats.programs} incentive programs`}
        className="group block bg-[#0C1B33] border-y border-white/10 overflow-hidden"
      >
        <div className="relative flex items-center">
          <span className="shrink-0 z-10 bg-[#2563EB] text-white font-mono-bureau text-[9px] tracking-[0.25em] uppercase px-4 py-2.5">
            {stats.programs} programs
          </span>
          <div className="ticker-mask relative flex-1 overflow-hidden">
            <div className="ticker-track flex whitespace-nowrap group-hover:[animation-play-state:paused]">
              {[0, 1].map((copy) => (
                <span
                  key={copy}
                  aria-hidden={copy === 1}
                  className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-white/40 py-2.5"
                >
                  {tickerNames.map((name) => (
                    <span key={name} className="mx-4">
                      {name} <span className="text-[#2563EB]/70">·</span>
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
          <span className="shrink-0 z-10 hidden sm:flex items-center gap-1 font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-white/40 group-hover:text-white px-4 py-2.5 transition-colors">
            All <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </Link>

      {/* ═══ THE MAP — the product, shown ═══ */}
      <section className="py-16 md:py-24 px-6 bg-white">
        <div className="container mx-auto max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-10 md:mb-12"
          >
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]/60">
              — The Map
            </span>
            <h2 className="font-editorial text-3xl md:text-4xl text-[#0C1B33] mt-3 mb-4 leading-tight">
              Tap any neighborhood.
              <br />
              See every incentive that applies.
            </h2>
            <p className="text-sm text-[#0C1B33]/55 max-w-xl mx-auto leading-relaxed">
              Every TIF, Opportunity Zone, Enterprise Zone, and program layer
              in Chicago — drawn on one live map, free to explore.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            <Link
              href="/map"
              onClick={() =>
                trackEvent("map_preview_clicked", {
                  source: "homepage_map_preview",
                })
              }
              className="group relative block overflow-hidden rounded-2xl border border-[#0C1B33]/10 shadow-[0_24px_60px_-24px_rgba(12,27,51,0.25)]"
            >
              <Image
                src="/home/map-preview.webp"
                alt="Live map of Chicago incentive zones — TIF districts, Opportunity Zones, and program boundaries"
                width={1600}
                height={900}
                className="w-full h-[240px] sm:h-[360px] md:h-[480px] object-cover transition-[filter] duration-300 group-hover:brightness-105"
                priority={false}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0C1B33]/30 via-transparent to-transparent pointer-events-none" />
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 sm:left-5 sm:translate-x-0 inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.2em] uppercase shadow-lg group-hover:bg-[#1d4ed8] transition-colors">
                Explore the map <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ═══ 02 · SPECIMEN — what one address returns ═══ */}
      <section className="py-20 md:py-24 px-6 bg-[#FAF9F6] bureau-grid">
        <div className="container mx-auto max-w-5xl">
          <SectionMark n="01" label="What One Address Returns" />
          <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">
            <div>
              <h2 className="font-editorial text-3xl md:text-4xl text-[#0C1B33] mb-6 leading-tight">
                One address.
                <br />
                <span className="text-[#0C1B33]/40">The full picture.</span>
              </h2>
              <p className="text-sm text-[#0C1B33]/55 leading-relaxed mb-8 max-w-md">
                Four levels of government run dozens of overlapping incentive
                zones and programs. The Explorer reads them all at once — then
                hands you a report you can take to a lender, a chamber, or an
                alderman&apos;s office.
              </p>
              <ol className="space-y-4">
                {[
                  ["01", "Start with an address", "or a corridor you're considering"],
                  ["02", "See what may apply", "zones + programs, plain English"],
                  ["03", "Generate the report", "print it, email it, share the link"],
                  ["04", "Take the next step", "with the right local partner"],
                ].map(([n, title, sub]) => (
                  <li key={n} className="flex items-baseline gap-4">
                    <span className="font-mono-bureau text-[10px] tracking-[0.2em] text-[#2563EB] shrink-0">
                      {n}
                    </span>
                    <div>
                      <span className="text-[14px] font-medium text-[#0C1B33]">
                        {title}
                      </span>
                      <span className="text-[12px] text-[#0C1B33]/40 ml-2">
                        {sub}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* The specimen dossier */}
            <motion.div
              initial={{ opacity: 0, y: 24, rotate: 0.8 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0.8 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative bg-white border border-[#0C1B33]/15 shadow-[0_24px_60px_-24px_rgba(12,27,51,0.35)] p-6 md:p-8"
            >
              <span className="absolute -top-3 right-6 bg-[#2563EB] text-white font-mono-bureau text-[9px] tracking-[0.3em] uppercase px-3 py-1">
                Sample Snapshot
              </span>
              <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/35 mb-1">
                Location Snapshot
              </div>
              <div className="font-editorial text-xl text-[#0C1B33] italic mb-5">
                8701 S Bennett Ave, Chicago
              </div>
              <div className="grid grid-cols-2 gap-px bg-[#0C1B33]/10 border border-[#0C1B33]/10 mb-5">
                {[
                  ["Zones matched", "7"],
                  ["Programs relevant", "12"],
                  ["Vacant parcels nearby", "14"],
                  ["Confidence", "High"],
                ].map(([label, value], i) => (
                  <div
                    key={label}
                    className={`p-4 ${i === 3 ? "bg-[#0C1B33] text-white" : "bg-white"}`}
                  >
                    <div
                      className={`font-editorial text-2xl ${i === 3 ? "text-white" : "text-[#0C1B33]"}`}
                    >
                      {value}
                    </div>
                    <div
                      className={`font-mono-bureau text-[8px] tracking-[0.2em] uppercase mt-1 ${i === 3 ? "text-white/50" : "text-[#0C1B33]/40"}`}
                    >
                      {label}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-5">
                {["TIF District", "Opportunity Zone", "Enterprise Zone", "NMTC", "SSA"].map(
                  (z) => (
                    <span
                      key={z}
                      className="font-mono-bureau text-[8.5px] tracking-[0.12em] uppercase px-2 py-1 border border-[#0C1B33]/15 text-[#0C1B33]/60"
                    >
                      {z}
                    </span>
                  ),
                )}
              </div>
              <p className="font-mono-bureau text-[8.5px] tracking-[0.15em] uppercase text-[#0C1B33]/30 leading-relaxed">
                Illustrative sample · verify with the administering agency
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══ VIDEO ═══ */}
      <section className="py-16 md:py-20 px-6 bg-white">
        <div className="container mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]/60">
              See How It Works
            </span>
            <h2 className="font-editorial text-3xl md:text-4xl text-[#0C1B33] mt-3 mb-10">
              From Search to Report in Seconds
            </h2>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="rounded-2xl overflow-hidden shadow-2xl border border-[#0C1B33]/10"
          >
            <video
              autoPlay
              loop
              muted
              playsInline
              className="w-full"
              poster="/chicago-map-hero.png"
            >
              <source src="/howto.webm" type="video/webm" />
              <source src="/howto.mp4" type="video/mp4" />
            </video>
          </motion.div>
        </div>
      </section>

      {/* ═══ 03 · NUMBERS — the coverage ledger (navy band) ═══ */}
      <section className="py-16 md:py-20 px-6 bg-[#0C1B33] bureau-noise">
        <div className="container mx-auto max-w-5xl relative z-10">
          <div className="flex items-center gap-4 mb-12">
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/25">
              02
            </span>
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/50">
              Coverage
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border border-white/10">
            {[
              [String(stats.programs), "Incentive programs", "/programs"],
              [String(stats.neighborhoods), "Community areas", "/map"],
              [String(stats.zoneLayers), "Zone layers mapped", "/map"],
              [String(stats.answers), "Questions answered", "/answers/" + featuredAnswers[0]?.slug],
            ].map(([value, label, href]) => (
              <Link
                key={label}
                href={href}
                className="group bg-[#0C1B33] p-6 md:p-8 hover:bg-[#11244275] transition-colors"
              >
                <div className="font-editorial text-4xl md:text-5xl text-white group-hover:text-[#5B8DEF] transition-colors">
                  {value}
                </div>
                <div className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/40 mt-3">
                  {label}
                </div>
              </Link>
            ))}
          </div>
          <p className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/25 mt-6 text-center">
            Four levels of government · one front door
          </p>
        </div>
      </section>

      {/* ═══ 04 · BROWSE — the index (SEO hub) ═══ */}
      <section className="py-20 md:py-24 px-6 bg-[#EFF3FB]">
        <div className="container mx-auto max-w-5xl">
          <SectionMark n="03" label="Browse the Index" />
          <div className="grid md:grid-cols-2 gap-10 md:gap-14">
            <div>
              <h3 className="font-editorial text-2xl text-[#0C1B33] mb-5">
                By program
              </h3>
              <div className="flex flex-wrap gap-2">
                {featuredPrograms.map((p) => (
                  <Link
                    key={p.slug}
                    href={`/programs/${p.slug}`}
                    className="inline-flex items-center px-3.5 py-2 bg-white border border-[#0C1B33]/12 text-[12px] text-[#0C1B33]/75 hover:border-[#2563EB] hover:text-[#2563EB] active:translate-y-px transition-all"
                  >
                    {p.name}
                  </Link>
                ))}
                <Link
                  href="/programs"
                  className="inline-flex items-center gap-1 px-3.5 py-2 bg-[#0C1B33] text-white text-[12px] hover:bg-[#2563EB] transition-colors"
                >
                  All {stats.programs} <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
            <div>
              <h3 className="font-editorial text-2xl text-[#0C1B33] mb-5">
                By neighborhood
              </h3>
              <div className="flex flex-wrap gap-2">
                {featuredNeighborhoods.map((n) => (
                  <Link
                    key={n.slug}
                    href={`/neighborhoods/${n.slug}/incentives`}
                    className="inline-flex items-center px-3.5 py-2 bg-white border border-[#0C1B33]/12 text-[12px] text-[#0C1B33]/75 hover:border-[#2563EB] hover:text-[#2563EB] active:translate-y-px transition-all"
                  >
                    {n.name}
                  </Link>
                ))}
                <Link
                  href="/map"
                  className="inline-flex items-center gap-1 px-3.5 py-2 bg-[#0C1B33] text-white text-[12px] hover:bg-[#2563EB] transition-colors"
                >
                  All {stats.neighborhoods} <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-[#0C1B33]/10">
            <h3 className="font-mono-bureau text-[10px] tracking-[0.25em] uppercase text-[#0C1B33]/40 mb-4">
              Common questions
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {featuredAnswers.map((a) => (
                <Link
                  key={a.slug}
                  href={`/answers/${a.slug}`}
                  className="group flex items-center justify-between gap-3 bg-white border border-[#0C1B33]/10 px-4 py-3 hover:border-[#2563EB]/50 transition-colors"
                >
                  <span className="font-editorial italic text-[15px] text-[#0C1B33]/80 group-hover:text-[#0C1B33]">
                    {a.question}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 text-[#0C1B33]/25 group-hover:text-[#2563EB] group-hover:translate-x-0.5 transition-all" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 05 · MISSION — the human layer ═══ */}
      <section className="py-20 md:py-24 px-6 bg-[#FAF9F6]">
        <div className="container mx-auto max-w-3xl text-center">
          <SectionMark n="04" label="Then Meet Who Can Help" />
          <blockquote className="font-editorial text-2xl md:text-[2rem] leading-snug text-[#0C1B33] mb-6">
            The data is the door.
            <br />
            <span className="text-[#0C1B33]/40 italic">
              Local partners are the path through it.
            </span>
          </blockquote>
          <p className="text-sm text-[#0C1B33]/55 leading-relaxed max-w-xl mx-auto mb-8">
            Every snapshot lists the chambers, business support organizations,
            and development corporations already working where you are — with
            real phone numbers and real people. Nobody should have to carry
            the whole ecosystem in their head.
          </p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-mono-bureau text-[9px] tracking-[0.22em] uppercase text-[#0C1B33]/35">
            <span>Chambers of commerce</span>
            <span>·</span>
            <span>SBDCs &amp; BSOs</span>
            <span>·</span>
            <span>Development corporations</span>
            <span>·</span>
            <span>CDFIs &amp; lenders</span>
          </div>
        </div>
      </section>

      {/* ═══ 06 · FINAL CTA — repeat the ask ═══ */}
      <section className="relative py-20 md:py-28 px-6 bg-[#0C1B33] bureau-grid overflow-hidden">
        <div className="absolute inset-0 bureau-noise" />
        <div className="relative z-10 container mx-auto max-w-[680px] text-center">
          <div className="flex items-center justify-center gap-3 mb-7">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Start Here
            </span>
            <div className="accent-bar-light" />
          </div>
          <h2 className="font-editorial text-3xl md:text-5xl text-white leading-[1.05] mb-4">
            Find what your address{" "}
            <span className="text-[#2563EB]">unlocks.</span>
          </h2>
          <p className="text-white/50 text-sm mb-8">
            One free snapshot. No login. Sixty seconds.
          </p>
          <AddressSearch source="homepage_repeat" />
          <p className="font-mono-bureau text-[9px] tracking-[0.22em] uppercase text-white/25 mt-6">
            chicagoincentiveexplorer.com · built from public data
          </p>
        </div>
      </section>
    </div>
  );
}

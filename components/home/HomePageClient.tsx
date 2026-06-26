"use client";

import { AddressSearch } from "@/components/lookup/AddressSearch";
import { motion } from "framer-motion";
import Link from "next/link";

export function HomePageClient() {
  return (
    <div>
      {/* Hero - Full-width map with floating search */}
      <section className="relative min-h-[calc(100svh-3.5rem)] md:min-h-screen flex flex-col justify-center md:justify-end overflow-hidden bg-[#0C1B33] py-10 md:py-0">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/chicago-map-hero.png')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C1B33]/30 via-[#0C1B33]/60 to-[#0C1B33]" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0C1B33] via-[#0C1B33]/90 to-transparent" />

        {/* Top badge */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="absolute top-24 left-1/2 z-10 hidden -translate-x-1/2 sm:block"
        >
          <div className="inline-flex items-center gap-2.5 px-5 py-2.5 bg-black/30 backdrop-blur-xl border border-white/10 rounded-full">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono-bureau text-[11px] tracking-[0.1em] text-white/60">
              Free Address-Based Location Snapshot
            </span>
          </div>
        </motion.div>

        {/* Bottom content */}
        <div className="relative z-10 w-full max-w-[800px] mx-auto px-4 pb-4 pt-6 text-center sm:px-6 sm:pb-12 sm:pt-12 md:pb-20 md:pt-0">
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
            className="text-white/55 text-[13px] sm:text-[15px] max-w-[560px] mx-auto mb-4 sm:mb-8 leading-relaxed"
          >
            Enter a Chicago address to generate a free location snapshot from
            public data, including TIF, NOF, and SBIF context, vacancy reports,
            and nearby local support partners.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
          >
            <AddressSearch />
          </motion.div>

          {/* Nav links below search */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.1 }}
            className="flex flex-wrap justify-center gap-4 sm:gap-6 mt-4 sm:mt-6"
          >
            {[
              { label: "Browse Programs", href: "/programs" },
              { label: "Explore Map", href: "/map" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[12px] text-white/30 hover:text-white/60 transition-colors border-b border-dashed border-white/15 pb-0.5"
              >
                {link.label}
              </Link>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How-To Video */}
      <section className="py-20 px-6 bg-white">
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
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
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

      {/* Coverage Highlights - soft blue section */}
      <section className="py-24 px-6 bg-[#EFF3FB]">
        <div className="container mx-auto max-w-5xl">
          <div className="flex items-center gap-4 mb-16">
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
              02
            </span>
            <div className="accent-bar" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50">
              Coverage
            </span>
          </div>

          <div className="grid md:grid-cols-2 gap-16">
            <div>
              <h2 className="font-editorial text-3xl md:text-4xl text-[#0C1B33] mb-6">
                Chicago
                <br />
                <span className="text-[#0C1B33]/40">Is Rich With Incentives</span>
              </h2>
              <p className="text-sm text-[#0C1B33]/50 leading-relaxed mb-8">
                Chicago sits at the intersection of multiple overlapping
                economic incentive programs - from federal Opportunity Zones to
                city TIF districts. Eligibility varies by location, industry,
                and business type.
              </p>
              <div className="space-y-4">
                {[
                  { pct: 87, label: "Special Service Area", color: "#16a34a" },
                  { pct: 81, label: "TIF District", color: "#2563eb" },
                  { pct: 49, label: "Opportunity Zone", color: "#7c3aed" },
                  { pct: 46, label: "Enterprise Zone", color: "#059669" },
                ].map((z, i) => (
                  <div key={i}>
                    <div className="flex justify-between mb-1">
                      <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/60">
                        {z.label}
                      </span>
                      <span className="font-mono-bureau text-[10px] text-[#0C1B33]/70">
                        {z.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#0C1B33]/5">
                      <div
                        className="h-full transition-all duration-1000"
                        style={{ width: `${z.pct}%`, backgroundColor: z.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { value: "Multi", label: "Incentive Zone Layers" },
                { value: "100", label: "SBIF Projects Nearby" },
                { value: "69", label: "Industry Categories" },
                { value: "0.91", label: "Diversity Index" },
              ].map((stat, i) => (
                <div
                  key={i}
                  className="border border-[#0C1B33]/10 bg-white/60 p-6 flex flex-col justify-between"
                >
                  <div className="font-editorial text-3xl text-[#0C1B33]">
                    {stat.value}
                  </div>
                  <div className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/40 mt-4">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

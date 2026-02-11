"use client";

import { AddressSearch } from "@/components/lookup/AddressSearch";
import { motion } from "framer-motion";
import Link from "next/link";

export default function Home() {
  return (
    <div>
      {/* Hero — Chicago map background */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden bg-[#0C1B33]">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/chicago-map-hero.png')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0C1B33]/95 via-[#0C1B33]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C1B33]/40 via-transparent to-[#0C1B33]/80" />

        <div className="relative z-10 container mx-auto px-6 py-20 max-w-5xl">
          {/* Eyebrow */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="mb-8"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="accent-bar-light" />
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
                Chicago Economic Development
              </span>
            </div>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="font-editorial text-5xl md:text-7xl lg:text-8xl font-normal text-white leading-[0.95] mb-8"
          >
            Chicago
            <br />
            <span className="text-white/40">Business</span>
            <br />
            Incentives
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="text-white/50 text-base md:text-lg max-w-xl mb-12 leading-relaxed"
          >
            Discover what your Chicago business qualifies for. We cross-reference
            11 incentive zone layers — from TIF districts to Opportunity Zones —
            to show you every program available at your address.
          </motion.p>

          {/* Search */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
          >
            <AddressSearch />
            <div className="mt-4 text-center">
              <Link
                href="/qualify"
                className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-white/40 hover:text-white transition-colors"
              >
                Not sure what you qualify for? Take the survey &rarr;
              </Link>
            </div>
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
              poster="/howto-poster.png"
            >
              <source src="/howto.webm" type="video/webm" />
              <source src="/howto.mp4" type="video/mp4" />
            </video>
          </motion.div>
        </div>
      </section>

      {/* Coverage Highlights — soft blue section */}
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
                economic incentive programs — from federal Opportunity Zones to
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
                { value: "11", label: "Incentive Zone Layers" },
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

"use client";

import { AddressSearch } from "@/components/lookup/AddressSearch";
import { motion } from "framer-motion";
import Link from "next/link";
import { Search, MapPin, ArrowRight, ClipboardCheck } from "lucide-react";

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
            Whether you&rsquo;re auditing incentives at your current location or
            searching for the best place to set up shop &mdash; we&rsquo;ve got you covered.
          </motion.p>

          {/* Two-Path Selection */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="grid md:grid-cols-2 gap-4 max-w-3xl"
          >
            {/* Path 1: Audit Your Incentives */}
            <Link
              href="#audit"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("audit")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="group relative border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] rounded-2xl p-6 transition-all hover:border-[#2563EB]/40 hover:shadow-lg hover:shadow-blue-500/10"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#2563EB]/20 flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5 text-[#2563EB]" />
                </div>
                <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/30">
                  Path 01
                </span>
              </div>
              <h3 className="font-editorial text-xl text-white mb-2 group-hover:text-[#93b4f8] transition-colors">
                Audit Your Incentives
              </h3>
              <p className="text-[12px] text-white/40 leading-relaxed mb-4">
                Enter your address or business name to discover which of
                Chicago&rsquo;s 11 incentive zone layers you qualify for.
                Get a full PDF report.
              </p>
              <div className="flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB]/70 group-hover:text-[#2563EB] transition-colors">
                Search Now
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>

            {/* Path 2: Find Best Location */}
            <Link
              href="/locate"
              className="group relative border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] rounded-2xl p-6 transition-all hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/30">
                  Path 02
                </span>
              </div>
              <h3 className="font-editorial text-xl text-white mb-2 group-hover:text-emerald-300 transition-colors">
                Find the Best Location
              </h3>
              <p className="text-[12px] text-white/40 leading-relaxed mb-4">
                Select your business sector and type to see the best areas
                in Southeast Chicago based on zoning ordinances and incentive overlap.
              </p>
              <div className="flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-emerald-500/70 group-hover:text-emerald-400 transition-colors">
                Explore Locations
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.2 }}
            className="mt-6 text-center"
          >
            <Link
              href="/qualify"
              className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-white/30 hover:text-white/60 transition-colors"
            >
              Or take the pre-qualification survey &rarr;
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Audit Section — Address Search */}
      <section id="audit" className="relative overflow-hidden bg-[#0C1B33] py-24 px-6">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C1B33] via-[#0f2240] to-[#0C1B33]" />
        <div className="relative z-10 container mx-auto max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-10"
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="w-8 h-0.5 bg-[#2563EB]" />
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
                Audit Your Incentives
              </span>
              <div className="w-8 h-0.5 bg-[#2563EB]" />
            </div>
            <h2 className="font-editorial text-3xl md:text-4xl text-white mb-4">
              What Does Your
              <br />
              <span className="text-white/40">Address Qualify For?</span>
            </h2>
            <p className="text-sm text-white/40 leading-relaxed max-w-md mx-auto">
              We cross-reference 11 incentive zone layers &mdash; from TIF
              districts to Opportunity Zones &mdash; to show you every program
              available at your location.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <AddressSearch />
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

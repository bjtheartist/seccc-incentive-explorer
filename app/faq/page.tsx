"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { programFact, programQualifier } from "@/lib/program-fact";
import { FAQ_ITEMS } from "./faq-items";


export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen">
      {/* Page Header — soft blue */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/chicago-map-hero.png')" }} />
        <div className="absolute inset-0 bg-[#0C1B33]/80" />
        <div className="relative z-10 container mx-auto max-w-3xl px-6 py-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Reference
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-white/50 text-base max-w-xl">
            Everything you need to know about business incentives in Chicago.
          </p>
        </div>
      </div>

      {/* Warm off-white body */}
      <div className="container mx-auto max-w-3xl px-6 py-10 bg-[#FAF9F6]">
        <div className="space-y-0">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border-b border-[#0C1B33]/8">
              <button
                className="w-full py-5 text-left flex items-center gap-4 group"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                <span className="font-mono-bureau text-[10px] text-[#2563EB]/30 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 text-sm text-[#0C1B33]/70 group-hover:text-[#0C1B33] transition-colors">
                  {item.q}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[#0C1B33]/25 shrink-0 transition-transform ${
                    openIndex === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openIndex === i && (
                <div className="pb-5 pl-10 pr-8">
                  <p className="text-sm text-[#0C1B33]/50 leading-relaxed">
                    {item.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* CTA — Still have questions */}
        <div className="mt-16 border border-[#0C1B33]/10 p-6 md:p-10 bg-[#EFF3FB]">
          <div className="text-center mb-8">
            <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33]/90 mb-3">
              Still have questions?
            </h2>
            <p className="text-sm text-[#0C1B33]/50 max-w-md mx-auto">
              Our team at the Southeast Chicago Chamber of Commerce is here to help you navigate incentive programs and find the right fit for your business.
            </p>
          </div>

          <div className="flex justify-center">
            <a
              href="tel:7737211999"
              className="flex flex-col items-center gap-2 bg-[#0C1B33] text-white px-10 py-5 hover:bg-[#1E3054] transition-colors text-center"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase">
                Call Us
              </span>
              <span className="text-[11px] text-white/60">
                (773) 721-1999
              </span>
            </a>
          </div>

          {/* Quiet way through to the unlisted Learning Pathway. Deliberately
              not navigation: no icon, no button, no label — a single muted
              line for the reader whose question outlasted the FAQ. */}
          <div className="mt-8 text-center">
            <a
              href="/learn"
              className="font-mono-bureau text-[10px] tracking-[0.15em] text-[#0C1B33]/25 hover:text-[#2563EB]/60 transition-colors"
            >
              There&apos;s a longer answer.
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

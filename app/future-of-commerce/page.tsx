import type { Metadata } from "next";
import Image from "next/image";
import { Building2, MapPin } from "lucide-react";
import { FutureCommerceSignupForm } from "./FutureCommerceSignupForm";

export const metadata: Metadata = {
  title: "Future of Commerce",
  description:
    "Join the CommuniData and Chicago Incentive Explorer email list for local business resources, incentive opportunities, and events.",
};

export default function FutureOfCommercePage() {
  return (
    <div className="bg-[#F7F8FA] text-[#0C1B33]">
      <section className="relative min-h-[280px] overflow-hidden bg-[#0C1B33] text-white">
        <Image
          src="/chicago-map-hero.png"
          alt="Chicago Incentive Explorer map showing neighborhood incentive geography"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-30"
        />
        <div className="absolute inset-0 bg-[#0C1B33]/82" />
        <div className="relative mx-auto flex min-h-[280px] max-w-6xl flex-col justify-center px-6 py-12 sm:px-8">
          <div className="flex flex-wrap items-center gap-3 font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-white/68">
            <span>CommuniData</span>
            <span className="h-px w-6 bg-[#5B8DEF]" aria-hidden="true" />
            <span>Chicago Incentive Explorer</span>
          </div>
          <h1 className="mt-5 max-w-4xl font-editorial text-[48px] leading-[1.02] sm:text-[64px]">
            Future of Commerce
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-6 text-white/68 sm:text-[17px]">
            Stay connected to neighborhood business intelligence, local incentive opportunities, and the people helping projects move forward.
          </p>
        </div>
      </section>

      <section className="border-b border-[#0C1B33]/10 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16 lg:py-16">
          <div>
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
              Stay in the loop
            </span>
            <h2 className="mt-4 font-editorial text-[34px] leading-tight sm:text-[42px]">
              Local insight should lead to local opportunity.
            </h2>
            <div className="mt-8 space-y-5 border-t border-[#0C1B33]/10 pt-6">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-[#16A34A]" aria-hidden="true" />
                <p className="text-[13px] leading-6 text-[#0C1B33]/58">
                  Updates will cover useful business resources, incentive programs, and upcoming conversations.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#F59E0B]" aria-hidden="true" />
                <p className="text-[13px] leading-6 text-[#0C1B33]/58">
                  Location details help us understand which neighborhoods and corridors our work is reaching. Addresses are kept private.
                </p>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/38">
                  Four quick details
                </span>
                <h2 className="mt-2 font-editorial text-[30px] leading-tight">
                  Join the list
                </h2>
              </div>
              <span className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/30">
                All fields required
              </span>
            </div>
            <FutureCommerceSignupForm />
          </div>
        </div>
      </section>
    </div>
  );
}

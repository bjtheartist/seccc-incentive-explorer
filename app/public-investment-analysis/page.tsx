import type { Metadata } from "next";
import { Suspense } from "react";
import { BarChart3, Building2, HeartHandshake, Landmark } from "lucide-react";
import { isPublicInvestmentAccessEmailConfigured } from "@/lib/public-investment-access-email";
import { PublicInvestmentEarlyAccessForm } from "./PublicInvestmentEarlyAccessForm";
import {
  PublicInvestmentBetaSignIn,
  PublicInvestmentVerificationNotice,
} from "./PublicInvestmentBetaSignIn";

export const metadata: Metadata = {
  title: "Public Investment Analysis — Beta",
  description:
    "Request early access to a beta analysis of public and philanthropic investment across Chicago neighborhoods.",
};

const SIGNALS = [
  {
    icon: Landmark,
    title: "Public dollars",
    description: "Trace documented government grants, programs, appropriations, and place-based commitments.",
  },
  {
    icon: HeartHandshake,
    title: "Philanthropic dollars",
    description: "Add foundation and charitable awards where reliable recipient and geography data are available.",
  },
  {
    icon: Building2,
    title: "Recipients and places",
    description: "Compare where funding is landing, who is receiving it, and which neighborhoods have thinner coverage.",
  },
  {
    icon: BarChart3,
    title: "Visual analysis",
    description: "Test maps, funding-flow views, timelines, and comparisons without treating announced dollars as delivered impact.",
  },
];

export default function PublicInvestmentAnalysisBetaPage() {
  return (
    <div className="bg-[#F7F8FA] text-[#0C1B33]">
      <section className="border-b border-[#0C1B33]/10 bg-[#E5E7EB]">
        <div className="mx-auto max-w-6xl px-6 py-14 sm:px-8 sm:py-20">
          <span className="inline-flex border border-[#0C1B33]/15 bg-white/55 px-3 py-1 font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#0C1B33]/50">
            Beta · Currently being tested
          </span>
          <h1 className="mt-6 max-w-4xl font-editorial text-[48px] leading-[0.98] text-[#0C1B33]/78 sm:text-[68px]">
            Public Investment Analysis
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-7 text-[#0C1B33]/55">
            Public Investment Analysis is a beta feature currently being tested. If you&apos;re interested, sign up for early access and help us shape a useful, evidence-grounded view of public and philanthropic dollars.
          </p>
        </div>
      </section>

      <section className="border-b border-[#0C1B33]/10 bg-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:py-18">
          <div>
            <Suspense fallback={null}>
              <PublicInvestmentVerificationNotice />
            </Suspense>
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/38">
              What we are testing
            </span>
            <h2 className="mt-4 max-w-2xl font-editorial text-[38px] leading-tight sm:text-[46px]">
              A clearer picture of where capital is moving — and what the records can actually prove.
            </h2>
            <div className="mt-9 grid gap-px border border-[#0C1B33]/10 bg-[#0C1B33]/10 sm:grid-cols-2">
              {SIGNALS.map(({ icon: Icon, title, description }) => (
                <article key={title} className="bg-white p-5">
                  <Icon className="h-5 w-5 text-[#0C1B33]/40" aria-hidden="true" />
                  <h3 className="mt-4 text-[14px] font-semibold text-[#0C1B33]/75">{title}</h3>
                  <p className="mt-2 text-[12px] leading-5 text-[#0C1B33]/46">{description}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="self-start border border-[#0C1B33]/10 bg-[#F7F8FA] p-6 sm:p-8">
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/38">
              Early-access request
            </span>
            <h2 className="mt-3 font-editorial text-[34px] leading-tight">Request early access</h2>
            <p className="mt-3 text-[13px] leading-6 text-[#0C1B33]/50">
              Tell us who you are so we can invite the right mix of community, public-sector, philanthropic, and development partners into testing.
            </p>
            <div className="mt-6">
              <PublicInvestmentEarlyAccessForm />
            </div>
            <div className="mt-8 border-t border-[#0C1B33]/10 pt-6">
              <h3 className="font-editorial text-[24px]">Already approved?</h3>
              <p className="mb-4 mt-2 text-[12px] leading-5 text-[#0C1B33]/48">
                Use the same verified email address to receive a passwordless sign-in link.
              </p>
              <PublicInvestmentBetaSignIn enabled={isPublicInvestmentAccessEmailConfigured()} />
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

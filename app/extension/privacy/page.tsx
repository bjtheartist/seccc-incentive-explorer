import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chrome Extension Privacy | Chicago Incentive Explorer",
  description:
    "Privacy policy for the Chicago Incentive Explorer Incentive Check Chrome extension.",
};

const EFFECTIVE = "Effective with version 1.0.0 · Prepared September 15, 2026";

export default function ExtensionPrivacyPage() {
  return (
    <div className="min-h-screen">
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/chicago-map-hero.png')" }}
        />
        <div className="absolute inset-0 bg-[#0C1B33]/80" />
        <div className="relative z-10 container mx-auto max-w-3xl px-6 py-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Chrome extension
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">
            Privacy for the Incentive Check extension
          </h1>
          <p className="text-white/50 text-base max-w-xl">{EFFECTIVE}</p>
        </div>
      </div>

      <div className="container mx-auto max-w-3xl px-6 py-10 bg-[#FAF9F6]">
        <div className="space-y-8 text-sm leading-relaxed text-[#0C1B33]/70">
          <p>
            The Chicago Incentive Explorer Incentive Check extension lets you look up
            which incentive zones and programs may apply to a Chicago address from
            your browser toolbar, and shows the same lookup on Cook County Assessor
            property pages. This policy covers the Chrome extension only. The
            website has its own terms and privacy notes.
          </p>

          <Section title="What the extension sends">
            <p>
              The only information the extension sends anywhere is the address text
              you type into the popup, or the property address it reads from a Cook
              County Assessor PIN page you are already viewing. That address is sent
              to chicagoincentiveexplorer.com to geocode it and run the zone and
              program lookup. Nothing else on the page is read or transmitted.
            </p>
          </Section>

          <Section title="What is stored">
            <p>
              Lookup results are cached in Chrome&apos;s local extension storage for
              up to 24 hours so repeat lookups are instant, and the last few
              addresses appear as a recent list in the popup. The cache holds at
              most 20 entries. It never leaves your browser and is not synced through
              your Google account. Removing the extension deletes it.
            </p>
          </Section>

          <Section title="What the extension does not do">
            <p>
              It has no accounts, no analytics, no advertising, and no remote code.
              It does not read your browsing history, other tabs, or any site other
              than the Cook County Assessor pages it is permitted to run on. It does
              not sell or share your data, and it does not use it for
              creditworthiness, lending, or eligibility decisions.
            </p>
          </Section>

          <Section title="Permissions">
            <p>
              <strong>storage</strong> keeps the local lookup cache. Host access to
              chicagoincentiveexplorer.com lets the extension call the lookup
              service. A content script runs on cookcountyassessoril.gov (formerly cookcountyassessor.com) PIN pages to
              read the property address and show the result panel. No other
              permissions are requested.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy can be sent to{" "}
              <a
                className="text-[#2563EB] underline underline-offset-2"
                href="mailto:billyjoseph243@gmail.com"
              >
                billyjoseph243@gmail.com
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-editorial text-xl text-[#0C1B33]/90 mb-2">{title}</h2>
      {children}
    </section>
  );
}

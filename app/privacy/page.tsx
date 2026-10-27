import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsChoicesInlineButton } from "@/components/privacy/AnalyticsChoicesBanner";
import { ORGANIZATION_NAME, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Chicago Incentive Explorer collects, uses, shares, and protects information, and the choices you have.",
};

const EFFECTIVE = "Effective October 27, 2026";
const CONTACT_EMAIL = "billyjoseph243@gmail.com";

export default function PrivacyPage() {
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
              Privacy
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">Privacy Policy</h1>
          <p className="text-white/50 text-base max-w-xl">{EFFECTIVE}</p>
        </div>
      </div>

      <div className="container mx-auto max-w-3xl px-6 py-10 bg-[#FAF9F6]">
        <div className="space-y-8 text-sm leading-relaxed text-[#0C1B33]/70">
          <p>
            {SITE_NAME}{" "}(&ldquo;CIE&rdquo;) helps Chicago businesses find economic
            incentives that may apply to an address. It is operated by the{" "}
            {ORGANIZATION_NAME}{" "}(&ldquo;SECCC,&rdquo; &ldquo;we&rdquo;). This policy explains
            what information CIE collects, how we use and share it, how we protect it,
            and the choices you have. Our Chrome extension has{" "}
            <Link href="/extension/privacy" className="text-[#2563EB] underline underline-offset-2">
              its own policy
            </Link>
            .
          </p>

          <Section title="Information you give us">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Searches and reports.</strong> The addresses, business names,
                neighborhoods, industries, and project goals you enter to run a lookup
                or build a report.
              </li>
              <li>
                <strong>Report delivery and help requests.</strong> When you ask us to
                email a report or ask for help, your name, email address, ZIP code,
                the report address, and your project goal.
              </li>
              <li>
                <strong>Accounts.</strong> If you sign in, your name and email address,
                and either your Google profile basics or a password, which we store
                only in hashed form. Saved reports, projects, watched areas, and
                business profiles you create (such as legal name, addresses, contact
                details, industry, and employee count).
              </li>
              <li>
                <strong>Documents.</strong> Files you upload to prepare an incentive
                application.
              </li>
              <li>
                <strong>Concierge chat.</strong> The questions you type into the site
                assistant and its replies.
              </li>
            </ul>
          </Section>

          <Section title="Information collected automatically">
            <p>
              When you use CIE we record activity such as pages viewed, searches run,
              reports generated or downloaded, and buttons used, along with your
              device type, screen width, the page that referred you, and campaign tags
              in the link you followed. If you are signed in, this activity is linked
              to your account. If you are not, it is linked to a random identifier
              stored in your browser (see Cookies below). If you later give us your
              email, for example to receive a report, we may connect that earlier
              activity to it.
            </p>
            <p className="mt-2">
              To prevent abuse we use your IP address to rate-limit some requests. We
              store a one-way hash of it, not the address itself. Our hosting
              provider also processes standard server logs.
            </p>
          </Section>

          <Section title="Cookies and similar storage">
            <p className="mb-3">
              We do not use advertising cookies or cross-site tracking.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#0C1B33]/15 text-[#0C1B33]/85">
                    <th className="py-2 pr-3 font-semibold">Type</th>
                    <th className="py-2 pr-3 font-semibold">What it does</th>
                    <th className="py-2 font-semibold">How long</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  <Row
                    type="Essential"
                    what="Keeps you signed in and protects sign-in forms (Auth.js session and security cookies)."
                    when="Up to 30 days"
                  />
                  <Row type="Essential" what="Keeps a concierge chat conversation together." when="24 hours" />
                  <Row
                    type="Essential"
                    what="Remembers access you were granted to a gated tool, and staff admin sign-ins."
                    when="Hours to days"
                  />
                  <Row
                    type="Essential"
                    what="Remembers your analytics choice (cie_analytics)."
                    when="1 year"
                  />
                  <Row
                    type="Analytics"
                    what="A random visitor identifier (cie_vid) that links your activity across visits."
                    when="1 year"
                  />
                  <Row
                    type="Analytics"
                    what="A random page-view session identifier kept in your browser's local storage."
                    when="Until cleared"
                  />
                  <Row
                    type="Analytics"
                    what="Vercel Web Analytics, which counts page views without cookies."
                    when="Not stored in your browser"
                  />
                  <Row
                    type="Preferences"
                    what="Map layer toggles, your chosen role, and guide progress, kept in your browser only."
                    when="Until cleared"
                  />
                </tbody>
              </table>
            </div>
            <p className="mt-3">
              Analytics is on by default. You can turn it off at any time with{" "}
              <AnalyticsChoicesInlineButton /> or the Cookie Choices link in the
              footer. If your browser sends a Global Privacy Control signal, we treat
              it as a request to turn analytics off. Essential cookies stay on because
              the site does not work without them.
            </p>
          </Section>

          <Section title="How we use information">
            <ul className="list-disc space-y-2 pl-5">
              <li>To run lookups, build and deliver reports, and keep your saved work.</li>
              <li>To respond to help requests and connect you with programs or partners you ask about.</li>
              <li>To understand how CIE is used and improve it.</li>
              <li>To keep the service secure and prevent spam and abuse.</li>
            </ul>
            <p className="mt-2">
              CIE is a discovery tool. We do not use your information to make
              eligibility, lending, or credit decisions about you.
            </p>
          </Section>

          <Section title="How we share information">
            <p>
              <strong>We do not sell your personal information.</strong> We share it
              only in these cases:
            </p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                <strong>SECCC staff</strong> see help requests and report-delivery
                requests so they can follow up.
              </li>
              <li>
                <strong>Partner organizations</strong>, such as a land bank, lender, or
                program administrator, only when you ask to be connected with them.
              </li>
              <li>
                <strong>Service providers</strong> that run CIE for us: Vercel
                (hosting, analytics, file storage, and AI gateway), Neon (database),
                Upstash (caching), Resend (email delivery), Google (sign-in), Mapbox
                (map display), and OpenStreetMap&apos;s Nominatim service (turning an
                address you type into map coordinates).
              </li>
              <li>
                <strong>Legal reasons</strong>, when required by law or to protect the
                rights and safety of users and the public.
              </li>
            </ul>
            <p className="mt-2">
              We may share aggregate statistics that do not identify you, for example
              how many reports were run in a neighborhood.
            </p>
          </Section>

          <Section title="The concierge assistant">
            <p>
              Questions you type into the concierge are sent through Vercel&apos;s AI
              Gateway to an AI model to generate a reply, and the conversation is
              stored so we can improve the assistant. Please do not enter sensitive
              personal information, such as Social Security numbers or bank details.
            </p>
          </Section>

          <Section title="Public records">
            <p>
              CIE shows information from public government datasets, including
              property, permit, license, and ownership records. Some of these name
              property owners or businesses. That information comes from the public
              source, not from you. To correct it, contact the agency that publishes
              it. You can also tell us and we will review it.
            </p>
          </Section>

          <Section title="How we protect information">
            <p>
              Information travels to and from CIE over encrypted HTTPS connections.
              Passwords are stored only as salted hashes, and IP addresses used for
              rate limiting are stored as one-way hashes. Uploaded documents are kept
              in private storage that only your signed-in account can reach. Staff
              tools require a separate sign-in. No system is perfectly secure, but we
              work to protect your information and will notify affected users if a
              breach occurs as required by Illinois law.
            </p>
          </Section>

          <Section title="How long we keep information">
            <p>
              We keep account information and saved work while your account is
              active. We keep report-delivery and help requests, and analytics
              records, for as long as they are useful for following up and improving
              CIE. Rate-limit records are deleted after 30 days. You can ask us to
              delete your information at any time.
            </p>
          </Section>

          <Section title="Your choices">
            <ul className="list-disc space-y-2 pl-5">
              <li>Turn analytics off using Cookie Choices.</li>
              <li>Use CIE without an account. Most lookups and reports do not require one.</li>
              <li>
                Ask us for a copy of your information, to correct it, or to delete it,
                by emailing us at the address below.
              </li>
            </ul>
          </Section>

          <Section title="Children">
            <p>
              CIE is meant for businesses and is not directed to children under 13.
              We do not knowingly collect information from them.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              If we change this policy we will update the effective date above, and
              for significant changes we will post a notice on the site.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions or requests about your information can be sent to{" "}
              <a className="text-[#2563EB] underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              , or to the {ORGANIZATION_NAME} at (773) 721-1999.
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

function Row({ type, what, when }: { type: string; what: string; when: string }) {
  return (
    <tr className="border-b border-[#0C1B33]/10">
      <td className="py-2 pr-3 font-medium text-[#0C1B33]/85">{type}</td>
      <td className="py-2 pr-3">{what}</td>
      <td className="py-2">{when}</td>
    </tr>
  );
}

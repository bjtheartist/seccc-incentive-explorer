import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAllPrograms,
  getProgramBySlug,
  programSlug,
  relatedPrograms,
} from "@/lib/programs-data";
import {
  pageMetadata,
  buildFaqJsonLd,
  buildTrailJsonLd,
} from "@/lib/seo";
import { ZONE_LABELS } from "@/lib/constants";
import { isDocumentRequirementGuidance } from "@/lib/document-preparation-cost";
import { resolveAvailability } from "@/lib/program-gating";
import { getProgramSeoOverride } from "@/lib/program-seo-overrides";
import { toPublicProgramView } from "@/lib/program-public";
import { JsonLd } from "@/components/seo/JsonLd";
import { SnapshotCTA } from "@/components/seo/SnapshotCTA";
import LevelBadge from "@/components/LevelBadge";
import { ProgramApplicationSection } from "@/components/programs/ProgramApplicationSection";
import { canPublishStaticApplicationGuidance } from "@/components/programs/programAvailability";

/* ── Static generation: indexable pages for currently available programs ── */

export const dynamicParams = false;

export async function generateStaticParams() {
  const now = new Date();
  return getAllPrograms()
    .filter((program) => resolveAvailability(program, now).state !== "expired")
    .map((program) => ({ slug: programSlug(program) }));
}

/** Trim a summary down to a clean ~150-char meta description. */
function metaDescription(summary: string): string {
  const clean = summary.replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  const truncated = clean.slice(0, 152);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 80 ? lastSpace : 152)}…`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const program = getProgramBySlug(slug);

  if (!program) {
    return {
      title: "Program Not Found",
      description: "This incentive program could not be found.",
      robots: { index: false, follow: false },
    };
  }

  if (resolveAvailability(program, new Date()).state === "expired") {
    return {
      title: `${program.name} — Program Availability Ended`,
      description: metaDescription(program.summary),
      robots: { index: false, follow: false },
    };
  }

  const override = getProgramSeoOverride(program.id);
  return pageMetadata({
    title:
      override?.title ??
      `${program.name} Chicago: Eligibility, Areas & Address Lookup`,
    description: override?.description ?? metaDescription(program.summary),
    path: `/programs/${slug}`,
  });
}

/* ── Small presentational helpers (server-safe, no client JS) ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-3">
      {children}
    </div>
  );
}

export default async function ProgramExplainerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const program = getProgramBySlug(slug);
  if (!program) notFound();

  const pageReferenceTime = new Date();
  if (resolveAvailability(program, pageReferenceTime).state === "expired") {
    notFound();
  }

  const p = program;
  const related = relatedPrograms(p).filter(
    (item) => resolveAvailability(item, pageReferenceTime).state !== "expired",
  );
  const zoneLabel = p.zoneKey ? ZONE_LABELS[p.zoneKey] : undefined;
  const officialUrl = p.sourceUrl || p.url;
  const requiredDocuments = p.requiredDocs.filter(
    (item) => !isDocumentRequirementGuidance(item),
  );
  const documentGuidance = p.requiredDocs.filter(isDocumentRequirementGuidance);

  // build-spec.md 2.2 (audit F4/F5): every public-facing status/benefit claim
  // on this page renders from the structured public DTO, never raw catalog
  // prose (`whoQualifies`) or an un-qualified `benefitRange`.
  const publicView = toPublicProgramView(p, pageReferenceTime.toISOString());
  const intakeIsOpen = publicView.intake.status === "open" || publicView.intake.status === "rolling";
  const criteriaFrame = publicView.links.administeringAgency
    ? `Published criteria — confirm with ${publicView.links.administeringAgency}`
    : "Published criteria — confirm with the administering agency";

  /* ── JSON-LD: FAQ + breadcrumb trail ── */
  const faqItems = [
    { question: `What is ${p.name}?`, answer: p.summary },
    {
      question: `What are the published criteria for ${p.name}?`,
      answer:
        publicView.screening.publishedCriteria.length > 0
          ? `${criteriaFrame}: ${publicView.screening.publishedCriteria.join(" ")}`
          : criteriaFrame,
    },
  ];
  if (
    p.howToApply.length > 0 &&
    canPublishStaticApplicationGuidance(p)
  ) {
    faqItems.push({
      question: `How do I apply for ${p.name}?`,
      answer: p.howToApply.join(" "),
    });
  }
  // audit F4 minimal fix: omit lapsed/pending/closed benefit terms from
  // standalone JSON-LD — a search result showing "$100,000" for a closed
  // round is exactly the defect named.
  if (p.benefits.length > 0 && intakeIsOpen) {
    faqItems.push({
      question: `What can ${p.name} support?`,
      answer: p.benefits.join(" "),
    });
  }

  const faqJsonLd = buildFaqJsonLd(faqItems, `/programs/${slug}#faq`);
  const trailJsonLd = buildTrailJsonLd([
    { name: "Home", path: "/" },
    { name: "Programs", path: "/programs" },
    { name: p.name, path: `/programs/${slug}` },
  ]);

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <JsonLd data={faqJsonLd} id="program-faq-jsonld" />
      <JsonLd data={trailJsonLd} id="program-breadcrumb-jsonld" />

      {/* ── Header — navy ── */}
      <header className="relative border-b border-[#0C1B33]/10 overflow-hidden bg-[#0C1B33]">
        <div className="absolute inset-0 bureau-grid opacity-60" />
        <div className="relative z-10 container mx-auto max-w-4xl px-6 pt-10 pb-14">
          {/* Breadcrumb */}
          <nav
            aria-label="Breadcrumb"
            className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-white/40 mb-8 flex flex-wrap items-center gap-2"
          >
            <Link href="/" className="hover:text-white/80 transition-colors">
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              href="/programs"
              className="hover:text-white/80 transition-colors"
            >
              Programs
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-white/70">{p.name}</span>
          </nav>

          <div className="flex items-center gap-4 mb-5">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Incentive Program
            </span>
          </div>

          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-5 leading-tight">
            {p.name}
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            <LevelBadge level={p.level} size="md" />
            {zoneLabel && (
              <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase px-3 py-1.5 rounded-full text-white/60 bg-white/10">
                {zoneLabel}
              </span>
            )}
            {p.benefitRange && intakeIsOpen && (
              <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase px-3 py-1.5 rounded-full text-white/60 bg-white/10">
                {p.benefitRange}
              </span>
            )}
            {!intakeIsOpen && (
              <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase px-3 py-1.5 rounded-full text-amber-200/80 bg-amber-500/10">
                No round currently open
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-6">
        {/* ── What it is ── */}
        <section className="py-12 border-b border-[#0C1B33]/10">
          <SectionLabel>What it is</SectionLabel>
          <p className="text-lg md:text-xl text-[#0C1B33]/80 leading-relaxed font-light">
            {p.summary}
          </p>
        </section>

        {/* ── Snapshot CTA (top) ── */}
        <section className="py-10">
          <SnapshotCTA
            heading="Check an Address — Free Snapshot"
            sub={`Compare the geocoded point for a Chicago address with the boundary used to screen ${p.name}. A match is a location signal; review the current program source for the boundary's role and remaining criteria.`}
          />
        </section>

        {/* ── Who it's for — soft blue ── */}
        <section className="py-12 border-t border-[#0C1B33]/10">
          <SectionLabel>Who it&apos;s for</SectionLabel>
          <div className="bg-[#EFF3FB] border border-[#2563EB]/10 rounded-xl p-6 md:p-7">
            <p className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#2563EB]/50 mb-3">
              {criteriaFrame}
            </p>
            {publicView.screening.publishedCriteria.length > 0 ? (
              <ul className="space-y-2">
                {publicView.screening.publishedCriteria.map((criterion, i) => (
                  <li
                    key={i}
                    className="text-base text-[#0C1B33]/75 leading-relaxed"
                  >
                    {criterion}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-base text-[#0C1B33]/75 leading-relaxed">
                {p.whoQualifies}
              </p>
            )}
          </div>
        </section>

        {/* ── Where it applies ── */}
        <section className="py-12 border-t border-[#0C1B33]/10">
          <SectionLabel>Where it applies</SectionLabel>
          <div className="space-y-4 text-base text-[#0C1B33]/75 leading-relaxed">
            <p>
              {zoneLabel ? (
                <>
                  {p.name} is screened against the{" "}
                  <span className="font-medium text-[#0C1B33]">{zoneLabel}</span>{" "}
                  boundary. A geocoded point that intersects that boundary is a
                  location signal, not a determination — review the current
                  program source for the boundary&apos;s role and any remaining
                  criteria. A single address can fall inside several overlapping
                  incentive boundaries at once.
                </>
              ) : (
                <>
                  {p.name} is administered at the {p.level.toLowerCase()} level.
                  Depending on the program, eligibility may depend on the
                  specific location, property type, or business activity rather
                  than a single drawn boundary.
                </>
              )}
            </p>
            <p className="text-[#0C1B33]/60">
              Boundaries are precise and change over time, so whether a
              specific address falls inside a mapped zone always depends on
              that exact address. The fastest way to check is to run a free
              snapshot for the parcel you have in mind — mapped coverage is
              a location signal, not an eligibility determination.
            </p>
            {p.boundaryDisclaimer && (
              <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex gap-3">
                <span
                  aria-hidden="true"
                  className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-slate-500 shrink-0 pt-0.5"
                >
                  Boundary note
                </span>
                <p className="text-[13px] text-slate-700 leading-relaxed">
                  {p.boundaryDisclaimer}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── What it can support ── */}
        {p.benefits.length > 0 && (
          <section className="py-12 border-t border-[#0C1B33]/10">
            <SectionLabel>What it can support</SectionLabel>
            {p.benefitRange && (
              <p className="text-sm text-[#0C1B33]/50 mb-1.5 font-mono-bureau tracking-[0.05em] uppercase">
                Range on file · {p.benefitRange}
              </p>
            )}
            {publicView.benefit.qualifier && (
              <p className="text-[13px] text-[#0C1B33]/55 mb-5 leading-relaxed">
                {publicView.benefit.qualifier}
              </p>
            )}
            <ul className="space-y-3">
              {p.benefits.map((b, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-base text-[#0C1B33]/75 leading-relaxed"
                >
                  <span className="mt-1 w-5 h-5 rounded-full bg-[#16a34a]/10 text-[#16a34a] flex items-center justify-center text-xs shrink-0">
                    +
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Live application availability and next step ── */}
        <ProgramApplicationSection program={p} />

        {/* ── What you'll need ── */}
        {requiredDocuments.length > 0 && (
          <section className="py-12 border-t border-[#0C1B33]/10">
            <SectionLabel>What you&apos;ll need</SectionLabel>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {requiredDocuments.map((doc, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-[15px] text-[#0C1B33]/70 leading-relaxed bg-white border border-[#0C1B33]/10 rounded-lg px-4 py-3"
                >
                  <span className="mt-0.5 w-5 h-5 rounded border border-[#0C1B33]/15 shrink-0" />
                  <span>{doc}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {documentGuidance.length > 0 && (
          <section className="py-12 border-t border-[#0C1B33]/10">
            <SectionLabel>Document notes</SectionLabel>
            <ul className="space-y-3">
              {documentGuidance.map((note, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-[15px] text-[#0C1B33]/70 leading-relaxed"
                >
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#0C1B33]/20 shrink-0" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── What to verify (discovery, not compliance) ── */}
        <section className="py-12 border-t border-[#0C1B33]/10">
          <SectionLabel>What to verify</SectionLabel>
          <div className="border border-amber-200 bg-amber-50 rounded-xl p-6">
            <p className="text-[15px] text-amber-900/90 leading-relaxed">
              This page is a starting point, not eligibility, legal, or tax
              advice. Verify current requirements, deadlines, and boundaries with
              the administering agency before applying or spending money — program
              rules and funding change over time.
            </p>
            {p.verificationSteps && p.verificationSteps.length > 0 && (
              <ul className="mt-5 space-y-3 border-t border-amber-200/70 pt-5">
                {p.verificationSteps.map((step, i) => (
                  <li key={i} className="text-[14px] leading-relaxed">
                    <a
                      href={step.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2563EB] hover:underline font-medium"
                    >
                      {step.label}
                    </a>
                    <span className="text-[#0C1B33]/50"> — {step.agency}</span>
                    {step.note && (
                      <p className="text-[13px] text-[#0C1B33]/55 mt-1">
                        {step.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Official source & contacts ── */}
        <section className="py-12 border-t border-[#0C1B33]/10">
          <SectionLabel>Official source &amp; contacts</SectionLabel>
          <div className="space-y-5">
            {officialUrl && (
              <a
                href={officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[#2563EB] border border-[#2563EB]/30 hover:bg-[#2563EB]/5 font-mono-bureau text-[11px] tracking-[0.15em] uppercase px-5 py-3 rounded-full transition-colors"
              >
                Official program source ↗
              </a>
            )}

            {p.contacts && p.contacts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {p.contacts.map((c, i) => (
                  <div
                    key={i}
                    className="bg-white border border-[#0C1B33]/10 rounded-xl p-5"
                  >
                    <div className="text-[15px] font-medium text-[#0C1B33] leading-snug">
                      {c.agency}
                      {c.abbreviation && (
                        <span className="text-[#0C1B33]/40 font-normal">
                          {" "}
                          ({c.abbreviation})
                        </span>
                      )}
                    </div>
                    {c.role && (
                      <div className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#2563EB]/50 mt-1.5">
                        {c.role}
                      </div>
                    )}
                    <dl className="mt-3 space-y-1.5 text-[13px] text-[#0C1B33]/65">
                      {c.phone && (
                        <div className="flex gap-2">
                          <dt className="text-[#0C1B33]/40 w-12 shrink-0">
                            Phone
                          </dt>
                          <dd>
                            <a
                              href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                              className="hover:text-[#2563EB] transition-colors"
                            >
                              {c.phone}
                            </a>
                          </dd>
                        </div>
                      )}
                      {c.email && (
                        <div className="flex gap-2">
                          <dt className="text-[#0C1B33]/40 w-12 shrink-0">
                            Email
                          </dt>
                          <dd>
                            <a
                              href={`mailto:${c.email}`}
                              className="hover:text-[#2563EB] transition-colors break-all"
                            >
                              {c.email}
                            </a>
                          </dd>
                        </div>
                      )}
                      {c.url && (
                        <div className="flex gap-2">
                          <dt className="text-[#0C1B33]/40 w-12 shrink-0">Web</dt>
                          <dd>
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#2563EB] hover:underline break-all"
                            >
                              Visit site ↗
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              p.contact && (
                <p className="text-[15px] text-[#0C1B33]/65">
                  <span className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/40 mr-2">
                    Contact
                  </span>
                  {p.contact}
                </p>
              )
            )}

            {p.lastVerifiedAt && (
              <p className="font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
                Last verified {p.lastVerifiedAt}
              </p>
            )}
          </div>
        </section>

        {/* ── Snapshot CTA (bottom) ── */}
        <section className="py-10">
          <SnapshotCTA heading="Check an Address — Free Snapshot" />
        </section>

        {/* ── Related programs ── */}
        <section className="py-12 border-t border-[#0C1B33]/10">
          <SectionLabel>Related programs</SectionLabel>
          {related.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
              {related.map((rp) => (
                <Link
                  key={rp.id}
                  href={`/programs/${programSlug(rp)}`}
                  className="group block bg-white border border-[#0C1B33]/10 hover:border-[#2563EB]/40 rounded-xl p-5 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <LevelBadge level={rp.level} size="xs" />
                  </div>
                  <div className="text-[15px] font-medium text-[#0C1B33] group-hover:text-[#2563EB] transition-colors leading-snug mb-1">
                    {rp.name}
                  </div>
                  <p className="text-[13px] text-[#0C1B33]/50 leading-relaxed line-clamp-2">
                    {rp.summary}
                  </p>
                </Link>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/programs"
              className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-[#2563EB] border-b border-dashed border-[#2563EB]/40 hover:border-[#2563EB] pb-0.5 transition-colors"
            >
              All programs
            </Link>
            <Link
              href="/map"
              className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-[#2563EB] border-b border-dashed border-[#2563EB]/40 hover:border-[#2563EB] pb-0.5 transition-colors"
            >
              Explore the map
            </Link>
          </div>
        </section>

        <div className="h-12" />
      </main>
    </div>
  );
}

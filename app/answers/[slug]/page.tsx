import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getAnswerBySlug,
  allAnswerSlugs,
  ANSWER_PAGES,
} from "@/lib/answers-data";
import { pageMetadata, buildFaqJsonLd, buildTrailJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { SnapshotCTA } from "@/components/seo/SnapshotCTA";

/**
 * Answer-engine page: a direct, quotable answer to one practical question,
 * with cross-links into related programs and the free location snapshot.
 * Statically generated, one route per ANSWER_PAGES entry.
 */

type RouteParams = { slug: string };

export function generateStaticParams(): RouteParams[] {
  return allAnswerSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = getAnswerBySlug(slug);
  if (!a) {
    return pageMetadata({
      title: "Answer Not Found",
      description: "The requested answer page could not be found.",
      path: `/answers/${slug}`,
    });
  }
  return pageMetadata({
    title: a.title,
    description: a.description,
    path: `/answers/${a.slug}`,
  });
}

/** Turn a program slug into a readable Title Case label for the link text. */
function deslugify(slug: string): string {
  return slug
    .split("-")
    .map((word) =>
      word.length <= 3 && /[a-z]/.test(word) === false
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

export default async function AnswerPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { slug } = await params;
  const a = getAnswerBySlug(slug);
  if (!a) notFound();

  // 2-3 sibling questions for the "Related questions" block.
  const relatedQuestions = ANSWER_PAGES.filter((p) => p.slug !== a.slug).slice(
    0,
    3,
  );

  const faqJsonLd = buildFaqJsonLd([
    { question: a.question, answer: a.answer },
  ]);
  const trailJsonLd = buildTrailJsonLd([
    { name: "Home", path: "/" },
    { name: "Answers", path: `/answers/${a.slug}` },
    { name: a.question, path: `/answers/${a.slug}` },
  ]);

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      <JsonLd id="answer-faq-jsonld" data={faqJsonLd} />
      <JsonLd id="answer-trail-jsonld" data={trailJsonLd} />

      <article className="container mx-auto max-w-3xl px-6 py-10 md:py-14">
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/40 mb-8 flex flex-wrap items-center gap-2"
        >
          <Link href="/" className="hover:text-[#2563EB] transition-colors">
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href="/programs"
            className="hover:text-[#2563EB] transition-colors"
          >
            Answers
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-[#0C1B33]/60 normal-case tracking-normal">
            {a.question}
          </span>
        </nav>

        {/* Eyebrow + H1 */}
        <div className="flex items-center gap-4 mb-5">
          <div className="accent-bar" />
          <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]">
            Answer
          </span>
        </div>
        <h1 className="font-editorial text-3xl md:text-4xl text-[#0C1B33] leading-tight mb-6">
          {a.question}
        </h1>

        {/* Prominent lead answer */}
        <div className="border-l-2 border-[#2563EB] bg-[#EFF3FB] rounded-r-xl px-6 py-5 md:px-7 md:py-6 mb-10">
          <p className="text-[#0C1B33]/80 text-lg md:text-xl leading-relaxed">
            {a.answer}
          </p>
        </div>

        {/* Conversion block */}
        <div className="mb-12">
          <SnapshotCTA heading="Check Your Address — Free Snapshot" />
        </div>

        {/* Supporting bullets */}
        <section className="mb-12">
          <h2 className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40 mb-4">
            What to know
          </h2>
          <ul className="space-y-3">
            {a.bullets.map((bullet, i) => (
              <li
                key={i}
                className="flex gap-3 text-[#0C1B33]/70 text-[15px] leading-relaxed"
              >
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#2563EB] shrink-0" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Related programs */}
        {a.relatedProgramSlugs.length > 0 && (
          <section className="mb-12">
            <h2 className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40 mb-4">
              Related programs
            </h2>
            <div className="flex flex-wrap gap-2">
              {a.relatedProgramSlugs.map((programSlug) => (
                <Link
                  key={programSlug}
                  href={`/programs/${programSlug}`}
                  className="inline-flex items-center gap-1.5 bg-white border border-[#0C1B33]/10 hover:border-[#2563EB]/40 text-[#0C1B33]/70 hover:text-[#0C1B33] text-[13px] px-4 py-2 rounded-full transition-colors"
                >
                  {deslugify(programSlug)}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Sources */}
        {a.sources.length > 0 && (
          <section className="mb-12 border-t border-[#0C1B33]/10 pt-8">
            <h2 className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40 mb-4">
              Sources
            </h2>
            <ul className="space-y-2">
              {a.sources.map((source) => (
                <li key={source.url} className="text-[14px]">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#2563EB] hover:underline break-words"
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-[#0C1B33]/45 leading-relaxed mt-5">
              This is a discovery tool, not legal, tax, or eligibility advice.
              Confirm current requirements with the administering agency before
              applying, certifying, or relying on any program listed here.
            </p>
          </section>
        )}

        {/* Related questions */}
        {relatedQuestions.length > 0 && (
          <section className="border-t border-[#0C1B33]/10 pt-8">
            <h2 className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40 mb-4">
              Related questions
            </h2>
            <ul className="space-y-3">
              {relatedQuestions.map((q) => (
                <li key={q.slug}>
                  <Link
                    href={`/answers/${q.slug}`}
                    className="text-[#0C1B33]/70 hover:text-[#2563EB] text-[15px] transition-colors inline-flex items-baseline gap-2"
                  >
                    <span aria-hidden="true" className="text-[#2563EB]">
                      &rarr;
                    </span>
                    {q.question}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}

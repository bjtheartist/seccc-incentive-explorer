"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  LEARNING_CHECK_TOTAL,
  LEARNING_MODULES,
  LEARNING_PATHWAY_STANDFIRST,
  LEARNING_PATHWAY_TITLE,
  LEARNING_RAILS_NOTE,
  LEARNING_MINUTES_LABEL,
  type Lesson,
  type LearningModule,
  type LessonParagraph,
} from "@/lib/learning-pathway";
import { LEARNING_FIGURES } from "@/lib/learning-pathway-figures";

/**
 * The Learning Pathway, rendered natively inside the site chrome.
 *
 * This replaces an iframe that carried its own header, its own scrollbar,
 * and its own progress counter — which meant a visitor saw two headers,
 * scrolled two documents, and lost their place the moment they navigated
 * away. Everything here is one document in the site's own typography, and
 * progress belongs to the visitor's browser rather than to a frame.
 *
 * Progress is per-visitor and local by design: the checks are a reading
 * aid, not an assessment, so nothing is sent anywhere. Every localStorage
 * access is wrapped — Safari private mode, disabled site data, and
 * storage-quota failures all throw on plain access, and a thrown read
 * must degrade to "no progress yet", never to a blank page.
 */

/** Versioned so a later change to the stored shape can't misread old data. */
const STORAGE_KEY = "cie:learning-pathway:checks:v1";

/** lesson id → the option key the visitor picked. */
type AnswerMap = Record<string, string>;

function readStoredAnswers(): AnswerMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    // Keep only entries that still correspond to a real lesson and a real
    // option, so a renamed lesson or a hand-edited value cannot inflate
    // the count past the twelve checks that actually exist.
    const answers: AnswerMap = {};
    for (const learningModule of LEARNING_MODULES) {
      for (const lesson of learningModule.lessons) {
        const value = (parsed as Record<string, unknown>)[lesson.id];
        if (
          typeof value === "string" &&
          lesson.check.options.some((option) => option.key === value)
        ) {
          answers[lesson.id] = value;
        }
      }
    }
    return answers;
  } catch {
    return {};
  }
}

function writeStoredAnswers(answers: AnswerMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    // Progress is a convenience. Losing it must never break the lesson.
  }
}

function Paragraph({ paragraph }: { paragraph: LessonParagraph }) {
  return (
    <p className="text-[15px] leading-[1.75] text-[#0C1B33]/75">
      {paragraph.map((span, index) => {
        if (typeof span === "string") return <span key={index}>{span}</span>;
        if ("strong" in span)
          return (
            <strong key={index} className="font-semibold text-[#0C1B33]">
              {span.strong}
            </strong>
          );
        return (
          <em key={index} className="italic">
            {span.em}
          </em>
        );
      })}
    </p>
  );
}

function LessonFigure({ lessonId }: { lessonId: string }) {
  const figure = LEARNING_FIGURES[lessonId];
  if (!figure) return null;

  return (
    <figure
      className="my-7 border border-[#0C1B33]/10 bg-white px-4 py-5 text-[#0C1B33]"
      style={
        {
          "--accent": "#2563EB",
          "--accent-mark": "#2563EB",
          "--on-accent": "#FFFFFF",
          "--ok": "#17633E",
          "--warn": "#9A3528",
        } as CSSProperties
      }
    >
      <svg
        viewBox={figure.viewBox}
        role="img"
        aria-label={figure.alt}
        className="w-full h-auto"
        // Static, authored diagram markup carried over verbatim from the
        // artifact this page replaced. Never runtime input.
        dangerouslySetInnerHTML={{ __html: figure.markup }}
      />
    </figure>
  );
}

function LessonCheckBlock({
  lesson,
  chosen,
  onChoose,
}: {
  lesson: Lesson;
  chosen: string | undefined;
  onChoose: (lessonId: string, optionKey: string) => void;
}) {
  const revealed = chosen !== undefined;

  return (
    <div className="mt-7 border border-[#2563EB]/15 bg-[#EFF3FB] p-5 md:p-6">
      <p className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-3">
        Check yourself
      </p>
      <p className="text-[15px] text-[#0C1B33] mb-4">{lesson.check.prompt}</p>

      <div className="space-y-2">
        {lesson.check.options.map((option) => {
          const isChosen = chosen === option.key;
          const showRight = revealed && option.correct;
          const showWrong = revealed && isChosen && !option.correct;

          return (
            <button
              key={option.key}
              type="button"
              disabled={revealed}
              onClick={() => onChoose(lesson.id, option.key)}
              className={`w-full text-left flex items-start gap-3 border px-4 py-3 text-[14px] transition-colors ${
                showRight
                  ? "border-[#17633E]/40 bg-[#E8F5EE] text-[#0C1B33]"
                  : showWrong
                    ? "border-[#9A3528]/40 bg-[#FBECEA] text-[#0C1B33]"
                    : revealed
                      ? "border-[#0C1B33]/10 bg-white/60 text-[#0C1B33]/45"
                      : "border-[#0C1B33]/12 bg-white text-[#0C1B33]/80 hover:border-[#2563EB]/50 hover:text-[#0C1B33]"
              }`}
            >
              <span className="font-mono-bureau text-[10px] tracking-[0.15em] text-[#2563EB]/60 mt-[3px]">
                {option.key}
              </span>
              <span className="flex-1">{option.text}</span>
            </button>
          );
        })}
      </div>

      {revealed && (
        <p
          aria-live="polite"
          className="mt-4 border-t border-[#2563EB]/15 pt-4 text-[14px] leading-relaxed text-[#0C1B33]/70"
        >
          {lesson.check.why.map((span, index) => {
            if (typeof span === "string") return <span key={index}>{span}</span>;
            if ("strong" in span)
              return (
                <strong key={index} className="font-semibold text-[#0C1B33]">
                  {span.strong}
                </strong>
              );
            return (
              <em key={index} className="italic">
                {span.em}
              </em>
            );
          })}
        </p>
      )}
    </div>
  );
}

function LessonArticle({
  lesson,
  moduleTitle,
  chosen,
  onChoose,
}: {
  lesson: Lesson;
  moduleTitle: string;
  chosen: string | undefined;
  onChoose: (lessonId: string, optionKey: string) => void;
}) {
  const figureAt = lesson.figureAfterParagraph;

  return (
    <article
      id={lesson.id}
      className="scroll-mt-32 border-b border-[#0C1B33]/8 py-10 md:py-12"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
        <span className="font-mono-bureau text-[10px] tracking-[0.2em] text-[#2563EB] border border-[#2563EB]/25 px-2 py-0.5">
          {lesson.code}
        </span>
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/35">
          {moduleTitle}
        </span>
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/35 md:ml-auto">
          {lesson.minutes} min
        </span>
      </div>

      <h3 className="font-editorial text-2xl md:text-[32px] leading-tight text-[#0C1B33] mb-5">
        {lesson.title}
      </h3>

      <div className="space-y-4 max-w-[68ch]">
        {lesson.body.map((paragraph, index) => (
          <div key={index}>
            <Paragraph paragraph={paragraph} />
            {figureAt === index + 1 && <LessonFigure lessonId={lesson.id} />}
          </div>
        ))}
      </div>

      <LessonCheckBlock lesson={lesson} chosen={chosen} onChoose={onChoose} />

      <div className="mt-6 border-t border-[#0C1B33]/8 pt-4">
        <p className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#0C1B33]/35 mb-2">
          Verify before you act
        </p>
        <ul className="space-y-1.5 mb-3">
          {lesson.sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-[#2563EB] hover:underline underline-offset-4"
              >
                {source.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[11px] leading-relaxed text-[#0C1B33]/40">
          {LEARNING_RAILS_NOTE}
        </p>
      </div>
    </article>
  );
}

function ModuleSection({
  learningModule,
  answers,
  onChoose,
}: {
  learningModule: LearningModule;
  answers: AnswerMap;
  onChoose: (lessonId: string, optionKey: string) => void;
}) {
  return (
    <section aria-labelledby={`${learningModule.id}-title`}>
      <div id={learningModule.id} className="scroll-mt-32 pt-12 pb-2">
        <p className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-3">
          Module {learningModule.number} of {LEARNING_MODULES.length}
        </p>
        <h2
          id={`${learningModule.id}-title`}
          className="font-editorial text-3xl md:text-[40px] leading-tight text-[#0C1B33] mb-2"
        >
          {learningModule.title}
        </h2>
        <p className="text-[15px] text-[#0C1B33]/50 max-w-[60ch]">
          {learningModule.summary}
        </p>
      </div>

      {learningModule.lessons.map((lesson) => (
        <LessonArticle
          key={lesson.id}
          lesson={lesson}
          moduleTitle={learningModule.title}
          chosen={answers[lesson.id]}
          onChoose={onChoose}
        />
      ))}
    </section>
  );
}

export default function LearningPathway() {
  const [answers, setAnswers] = useState<AnswerMap>({});

  // Read after mount, never during render: localStorage does not exist on
  // the server, and seeding state from it in a useState initializer would
  // hydrate a different tree than the server sent.
  useEffect(() => {
    const stored = readStoredAnswers();
    if (Object.keys(stored).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnswers(stored);
    }
  }, []);

  const completed = useMemo(() => Object.keys(answers).length, [answers]);
  const isComplete = completed >= LEARNING_CHECK_TOTAL;

  const onChoose = useCallback((lessonId: string, optionKey: string) => {
    setAnswers((previous) => {
      if (previous[lessonId] !== undefined) return previous;
      const next = { ...previous, [lessonId]: optionKey };
      writeStoredAnswers(next);
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {/* Hero */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div className="absolute inset-0 bg-[#0C1B33]" />
        <div className="absolute inset-0 bureau-noise opacity-30" />
        <div className="relative z-10 container mx-auto max-w-3xl px-6 py-14">
          <div className="flex items-center gap-4 mb-5">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Zoning &amp; permits
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">
            {LEARNING_PATHWAY_TITLE}
          </h1>
          <p className="text-white/50 text-base max-w-xl">
            {LEARNING_PATHWAY_STANDFIRST}
          </p>
        </div>
      </div>

      {/* Pathway facts */}
      <div className="border-b border-[#0C1B33]/10 bg-white">
        <div className="container mx-auto max-w-3xl px-6 grid grid-cols-2 md:grid-cols-4">
          {[
            { value: String(LEARNING_MODULES.length), label: "Modules" },
            { value: String(LEARNING_CHECK_TOTAL), label: "Lessons" },
            { value: LEARNING_MINUTES_LABEL, label: "Minutes" },
            { value: "Linked", label: "Official sources" },
          ].map((item) => (
            <div
              key={item.label}
              className="py-5 pr-4 border-r last:border-r-0 border-[#0C1B33]/8"
            >
              <div className="font-editorial text-2xl text-[#0C1B33]">
                {item.value}
              </div>
              <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/35 mt-1">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky module tabs + progress. top-14 clears the site header. */}
      <nav
        aria-label="Pathway modules"
        className="sticky top-14 z-30 border-b border-[#0C1B33]/10 bg-[#FAF9F6]/95 backdrop-blur-md"
      >
        <div className="container mx-auto max-w-3xl px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-4 overflow-x-auto min-w-0">
            {LEARNING_MODULES.map((learningModule) => (
              <a
                key={learningModule.id}
                href={`#${learningModule.id}`}
                className="whitespace-nowrap font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45 hover:text-[#2563EB] transition-colors"
              >
                {learningModule.navLabel}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <span
              aria-live="polite"
              className="font-mono-bureau text-[10px] tracking-[0.12em] text-[#0C1B33]/50"
            >
              {completed} of {LEARNING_CHECK_TOTAL} checks complete
            </span>
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={LEARNING_CHECK_TOTAL}
              aria-valuenow={completed}
              aria-label="Checks completed"
              className="hidden sm:block h-1 w-20 bg-[#0C1B33]/10"
            >
              <span
                className="block h-full bg-[#2563EB] transition-all"
                style={{
                  width: `${(completed / LEARNING_CHECK_TOTAL) * 100}%`,
                }}
              />
            </span>
          </div>
        </div>
      </nav>

      {/* Lessons */}
      <div className="container mx-auto max-w-3xl px-6 pb-4">
        {LEARNING_MODULES.map((learningModule) => (
          <ModuleSection
            key={learningModule.id}
            learningModule={learningModule}
            answers={answers}
            onChoose={onChoose}
          />
        ))}
      </div>

      {/* Completion state — only after all twelve checks are answered. */}
      {isComplete && (
        <div className="container mx-auto max-w-3xl px-6 pt-10">
          <div className="border border-[#2563EB]/25 bg-[#EFF3FB] p-6 md:p-8">
            <p className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-3">
              Pathway complete
            </p>
            <h2 className="font-editorial text-2xl md:text-[28px] text-[#0C1B33] mb-2">
              All {LEARNING_CHECK_TOTAL} checks answered.
            </h2>
            <p className="text-[14px] text-[#0C1B33]/55 max-w-[58ch] mb-6">
              Two ways to keep going: test what stuck, or see how these
              decisions land on real Chicago geography.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/quiz"
                className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] hover:bg-[#1E3054] text-white px-6 py-3 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors"
              >
                Take the incentive quiz
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
              <Link
                href="/map"
                className="inline-flex items-center justify-center gap-2 border border-[#0C1B33]/20 text-[#0C1B33] hover:border-[#2563EB] hover:text-[#2563EB] px-6 py-3 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors"
              >
                Explore the map
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Closing CTA — turns the lessons into a site-specific starting point. */}
      <div className="container mx-auto max-w-3xl px-6 py-12">
        <div className="relative overflow-hidden bg-[#0C1B33] p-6 md:p-10">
          <div className="absolute inset-0 bureau-noise opacity-20" />
          <div className="relative z-10">
            <p className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-white/35 mb-3">
              Next step
            </p>
            <h2 className="font-editorial text-2xl md:text-[30px] text-white mb-3 max-w-[24ch]">
              Turn the lessons into a site-specific starting point.
            </h2>
            <p className="text-[14px] text-white/50 max-w-[58ch] mb-6">
              Run an address report to organize published incentive, zoning,
              site, and local-support information around a Chicago location.
              The report is a discovery tool, not an approval or eligibility
              determination.
            </p>
            <Link
              href="/report"
              className="inline-flex items-center gap-2 bg-[#2563EB] hover:bg-[#1d4ed8] text-white px-6 py-3 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors"
            >
              Run an address report
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
            <p className="mt-8 text-[11px] text-white/30 max-w-[60ch]">
              Built by the Southeast Chicago Chamber of Commerce for Chicago
              businesses, neighborhoods, and the people helping projects move
              forward.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

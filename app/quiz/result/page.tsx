"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Copy,
  Linkedin,
  RotateCcw,
  Twitter,
  Check,
} from "lucide-react";
import {
  getPersonaForScore,
  QUIZ_QUESTIONS,
  type QuizPersona,
  type QuizQuestion,
} from "@/lib/quiz-data";

export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[#0C1B33]/40 font-mono-bureau text-xs tracking-[0.2em] uppercase">
          Loading…
        </div>
      }
    >
      <ResultContent />
    </Suspense>
  );
}

function ResultContent() {
  const searchParams = useSearchParams();
  const scoreRaw = parseInt(searchParams.get("score") || "0", 10);
  const idsParam = searchParams.get("ids") || "";
  const total = QUIZ_QUESTIONS.length > 10 ? 10 : QUIZ_QUESTIONS.length;
  const score = Math.max(0, Math.min(total, isNaN(scoreRaw) ? 0 : scoreRaw));
  const persona: QuizPersona = getPersonaForScore(score);

  const seenQuestions: QuizQuestion[] = idsParam
    ? idsParam
        .split(",")
        .map((s) => parseInt(s, 10))
        .map((id) => QUIZ_QUESTIONS.find((q) => q.id === id))
        .filter((q): q is QuizQuestion => Boolean(q))
    : [];

  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
    // Client-only window.location read. SSR has no window; doing this during
    // render would cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (typeof window !== "undefined") setShareUrl(window.location.href);
  }, []);

  const shareText = `I'm a ${persona.name} ${persona.emoji} — ${score}/${total} on the Chicago Incentive Explorer quiz. How well do YOU know Chicago incentives?`;

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {/* Header */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div className="absolute inset-0 bg-[#0C1B33]" />
        <div className="absolute inset-0 bureau-noise opacity-30" />
        <div className="relative z-10 container mx-auto max-w-2xl px-6 py-10">
          <div className="flex items-center gap-4 mb-2">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/50">
              Quiz result
            </span>
          </div>
          <h1 className="font-editorial text-3xl md:text-4xl text-white">Your result</h1>
        </div>
      </div>

      {/* Persona card */}
      <div className="container mx-auto max-w-2xl px-6 py-8">
        <div className="bg-white rounded-xl shadow-sm p-6 md:p-10 text-center">
          <div className="text-6xl mb-3">{persona.emoji}</div>
          <div className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40 mb-2">
            You scored {score} / {total}
          </div>
          <h2 className="font-editorial text-3xl md:text-4xl text-[#0C1B33] mb-4">
            {persona.name}
          </h2>
          <p className="text-[#0C1B33]/60 text-base leading-relaxed mb-5 max-w-lg mx-auto">
            {persona.blurb}
          </p>
          <div className="border-t border-[#0C1B33]/8 pt-5 mt-5 max-w-lg mx-auto text-left">
            <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-1.5">
              Where to go next
            </div>
            <p className="text-sm text-[#0C1B33]/65 leading-relaxed">{persona.nextStep}</p>
          </div>
        </div>

        {/* Share row */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 border border-[#0C1B33]/15 hover:border-[#0C1B33]/40 text-[#0C1B33]/70 hover:text-[#0C1B33] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-4 py-2 rounded-full transition-colors"
          >
            <Twitter className="w-3.5 h-3.5" /> Share on X
          </a>
          <a
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 border border-[#0C1B33]/15 hover:border-[#0C1B33]/40 text-[#0C1B33]/70 hover:text-[#0C1B33] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-4 py-2 rounded-full transition-colors"
          >
            <Linkedin className="w-3.5 h-3.5" /> LinkedIn
          </a>
          <button
            onClick={copyLink}
            className="inline-flex items-center gap-1.5 border border-[#0C1B33]/15 hover:border-[#0C1B33]/40 text-[#0C1B33]/70 hover:text-[#0C1B33] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-4 py-2 rounded-full transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#16a34a]" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy link
              </>
            )}
          </button>
        </div>

        {/* Per-question recap */}
        {seenQuestions.length > 0 && (
          <div className="mt-10">
            <div className="font-mono-bureau text-[10px] tracking-[0.25em] uppercase text-[#0C1B33]/45 mb-3">
              What you saw
            </div>
            <div className="space-y-2">
              {seenQuestions.map((q) => (
                <div
                  key={q.id}
                  className="bg-white border border-[#0C1B33]/8 rounded-lg p-4"
                >
                  <div className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-1">
                    Q{q.id} · {q.topic}
                  </div>
                  <p className="text-sm text-[#0C1B33] mb-1.5">{q.question}</p>
                  <p className="text-[12px] text-[#0C1B33]/55 leading-relaxed">
                    <span className="text-[#16a34a] font-medium">Answer:</span>{" "}
                    {q.choices[q.correctIndex]} — {q.explanation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer CTAs */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/quiz"
            className="inline-flex items-center gap-2 bg-[#0C1B33] hover:bg-[#1c2c4a] text-white font-mono-bureau text-[11px] tracking-[0.2em] uppercase px-6 py-3 rounded-full transition-colors"
          >
            <RotateCcw className="w-4 h-4" /> Take again
          </Link>
          <Link
            href="/programs"
            className="inline-flex items-center gap-2 border border-[#2563EB]/30 hover:bg-[#2563EB]/5 text-[#2563EB] font-mono-bureau text-[11px] tracking-[0.2em] uppercase px-6 py-3 rounded-full transition-colors"
          >
            Browse programs <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

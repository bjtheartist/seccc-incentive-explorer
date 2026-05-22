"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { QUIZ_QUESTIONS, type QuizQuestion } from "@/lib/quiz-data";
import LevelBadge from "@/components/LevelBadge";

const QUESTIONS_PER_ATTEMPT = 10;

/** Fisher–Yates shuffle (in-place, returns new array). */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sample 10 questions trying to keep gov-level distribution balanced. */
function sampleQuestions(bank: QuizQuestion[], n: number): QuizQuestion[] {
  if (bank.length <= n) return shuffle(bank);
  // Group by topic, shuffle within each, then round-robin pick.
  const byTopic = new Map<string, QuizQuestion[]>();
  for (const q of bank) {
    if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
    byTopic.get(q.topic)!.push(q);
  }
  const buckets = [...byTopic.values()].map(shuffle);
  const out: QuizQuestion[] = [];
  let i = 0;
  while (out.length < n && buckets.some((b) => b.length > 0)) {
    const bucket = buckets[i % buckets.length];
    if (bucket.length > 0) out.push(bucket.shift()!);
    i++;
  }
  return shuffle(out);
}

export default function QuizPage() {
  const router = useRouter();
  // Sample once on mount so re-renders don't reshuffle the deck mid-quiz.
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    // Post-mount randomization: cannot run during render or in useState initializer
    // without causing an SSR hydration mismatch (Math.random differs server/client).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuestions(sampleQuestions(QUIZ_QUESTIONS, QUESTIONS_PER_ATTEMPT));
  }, []);

  const q = questions[idx];
  const progress = useMemo(
    () => (questions.length ? ((idx + (revealed ? 1 : 0)) / questions.length) * 100 : 0),
    [idx, revealed, questions.length],
  );

  function selectChoice(choiceIdx: number) {
    if (revealed || !q) return;
    setSelectedChoice(choiceIdx);
    setRevealed(true);
    setAnswers((prev) => [...prev, choiceIdx]);
  }

  function next() {
    if (!q) return;
    if (idx === questions.length - 1) {
      // Compute score and navigate
      const score = answers.filter((a, i) => a === questions[i].correctIndex).length;
      // Also encode which questions appeared so result page can show recap if it wants
      const ids = questions.map((q) => q.id).join(",");
      router.push(`/quiz/result?score=${score}&ids=${ids}`);
    } else {
      setIdx(idx + 1);
      setRevealed(false);
      setSelectedChoice(null);
    }
  }

  function restart() {
    setQuestions(sampleQuestions(QUIZ_QUESTIONS, QUESTIONS_PER_ATTEMPT));
    setIdx(0);
    setAnswers([]);
    setSelectedChoice(null);
    setRevealed(false);
  }

  if (!q) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[#0C1B33]/40 font-mono-bureau text-xs tracking-[0.2em] uppercase">
        Loading quiz…
      </div>
    );
  }

  const isCorrect = selectedChoice === q.correctIndex;

  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {/* Header */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div className="absolute inset-0 bg-[#0C1B33]" />
        <div className="absolute inset-0 bureau-noise opacity-30" />
        <div className="relative z-10 container mx-auto max-w-2xl px-6 py-10">
          <div className="flex items-center gap-4 mb-3">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/50">
              Quiz · {QUESTIONS_PER_ATTEMPT} questions from a bank of {QUIZ_QUESTIONS.length}
            </span>
          </div>
          <h1 className="font-editorial text-3xl md:text-4xl text-white mb-1">
            How well do you know Chicago incentives?
          </h1>
          <p className="text-white/40 text-sm">
            A public-education quiz. No grade goes on your transcript. Probably.
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="container mx-auto max-w-2xl px-6 pt-6">
        <div className="flex items-center justify-between font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/40 mb-2">
          <span>
            Question {idx + 1} of {questions.length}
          </span>
          <button
            onClick={restart}
            className="text-[#0C1B33]/30 hover:text-[#0C1B33]/70 transition-colors inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Restart
          </button>
        </div>
        <div className="h-1 bg-[#0C1B33]/8 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#2563EB] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question card */}
      <div className="container mx-auto max-w-2xl px-6 py-8">
        <div className="bg-white rounded-xl shadow-sm p-6 md:p-8">
          <div className="mb-4">
            <LevelBadge level={q.topic} size="xs" />
          </div>
          <h2 className="font-editorial text-xl md:text-2xl text-[#0C1B33] mb-6 leading-snug">
            {q.question}
          </h2>

          <div className="space-y-2 mb-5">
            {q.choices.map((choice, i) => {
              const isPicked = selectedChoice === i;
              const isAnswer = q.correctIndex === i;
              let styles =
                "border-[#0C1B33]/10 bg-white hover:border-[#2563EB]/40 hover:bg-[#EFF3FB]/40";
              if (revealed) {
                if (isAnswer)
                  styles = "border-[#16a34a]/50 bg-[#16a34a]/8 text-[#0C1B33]";
                else if (isPicked)
                  styles = "border-[#dc2626]/40 bg-[#dc2626]/5 text-[#0C1B33]";
                else styles = "border-[#0C1B33]/8 bg-white text-[#0C1B33]/40";
              } else if (isPicked) {
                styles = "border-[#2563EB] bg-[#EFF3FB]/40";
              }
              return (
                <button
                  key={i}
                  onClick={() => selectChoice(i)}
                  disabled={revealed}
                  className={`w-full text-left px-4 py-3 border rounded-lg text-sm transition-colors ${styles} ${revealed ? "cursor-default" : "cursor-pointer"}`}
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="font-mono-bureau text-[10px] tracking-wider text-[#0C1B33]/30 w-4">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="flex-1">{choice}</span>
                    {revealed && isAnswer && (
                      <CheckCircle2 className="w-4 h-4 text-[#16a34a]" />
                    )}
                    {revealed && isPicked && !isAnswer && (
                      <XCircle className="w-4 h-4 text-[#dc2626]" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {revealed && (
            <div
              className={`border-l-2 pl-4 py-2 mb-4 ${isCorrect ? "border-[#16a34a]" : "border-[#dc2626]"}`}
            >
              <div className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase mb-1.5">
                {isCorrect ? (
                  <span className="text-[#16a34a]">Correct</span>
                ) : (
                  <span className="text-[#dc2626]">Not quite</span>
                )}
              </div>
              <p className="text-sm text-[#0C1B33]/65 leading-relaxed">{q.explanation}</p>
            </div>
          )}

          {revealed && (
            <button
              onClick={next}
              className="w-full md:w-auto inline-flex items-center justify-center gap-2 bg-[#0C1B33] hover:bg-[#1c2c4a] text-white font-mono-bureau text-[11px] tracking-[0.2em] uppercase px-6 py-3 rounded-full transition-colors"
            >
              {idx === questions.length - 1 ? "See my result" : "Next question"}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/programs"
            className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/35 hover:text-[#0C1B33]/70 transition-colors"
          >
            ← Back to programs directory
          </Link>
        </div>
      </div>
    </div>
  );
}

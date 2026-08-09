"use client";

import { motion } from "framer-motion";
import { ArrowRight, ChevronDown, ExternalLink, MapPin } from "lucide-react";
import Link from "next/link";
import type {
  MatchTransparencyContact,
  ProgramMatch,
  SurveyResult,
} from "@/lib/types";

interface SurveyResultsProps {
  results: SurveyResult;
  onRetake: () => void;
}

export function SurveyResults({ results, onRetake }: SurveyResultsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center mb-10">
        <span className="font-mono-bureau text-[10px] text-[#0C1B33]/25 uppercase tracking-[0.2em] block mb-5">
          Programs to review
        </span>
        <h2 className="font-editorial text-2xl sm:text-3xl text-[#0C1B33] mb-3">
          Starting points for your project
        </h2>
        <p className="text-sm text-[#0C1B33]/55 leading-relaxed max-w-xl mx-auto">
          Your answers organize programs for further review. Check the open
          questions and confirm current requirements with the listed contact.
        </p>
      </div>

      <div className="space-y-2 mb-12" data-testid="survey-program-review-list">
        {results.matches.map((match) => (
          <ProgramCard key={match.programId} match={match} />
        ))}
      </div>

      <div className="border border-[#0C1B33]/8 bg-[#EFF3FB] p-6 sm:p-8 mb-6">
        <div className="flex items-start gap-4">
          <MapPin className="w-5 h-5 text-[#2563EB] flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-mono-bureau text-[12px] text-[#0C1B33] uppercase tracking-[0.1em] mb-2">
              Add location context
            </h3>
            <p className="text-[#0C1B33]/55 text-sm leading-relaxed mb-4">
              Many programs depend on a specific boundary. Add a Chicago address
              to check its mapped program geographies.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 font-mono-bureau text-[11px] text-[#2563EB] uppercase tracking-[0.1em] hover:text-[#0C1B33] transition-colors"
            >
              Check mapped location
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={onRetake}
          className="font-mono-bureau text-[11px] text-[#0C1B33]/35 uppercase tracking-[0.1em] hover:text-[#0C1B33] transition-colors cursor-pointer"
        >
          Change answers
        </button>
      </div>
    </motion.div>
  );
}

function ExplanationList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <section>
      <h4 className="font-mono-bureau text-[10px] text-[#0C1B33]/40 uppercase tracking-[0.14em] mb-2">
        {title}
      </h4>
      <ul className="space-y-1.5 text-sm text-[#0C1B33]/65 leading-relaxed">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="text-[#2563EB]">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContactList({ contacts }: { contacts: MatchTransparencyContact[] }) {
  if (contacts.length === 0) return null;

  return (
    <section>
      <h4 className="font-mono-bureau text-[10px] text-[#0C1B33]/40 uppercase tracking-[0.14em] mb-2">
        Confirm with
      </h4>
      <ul className="space-y-3 text-sm text-[#0C1B33]/65">
        {contacts.map((contact) => (
          <li key={`${contact.agency}-${contact.role ?? "contact"}`}>
            <p className="text-[#0C1B33]">{contact.agency}</p>
            {contact.role && <p className="text-xs mt-0.5">{contact.role}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs">
              {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
              {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
              {contact.url && (
                <a
                  href={contact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[#2563EB]"
                >
                  Contact page <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgramCard({ match }: { match: ProgramMatch }) {
  const explanation = match.explanation;

  return (
    <details className="group border border-[#0C1B33]/8 bg-white">
      <summary className="list-none cursor-pointer px-5 py-4 flex items-center justify-between gap-4 hover:bg-[#EFF3FB] transition-colors">
        <div className="min-w-0">
          <p className="font-mono-bureau text-[12px] text-[#0C1B33] uppercase tracking-[0.05em]">
            {match.program.name}
          </p>
          <p className="font-mono-bureau text-[9px] text-[#0C1B33]/35 uppercase tracking-[0.12em] mt-1">
            {match.program.level}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 font-mono-bureau text-[9px] text-[#0C1B33]/40 uppercase tracking-[0.1em] flex-shrink-0">
          Review details
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="border-t border-[#0C1B33]/8 px-5 py-5 grid gap-6 sm:grid-cols-2">
        <ExplanationList title="Why it appears" items={explanation.whyItAppears} />
        <ExplanationList
          title="Known from public data"
          items={explanation.knownFromPublicData}
        />
        <ExplanationList
          title="Based on your answers"
          items={explanation.basedOnUserAnswers}
        />
        <ExplanationList title="Still to confirm" items={explanation.stillToConfirm} />
        <ExplanationList
          title="Documents to gather"
          items={explanation.currentDocumentsToGather}
        />
        <ContactList contacts={explanation.confirmWith} />

        {explanation.officialSource && (
          <section className="sm:col-span-2 pt-4 border-t border-[#0C1B33]/8">
            <a
              href={explanation.officialSource.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 font-mono-bureau text-[10px] text-[#2563EB] uppercase tracking-[0.1em] hover:text-[#0C1B33] transition-colors"
            >
              {explanation.officialSource.label}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </section>
        )}
      </div>
    </details>
  );
}

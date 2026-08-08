"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Search } from "lucide-react";
import type { IllinoisArtsCouncilAwardsContext } from "@/lib/investment-analysis";

const PAGE_SIZE = 25;

function formatAward(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatProgram(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function IllinoisArtsCouncilAwardsTable({
  data,
}: {
  data: IllinoisArtsCouncilAwardsContext;
}) {
  const [query, setQuery] = useState("");
  const [program, setProgram] = useState("all");
  const [fiscalYear, setFiscalYear] = useState("all");
  const [page, setPage] = useState(0);

  const programs = useMemo(
    () => [...new Set(data.records.map((record) => record.program))].sort(),
    [data.records],
  );
  const fiscalYears = useMemo(
    () => [...new Set(data.records.map((record) => record.fiscalYear))].sort((a, b) => b - a),
    [data.records],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.records.filter((record) => {
      if (program !== "all" && record.program !== program) return false;
      if (fiscalYear !== "all" && record.fiscalYear !== Number(fiscalYear)) return false;
      if (!normalizedQuery) return true;
      return (
        record.applicantName.toLowerCase().includes(normalizedQuery) ||
        record.program.toLowerCase().includes(normalizedQuery) ||
        record.region.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [data.records, fiscalYear, program, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const first = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const last = Math.min((safePage + 1) * PAGE_SIZE, filtered.length);

  return (
    <section id="illinois-arts-awards" className="mt-10 scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#2563EB]">
            State arts funding
          </span>
          <h2 className="mt-1.5 font-editorial text-[26px]">Illinois Arts Council awards</h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#0C1B33]/50">
            {data.sourceVersion} historical awards to applicants whose published city is Chicago.
            City and region are the finest available geography, so these records are not mapped to
            neighborhoods or properties.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono-bureau text-[9px] uppercase tracking-[0.1em]">
          <span className="border border-emerald-700/25 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">
            Complete for published source
          </span>
          <span className="border border-amber-700/20 bg-amber-50 px-2.5 py-1.5 text-amber-800">
            City-level only
          </span>
          <span className="border border-[#2563EB]/20 bg-[#2563EB]/5 px-2.5 py-1.5 text-[#1D4ED8]">
            Arts funding
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-y border-[#0C1B33]/10 py-4 sm:grid-cols-[minmax(0,1fr)_220px_150px]">
        <label className="block">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
            Search applicants
          </span>
          <span className="mt-1.5 flex h-10 items-center border border-[#0C1B33]/15 bg-white px-3 focus-within:border-[#2563EB]">
            <Search aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-[#0C1B33]/35" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#0C1B33]/30"
              placeholder="Name, program, or region"
            />
          </span>
        </label>
        <label className="block">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
            Program
          </span>
          <select
            value={program}
            onChange={(event) => {
              setProgram(event.target.value);
              setPage(0);
            }}
            className="mt-1.5 h-10 w-full border border-[#0C1B33]/15 bg-white px-3 text-[12px] outline-none focus:border-[#2563EB]"
          >
            <option value="all">All programs</option>
            {programs.map((value) => (
              <option key={value} value={value}>
                {formatProgram(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
            Fiscal year
          </span>
          <select
            value={fiscalYear}
            onChange={(event) => {
              setFiscalYear(event.target.value);
              setPage(0);
            }}
            className="mt-1.5 h-10 w-full border border-[#0C1B33]/15 bg-white px-3 text-[12px] outline-none focus:border-[#2563EB]"
          >
            <option value="all">All years</option>
            {fiscalYears.map((value) => (
              <option key={value} value={value}>
                FY{String(value).slice(-2)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto border-x border-b border-[#0C1B33]/10 bg-white">
        <table className="w-full min-w-[780px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#0C1B33]/10 bg-[#0C1B33]/[0.025] font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
              <th className="px-4 py-3 font-normal">Applicant</th>
              <th className="px-4 py-3 font-normal">Program</th>
              <th className="px-4 py-3 text-right font-normal">Award</th>
              <th className="px-4 py-3 font-normal">Published geography</th>
              <th className="w-16 px-4 py-3 text-center font-normal">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0C1B33]/8">
            {visible.map((record) => (
              <tr key={record.recordId} className="text-[12px] text-[#0C1B33]/65 hover:bg-[#FAF9F6]">
                <td className="px-4 py-3 font-medium text-[#0C1B33]">{record.applicantName}</td>
                <td className="px-4 py-3">{formatProgram(record.program)}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-[#0C1B33]">
                  {formatAward(record.grantAmount)}
                </td>
                <td className="px-4 py-3">{record.city} · {record.region}</td>
                <td className="px-4 py-3 text-center">
                  <a
                    href={record.sourcePageUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open official Illinois Arts Council source"
                    aria-label={`Open official source for ${record.applicantName}`}
                    className="inline-flex h-8 w-8 items-center justify-center text-[#2563EB] hover:bg-[#2563EB]/5"
                  >
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </a>
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-[#0C1B33]/45">
                  No published awards match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-x border-b border-[#0C1B33]/10 bg-white px-4 py-3">
        <p className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
          Showing {first}–{last} of {filtered.length.toLocaleString("en-US")} published records
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={safePage === 0}
            title="Previous page"
            aria-label="Previous page"
            className="inline-flex h-8 w-8 items-center justify-center border border-[#0C1B33]/12 text-[#0C1B33]/65 hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          <span className="min-w-20 text-center font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            disabled={safePage >= pageCount - 1}
            title="Next page"
            aria-label="Next page"
            className="inline-flex h-8 w-8 items-center justify-center border border-[#0C1B33]/12 text-[#0C1B33]/65 hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/40">
        Historical award, not current eligibility or proof of payment. The source publishes no official award id;
        internal record keys refer only to rows in this accepted snapshot. Source reviewed {data.sourceCheckedAt}.
      </p>
    </section>
  );
}

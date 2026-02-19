"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ArrowRight } from "lucide-react";
import { IncentiveReport } from "./IncentiveReport";
import {
  findBusinessByAddress,
  findBusinessByName,
  businessToLookupResult,
} from "@/lib/business-lookup";
import { checkZones, enrichEmployment } from "@/lib/zone-check";
import type { Business, LookupResult, Program } from "@/lib/types";

const SAMPLE_PROMPTS = [
  { label: "Justice of the Pies", type: "business" },
  { label: "2404 E 79th St", type: "address" },
  { label: "8100 S Stony Island Ave", type: "address" },
  { label: "Caribbean Jerk Joint", type: "business" },
  { label: "A New Day Mental Wellness Center", type: "business" },
];

const LOADING_MESSAGES = [
  "Scanning 11 incentive zone layers...",
  "Cross-referencing TIF district boundaries...",
  "Checking Opportunity Zone eligibility...",
  "Analyzing Enterprise Zone coverage...",
  "Computing your incentive stacking score...",
  "Running spatial analysis on your location...",
  "This part usually impresses people...",
  "Crunching the numbers the city doesn't want you to know...",
  "Your tax dollars at work (literally)...",
  "Almost there — pulling program details...",
];

export function AddressSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [suggestions, setSuggestions] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);

  useEffect(() => {
    fetch("/data/businesses.json")
      .then((r) => r.json())
      .then(setBusinesses);
    fetch("/data/programs.json")
      .then((r) => r.json())
      .then(setPrograms);
  }, []);

  // Cycle loading messages
  useEffect(() => {
    if (!loading) return;
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[i]);
    }, 1800);
    return () => clearInterval(interval);
  }, [loading]);

  // Suggestions as user types
  useEffect(() => {
    if (query.length < 3 || !businesses.length) {
      setSuggestions([]);
      return;
    }
    const nameMatches = findBusinessByName(query, businesses).slice(0, 5);
    setSuggestions(nameMatches);
  }, [query, businesses]);

  const handleLookup = useCallback(
    async (searchQuery?: string, directBusiness?: Business) => {
      const q = searchQuery ?? query;
      if (!q.trim() && !directBusiness) return;

      setLoading(true);
      setError("");
      setResult(null);
      setSuggestions([]);

      try {
        if (directBusiness) {
          await new Promise((r) => setTimeout(r, 600));
          const lookupResult = businessToLookupResult(directBusiness);
          setResult(await enrichEmployment(lookupResult));
          setLoading(false);
          return;
        }

        const addrMatch = findBusinessByAddress(q, businesses);
        if (addrMatch) {
          await new Promise((r) => setTimeout(r, 600));
          const lookupResult = businessToLookupResult(addrMatch);
          setResult(await enrichEmployment(lookupResult));
          setLoading(false);
          return;
        }

        const nameMatches = findBusinessByName(q, businesses);
        if (nameMatches.length === 1) {
          await new Promise((r) => setTimeout(r, 600));
          const lookupResult = businessToLookupResult(nameMatches[0]);
          setResult(await enrichEmployment(lookupResult));
          setLoading(false);
          return;
        }

        const res = await fetch(
          `/api/geocode?address=${encodeURIComponent(q)}`
        );
        if (!res.ok) {
          setError(
            "Address not found. Try entering a street address in the SSA #50 area."
          );
          setLoading(false);
          return;
        }

        const geo = await res.json();
        const zoneResult = await checkZones(geo.lat, geo.lon);
        setResult({
          ...zoneResult,
          address: geo.displayName || q,
        });
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [query, businesses]
  );

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Search Form */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search by business name or address..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              className="w-full h-14 bg-white border border-white/20 text-[#0C1B33] text-base px-5 pl-12 placeholder:text-[#0C1B33]/35 rounded-full focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 focus:border-transparent shadow-lg transition-all font-mono-bureau text-sm tracking-wide"
            />
            <Search className="absolute left-4 top-4.5 w-5 h-5 text-[#0C1B33]/30" />
          </div>
          <button
            onClick={() => handleLookup()}
            disabled={loading || !query.trim()}
            className="h-14 px-8 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.2em] uppercase flex items-center gap-3 rounded-full hover:bg-[#1d4ed8] hover:shadow-lg hover:shadow-blue-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Check
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Sample Search Prompts */}
        {!query && !result && !loading && (
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            <span className="font-mono-bureau text-[10px] tracking-[0.1em] uppercase text-white/30 self-center mr-1">
              Try:
            </span>
            {SAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt.label}
                onClick={() => {
                  setQuery(prompt.label);
                  handleLookup(prompt.label);
                }}
                className="px-3 py-1.5 text-[11px] font-mono-bureau tracking-wide text-white/50 bg-white/8 border border-white/10 rounded-full hover:bg-white/15 hover:text-white/70 hover:border-white/20 transition-all cursor-pointer"
              >
                {prompt.label}
              </button>
            ))}
          </div>
        )}

        {/* Autocomplete Suggestions */}
        {suggestions.length > 0 && !result && (
          <div className="absolute z-20 w-full mt-2 bg-white rounded-2xl border border-[#0C1B33]/10 shadow-xl overflow-hidden">
            {suggestions.map((biz) => (
              <button
                key={biz.id}
                className="w-full px-5 py-3 text-left hover:bg-[#EFF3FB] border-b border-[#0C1B33]/5 last:border-b-0 transition-colors"
                onClick={() => {
                  setQuery(biz.name);
                  handleLookup(biz.name, biz);
                }}
              >
                <div className="text-[#0C1B33]/80 text-sm">{biz.name}</div>
                <div className="text-[#0C1B33]/40 text-xs font-mono-bureau mt-0.5">
                  {biz.address} &middot; {biz.category}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-3">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-white/60 bureau-pulse" style={{ animationDelay: "0s" }} />
              <div className="w-1.5 h-1.5 bg-white/60 bureau-pulse" style={{ animationDelay: "0.3s" }} />
              <div className="w-1.5 h-1.5 bg-white/60 bureau-pulse" style={{ animationDelay: "0.6s" }} />
            </div>
            <span className="font-mono-bureau text-[11px] tracking-wide text-white/50">
              {loadingMsg}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-6 p-4 border border-red-400/30 bg-red-500/10 text-red-300 text-sm font-mono-bureau">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-10">
          <IncentiveReport result={result} programs={programs} />
        </div>
      )}
    </div>
  );
}

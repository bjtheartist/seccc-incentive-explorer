"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { IncentiveReport } from "./IncentiveReport";
import {
  findBusinessByAddress,
  findBusinessByName,
  businessToLookupResult,
} from "@/lib/business-lookup";
import { checkZones, enrichEmployment } from "@/lib/zone-check";
import type { Business, LookupResult, Program } from "@/lib/types";
import { cachedFetch } from "@/lib/fetch-cache";

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
  "Looking up city zoning classification...",
  "Almost there — pulling program details...",
  "Asking the GIS database nicely...",
  "Consulting the ancient TIF scrolls...",
  "Mapping every dollar left on the table...",
  "Whispering to the Cook County parcel data...",
  "Checking if your block is secretly a goldmine...",
  "Reviewing 20+ federal, state, and city programs...",
  "Doing math so you don't have to...",
  "Convincing the server this is important...",
  "Loading incentives faster than City Hall returns calls...",
  "Cross-checking SBIF project boundaries...",
  "Verifying census tract employment data...",
  "Stacking zones like it's a game of Tetris...",
  "If this were a city meeting, we'd still be on roll call...",
  "Running the numbers... they're looking good...",
  "Pulling data from 6 government databases at once...",
];

export function AddressSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [suggestions, setSuggestions] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);

  useEffect(() => {
    // Try API first, fallback to static files
    cachedFetch<Business[]>("/api/businesses")
      .catch(() => cachedFetch<Business[]>("/data/businesses.json"))
      .then(setBusinesses)
      .catch(() => {});
    cachedFetch<Program[]>("/data/programs.json")
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

  /** Navigate to instant report with lat/lon/addr */
  const navigateToReport = useCallback(
    (lat: number, lon: number, addr: string) => {
      const params = new URLSearchParams();
      params.set("instant", "true");
      params.set("lat", lat.toFixed(5));
      params.set("lon", lon.toFixed(5));
      if (addr) params.set("addr", addr);
      router.push(`/report?${params.toString()}`);
    },
    [router]
  );

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
          if (directBusiness.lat && directBusiness.lon) {
            navigateToReport(directBusiness.lat, directBusiness.lon, directBusiness.address);
            return;
          }
          await new Promise((r) => setTimeout(r, 600));
          const lookupResult = businessToLookupResult(directBusiness);
          setResult(await enrichEmployment(lookupResult));
          setLoading(false);
          return;
        }

        const addrMatch = findBusinessByAddress(q, businesses);
        if (addrMatch) {
          if (addrMatch.lat && addrMatch.lon) {
            navigateToReport(addrMatch.lat, addrMatch.lon, addrMatch.address);
            return;
          }
          await new Promise((r) => setTimeout(r, 600));
          const lookupResult = businessToLookupResult(addrMatch);
          setResult(await enrichEmployment(lookupResult));
          setLoading(false);
          return;
        }

        const nameMatches = findBusinessByName(q, businesses);
        if (nameMatches.length === 1) {
          const match = nameMatches[0];
          if (match.lat && match.lon) {
            navigateToReport(match.lat, match.lon, match.address);
            return;
          }
          await new Promise((r) => setTimeout(r, 600));
          const lookupResult = businessToLookupResult(match);
          setResult(await enrichEmployment(lookupResult));
          setLoading(false);
          return;
        }

        let geo;
        try {
          geo = await cachedFetch<{ lat: number; lon: number; displayName?: string }>(
            `/api/geocode?address=${encodeURIComponent(q)}`
          );
        } catch {
          setError(
            "Address not found. Try entering a street address in the SSA #50 area."
          );
          setLoading(false);
          return;
        }
        // Navigate to instant report with geocoded coordinates
        navigateToReport(geo.lat, geo.lon, geo.displayName || q);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [query, businesses, navigateToReport]
  );

  return (
    <div className="w-full max-w-[600px] mx-auto">
      {/* Search Form */}
      <div className="relative">
        <div className="flex items-center gap-3 bg-black/40 backdrop-blur-2xl border border-white/20 rounded-2xl px-5 py-1.5 focus-within:border-[#2563EB]/50 focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.15)] transition-all">
          <Search className="w-[18px] h-[18px] text-white/40 shrink-0" />
          <input
            type="text"
            placeholder="Enter address, business name, or ZIP code..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            className="flex-1 h-12 bg-transparent text-white text-[15px] placeholder:text-white/30 focus:outline-none font-[inherit]"
          />
          <button
            onClick={() => handleLookup()}
            disabled={loading || !query.trim()}
            className="h-10 px-6 bg-[#2563EB] text-white font-mono-bureau text-[11px] tracking-[0.1em] uppercase rounded-xl hover:bg-[#1d4ed8] disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
          >
            Check Now
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

      {/* Loading State — Claude-style thinking */}
      {loading && (
        <div className="mt-6">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm px-5 py-4">
            {/* Shimmer gradient */}
            <div
              className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(37,99,235,0.06), transparent)",
              }}
            />
            <div className="relative flex items-center gap-3">
              {/* Animated orb */}
              <div className="relative w-5 h-5 shrink-0">
                <div className="absolute inset-0 rounded-full bg-[#2563EB]/40 animate-ping" />
                <div className="absolute inset-0.5 rounded-full bg-[#2563EB]/80" />
              </div>
              {/* Rotating text */}
              <div className="overflow-hidden h-5">
                <div
                  key={loadingMsg}
                  className="animate-[fadeSlideIn_0.4s_ease-out]"
                >
                  <span className="font-mono-bureau text-[11px] tracking-wide text-white/50">
                    {loadingMsg}
                  </span>
                </div>
              </div>
            </div>
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

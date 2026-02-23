"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ArrowRight, Shield } from "lucide-react";
import {
  findBusinessByAddress,
  findBusinessByName,
} from "@/lib/business-lookup";
import type { Business } from "@/lib/types";

const SAMPLE_ADDRESSES = [
  "9133 S Stony Island Ave",
  "2404 E 79th St",
  "8100 S Stony Island Ave",
  "8751 S Houston Ave",
];

interface CheckAddressInputProps {
  onSubmit: (address: string, lat: number, lon: number) => void;
  loading?: boolean;
}

export function CheckAddressInput({ onSubmit, loading }: CheckAddressInputProps) {
  const [query, setQuery] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [suggestions, setSuggestions] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [geocoding, setGeocoding] = useState(false);

  useEffect(() => {
    fetch("/api/businesses")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .catch(() => fetch("/data/businesses.json").then((r) => r.json()))
      .then(setBusinesses)
      .catch(() => {});
  }, []);

  // Suggestions as user types
  useEffect(() => {
    if (query.length < 3 || !businesses.length) {
      setSuggestions([]);
      return;
    }
    const nameMatches = findBusinessByName(query, businesses).slice(0, 4);
    setSuggestions(nameMatches);
  }, [query, businesses]);

  const handleSubmit = useCallback(
    async (searchQuery?: string, directBusiness?: Business) => {
      const q = searchQuery ?? query;
      if (!q.trim() && !directBusiness) return;

      setError("");
      setSuggestions([]);

      // Direct business match — use its coordinates
      if (directBusiness && directBusiness.lat && directBusiness.lon) {
        onSubmit(directBusiness.address, directBusiness.lat, directBusiness.lon);
        return;
      }

      // Try address match in business DB
      const addrMatch = findBusinessByAddress(q, businesses);
      if (addrMatch && addrMatch.lat && addrMatch.lon) {
        onSubmit(addrMatch.address, addrMatch.lat, addrMatch.lon);
        return;
      }

      // Geocode
      setGeocoding(true);
      try {
        const res = await fetch(
          `/api/geocode?address=${encodeURIComponent(q)}`
        );
        if (!res.ok) {
          setError(
            "Address not found. Try entering a street address in Chicago."
          );
          return;
        }
        const geo = await res.json();
        onSubmit(geo.displayName || q, geo.lat, geo.lon);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setGeocoding(false);
      }
    },
    [query, businesses, onSubmit]
  );

  const isLoading = loading || geocoding;

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Trust signal */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <Shield className="w-4 h-4 text-[#2563EB]/50" />
        <p className="text-[11px] font-mono-bureau tracking-wide text-[#0C1B33]/40">
          Free tool — no login required — results are instant
        </p>
      </div>

      {/* Search Form */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Enter a Chicago address..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              disabled={isLoading}
              className="w-full h-14 bg-white border border-[#0C1B33]/10 text-[#0C1B33] text-sm px-5 pl-12 placeholder:text-[#0C1B33]/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50 focus:border-transparent shadow-sm transition-all font-mono-bureau tracking-wide disabled:opacity-50"
            />
            <Search className="absolute left-4 top-4.5 w-5 h-5 text-[#0C1B33]/25" />
          </div>
          <button
            onClick={() => handleSubmit()}
            disabled={isLoading || !query.trim()}
            className="h-14 px-6 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.2em] uppercase flex items-center gap-2 rounded-xl hover:bg-[#1d4ed8] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-white/60 rounded-full animate-pulse" />
                <div
                  className="w-1.5 h-1.5 bg-white/60 rounded-full animate-pulse"
                  style={{ animationDelay: "0.2s" }}
                />
                <div
                  className="w-1.5 h-1.5 bg-white/60 rounded-full animate-pulse"
                  style={{ animationDelay: "0.4s" }}
                />
              </div>
            ) : (
              <>
                Check
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        {/* Autocomplete Suggestions */}
        {suggestions.length > 0 && (
          <div className="absolute z-20 w-full mt-2 bg-white rounded-xl border border-[#0C1B33]/10 shadow-lg overflow-hidden">
            {suggestions.map((biz) => (
              <button
                key={biz.id}
                className="w-full px-5 py-3 text-left hover:bg-[#EFF3FB] border-b border-[#0C1B33]/5 last:border-b-0 transition-colors"
                onClick={() => {
                  setQuery(biz.address);
                  handleSubmit(biz.address, biz);
                }}
              >
                <div className="text-[#0C1B33]/80 text-sm">{biz.name}</div>
                <div className="text-[#0C1B33]/40 text-xs font-mono-bureau mt-0.5">
                  {biz.address}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sample Addresses */}
      {!query && (
        <div className="flex flex-wrap gap-2 mt-4 justify-center">
          <span className="font-mono-bureau text-[10px] tracking-[0.1em] uppercase text-[#0C1B33]/25 self-center mr-1">
            Try:
          </span>
          {SAMPLE_ADDRESSES.map((addr) => (
            <button
              key={addr}
              onClick={() => {
                setQuery(addr);
                handleSubmit(addr);
              }}
              className="px-3 py-1.5 text-[11px] font-mono-bureau tracking-wide text-[#0C1B33]/40 bg-[#0C1B33]/3 border border-[#0C1B33]/5 rounded-full hover:bg-[#0C1B33]/6 hover:text-[#0C1B33]/60 hover:border-[#0C1B33]/10 transition-all cursor-pointer"
            >
              {addr}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 border border-red-200 bg-red-50 text-red-600 text-sm rounded-lg font-mono-bureau">
          {error}
        </div>
      )}
    </div>
  );
}

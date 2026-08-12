"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, X, MapPin } from "lucide-react";

interface SearchResult {
  lat: number;
  lon: number;
  label: string;
  type: "business" | "address";
}

interface MapSearchProps {
  onResult: (result: SearchResult) => void;
  onQueryChange?: (query: string) => void;
}

export default function MapSearch({ onResult, onQueryChange }: MapSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 3) {
        setResults([]);
        return;
      }

      setLoading(true);

      try {
        const items: SearchResult[] = [];

        // Search businesses first
        const bizRes = await fetch(
          `/api/businesses?search=${encodeURIComponent(q)}`
        );
        if (bizRes.ok) {
          const bizData = await bizRes.json();
          if (Array.isArray(bizData)) {
            for (const biz of bizData.slice(0, 5)) {
              if (biz.lat && biz.lon) {
                items.push({
                  lat: biz.lat,
                  lon: biz.lon,
                  label: `${biz.name} — ${biz.address}`,
                  type: "business",
                });
              }
            }
          }
        }

        // Also try geocoding for addresses
        if (items.length < 3) {
          const geoRes = await fetch(
            `/api/geocode?address=${encodeURIComponent(q)}`
          );
          if (geoRes.ok) {
            const geo = await geoRes.json();
            if (geo.lat && geo.lon) {
              items.push({
                lat: geo.lat,
                lon: geo.lon,
                label: geo.displayName || q,
                type: "address",
              });
            }
          }
        }

        setResults(items);
        setOpen(items.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      onQueryChange?.(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 400);
    },
    [doSearch, onQueryChange]
  );

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const selectedLabel = result.label.split(" — ")[0];
      setQuery(selectedLabel);
      onQueryChange?.(selectedLabel);
      setOpen(false);
      setResults([]);
      onResult(result);
    },
    [onQueryChange, onResult]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && results.length > 0) {
        handleSelect(results[0]);
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    },
    [results, handleSelect]
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = () => setOpen(false);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <div
      data-testid="map-search"
      data-tour="map-search"
      className="absolute top-16 left-3 right-3 md:top-3 md:left-auto md:right-3 z-[60] isolate pointer-events-auto md:w-72"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Search input — hero on mobile (search-first), compact on desktop */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Enter an address to explore incentives…"
          className="w-full h-12 md:h-9 bg-white md:bg-white/95 backdrop-blur border border-[#0C1B33]/10 text-[#0C1B33] text-[14px] md:text-[12px] pl-10 md:pl-8 pr-9 md:pr-8 rounded-full md:rounded-none shadow-lg md:shadow-none font-mono-bureau tracking-wide placeholder:text-[#0C1B33]/35 placeholder:normal-case focus:outline-none focus:ring-1 focus:ring-[#2563EB]/40 focus:border-[#2563EB]/40 transition-colors"
        />
        <Search className="absolute left-3.5 md:left-2.5 top-3.5 md:top-2.5 w-4 h-4 md:w-3.5 md:h-3.5 text-[#0C1B33]/35" />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onQueryChange?.("");
              setResults([]);
              setOpen(false);
            }}
            className="absolute right-3.5 md:right-2.5 top-4 md:top-2.5 text-[#0C1B33]/30 hover:text-[#0C1B33]/60"
          >
            <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
          </button>
        )}

        {loading && (
          <div className="absolute right-3.5 md:right-2.5 top-5 md:top-3 flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-1 h-1 bg-[#2563EB] rounded-full"
                style={{
                  animation: `bureau-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dropdown results */}
      {open && results.length > 0 && (
        <div
          data-testid="map-search-results"
          className="relative z-[70] mt-1 bg-white/95 backdrop-blur border border-[#0C1B33]/10 shadow-lg overflow-hidden pointer-events-auto"
        >
          {results.map((r, i) => (
            <button
              type="button"
              key={i}
              onClick={() => handleSelect(r)}
              className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-[#EFF3FB] border-b border-[#0C1B33]/5 last:border-b-0 transition-colors pointer-events-auto touch-manipulation"
            >
              <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-[#2563EB]/50" />
              <div className="min-w-0">
                <div className="text-[11px] text-[#0C1B33]/70 truncate leading-tight">
                  {r.label}
                </div>
                <div className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#0C1B33]/30 mt-0.5">
                  {r.type === "business" ? "Business" : "Address"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

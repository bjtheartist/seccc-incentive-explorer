"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";

/**
 * Primary CTA on a neighborhood page: routes to the report flow pre-filled
 * with the community-area centroid, generating a snapshot for that area.
 */
export function NeighborhoodSnapshotButton({
  lat,
  lon,
  name,
}: {
  lat: number;
  lon: number;
  name: string;
}) {
  const router = useRouter();

  const handleClick = () => {
    const addr = `${name}, Chicago, IL`;
    trackEvent("location_snapshot_requested", {
      address: addr,
      lat,
      lon,
      source: "neighborhood_page",
      metadata: { neighborhood: name },
    });
    const params = new URLSearchParams({
      instant: "true",
      lat: String(lat),
      lon: String(lon),
      addr,
      source: "neighborhood_page",
    });
    router.push(`/report?${params.toString()}`);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-2 h-12 px-6 bg-[#2563EB] text-white font-mono-bureau text-[12px] tracking-[0.1em] uppercase rounded-xl hover:bg-[#1d4ed8] transition-all"
    >
      Generate Free Location Snapshot for {name}
      <ArrowRight className="w-4 h-4" />
    </button>
  );
}

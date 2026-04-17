"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { decodeCheckState } from "@/lib/url-state";

function CheckRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const state = decodeCheckState(searchParams);

    if (state) {
      // Has lat/lon — redirect to instant report with all existing params
      const params = new URLSearchParams();
      params.set("instant", "true");
      params.set("lat", state.lat.toFixed(5));
      params.set("lon", state.lon.toFixed(5));
      if (state.address) params.set("addr", state.address);
      if (state.sector) params.set("sector", state.sector);
      if (state.surveyAnswers) {
        params.set("sa", btoa(JSON.stringify(state.surveyAnswers)));
      }
      router.replace(`/report?${params.toString()}`);
    } else {
      // No coords — redirect to /report
      router.replace("/report");
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
      <div className="text-center">
        <div className="flex gap-1.5 justify-center mb-3">
          <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" />
          <div
            className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse"
            style={{ animationDelay: "0.2s" }}
          />
          <div
            className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse"
            style={{ animationDelay: "0.4s" }}
          />
        </div>
        <p className="font-mono-bureau text-[11px] tracking-wide text-[#0C1B33]/30">
          Redirecting to report...
        </p>
      </div>
    </div>
  );
}

export default function CheckPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
          <div className="text-center">
            <div className="flex gap-1.5 justify-center mb-3">
              <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" />
              <div
                className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse"
                style={{ animationDelay: "0.2s" }}
              />
              <div
                className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse"
                style={{ animationDelay: "0.4s" }}
              />
            </div>
            <p className="font-mono-bureau text-[11px] tracking-wide text-[#0C1B33]/30">
              Loading...
            </p>
          </div>
        </div>
      }
    >
      <CheckRedirect />
    </Suspense>
  );
}

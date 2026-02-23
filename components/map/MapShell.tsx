"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const LOADING_MESSAGES = [
  "Scanning corridor boundaries",
  "Fetching incentive layers",
  "Mapping TIF districts",
  "Locating opportunity zones",
  "Compiling enterprise data",
  "Charting transit routes",
  "Cross-referencing zoning codes",
  "Stacking incentive overlaps",
  "Rendering Southeast Chicago",
  "Preparing your map",
];

function MapLoader() {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % LOADING_MESSAGES.length);
        setFade(true);
      }, 300);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="w-full flex flex-col items-center justify-center bg-[#F0F1EE] bureau-grid"
      style={{ height: 650 }}
    >
      {/* Pulsing dot cluster */}
      <div className="flex items-center gap-1.5 mb-6">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block w-1.5 h-1.5 bg-[#2563EB] rounded-full"
            style={{
              animation: `bureau-pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Cycling message */}
      <span
        className="font-mono-bureau text-[10px] tracking-[0.25em] uppercase text-[#0C1B33]/40 transition-opacity duration-300"
        style={{ opacity: fade ? 1 : 0 }}
      >
        {LOADING_MESSAGES[index]}
      </span>

      {/* Progress bar */}
      <div className="mt-5 w-48 h-px bg-[#0C1B33]/10 overflow-hidden">
        <div
          className="h-full bg-[#2563EB]/30"
          style={{
            animation: "map-loader-progress 2.2s ease-in-out infinite",
          }}
        />
      </div>

      <style jsx>{`
        @keyframes map-loader-progress {
          0% {
            width: 0%;
            margin-left: 0;
          }
          50% {
            width: 60%;
            margin-left: 20%;
          }
          100% {
            width: 0%;
            margin-left: 100%;
          }
        }
      `}</style>
    </div>
  );
}

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <MapLoader />,
});

export default function MapShell() {
  return <MapView />;
}

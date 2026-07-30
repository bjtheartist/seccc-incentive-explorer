"use client";

import dynamic from "next/dynamic";
import type { CasePreviewMapProps } from "./CasePreviewMap";

/**
 * Client island around the Case Workbench's compact preview map. mapbox-gl
 * touches `window` at module scope, so the map is loaded with `ssr: false`
 * (the components/map/MapShell.tsx pattern) and the Server Component page
 * imports only THIS module — it passes the active case's mapped points
 * straight through, exactly as it fed the SVG preview this replaced.
 */
const CasePreviewMap = dynamic(() => import("./CasePreviewMap"), {
  ssr: false,
  loading: () => <PreviewSkeleton />,
});

/** Quiet placeholder at the map's exact footprint — no layout shift when the
 *  basemap arrives, and no fake dots pretending to be data. */
function PreviewSkeleton() {
  return (
    <div className="flex h-[260px] w-full items-center justify-center bg-[#F0F1EE] sm:h-[290px]">
      <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/35">
        Loading preview map
      </span>
    </div>
  );
}

export default function CasePreviewMapIsland(props: CasePreviewMapProps) {
  return <CasePreviewMap {...props} />;
}

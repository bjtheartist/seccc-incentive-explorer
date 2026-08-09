"use client";

import dynamic from "next/dynamic";
import type { CaseWorkspaceMapProps } from "./CaseWorkspaceMap";

const CaseWorkspaceMap = dynamic(() => import("./CaseWorkspaceMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[480px] w-full items-center justify-center bg-[#F0F1EE]">
      <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#0C1B33]/35">
        Loading property map
      </span>
    </div>
  ),
});

export default function CaseWorkspaceMapIsland(props: CaseWorkspaceMapProps) {
  return <CaseWorkspaceMap {...props} />;
}

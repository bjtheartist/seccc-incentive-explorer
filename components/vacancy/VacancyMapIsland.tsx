"use client";

import { useEffect, useRef } from "react";
import VacancyReportMap from "./VacancyReportMap";
import { useFocusBbox } from "./vacancy-focus";
import type { ComponentProps } from "react";

type MapProps = Omit<ComponentProps<typeof VacancyReportMap>, "focusBbox">;

/**
 * Client island around the report map: subscribes to the shared focus store
 * (set by the cluster cards further down the page) and scrolls the map into
 * view when a cluster is focused.
 */
export default function VacancyMapIsland(props: MapProps) {
  const focusBbox = useFocusBbox();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusBbox && wrapRef.current) {
      wrapRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusBbox]);

  return (
    <div ref={wrapRef}>
      <VacancyReportMap {...props} focusBbox={focusBbox} />
    </div>
  );
}

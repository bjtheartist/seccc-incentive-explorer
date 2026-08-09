"use client";

import { useEffect, useRef } from "react";
import VacancyReportMap from "./VacancyReportMap";
import SiteMatchmakerResultsTable from "./SiteMatchmakerResultsTable";
import { useFocusBbox } from "./vacancy-focus";
import type { ComponentProps } from "react";

type MapProps = Omit<ComponentProps<typeof VacancyReportMap>, "focusBbox"> & {
  showSiteMatchmakerResults?: boolean;
};

/**
 * Client island around the report map: subscribes to the shared focus store
 * (set by the cluster cards further down the page) and scrolls the map into
 * view when a cluster is focused. `initialAreaId` (the page's `?area=` deep
 * link, defect B) passes straight through in `props` — VacancyReportMap
 * itself resolves it against `clusters` on load.
 */
export default function VacancyMapIsland({
  showSiteMatchmakerResults = false,
  ...props
}: MapProps) {
  const focusBbox = useFocusBbox();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusBbox && wrapRef.current) {
      wrapRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusBbox]);

  return (
    <>
      <div ref={wrapRef} id={showSiteMatchmakerResults ? "site-matchmaker-map" : undefined}>
        <VacancyReportMap {...props} focusBbox={focusBbox} />
      </div>
      {showSiteMatchmakerResults ? (
        <div className="mt-8">
          <SiteMatchmakerResultsTable
            sitePoints={props.sitePoints}
            landPoints={props.landPoints}
            zip={props.zip}
            neighborhood={props.neighborhood ?? `ZIP ${props.zip}`}
          />
        </div>
      ) : null}
    </>
  );
}

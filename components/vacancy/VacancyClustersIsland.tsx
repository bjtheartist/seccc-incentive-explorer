"use client";

import VacancyClusters from "./VacancyClusters";
import { setFocusBbox } from "./vacancy-focus";
import type { ComponentProps } from "react";

type ClustersProps = Omit<ComponentProps<typeof VacancyClusters>, "onFocus">;

/** Client island around the cluster cards: "View on map" publishes the
 *  cluster bbox to the shared focus store the map island subscribes to. */
export default function VacancyClustersIsland(props: ClustersProps) {
  return <VacancyClusters {...props} onFocus={(bbox) => setFocusBbox(bbox)} />;
}

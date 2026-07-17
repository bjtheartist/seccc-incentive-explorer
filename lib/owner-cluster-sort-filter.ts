import type { OwnerCluster } from "@/lib/corridor-owners";
import { hasEntityMarkers, normalizeOwnerType, type OwnerType } from "@/lib/owner-classify";

/**
 * Pure, client-side sort/filter over an already-loaded OwnerCluster[] page
 * (app/admin/owner-files/[zip]/page.tsx -> components/owner-file/
 * OwnerClusterListClient.tsx). No network/DB calls here — the ZIP's cluster
 * list is fetched once server-side; everything below just reorders/narrows
 * that in-memory array, which is why it's plain functions rather than a
 * hook, and unit-testable without React.
 */

export type ClusterSortKey = "vacant" | "parcels" | "ownerName";

export const CLUSTER_SORT_KEYS: ClusterSortKey[] = ["vacant", "parcels", "ownerName"];

export type EntityFilter = "all" | "entities" | "individuals";

export const ENTITY_FILTERS: EntityFilter[] = ["all", "entities", "individuals"];

export interface ClusterFilterOptions {
  /** Selected owner-type chips. Empty/undefined = no owner-type narrowing (show every type). */
  ownerTypes?: OwnerType[];
  /** Defaults to "all" (no entity/individual narrowing). */
  entityFilter?: EntityFilter;
  /** Minimum vacantParcelCount, inclusive. Defaults to 0 (no floor). */
  minVacant?: number;
}

/**
 * Cluster-only approximation of lib/owner-file.ts resolveIsEntityOwner: the
 * two checks that don't require the human verification/notes layer (which
 * isn't loaded on this list page). Mirrors resolveIsEntityOwner's first two
 * conditions exactly — a taxpayer-name entity marker, or an assessor-
 * classified corporate_llc/city_public ownerType — so "Entities only" here
 * agrees with the dossier page's own entity-owner governance rail wherever
 * both have the same inputs to work with.
 */
export function isEntityOwnerFromClusterOnly(cluster: Pick<OwnerCluster, "ownerName" | "ownerType">): boolean {
  if (hasEntityMarkers(cluster.ownerName)) return true;
  if (cluster.ownerType === "corporate_llc" || cluster.ownerType === "city_public") return true;
  return false;
}

/** Sort a copy of `clusters` by the given key. Never mutates the input array. */
export function sortClusters(clusters: OwnerCluster[], sortKey: ClusterSortKey): OwnerCluster[] {
  const sorted = clusters.slice();
  switch (sortKey) {
    case "parcels":
      sorted.sort((a, b) => b.parcelCount - a.parcelCount);
      break;
    case "ownerName": {
      sorted.sort((a, b) => {
        const nameA = (a.ownerName || "").trim();
        const nameB = (b.ownerName || "").trim();
        if (!nameA && !nameB) return 0;
        if (!nameA) return 1; // missing/unavailable owner names sort last, not first
        if (!nameB) return -1;
        return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
      });
      break;
    }
    case "vacant":
    default:
      sorted.sort((a, b) => b.vacantParcelCount - a.vacantParcelCount);
      break;
  }
  return sorted;
}

/** Filter a copy of `clusters` by owner-type chips, entity/individual, and a min-vacant floor. */
export function filterClusters(clusters: OwnerCluster[], options: ClusterFilterOptions = {}): OwnerCluster[] {
  const { ownerTypes, entityFilter = "all", minVacant = 0 } = options;

  return clusters.filter((cluster) => {
    if (ownerTypes && ownerTypes.length > 0) {
      if (!ownerTypes.includes(normalizeOwnerType(cluster.ownerType))) return false;
    }

    if (entityFilter !== "all") {
      const isEntity = isEntityOwnerFromClusterOnly(cluster);
      if (entityFilter === "entities" && !isEntity) return false;
      if (entityFilter === "individuals" && isEntity) return false;
    }

    if (minVacant > 0 && cluster.vacantParcelCount < minVacant) return false;

    return true;
  });
}

/** Filter then sort — the single entry point OwnerClusterListClient calls on every control change. */
export function sortAndFilterClusters(
  clusters: OwnerCluster[],
  options: ClusterFilterOptions & { sortKey?: ClusterSortKey } = {}
): OwnerCluster[] {
  return sortClusters(filterClusters(clusters, options), options.sortKey ?? "vacant");
}

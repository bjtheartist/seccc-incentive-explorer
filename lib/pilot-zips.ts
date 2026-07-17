/**
 * The nine Owner Files pilot ZIPs (Southeast ZIPs 60617/60619/60649 plus the
 * West pilot 60624/60623/60644/60651/60621/60636 — see
 * app/admin/owner-files/[zip]/page.tsx and lib/owner-file.ts
 * listOwnerClusters), each labeled with a primary neighborhood
 * (community-area) name and any secondary community areas that share the
 * ZIP. Backs the Owner Files landing page (app/admin/owner-files/page.tsx)
 * and the neighborhood header/switcher on the per-ZIP page.
 *
 * Derivation — NOT hand-typed: every primaryNeighborhood/secondaryAreas
 * value below is the ZIP-code -> community-area inversion of
 * data/exports/community-area-zip.json, which is itself built by
 * scripts/build-ca-zip-map.ts from lib/community-areas.ts centroids via
 * point-in-polygon against real Chicago ZIP boundaries (not from this
 * file's own guesses). For a pilot ZIP, "primary" is the community area
 * whose centroid falls inside that ZIP; "secondary" areas are any other
 * community areas whose centroid also falls inside it. A ZIP with only one
 * matching community area has an empty secondaryAreas array — that is
 * correct, not a gap.
 *
 * Two deliberate departures from a naive "what most people call this area"
 * list:
 *  - 60624 resolves to West Garfield Park only. East Garfield Park's own
 *    centroid falls in 60612 per the computed mapping, so it is NOT listed
 *    as a secondary area here even though the two Garfield Parks are
 *    adjacent — correctness against the computed source beats a
 *    colloquial pairing.
 *  - 60623's secondary area is labeled "South Lawndale (Little Village)"
 *    since South Lawndale is the official community-area name but "Little
 *    Village" is how the neighborhood is near-universally referred to.
 */

export interface PilotZipEntry {
  zip: string;
  primaryNeighborhood: string;
  secondaryAreas: string[];
}

export const PILOT_ZIPS: PilotZipEntry[] = [
  {
    zip: "60617",
    primaryNeighborhood: "South Chicago",
    secondaryAreas: ["East Side", "South Deering", "Calumet Heights"],
  },
  {
    zip: "60619",
    primaryNeighborhood: "Chatham",
    secondaryAreas: ["Avalon Park", "Greater Grand Crossing", "Burnside"],
  },
  {
    zip: "60649",
    primaryNeighborhood: "South Shore",
    secondaryAreas: [],
  },
  {
    zip: "60624",
    primaryNeighborhood: "West Garfield Park",
    secondaryAreas: [],
  },
  {
    zip: "60623",
    primaryNeighborhood: "North Lawndale",
    secondaryAreas: ["South Lawndale (Little Village)"],
  },
  {
    zip: "60644",
    primaryNeighborhood: "Austin",
    secondaryAreas: [],
  },
  {
    zip: "60651",
    primaryNeighborhood: "Humboldt Park",
    secondaryAreas: [],
  },
  {
    zip: "60621",
    primaryNeighborhood: "Englewood",
    secondaryAreas: [],
  },
  {
    zip: "60636",
    primaryNeighborhood: "West Englewood",
    secondaryAreas: [],
  },
];

/** Lookup a pilot ZIP's neighborhood entry, or undefined for a non-pilot ZIP. */
export function getPilotZipEntry(zip: string): PilotZipEntry | undefined {
  return PILOT_ZIPS.find((entry) => entry.zip === zip);
}

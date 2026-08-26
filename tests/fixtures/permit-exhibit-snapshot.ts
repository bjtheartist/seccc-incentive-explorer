import type { PermitExhibitSnapshot } from "@/lib/permit-exhibit-snapshot";
import { fixturePermitExhibit } from "@/lib/permit-exhibit-fixtures";

export const PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID = "ps_abcdefghijklmnopqrstuvwx";
export const PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID = "PX-20363230080000-20260826-ABCD";
export const PERMIT_EXHIBIT_SNAPSHOT_HASH =
  "c257218754f74d16c10f3983ebedabacaf71161b3e4a93388382e9fcb15aa711";

export function fixturePermitExhibitSnapshot(): PermitExhibitSnapshot {
  const exhibit = fixturePermitExhibit({
    pin: "20363230080000",
    radiusFt: 500,
    exhibitId: "F3E7D0198BE1C91DB289",
  });

  return {
    schemaVersion: 1,
    publicId: PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID,
    displayId: PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID,
    savedAt: "2026-08-26T15:18:00.000Z",
    appRevision: "42d5b66",
    sourceVintages: {
      permitDatasetUpdatedAt: exhibit.meta.datasetLastUpdate,
      parcelContextResolvedAt: exhibit.meta.snapshotDate,
      boundaryContextResolvedAt: exhibit.boundaryContext.asOfDate,
      zoningRecordUpdatedAt: exhibit.boundaryContext.zoningDistrict.recordUpdatedAt,
      zoningArchive: exhibit.boundaryContext.archiveVintageRange,
    },
    exhibit,
    contentHash: PERMIT_EXHIBIT_SNAPSHOT_HASH,
  };
}

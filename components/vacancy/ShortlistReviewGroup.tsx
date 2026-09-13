"use client";

import { useId, useState } from "react";
import { assessorRecordUrl, cookViewerUrl } from "@/lib/cook-viewer";

export interface ShortlistReviewRecord {
  key: string;
  address: string;
  pin: string | null;
  identityStatus: string;
  recordedType: string;
  sourceYear: string | null;
  zoningDistrict: string | null;
  reasons: readonly string[];
}

/** Only a small review slice crosses the client boundary. Keep the optional
 * details closed initially so a large uncertain inventory does not delay the
 * ordinary matches or dominate the page on mobile. No new request on expand.
 */
export default function ShortlistReviewGroup({ title, total, records }: {
  title: string;
  total: number;
  records: readonly ShortlistReviewRecord[];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <section className="mt-8 border-t pt-5">
      <h2 className="text-xl font-semibold">{title} ({total})</h2>
      <p className="mt-2 text-sm">These are not matches to all evaluated requirements. Open up to {records.length} records to inspect the evidence and verification reasons.</p>
      <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}
        className="mt-3 min-h-11 border border-[#0C1B33]/25 px-4 py-2 text-sm">
        {expanded ? "Hide" : "Show"} {title.toLowerCase()} records
      </button>
      <div id={id}>
        {expanded && <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {records.map((record) => <li key={record.key} className="border p-4" data-testid="shortlist-review-record">
            <h3 className="font-semibold">{record.address}</h3>
            <p className="text-xs">PIN: {record.pin ?? "unresolved"}. Identity: {record.identityStatus}.</p>
            <p className="text-sm">{record.reasons.join(" ")}</p>
            <p className="mt-2 text-xs">Recorded type: {record.recordedType}; source year: {record.sourceYear ?? "not published"}. District: {record.zoningDistrict ?? "unresolved"}.</p>
            {record.pin && <p className="mt-2 flex flex-wrap gap-3 text-sm">
              <a className="underline" href={cookViewerUrl(record.pin)!} target="_blank" rel="noreferrer">Verify parcel in CookViewer</a>
              <a className="underline" href={assessorRecordUrl(record.pin)!} target="_blank" rel="noreferrer">Assessor record</a>
            </p>}
          </li>)}
        </ul>}
      </div>
    </section>
  );
}

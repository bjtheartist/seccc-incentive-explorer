import Link from "next/link";
import { cookies } from "next/headers";
import {
  ANALYTICS_ADMIN_COOKIE,
  hasValidAnalyticsAdminSession,
  isAnalyticsAdminConfigured,
} from "@/lib/analytics-admin-auth";
import {
  type ZoningLegislationKind,
  type ZoningLegislationLifecycle,
} from "@/lib/zoning-legislation";
import { loadZoningSourceLedger } from "@/lib/zoning-legislation-data";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  if (!value) return "Not published";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

const LIFECYCLE_LABELS: Record<ZoningLegislationLifecycle, string> = {
  pending: "Pending",
  adopted: "Adopted",
  withdrawn: "Withdrawn",
  failed: "Failed",
  repealed: "Repealed",
  closed_without_adoption: "Closed without adoption",
  unknown: "Status not classified",
};

const KIND_LABELS: Record<ZoningLegislationKind, string> = {
  map_amendment: "Map amendment",
  zoning_code_amendment: "Zoning Code amendment",
};

function LoginPanel() {
  return (
    <main className="mx-auto max-w-xl px-5 py-20">
      <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
        Admin
      </span>
      <h1 className="mt-3 font-editorial text-[36px] leading-tight text-[#0C1B33]">
        Zoning Change Ledger
      </h1>
      <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/55">
        Sign in with the analytics admin password to review the City Clerk, zoning-map, and ZBA
        source history.
      </p>
      <form action="/api/admin/analytics/login" method="post" className="mt-8 space-y-4">
        <input type="hidden" name="redirectTo" value="/admin/zoning-changes" />
        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]/50">
            Admin password
          </span>
          <input
            type="password"
            name="password"
            required
            className="mt-2 w-full border border-[#0C1B33]/15 px-4 py-3 text-[14px] outline-none focus:border-[#2563EB]"
          />
        </label>
        <button
          type="submit"
          className="bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-white"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

export default async function ZoningChangesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (!isAnalyticsAdminConfigured()) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-20">
        <h1 className="font-editorial text-[36px] text-[#0C1B33]">Zoning Change Ledger</h1>
        <p className="mt-4 text-[14px] text-[#0C1B33]/55">
          Set `ANALYTICS_ADMIN_PASSWORD` before using this private source-review page.
        </p>
      </main>
    );
  }

  const cookieStore = await cookies();
  if (
    !hasValidAnalyticsAdminSession(cookieStore.get(ANALYTICS_ADMIN_COOKIE)?.value)
  ) {
    return <LoginPanel />;
  }

  const params = await searchParams;
  const lifecycle = param(params.lifecycle) ?? "all";
  const kind = param(params.kind) ?? "all";
  const year = param(params.year) ?? "all";
  const query = (param(params.q) ?? "").trim().toLowerCase();
  const page = Math.max(1, Number(param(params.page) ?? "1") || 1);
  const pageSize = 50;
  const { legislation, mapSnapshot, mapDelta, zbaSnapshot, zbaDelta } =
    loadZoningSourceLedger();
  const years = Object.keys(legislation.coverage.byFileYear).sort(
    (a, b) => Number(b) - Number(a),
  );
  const excludedRelatedRecords = legislation.coverage.searches.reduce(
    (total, search) => total + search.excludedRelatedRecords,
    0,
  );

  const filtered = legislation.matters.filter((matter) => {
    if (lifecycle !== "all" && matter.lifecycle !== lifecycle) return false;
    if (kind !== "all" && matter.kind !== kind) return false;
    if (year !== "all" && String(matter.fileYear ?? "") !== year) return false;
    if (
      query &&
      !`${matter.recordNumber} ${matter.title} ${matter.controllingBody ?? ""}`
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (lifecycle !== "all") next.set("lifecycle", lifecycle);
    if (kind !== "all") next.set("kind", kind);
    if (year !== "all") next.set("year", year);
    if (query) next.set("q", query);
    next.set("page", String(nextPage));
    return `/admin/zoning-changes?${next.toString()}`;
  };

  return (
    <main className="min-h-screen bg-[#F8F8F5] px-4 py-8 text-[#0C1B33] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[#0C1B33]/10 pb-5 font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]/45">
          <Link href="/admin/analytics" className="hover:text-[#2563EB]">Analytics</Link>
          <Link href="/admin/owner-files" className="hover:text-[#2563EB]">Owner Files</Link>
          <span className="text-[#0C1B33]">Zoning Changes</span>
        </nav>

        <header className="py-8">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.18em] text-[#2563EB]">
            Official-source review
          </span>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-editorial text-[40px] leading-tight sm:text-[52px]">
                Zoning Change Ledger
              </h1>
              <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/55">
                eLMS records legislative activity. ArcGIS publishes the current zoning geometry,
                and the separate City ZBA layer publishes historical case records. The ledger
                never infers a parcel boundary, permitted use, or current authorization from a
                matter title or past ZBA judgment.
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <a
                href={legislation.source.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#2563EB] hover:underline"
              >
                Open City Clerk eLMS ↗
              </a>
              <a
                href={zbaSnapshot.source.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#2563EB] hover:underline"
              >
                Open City ZBA layer ↗
              </a>
            </div>
          </div>
        </header>

        <section className="grid border-y border-l border-[#0C1B33]/10 bg-white sm:grid-cols-2 xl:grid-cols-7">
          {[
            ["Legislative matters", legislation.coverage.total.toLocaleString()],
            ["Pending", legislation.coverage.byLifecycle.pending.toLocaleString()],
            ["Adopted", legislation.coverage.byLifecycle.adopted.toLocaleString()],
            ["Current map polygons", mapSnapshot.featureCount.toLocaleString()],
            ["Map updated through", formatDate(mapSnapshot.source.sourceUpdatedThrough)],
            ["Published ZBA records", zbaSnapshot.featureCount.toLocaleString()],
            ["ZBA updated through", "Not published"],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-r border-[#0C1B33]/10 p-4">
              <span className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/35">
                {label}
              </span>
              <div className="mt-2 font-editorial text-[26px] leading-tight">{value}</div>
            </div>
          ))}
        </section>

        <section className="mt-6 border-l-2 border-[#2563EB] bg-white px-5 py-4">
          <h2 className="font-mono-bureau text-[10px] uppercase tracking-[0.16em]">
            Source boundary
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
            eLMS coverage begins December 1, 2010. The separate City ZBA layer supplies historical
            special-use, variation, and administrative-appeal case records. A ZBA record or past
            judgment does not establish current authorization, permitted use, or compliance. The
            City layer does not publish a refresh timestamp, and the Explorer does not substitute
            its retrieval date. A pending ordinance is not a zoning-map change; an adopted matter
            is not treated as mapped until the official GIS source reflects it. The Explorer&apos;s
            point matching and presentation are informational, not a City zoning determination.
            {" "}{excludedRelatedRecords.toLocaleString()} related eLMS search result
            {excludedRelatedRecords === 1 ? " is" : "s are"} excluded because the record is not a
            map or Zoning Code amendment (for example, an opposition or vote-intent communication).
            {" "}{zbaSnapshot.coverage.byCaseType.unknown.toLocaleString()} ZBA record
            {zbaSnapshot.coverage.byCaseType.unknown === 1 ? " has" : "s have"} an unrecognized
            published case-type code, and {zbaSnapshot.coverage.withoutPublishedJudgment.toLocaleString()}
            {" "}do not publish judgment text; both remain visible as source limitations.
          </p>
          {/*
            A baseline is NOT a zero-change result. Both delta artifacts carry
            `comparedFrom: null` until a second snapshot exists, meaning no
            comparison has been performed at all — but this line used to print
            the counts alone, so "nothing to compare against" and "compared and
            found nothing" rendered as the identical sentence: "0 added, 0
            removed". An admin would reasonably read that as confirmation the
            City's map had not moved. Rail 7: an absence of evidence must never
            be published as evidence of absence.
          */}
          <p className="mt-2 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/35">
            eLMS published through {formatDate(legislation.source.sourceUpdatedThrough)} ·{" "}
            {mapDelta.comparedFrom === null ? (
              <>map delta: no comparison performed yet — this is the first captured snapshot,
                with no earlier one to compare against</>
            ) : (
              <>latest reviewed map delta (compared against {formatDate(mapDelta.comparedFrom)}):{" "}
                {mapDelta.counts.added} added, {mapDelta.counts.removed} removed,{" "}
                {mapDelta.counts.attributesChanged} attribute and{" "}
                {mapDelta.counts.geometryChanged} geometry changes</>
            )}
            {" · "}
            {zbaDelta.comparedFromFeatureCount === null ? (
              <>ZBA delta: no comparison performed yet — first captured snapshot, no earlier one
                to compare against</>
            ) : (
              <>latest reviewed ZBA delta (compared against{" "}
                {zbaDelta.comparedFromFeatureCount.toLocaleString()} prior records):{" "}
                {zbaDelta.counts.added} added, {zbaDelta.counts.removed} removed,{" "}
                {zbaDelta.counts.attributesChanged} attribute and{" "}
                {zbaDelta.counts.geometryChanged} geometry changes</>
            )}
          </p>
        </section>

        <form className="mt-6 grid gap-3 border-y border-[#0C1B33]/10 bg-white p-4 md:grid-cols-[minmax(220px,1fr)_180px_200px_140px_auto]">
          <input
            type="search"
            name="q"
            defaultValue={param(params.q) ?? ""}
            placeholder="Record number or title"
            className="min-w-0 border border-[#0C1B33]/15 px-3 py-2 text-[12px] outline-none focus:border-[#2563EB]"
          />
          <select name="lifecycle" defaultValue={lifecycle} className="border border-[#0C1B33]/15 px-3 py-2 text-[12px]">
            <option value="all">All lifecycle states</option>
            {Object.entries(LIFECYCLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select name="kind" defaultValue={kind} className="border border-[#0C1B33]/15 px-3 py-2 text-[12px]">
            <option value="all">All matter types</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select name="year" defaultValue={year} className="border border-[#0C1B33]/15 px-3 py-2 text-[12px]">
            <option value="all">All years</option>
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="submit" className="bg-[#0C1B33] px-4 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-white">
            Apply
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between gap-4 text-[11px] text-[#0C1B33]/45">
          <span>{filtered.length.toLocaleString()} records</span>
          <span>Page {currentPage} of {totalPages}</span>
        </div>

        <div className="mt-3 hidden overflow-x-auto border border-[#0C1B33]/10 bg-white md:block">
          <table className="w-full min-w-[980px] text-left">
            <thead className="border-b border-[#0C1B33]/10 font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/35">
              <tr>
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Matter</th>
                <th className="px-4 py-3">Lifecycle</th>
                <th className="px-4 py-3">Introduced</th>
                <th className="px-4 py-3">Final action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0C1B33]/7">
              {rows.map((matter) => (
                <tr key={matter.matterId} className="align-top">
                  <td className="px-4 py-4">
                    <a href={matter.sourceUrl} target="_blank" rel="noreferrer" className="font-mono-bureau text-[10px] text-[#2563EB] hover:underline">
                      {matter.recordNumber} ↗
                    </a>
                    <div className="mt-2 text-[10px] text-[#0C1B33]/35">{KIND_LABELS[matter.kind]}</div>
                  </td>
                  <td className="max-w-2xl px-4 py-4 text-[12px] leading-relaxed text-[#0C1B33]/65">{matter.title}</td>
                  <td className="px-4 py-4 text-[11px]">{LIFECYCLE_LABELS[matter.lifecycle]}</td>
                  <td className="px-4 py-4 text-[11px] text-[#0C1B33]/50">{formatDate(matter.introductionDate)}</td>
                  <td className="px-4 py-4 text-[11px] text-[#0C1B33]/50">{formatDate(matter.finalActionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 space-y-3 md:hidden">
          {rows.map((matter) => (
            <article key={matter.matterId} className="border border-[#0C1B33]/10 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <a href={matter.sourceUrl} target="_blank" rel="noreferrer" className="font-mono-bureau text-[10px] text-[#2563EB]">
                  {matter.recordNumber} ↗
                </a>
                <span className="text-[10px] text-[#0C1B33]/45">{LIFECYCLE_LABELS[matter.lifecycle]}</span>
              </div>
              <h2 className="mt-3 text-[13px] leading-relaxed">{matter.title}</h2>
              <p className="mt-3 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/35">
                {KIND_LABELS[matter.kind]} · introduced {formatDate(matter.introductionDate)} · final {formatDate(matter.finalActionDate)}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-[#0C1B33]/10 pt-5">
          {currentPage > 1 ? (
            <Link href={pageHref(currentPage - 1)} className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#2563EB]">← Previous</Link>
          ) : <span />}
          {currentPage < totalPages ? (
            <Link href={pageHref(currentPage + 1)} className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#2563EB]">Next →</Link>
          ) : <span />}
        </div>
      </div>
    </main>
  );
}

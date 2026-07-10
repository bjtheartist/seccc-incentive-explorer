import type { ReportDetailGroup } from "@/lib/report-engine";

interface GroupedReportDetailProps {
  summary?: string;
  groups: ReportDetailGroup[];
  caveat?: string;
}

export function GroupedReportDetail({
  summary,
  groups,
  caveat,
}: GroupedReportDetailProps) {
  return (
    <div className="mt-3">
      {summary && (
        <p className="font-mono-bureau text-[10px] leading-relaxed text-[#0C1B33]/55 sm:text-[11px]">
          {summary}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.id} className="min-w-0 border-t border-[#0C1B33]/8 pt-3">
            <dt className="font-mono-bureau text-[9px] uppercase text-[#0C1B33]/55">
              {group.label}
            </dt>
            <dd className="mt-2">
              <ul className="list-disc space-y-1.5 pl-4 marker:text-[#2563EB]/45">
                {group.items.map((entry) => (
                  <li
                    key={`${group.id}-${entry}`}
                    className="pl-1 text-[12px] leading-relaxed text-[#0C1B33]/65 sm:text-[13px]"
                  >
                    {entry}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>

      {caveat && (
        <p className="mt-4 border-l-2 border-[#2563EB]/20 pl-3 text-[11px] leading-relaxed text-[#0C1B33]/50 sm:text-[12px]">
          {caveat}
        </p>
      )}
    </div>
  );
}

import { permanentRedirect } from "next/navigation";
import { parseCaseParam } from "@/lib/vacancy-cases";

/**
 * app/vacancy/ux-lab/ was the interaction prototype for the Case Workbench. The
 * Case Workbench is now the Vacant Sites per-ZIP landing itself
 * (/vacancy/[zip]), so this route permanently redirects there — carrying the
 * prototype's `case` param through when it names one of the five real cases,
 * and dropping the retired builder/compare params (goal/records/tax/violations/
 * sel), which the decision-first landing no longer models.
 */
export default async function VacancyUxLabRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  // Only `case` survives, and only when it maps to a known case key.
  if (params.case !== undefined) {
    query.set("case", parseCaseParam(params.case));
  }
  const search = query.toString();
  permanentRedirect(`/vacancy/60617${search ? `?${search}` : ""}`);
}

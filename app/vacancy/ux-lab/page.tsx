import { permanentRedirect } from "next/navigation";

/**
 * app/vacancy/ux-lab/ was the interaction prototype for the Case Workbench
 * (Quick Paths / Build a Case / Compare). It shipped to production as
 * /vacancy/[zip]/cases, generalized to all nine pilot ZIPs. This route now
 * permanently redirects so any review links that were shared against ux-lab
 * keep working — translating the prototype's ux-lab-only params (view/case/
 * goal/records/tax/violations/sel) straight through, since the production
 * route reads the exact same param names.
 */
export default async function VacancyUxLabRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value[0] !== undefined) query.set(key, value[0]);
    } else {
      query.set(key, value);
    }
  }
  const search = query.toString();
  permanentRedirect(`/vacancy/60617/cases${search ? `?${search}` : ""}`);
}

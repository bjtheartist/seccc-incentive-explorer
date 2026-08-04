import { permanentRedirect } from "next/navigation";

/**
 * Compatibility route for shared prototype links. The case workbench is the
 * canonical ZIP landing page; preserve every task/filter parameter while
 * redirecting so old `/cases` links remain reproducible.
 */
export default async function VacancyCasesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ zip: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ zip }, resolved] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item);
    } else if (value) {
      query.set(key, value);
    }
  }
  permanentRedirect(`/vacancy/${zip}${query.size > 0 ? `?${query.toString()}` : ""}`);
}

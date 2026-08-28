import { permanentRedirect } from "next/navigation";
import { buildRetiredCheckDestination } from "@/lib/check-retirement";

/**
 * The standalone Quick Address Check was sunset in favor of the complete Site
 * Incentive Analysis. Keep old bookmarks useful: a resolved legacy point goes
 * straight into the same address on /report, while a bare or malformed link
 * lands on the normal report entry screen.
 */

export default async function RetiredCheckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(buildRetiredCheckDestination(await searchParams));
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCommunityAreaBoundary } from "@/lib/community-area-boundary";
import {
  allNeighborhoodSlugs,
  findCommunityAreaBySlug,
} from "@/lib/neighborhood-slugs";
import { PermitActivityBrief } from "./PermitActivityBrief";

type Params = Promise<{ area: string }>;

export const dynamicParams = false;
export const dynamic = "force-dynamic";

export function generateStaticParams(): Array<{ area: string }> {
  return allNeighborhoodSlugs().map((area) => ({ area }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { area: slug } = await params;
  const area = findCommunityAreaBySlug(slug);
  return {
    title: area
      ? `Permit Activity Analysis — ${area.name}`
      : "Permit Activity Analysis",
    description: area
      ? `Source-backed building-permit filing activity inside the official ${area.name} community-area boundary.`
      : "Source-backed building-permit filing activity for Chicago community areas.",
    robots: { index: false, follow: false },
  };
}

export default async function PermitActivityAreaPage({
  params,
}: {
  params: Params;
}) {
  const { area: slug } = await params;
  const area = findCommunityAreaBySlug(slug);
  if (!area) notFound();

  const geometry = getCommunityAreaBoundary(area.name);
  if (!geometry) notFound();

  const reportDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  }).format(new Date());

  return (
    <PermitActivityBrief
      area={{ id: area.id, name: area.name, slug }}
      geometry={geometry}
      reportDate={reportDate}
    />
  );
}

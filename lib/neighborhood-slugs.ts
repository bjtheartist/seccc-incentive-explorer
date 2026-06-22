import {
  CHICAGO_COMMUNITY_AREAS,
  type CommunityArea,
} from "@/lib/community-areas";

/** URL slug for a community area: "O'Hare" -> "o-hare", "Auburn Gresham" -> "auburn-gresham". */
export function neighborhoodSlug(ca: { name: string }): string {
  return ca.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const slugToArea = new Map<string, CommunityArea>();
for (const ca of CHICAGO_COMMUNITY_AREAS) {
  slugToArea.set(neighborhoodSlug(ca), ca);
}

export function findCommunityAreaBySlug(slug: string): CommunityArea | undefined {
  return slugToArea.get(slug);
}

export function allNeighborhoodSlugs(): string[] {
  return [...slugToArea.keys()];
}

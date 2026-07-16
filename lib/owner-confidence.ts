/**
 * Owner File confidence tiers.
 *
 * `D`/`C`/`B` map from the existing OwnerCluster.confidence string
 * (Low/Medium/High, computed at export time in lib/corridor-owners.ts).
 * `A` is runtime-only, granted solely by a completed human verification
 * with an IL-SOS entity lookup on file — an algorithm must never claim
 * Tier A, because that would launder the no-bulk-SOS-scraping boundary
 * (see the plan's governance rails). This file is the single place that
 * ruling is enforced.
 */

export type ConfidenceTier = "A" | "B" | "C" | "D";
export type AlgorithmicConfidenceTier = "B" | "C" | "D";

/** D/C/B mapping from the OwnerCluster.confidence string computed at export time. */
export function algorithmicTier(confidence: string): AlgorithmicConfidenceTier {
  if (confidence === "High") return "B";
  if (confidence === "Medium") return "C";
  return "D";
}

/** The subset of OwnerCluster fields resolveConfidenceTier needs. */
export interface OwnerClusterForTier {
  confidence: string;
}

/** The subset of an Owner File verification record resolveConfidenceTier needs. */
export interface OwnerFileVerificationForTier {
  status?: string | null;
  ilSosLookupUrl?: string | null;
}

/** The subset of an Owner File note resolveConfidenceTier needs. */
export interface OwnerFileNoteForTier {
  noteType?: string | null;
}

/**
 * Resolve the confidence tier shown on an Owner File.
 *
 * Tier A requires a `verified` verification AND either a non-empty
 * `il_sos_lookup_url` on that verification or at least one `entity_lookup`
 * note (the paste-back trail for a guided individual IL SOS lookup —
 * bulk/scraped access is prohibited, so a note is the only other honest way
 * to record that a human did the lookup). Everything else falls back to the
 * algorithmic tier computed from the cluster's own confidence.
 *
 * `notes` defaults to `[]` so callers that haven't loaded notes yet still
 * get a defensible (non-A) tier rather than a thrown error.
 */
export function resolveConfidenceTier(
  cluster: OwnerClusterForTier,
  verification: OwnerFileVerificationForTier | null | undefined,
  notes: OwnerFileNoteForTier[] = []
): ConfidenceTier {
  const isVerified = verification?.status === "verified";
  const hasLookupUrl = Boolean(verification?.ilSosLookupUrl?.trim());
  const hasEntityLookupNote = notes.some((note) => note.noteType === "entity_lookup");

  if (isVerified && (hasLookupUrl || hasEntityLookupNote)) {
    return "A";
  }
  return algorithmicTier(cluster.confidence);
}

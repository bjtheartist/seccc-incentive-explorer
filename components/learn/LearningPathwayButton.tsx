import Link from "next/link";

/**
 * The way in to the unlisted Learning Pathway, shared by the FAQ's
 * "Still have questions?" card and the program directory.
 *
 * This replaces the single muted line ("There's a longer answer.") that
 * used to sit in both places. It is a button now because a reader who
 * wants twelve lessons on zoning should be able to see that there is
 * something to press — but it stays an OUTLINED mono pill, never the
 * page's blue or navy primary, so it reads as a footnote to the real CTA
 * (Call Us on the FAQ, the quiz card on /programs) rather than a rival.
 *
 * /learn stays unlisted everywhere else: no nav entry, no sitemap row,
 * noindex. These two buttons are its only entrances.
 */

const CAPTION = "Twelve short lessons on zoning, permits, and licenses.";

export default function LearningPathwayButton({
  align = "start",
}: {
  /** "center" under the FAQ's centered card; "start" in the left-aligned directory. */
  align?: "start" | "center";
}) {
  return (
    <div
      className={`flex flex-col gap-2 ${
        align === "center" ? "items-center text-center" : "items-start"
      }`}
    >
      <Link
        href="/learn"
        className="inline-flex items-center rounded-full border border-[#0C1B33]/25 px-5 py-2 font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/70 hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
      >
        Learning Pathway
      </Link>
      <p className="font-mono-bureau text-[10px] tracking-[0.08em] text-[#0C1B33]/40">
        {CAPTION}
      </p>
    </div>
  );
}

import type { ProgramLevel } from "@/lib/types";
import { LEVEL_COLORS, LEVEL_DESCRIPTIONS } from "@/lib/constants";

type Size = "xs" | "sm" | "md";

interface LevelBadgeProps {
  level: ProgramLevel;
  size?: Size;
  className?: string;
}

const sizeClasses: Record<Size, string> = {
  xs: "text-[8px] tracking-[0.12em] px-1.5 py-0.5",
  sm: "text-[9px] tracking-[0.15em] px-2.5 py-1",
  md: "text-[10px] tracking-[0.18em] px-3 py-1.5",
};

/**
 * Color-coded chip identifying which government level administers an incentive.
 * Use anywhere a program is summarized: directory cards, map popups, report sections.
 */
export default function LevelBadge({ level, size = "sm", className = "" }: LevelBadgeProps) {
  const color = LEVEL_COLORS[level];
  return (
    <span
      className={`font-mono-bureau uppercase rounded-full inline-flex items-center ${sizeClasses[size]} ${className}`}
      style={{ color, backgroundColor: `${color}14` }}
      title={LEVEL_DESCRIPTIONS[level]}
    >
      {level}
    </span>
  );
}

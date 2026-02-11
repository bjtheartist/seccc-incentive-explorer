"use client";

interface StackingScoreProps {
  score: number;
  maxScore?: number;
}

export function StackingScore({ score, maxScore = 11 }: StackingScoreProps) {
  const pct = Math.round((score / maxScore) * 100);

  const getColor = () => {
    if (pct >= 70) return "#4ADE80";
    if (pct >= 40) return "#FBBF24";
    return "#EF4444";
  };

  const getLabel = () => {
    if (score >= 7) return "Excellent";
    if (score >= 5) return "Strong";
    if (score >= 3) return "Moderate";
    if (score >= 1) return "Limited";
    return "None";
  };

  const color = getColor();

  return (
    <div className="text-center">
      <div className="relative w-28 h-28 mx-auto mb-4">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="2.5"
          />
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeDasharray={`${pct}, 100`}
            strokeLinecap="butt"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-editorial text-3xl" style={{ color }}>
            {score}
          </span>
          <span className="font-mono-bureau text-[8px] tracking-[0.2em] text-white/30 uppercase">
            of {maxScore}
          </span>
        </div>
      </div>
      <div className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase" style={{ color }}>
        {getLabel()} Coverage
      </div>
    </div>
  );
}

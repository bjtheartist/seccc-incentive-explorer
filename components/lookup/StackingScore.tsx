"use client";

interface StackingScoreProps {
  score: number;
}

export function StackingScore({ score }: StackingScoreProps) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 flex h-20 w-20 flex-col items-center justify-center border border-white/10 bg-white/[0.03]">
        <span className="font-editorial text-3xl text-white">{score}</span>
        <span className="font-mono-bureau text-[8px] tracking-[0.2em] text-white/30 uppercase">
          zones
        </span>
      </div>
      <div className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-white/55">
        Mapped Incentive Coverage
      </div>
    </div>
  );
}

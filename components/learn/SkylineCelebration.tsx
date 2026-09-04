"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The one flourish on the Learning Pathway: a small card that pops up the
 * first time a visitor answers all twelve checks, carrying a hand-drawn
 * Chicago skyline that rises out of the baseline.
 *
 * Everything here is inline SVG — no GIF, no image request, no animation
 * library. The silhouette is Willis (stepped, two masts), Aon, Trump with
 * its spire, the Hancock's taper, a scatter of mid-rises, a hint of the
 * lakefront, and the city flag's two light-blue stripes with four red
 * six-pointed stars.
 *
 * It makes no claim about any program. It is a reading reward on an
 * unlisted education page, and the copy is deliberately about the lessons
 * ("All twelve lessons, done.") and nothing else.
 *
 * Motion is opt-in, not opt-out: the animating class is added only after
 * a mount-time matchMedia check clears it, so a visitor who asks for
 * reduced motion is rendered the finished skyline and never a frame of
 * animation. The keyframes themselves also carry a reduced-motion guard
 * in globals.css.
 */

/** Each tower: a baseline-anchored polygon, plus any rooftop masts as [x, top, bottom]. */
const TOWERS: readonly {
  points: string;
  masts?: readonly (readonly [number, number, number])[];
}[] = [
  { points: "6,150 6,112 26,112 26,150" },
  { points: "28,150 28,96 44,96 44,150" },
  // Willis Tower — stepped bundled tubes, two antennas.
  {
    points: "48,150 48,78 58,78 58,52 70,52 70,26 86,26 86,52 92,52 92,78 96,78 96,150",
    masts: [
      [73, 2, 26],
      [82, 6, 26],
    ],
  },
  { points: "100,150 100,104 116,104 116,150" },
  // Aon Center — a plain slender shaft.
  { points: "120,150 120,36 146,36 146,150" },
  // Trump Tower — three setbacks under a spire.
  {
    points: "152,150 152,90 162,90 162,64 172,64 172,40 184,40 184,150",
    masts: [[178, 8, 40]],
  },
  { points: "190,150 190,110 204,110 204,150" },
  { points: "206,150 206,98 218,98 218,150" },
  { points: "220,150 220,116 232,116 232,150" },
  // John Hancock Center — tapering, twin antennas.
  {
    points: "238,150 246,30 270,30 278,150",
    masts: [
      [252, 6, 30],
      [264, 10, 30],
    ],
  },
  { points: "284,150 284,108 298,108 298,150" },
  { points: "300,150 300,92 316,92 316,150" },
  { points: "318,150 318,118 330,118 330,150" },
  { points: "334,150 334,104 352,104 352,150" },
  { points: "356,150 356,120 370,120 370,150" },
  { points: "374,150 374,100 394,100 394,150" },
];

/** Lit windows, [x, y]. Twinkle delay is derived from the index. */
const WINDOWS: readonly (readonly [number, number])[] = [
  [12, 122],
  [33, 106],
  [52, 92],
  [62, 64],
  [76, 38],
  [88, 92],
  [106, 116],
  [126, 52],
  [138, 84],
  [126, 110],
  [156, 102],
  [165, 76],
  [176, 52],
  [196, 122],
  [210, 110],
  [250, 62],
  [262, 96],
  [258, 40],
  [288, 120],
  [306, 104],
  [340, 116],
  [380, 112],
  [36, 126],
  [108, 132],
  [134, 120],
  [225, 128],
  [310, 128],
  [344, 132],
  [362, 130],
  [386, 132],
];

/** A six-pointed star, outer radius 5, centered on the origin. */
const STAR =
  "0,-5 1.44,-2.5 4.33,-2.5 2.89,0 4.33,2.5 1.44,2.5 0,5 -1.44,2.5 -4.33,2.5 -2.89,0 -4.33,-2.5 -1.44,-2.5";

export default function SkylineCelebration({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [animated, setAnimated] = useState(false);

  // Focus moves to the close control, and back to whatever had it when we
  // dismiss — the visitor was mid-keyboard on the twelfth lesson's option.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Motion is added after the fact, never assumed. Rendering the animating
  // class first and stripping it later would flash one frame of movement
  // at exactly the visitor who asked for none.
  useEffect(() => {
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnimated(true);
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="skyline-celebration-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C1B33]/45 p-4"
      onMouseDown={(event) => {
        if (!cardRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skyline-celebration-title"
        className={`w-full max-w-md overflow-hidden border border-[#0C1B33]/15 bg-[#FAF9F6] shadow-2xl ${
          animated ? "skyline-anim" : ""
        }`}
      >
        <svg
          viewBox="0 0 400 180"
          role="img"
          aria-label="An illustrated Chicago skyline over the city flag's stripes and stars."
          className="block w-full"
        >
          <defs>
            <linearGradient id="skyline-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0C1B33" />
              <stop offset="100%" stopColor="#1E3054" />
            </linearGradient>
            <clipPath id="skyline-ground">
              <rect x="0" y="0" width="400" height="150" />
            </clipPath>
          </defs>

          <rect x="0" y="0" width="400" height="152" fill="url(#skyline-sky)" />

          {/* Shared paint and the per-building rise delay both live in CSS
              (globals.css), so this markup stays a list of coordinates. */}
          <g clipPath="url(#skyline-ground)">
            <g fill="#16294A" stroke="#2563EB" strokeWidth="0.75">
              {TOWERS.map((tower) => (
                <g key={tower.points} className="skyline-building">
                  <polygon points={tower.points} />
                  {tower.masts?.map(([x, top, bottom]) => (
                    <rect
                      key={x}
                      x={x - 0.7}
                      y={top}
                      width="1.4"
                      height={bottom - top}
                      fill="#2563EB"
                      stroke="none"
                    />
                  ))}
                </g>
              ))}
            </g>
            <g className="skyline-lights" fill="#FBBF6B">
              {WINDOWS.map(([x, y]) => (
                <rect key={`${x}-${y}`} x={x} y={y} width="2.4" height="3" />
              ))}
            </g>
          </g>

          {/* A hint of the lakefront under the baseline. */}
          <path
            d="M0 154 Q 50 150 100 154 T 200 154 T 300 154 T 400 154"
            fill="none"
            stroke="#2563EB"
            strokeWidth="1.2"
            opacity="0.55"
          />

          {/* City flag: white field, two light-blue stripes, four red stars. */}
          <rect x="0" y="158" width="400" height="22" fill="#FFFFFF" />
          <rect x="0" y="160" width="400" height="3" fill="#7FCDEE" />
          <rect x="0" y="175" width="400" height="3" fill="#7FCDEE" />
          {[128, 176, 224, 272].map((cx) => (
            <polygon key={cx} points={STAR} fill="#C1272D" transform={`translate(${cx} 169)`} />
          ))}
        </svg>

        <div className="px-6 py-5">
          <p className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#2563EB]/60 mb-2">
            Twelve of twelve
          </p>
          <h2
            id="skyline-celebration-title"
            className="font-editorial text-2xl md:text-[28px] text-[#0C1B33] mb-1.5"
          >
            You made it to the top.
          </h2>
          <p className="text-[14px] text-[#0C1B33]/55 mb-5">All twelve lessons, done.</p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-full border border-[#0C1B33]/25 px-5 py-2 font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/70 hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

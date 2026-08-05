import MapShell from "@/components/map/MapShell";
import IncentiveGlance from "@/components/map/IncentiveGlance";

export default function MapPage() {
  return (
    <div className="min-h-screen">
      {/* Page Header — soft blue. Hidden on mobile so the map lands full-screen
          directly under the nav (controls stay pinned during use). */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden hidden md:block">
        <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/chicago-map-hero.png')" }} />
        <div className="absolute inset-0 bg-[#0C1B33]/80" />
        <div className="relative z-10 container mx-auto max-w-6xl px-4 md:px-6 py-6 md:py-16">
          <div className="flex items-center gap-4 mb-3 md:mb-6">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Spatial
            </span>
          </div>
          <h1 className="font-editorial text-2xl md:text-5xl text-white mb-2 md:mb-4">
            Chicago Site Incentive Map
          </h1>
          <p className="text-white/50 text-sm md:text-base max-w-xl">
            Search any address to find location-linked incentive programs, then explore zones, assets, permits, and neighborhood data across Chicago.
          </p>
        </div>
      </div>

      {/* Warm off-white body */}
      <div className="px-0 md:px-6 py-0 md:py-10 bg-[#FAF9F6]">
        {/* Secondary heading — desktop only; mobile goes straight to a map-first view */}
        <div className="max-w-6xl mx-auto hidden md:block">
          <div className="flex items-center gap-4 mb-6">
            <div className="accent-bar" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40">
              Interactive Explorer
            </span>
          </div>
          <h2 className="font-editorial text-2xl md:text-3xl text-[#0C1B33]/90 mb-6">
            Chicago Incentive Zones
          </h2>
        </div>

        <div className="border-y md:border border-[#0C1B33]/10 overflow-hidden">
          <MapShell />
        </div>

        <div className="max-w-6xl mx-auto px-3 md:px-0 pt-6 md:pt-0 pb-6 md:pb-0">
        <IncentiveGlance />

        <div className="mt-6 grid md:grid-cols-3 gap-0 border border-[#0C1B33]/10 bg-white">
          {[
            {
              num: "01",
              title: "Toggle Layers",
              desc: "Use the legend to show or hide incentive zones, transit stops, schools, parks, and other community assets.",
            },
            {
              num: "02",
              title: "Click & Right-Click",
              desc: "Click any zone or point of interest for details. Right-click anywhere for the Chicago zoning classification.",
            },
            {
              num: "03",
              title: "Zone Overlaps",
              desc: "Areas where multiple zones overlap may offer stronger incentive stacking potential for businesses.",
            },
          ].map((item, i) => (
            <div
              key={i}
              className={`p-6 ${i < 2 ? "md:border-r border-[#0C1B33]/10" : ""} ${i > 0 ? "border-t md:border-t-0 border-[#0C1B33]/10" : ""}`}
            >
              <div className="font-mono-bureau text-[10px] tracking-[0.3em] text-[#2563EB]/40 mb-3">
                {item.num}
              </div>
              <h3 className="text-sm text-[#0C1B33]/80 mb-2">{item.title}</h3>
              <p className="text-sm text-[#0C1B33]/50 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <div className="min-h-screen">
      {/* Page Header — soft blue */}
      <div className="relative border-b border-[#0C1B33]/10 overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/chicago-map-hero.png')" }} />
        <div className="absolute inset-0 bg-[#0C1B33]/80" />
        <div className="relative z-10 container mx-auto max-w-6xl px-6 py-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="accent-bar-light" />
            <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-white/40">
              Spatial
            </span>
          </div>
          <h1 className="font-editorial text-4xl md:text-5xl text-white mb-4">
            Chicago Incentive Map
          </h1>
          <p className="text-white/50 text-base max-w-xl">
            Interactive map of Chicago businesses and incentive zone boundaries.
          </p>
        </div>
      </div>

      {/* Warm off-white body */}
      <div className="container mx-auto max-w-6xl px-6 py-10 bg-[#FAF9F6]">
        <div className="border border-[#0C1B33]/10 overflow-hidden">
          <iframe
            src="https://www.google.com/maps/d/embed?mid=1rUGMDOPqBmPmaZe2-fnyfIlfiMPG7XA&ehbc=2E312F&noprof=1"
            width="100%"
            height="600"
            style={{ border: 0, minHeight: "400px" }}
            allowFullScreen
            loading="lazy"
            title="Chicago Incentive Zones Map"
          />
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-0 border border-[#0C1B33]/10 bg-white">
          {[
            {
              num: "01",
              title: "Map Layers",
              desc: "Toggle layers in the map to see different incentive zones, business locations, and corridor boundaries.",
            },
            {
              num: "02",
              title: "Click a Business",
              desc: "Click any business pin to see its name, address, category, and which incentive zones it falls within.",
            },
            {
              num: "03",
              title: "Zone Overlaps",
              desc: "Areas where multiple zones overlap represent the highest incentive stacking potential for businesses.",
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
  );
}

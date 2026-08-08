import { PreQualSurvey } from "@/components/survey/PreQualSurvey";

export const metadata = {
  title: "Program Fit Questions | Chicago Site Incentive Map",
  description:
    "Answer four questions to identify Chicago business incentive programs worth reviewing.",
};

export default function QualifyPage() {
  return (
    <div className="bg-[#FAF9F6] min-h-screen">
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-2xl">
          {/* Page header */}
          <div className="text-center mb-14">
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="accent-bar" />
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
                Program Fit Questions
              </span>
              <div className="accent-bar" />
            </div>
            <h1 className="font-editorial text-3xl sm:text-4xl md:text-5xl text-[#0C1B33] mb-4">
              Find Programs to Review
            </h1>
            <p className="font-mono-bureau text-[11px] text-[#0C1B33]/40 uppercase tracking-[0.1em] max-w-md mx-auto">
              Four questions to organize useful starting points for your project
            </p>
          </div>

          {/* Survey */}
          <PreQualSurvey />
        </div>
      </section>
    </div>
  );
}

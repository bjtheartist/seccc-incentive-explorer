export const metadata = {
  title: "Learn Zoning and Permits | Chicago Incentive Explorer",
  description:
    "Twelve plain-language lessons on Chicago zoning, approvals, building permits, and business licensing.",
};

export default function LearnPage() {
  return (
    <main className="h-[100dvh] w-full overflow-hidden bg-[#ECEEF1]">
      <iframe
        src="/learning/tier-one-lessons.html"
        title="Chicago zoning and permit lessons"
        className="h-full w-full border-0"
      />
    </main>
  );
}

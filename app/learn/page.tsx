export const metadata = {
  title: "Chicago Zoning & Permit Essentials | Chicago Incentive Explorer",
  description:
    "Twelve plain-language lessons on Chicago zoning, approvals, building permits, and business licensing.",
};

export default function LearnPage() {
  return (
    <main className="h-[calc(100dvh-3.5rem)] min-h-[640px] w-full overflow-hidden bg-[#F7F8FA]">
      <iframe
        src="/learning/tier-one-lessons.html"
        title="Chicago zoning and permit lessons"
        className="h-full w-full border-0"
      />
    </main>
  );
}

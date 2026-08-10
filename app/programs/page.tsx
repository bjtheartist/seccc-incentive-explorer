import ProgramsCatalog from "@/components/programs/ProgramsCatalog";

export const dynamic = "force-dynamic";

export default function ProgramsPage() {
  return <ProgramsCatalog initialNowIso={new Date().toISOString()} />;
}

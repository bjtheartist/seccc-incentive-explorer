export interface Business {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lon: number | null;
  phone: string;
  website: string;
  category: string;
  incentiveCount: number;
  zones: Record<string, boolean | string>;
}

export interface Program {
  id: string;
  name: string;
  level: "Federal" | "State" | "County" | "City";
  zoneKey: string;
  summary: string;
  whoQualifies: string;
  benefits: string[];
  howToApply: string[];
  requiredDocs: string[];
  contact: string;
  url: string;
}

export interface ZoneCoverage {
  count: number;
  pct: number;
  label: string;
}

export interface Stats {
  totalBusinesses: number;
  totalCategories: number;
  zipCodes: string[];
  diversityIndex: number;
  zoneCoverage: Record<string, ZoneCoverage>;
  stackingDistribution: Record<string, number>;
  sbif: {
    localProjects: number;
    citywideProjects: number;
    localShare: number;
  };
  corridors: Record<string, string>;
}

export interface LookupResult {
  matched: boolean;
  business?: Business;
  address: string;
  lat: number;
  lon: number;
  zones: Record<string, boolean>;
  incentiveCount: number;
}

/* ── Pre-Qualification Survey ── */

export interface SurveyQuestion {
  id: string;
  step: number;
  title: string;
  subtitle: string;
  type: "single" | "multi";
  options: { id: string; label: string }[];
}

export interface SurveyAnswers {
  industry?: string;
  property?: string;
  activities?: string[];
  size?: string;
}

export interface ProgramMatch {
  programId: string;
  program: { name: string; short: string };
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export interface SurveyResult {
  matches: ProgramMatch[];
  total: number;
  totalPrograms: number;
}

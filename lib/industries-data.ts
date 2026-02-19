// ─── Industry / Sector Definitions ──────────────────────────────────
// Maps industries to the incentive programs they commonly qualify for.

export interface Industry {
  id: string;
  name: string;
  icon: string;
  description: string;
  topPrograms: string[]; // program IDs from survey-engine PROGRAMS
  keywords: string[];
}

export const INDUSTRIES: Industry[] = [
  {
    id: "ev",
    name: "EV / Clean Energy",
    icon: "⚡",
    description:
      "Electric vehicle manufacturing, battery production, renewable energy, and clean energy supply chain.",
    topPrograms: ["rev", "edge", "enterprise", "federalOZ", "illinoisOZ"],
    keywords: ["ev", "electric vehicle", "battery", "solar", "wind", "renewable", "clean energy"],
  },
  {
    id: "semiconductor",
    name: "Semiconductor",
    icon: "🔬",
    description:
      "Microchip manufacturing, packaging, testing, and semiconductor supply chain operations.",
    topPrograms: ["micro", "edge", "enterprise", "federalOZ"],
    keywords: ["semiconductor", "microchip", "chip", "wafer", "electronics"],
  },
  {
    id: "dataCenter",
    name: "Data Center / Cloud",
    icon: "🖥️",
    description:
      "Data center operations, cloud infrastructure, and technology hosting facilities.",
    topPrograms: ["dataCenter", "enterprise", "edge", "federalOZ"],
    keywords: ["data center", "cloud", "hosting", "server", "colocation"],
  },
  {
    id: "manufacturing",
    name: "Manufacturing",
    icon: "🏭",
    description:
      "General manufacturing, industrial production, food processing, and fabrication.",
    topPrograms: ["edge", "enterprise", "rev", "micro", "tif", "catalystGrant"],
    keywords: ["manufacturing", "factory", "production", "industrial", "fabrication"],
  },
  {
    id: "retail",
    name: "Retail / Restaurant / Service",
    icon: "🏪",
    description:
      "Storefront retail, restaurants, personal services, and consumer-facing businesses.",
    topPrograms: ["sbif", "tif", "ssa", "catalystGrant", "smallBizSource"],
    keywords: ["retail", "restaurant", "store", "shop", "food", "service", "salon"],
  },
  {
    id: "professional",
    name: "Professional Services",
    icon: "💼",
    description:
      "Legal, accounting, consulting, finance, and other office-based professional firms.",
    topPrograms: ["tif", "federalOZ", "illinoisOZ", "smallBizSource", "ssa"],
    keywords: ["professional", "consulting", "legal", "accounting", "finance", "office"],
  },
  {
    id: "construction",
    name: "Construction / Trades",
    icon: "🔨",
    description:
      "General contracting, specialty trades, plumbing, electrical, and building services.",
    topPrograms: ["enterprise", "sbif", "cpace", "tif", "catalystGrant"],
    keywords: ["construction", "contractor", "plumbing", "electrical", "trades", "building"],
  },
  {
    id: "healthcare",
    name: "Healthcare / Wellness",
    icon: "🏥",
    description:
      "Medical offices, clinics, pharmacies, wellness centers, and health services.",
    topPrograms: ["tif", "sbif", "catalystGrant", "ssa", "smallBizSource"],
    keywords: ["healthcare", "medical", "clinic", "pharmacy", "wellness", "dental", "therapy"],
  },
  {
    id: "tech",
    name: "Tech / Software",
    icon: "💻",
    description:
      "Software development, IT services, SaaS, and technology startups.",
    topPrograms: ["dataCenter", "federalOZ", "illinoisOZ", "edge", "smallBizSource"],
    keywords: ["tech", "software", "IT", "startup", "SaaS", "app", "developer"],
  },
  {
    id: "nonprofit",
    name: "Nonprofit",
    icon: "🤝",
    description:
      "Charitable organizations, community groups, and mission-driven entities.",
    topPrograms: ["cpace", "tif", "ssa", "smallBizSource"],
    keywords: ["nonprofit", "charity", "community", "ngo", "foundation"],
  },
  {
    id: "realEstate",
    name: "Real Estate / Development",
    icon: "🏗️",
    description:
      "Commercial and residential development, property investment, and rehab projects.",
    topPrograms: ["federalOZ", "illinoisOZ", "class7a", "landBank", "tif", "cpace"],
    keywords: ["real estate", "development", "property", "investment", "rehab"],
  },
  {
    id: "food",
    name: "Food & Beverage Production",
    icon: "🍽️",
    description:
      "Food manufacturing, breweries, bakeries, and beverage production facilities.",
    topPrograms: ["enterprise", "edge", "catalystGrant", "tif", "sbif"],
    keywords: ["food production", "brewery", "bakery", "beverage", "catering"],
  },
  {
    id: "logistics",
    name: "Transportation & Logistics",
    icon: "🚛",
    description:
      "Freight, warehousing, distribution, and supply chain logistics operations.",
    topPrograms: ["enterprise", "edge", "highUnemployment", "tif", "catalystGrant"],
    keywords: ["transportation", "logistics", "warehouse", "freight", "distribution"],
  },
  {
    id: "arts",
    name: "Arts & Entertainment",
    icon: "🎭",
    description:
      "Galleries, performance venues, creative studios, and entertainment businesses.",
    topPrograms: ["tif", "ssa", "sbif", "smallBizSource"],
    keywords: ["arts", "entertainment", "gallery", "studio", "music", "theater"],
  },
];

// Helper: get an industry by ID
export function getIndustryById(id: string): Industry | undefined {
  return INDUSTRIES.find((ind) => ind.id === id);
}

// Helper: get all industries that list a given program
export function getIndustriesForProgram(programId: string): Industry[] {
  return INDUSTRIES.filter((ind) => ind.topPrograms.includes(programId));
}

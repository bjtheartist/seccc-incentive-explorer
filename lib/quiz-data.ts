import type { ProgramLevel } from "./types";
import { QUIZ_QUESTIONS_EXTENSION } from "./quiz-bank-extension";

export interface QuizQuestion {
  id: number;
  topic: ProgramLevel;
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

export interface QuizPersona {
  id: string;
  name: string;
  emoji: string;
  minScore: number;
  maxScore: number;
  blurb: string;
  nextStep: string;
}

const QUIZ_QUESTIONS_BASE: QuizQuestion[] = [
  {
    id: 1,
    topic: "City",
    question: "What does SBIF stand for?",
    choices: [
      "Small Business Incentive Fund",
      "Small Business Improvement Fund",
      "South-side Business Incubator Fund",
      "Standard Building Investment Fund",
    ],
    correctIndex: 1,
    explanation:
      "SBIF — the Small Business Improvement Fund — uses TIF dollars to reimburse up to 90% of permanent building improvements (HVAC, roofing, electrical, fire suppression). Up to $75K for multi-tenant, $150K commercial, $250K industrial.",
  },
  {
    id: 2,
    topic: "Federal",
    question: "Federal Opportunity Zones were originally created by which law?",
    choices: [
      "The 2009 American Recovery and Reinvestment Act",
      "The 2017 Tax Cuts and Jobs Act",
      "The 2021 American Rescue Plan",
      "The 2025 One Big Beautiful Bill Act",
    ],
    correctIndex: 1,
    explanation:
      "OZs were created by the 2017 TCJA. In July 2025, the One Big Beautiful Bill Act made the program permanent on a 10-year designation cycle. OZ 1.0 tracts stay valid through 12/31/2028; OZ 2.0 tracts take effect 1/1/2027.",
  },
  {
    id: 3,
    topic: "State",
    question: "DCEO is short for…",
    choices: [
      "Department of Construction and Economic Operations",
      "Division of Capital and Economic Outreach",
      "Department of Commerce and Economic Opportunity",
      "Department of Cities, Economy, and Operations",
    ],
    correctIndex: 2,
    explanation:
      "The Illinois Department of Commerce and Economic Opportunity administers EDGE, REV, MICRO, the Data Center credit, Enterprise Zone certification, and much more. Most state-level incentives start here.",
  },
  {
    id: 4,
    topic: "County",
    question: "Cook County's Class 6b incentive applies primarily to what kind of property?",
    choices: [
      "Affordable housing",
      "Industrial property",
      "Landmark rehabilitation",
      "Cannabis retail",
    ],
    correctIndex: 1,
    explanation:
      "Class 6b reduces the assessed value of qualifying industrial property from 25% to 10% for 10 years. It's the workhorse incentive for manufacturing reinvestment in Cook County.",
  },
  {
    id: 5,
    topic: "City",
    question:
      "Who administers the Neighborhood Opportunity Fund (NOF) and its application portal?",
    choices: [
      "Cook County Land Bank Authority",
      "Southeast Chicago Chamber of Commerce",
      "Chicago Department of Planning and Development (DPD)",
      "U.S. Small Business Administration",
    ],
    correctIndex: 2,
    explanation:
      "DPD runs NOF, funded by downtown development fees. Awards are up to $250K @ 75% reimbursement plus a $50K technical-assistance bonus. Applications go through cocdpd.submittable.com.",
  },
  {
    id: 6,
    topic: "Federal",
    question:
      "As of 2026, is the federal Work Opportunity Tax Credit (WOTC) still authorized?",
    choices: [
      "Yes, made permanent in 2025",
      "Yes, but reduced to $3,000 max",
      "No — authority lapsed 12/31/2025",
      "Only for hiring veterans",
    ],
    correctIndex: 2,
    explanation:
      "WOTC authority expired 12/31/2025 and is awaiting Congressional reauthorization. Employers should continue Form 8850 pre-screening to preserve retroactive eligibility if it gets reinstated.",
  },
  {
    id: 7,
    topic: "State",
    question: "What does a Building Materials Exemption Certificate (BMEC) do?",
    choices: [
      "Caps property taxes on new construction",
      "Exempts qualified building materials from state sales tax",
      "Certifies historic preservation work",
      "Pre-approves zoning variances",
    ],
    correctIndex: 1,
    explanation:
      "BMEC, issued by the Illinois Department of Revenue, exempts building materials from sales tax when used in projects certified under Enterprise Zone, REV, MICRO, HIB, AIM, or Quantum EZ programs. The project must be certified first by DCEO or a zone administrator.",
  },
  {
    id: 8,
    topic: "City",
    question: "Roughly how many active TIF districts does Chicago have in 2026?",
    choices: ["24", "60", "124", "300"],
    correctIndex: 2,
    explanation:
      "Chicago has about 124 active TIF districts (Civic Federation, 2025). 9 expired 12/31/2025 and 13 more sunset 12/31/2026 — the map evolves.",
  },
  {
    id: 9,
    topic: "County",
    question:
      "Cook County's Class 8 property tax incentive is restricted to which five townships?",
    choices: [
      "Cicero, Berwyn, Oak Park, Forest Park, Maywood",
      "Bloom, Bremen, Calumet, Rich, Thornton",
      "Evanston, Skokie, Niles, Lincolnwood, Morton Grove",
      "Chicago, Lemont, Lyons, Riverside, Stickney",
    ],
    correctIndex: 1,
    explanation:
      "Class 8 reserves the same 10% assessment benefit as Class 6b/7b but limits it to five south-suburban townships — Bloom, Bremen, Calumet, Rich, and Thornton — recognizing structural disinvestment in that region.",
  },
  {
    id: 10,
    topic: "Utility",
    question:
      "What is the maximum 2026 ComEd EV charger rebate per port for commercial sites?",
    choices: ["$500", "$2,500", "$5,000", "$8,000"],
    correctIndex: 3,
    explanation:
      "Up to $8,000 per port through ComEd's EV Make-Ready program. It stacks with the federal §30C alternative-fuel-vehicle refueling property credit, so check both before installing.",
  },
];

/** Full 100-question bank — base 10 + 90 from extension file. */
export const QUIZ_QUESTIONS: QuizQuestion[] = [
  ...QUIZ_QUESTIONS_BASE,
  ...QUIZ_QUESTIONS_EXTENSION,
];

export const QUIZ_PERSONAS: QuizPersona[] = [
  {
    id: "early-explorer",
    name: "Early Explorer",
    emoji: "🌱",
    minScore: 0,
    maxScore: 2,
    blurb:
      "Day-one energy. Most Chicagoans never get past the headlines on these programs — but you took the quiz, so you're already ahead of the curve. Bookmark this site, come back in a month, and try again.",
    nextStep:
      "Start with the Federal level on /programs — the biggest, most-talked-about programs live there and they're a good gateway into the rest.",
  },
  {
    id: "informed-citizen",
    name: "Informed Citizen",
    emoji: "🗺️",
    minScore: 3,
    maxScore: 4,
    blurb:
      "You've heard of TIF. You've maybe seen an SBIF sign in a storefront window. You know there's a system here — you're just learning the shape of it. Keep digging.",
    nextStep:
      "Open the /map and click around a few neighborhoods. Seeing how zones overlap on the same block is where a lot of this finally clicks.",
  },
  {
    id: "educated-operator",
    name: "Educated Operator",
    emoji: "🔧",
    minScore: 5,
    maxScore: 6,
    blurb:
      "You know enough to ask the right questions. The next deal or grant you walk into, you'll spot the incentive stack before anyone else in the room.",
    nextStep:
      "Read the verification steps on Enterprise Zone, REV, or MICRO programs — that's where most operators leave money on the table.",
  },
  {
    id: "corridor-captain",
    name: "Corridor Captain",
    emoji: "🏛️",
    minScore: 7,
    maxScore: 8,
    blurb:
      "Solid civic muscle. You can name three+ incentive programs without Googling, you know DPD isn't DCD anymore, and you probably know what BMEC does. Your block club or chamber should be calling you.",
    nextStep:
      "Filter /programs by County. There are 17 entries there — Class 6b, 7b, 7c, 8, AHSAP, C-PACE, CCLBA — and most folks don't even know that level exists.",
  },
  {
    id: "policy-wonk",
    name: "Policy Wonk",
    emoji: "📚",
    minScore: 9,
    maxScore: 10,
    blurb:
      "You probably finish city budget reports for fun. You know which year TIF was created, what 6b SER means, and you can pronounce CCLBA. We're not going to teach you anything — but tell your friends?",
    nextStep:
      "If you spotted a stale field, a 404 link, or a missing program while taking the quiz, tell us. The Explorer is community-audited.",
  },
];

export function getPersonaForScore(score: number): QuizPersona {
  const clamped = Math.max(0, Math.min(QUIZ_QUESTIONS.length, score));
  return (
    QUIZ_PERSONAS.find((p) => clamped >= p.minScore && clamped <= p.maxScore) ??
    QUIZ_PERSONAS[0]
  );
}

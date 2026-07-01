# Chicago Incentive Explorer — Growth Playbook

*Canonical, versioned playbook. Consolidates and supersedes the working docs on
Desktop (`CIE-Product-Roadmap/01_mobile_and_data_roadmap.md`,
`02_growth_strategies_research.md`, `03_demand_validation.md`) and operationalizes
the Linear growth tree ([BJT-100] free web traffic foundation, [BJT-109]
activation experiments). Last audited: 2026-07-01.*

---

## 1. North star & posture

**Product:** a free location snapshot — enter a Chicago address, see every
overlapping incentive zone/program plus local support partners, from public data.

**Metric:** useful next steps, not traffic. A visit counts when someone runs a
snapshot, saves/emails/downloads it, or identifies a local support partner.

**Posture:** *ship, measure, learn.* We do not wait for proof to move; we move
while instrumenting well enough to learn honestly. Guardrails:
- No % deltas reported below **100 sessions / 30 report events** per period.
- Qualitative signal (task tests, live-user feedback) is the primary gate at
  current traffic; quantitative funnels are directional until volume grows.
- Never overclaim: support-resource clicks are a leading indicator, not
  "funding won." Demo reports prove comprehension, not impact.
- Product boundary: discovery + navigation, never compliance.

## 2. The engine

```
CHANNELS                    SURFACES                       ACTION            MISSION
institutional (LISC, ————→  /start (QR/partner)  ————┐
chambers, CDCs)             homepage (Civic Dossier)  │
earned media (Block Club) → /programs/[slug] ×63      ├→ location  ————→  local support
program-name SEO   ————→    /neighborhoods/[..] ×77   │   snapshot          partner contact
directories/embeds ————→    /answers/[slug] ×26       │  (report page       (chambers, BSOs,
AEO / AI answers   ————→    Chrome extension /lookup ─┘   + PDF/email)       SBDCs, CDFIs)
```

Every surface routes to one action: **Generate Free Location Snapshot.**
Every snapshot surfaces the human layer: **local support partners.**

## 3. Channels — ranked by verified evidence

Evidence grades come from the adversarially-verified research (Desktop doc 02)
and live demand validation (doc 03).

| # | Channel | Evidence | Status | Next action |
|---|---------|----------|--------|-------------|
| 1 | **Institutional distribution** (LISC network, chambers, CDCs, SBDCs, aldermanic) | HIGH — direct precedent: CrimeAround.us grew via LISC Chicago + Knight grant | LISC meeting done (intros ask placed); One Chicago for All Alliance talk 6/10 | **Capture OCFA outcomes**; chase the 3–5 corridor-org intros (30-day window has elapsed — follow up); put /start QR in every deck |
| 2 | **Earned media** (Block Club first; TRiiBE, WBEZ, Crain's) | HIGH — Block Club features tiny civic tools ~1mo post-launch; verified equity hook (NOF reimbursement barrier) | **Pitch drafted, never sent** | Send the Block Club pitch (Newsroom@BlockClubChi.org / 312-860-0020) with the NOF-reimbursement equity angle |
| 3 | **Program-name SEO** | HIGH mechanism + demand VALIDATED for ~10 programs (SBIF, TIF, NOF, SSA, MMRP, Enterprise/Opportunity Zone, "chicago small business grants") | 63 pages live; retitles in PR #23 | Merge PR stack; submit sitemap to GSC + Bing; optimize `/programs` index for "chicago small business grants" |
| 4 | **Partner embeds** ("powered by" widget) | HIGH mechanism (BallotReady precedent) | Not built | Build `/embed` after first partner asks; pairs with channel 1 |
| 5 | **Directories** (Civic Tech Field Guide, Nextdoor, Google Business Profile) | HIGH but low-volume baseline | **Never submitted** | 30-minute pass: submit all three |
| 6 | **Content/AEO** (answer pages, AI citation) | MEDIUM — question queries flat in autocomplete; judged by AI-Overview/snippet capture, not volume | 26 pages live | Add demand-validated **minority-owned + woman-owned grant pages** (validated, unbuilt); measure via GSC impressions + AI citations |

**Demand rules (from validation, 2026-06-22):**
- People search **bare program names**, not "[program] chicago" templates.
- "[neighborhood] business grants" is dead across 18 neighborhoods + 4 rollups →
  **neighborhood-page expansion stays FROZEN** until GSC shows impressions.
  The 77 built pages stay as internal-link plumbing + address-first UX.
- The one live geo pattern is "[neighborhood] chamber of commerce" → chamber-hub
  pivot is the sanctioned geo play, gated on GSC.

## 4. State of the machine (2026-07-01)

**Merged & live-ready:** SEO foundation (robots/sitemap/JSON-LD/canonicals),
address-first homepage v1, 63+77+26 programmatic pages, context engine
(canonical `LocationContext` with provenance labels), mobile map work.

**Built, verified, awaiting merge — the current bottleneck:**

| PR | What | Why it matters |
|----|------|----------------|
| #22 | Funnel analytics (`search_performed`, `location_snapshot_generated`, landing-page attribution) | Nothing is measurable until this lands — merge FIRST |
| #23 | Program-page retitles to searched phrasings | The validated-demand SEO win |
| #24 | `/start` focused landing page | QR/partner/LinkedIn distribution surface |
| #27 | Cheat-sheet true one-pager | The leave-behind artifact |
| #28 | Homepage growth redesign (Civic Dossier: demo chips, ticker, specimen, SEO hub) | Conversion surface + internal link equity |

**Environment:** `RESEND_API_KEY` restored to Vercel prod+preview (2026-07-01) —
email-report revives on next deploy. `NEXT_PUBLIC_SITE_URL` set.

## 5. Audit findings (what was stale, contradictory, or missing)

Audited the three Desktop docs + Linear tree against reality:

**Stale (fixed by this doc):**
- Doc 01's mobile Track A listed address-first + shareable-report as open;
  address-first homepage is shipped (v1 merged, v2 in PR #28). Still genuinely
  open from Track A: **OG-image share cards, PWA install, Spanish, lite mode**.
- Doc 02's "start here this week" (institutional) executed — but its cheap
  baseline actions (directories, Block Club pitch) were **never executed**.
- Doc 03's retitle recommendation shipped (PR #23); its "build minority/woman-
  owned pages" recommendation was **not built** despite validated demand.

**Contradiction (resolved):** Doc 01 implies scaling geo/data pages; doc 03
froze neighborhood expansion. Resolution encoded in §3: frozen pending GSC;
chamber-hub is the only sanctioned geo play.

**Top gaps (now the Now-column backlog):**
1. Five verified PRs unmerged → merge stack, deploy.
2. Sitemap never submitted to GSC/Bing → blind on indexation/impressions.
3. Block Club pitch unsent; directories unsubmitted.
4. Minority/woman-owned grant pages unbuilt (validated demand).
5. Report experience too dense — streamline page + PDF around a verdict-first
   summary and elevated support partners (BJT-109 exp #2 vehicle).
6. LISC follow-up loop open (intros + Jaime/QLP + Wesley session).

## 6. Weekly operating cadence

- **Mon (30 min):** GSC scan — indexation, new impressions by page family;
  note any first-organic-click events. Funnel counts (searches, snapshots,
  partner clicks) by landing page + source.
- **Tue/live events:** every presentation/meeting uses `/start?source=qr&c=<event>`;
  ask two feedback questions after ("what was unclear?" / "what would make this
  usable without me?").
- **Wed (1 hr):** one distribution rep — a partner follow-up, a directory,
  a pitch, or a LinkedIn post pointing at /start or a program page.
- **Fri (30 min):** ship-log — what merged, what's measured, one decision.
- **Quarterly:** program-data audit (already practiced); refresh KP/autocomplete
  demand check; revisit frozen bets against GSC data.

## 7. Measurement & decision rules

**Funnels (all segmented by `landing_page` + `source` once PR #22 merges):**
- Acquisition→report: sessions → `search_performed` → `location_snapshot_generated`
- Report→activation: snapshot → save/email/download
- Report→mission: snapshot → `support_resource_clicked` (baseline 0 — first
  click is a milestone)

**Decision rules:**
- *Indexation gate (day ~30 post-deploy):* <70% of programmatic pages indexed →
  treat as thin-content signal; fix pages (more data, internal links), don't wait.
- *Neighborhood unfreeze:* only if Tier-C GSC impressions or KP volumes show
  real demand; otherwise consider chamber-hub pivot with 5 pilot pages.
- *Experiment shipping (BJT-109):* qualitative gate (4/5 task-test users) AND
  one supporting signal (mission events up, or funnel-shape improvement at the
  targeted step).
- *Channel reallocation:* if organic-sourced snapshots stay < 40/mo at day 90
  despite decent indexation, shift build time from pages to institutional
  distribution (the highest-evidence channel).

## 8. Backlog

**NOW (this week):**
- Merge PR stack (#22 → #23 → #24 → #27 → #28; two one-line
  `demo_address_clicked` dedupes), deploy, verify Resend live.
- Submit sitemap to Google Search Console + Bing Webmaster.
- Send Block Club pitch; submit Civic Tech Field Guide + Nextdoor + GBP.
- **Report streamline (page + PDF)** — verdict-first, partners elevated,
  progressive disclosure. (In flight with this doc.)
- LISC follow-ups: OCFA outcome capture, intro chase, Jaime 1:1, Wesley session.

**NEXT (2–4 weeks):**
- Minority-owned + woman-owned business grant pages (validated demand).
- `/programs` index title/H1 for "chicago small business grants".
- OG share-card images for report/program/neighborhood links (texted links
  should look rich — this audience shares by text).
- First KP pass (5 min, seed list in doc 03) to put numbers on the tiers.
- 5-user task test (BJT-109 exp #1) recruited from live-event feedback.

**LATER (gated):**
- Chamber-hub geo pages (gated on GSC/KP).
- Partner `/embed` widget (gated on first partner demand).
- PWA + Spanish + lite mode (doc 01 Track A remainder).
- CoStar/Morningstar data ladder (doc 01 Track B) and the corridor resilience
  score — via the context engine.
- Protected `/api/location-context` for partners/agents (BJT-121 design doc).

## 9. Pointers

- Research evidence: `~/Desktop/CIE-Product-Roadmap/02_growth_strategies_research.md`
- Demand validation + KP seed lists: `~/Desktop/CIE-Product-Roadmap/03_demand_validation.md`
- Mobile/data roadmap: `~/Desktop/CIE-Product-Roadmap/01_mobile_and_data_roadmap.md`
- Linear: BJT-100 (foundation, sub-issues BJT-101–108, 116, 123),
  BJT-109 (activation experiments), Context Engine project (BJT-117–121).
- Demo funnel attribution vocabulary: `source` ∈ `address_search`, `seo_cta`,
  `homepage_demo`, `start`, `qr`, `chrome-extension`; `landing_page` = pathname.

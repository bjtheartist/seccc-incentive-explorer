# Plan: Add Industries/Sectors + Sample Search Prompts

## Overview
Two features: (1) an industries/sectors reference that shows which industries qualify for which incentive programs, and (2) sample search prompts (placeholder suggestions) in the search bar so users know what to type.

---

## Feature 1: Industries/Sectors Data & Display

### 1a. Create industry-to-incentive mapping data (`lib/industries-data.ts`)

Define a structured list of industries/sectors with metadata about which incentive programs each qualifies for. Based on the existing survey engine rules and program data, the industries are:

| Industry | Key Programs | Notes |
|----------|-------------|-------|
| **EV / Clean Energy** | REV Illinois, EDGE, Enterprise Zone | REV is specifically for EV supply chain |
| **Semiconductor / Microelectronics** | MICRO, EDGE, Enterprise Zone | MICRO targets chip manufacturing |
| **Data Center / Cloud** | Data Center Tax Incentive, Enterprise Zone | Sales tax exemptions on equipment |
| **Manufacturing** | EDGE, REV, MICRO, Enterprise Zone, TIF | Broad eligibility across state programs |
| **Retail / Restaurant / Service** | SBIF, TIF, SSA, Catalyst Grant | Building improvements, facade grants |
| **Professional Services** | TIF, Federal/IL OZ, Small Biz Source | Location-based benefits |
| **Construction / Trades** | Enterprise Zone, SBIF, C-PACE | Sales tax exemptions on materials |
| **Healthcare / Wellness** | TIF, SBIF, Catalyst Grant, SSA | Building/equipment incentives |
| **Tech / Software** | Data Center, Federal/IL OZ, EDGE | OZ for capital investment |
| **Nonprofit** | C-PACE, TIF, SSA | Energy + building programs |
| **Real Estate / Development** | Federal/IL OZ, Class 7a, Land Bank, TIF | Property-focused incentives |
| **Food & Beverage Production** | Enterprise Zone, EDGE, Catalyst Grant | Manufacturing-adjacent |
| **Transportation & Logistics** | Enterprise Zone, EDGE, High Unemployment | Hiring + equipment credits |
| **Arts & Entertainment** | TIF, SSA, SBIF, Small Biz Source | Community/storefront programs |

Each industry entry will include:
- `id`, `name`, `icon` (emoji or Lucide icon name)
- `description` (1-sentence sector summary)
- `topPrograms[]` — array of program IDs ranked by relevance
- `keywords[]` — search terms that map to this industry (used for search matching)

### 1b. Add an Industries section to the home page (`app/page.tsx`)

Add a new section below the Coverage Highlights showing industry cards. Each card shows the industry name, icon, and a count of qualifying programs. Clicking a card navigates to `/programs` filtered by that industry, OR scrolls/links to a detail view.

### 1c. Add industry filter to the Programs page (`app/programs/page.tsx`)

Add an industry dropdown or pill filter alongside the existing government-level tabs (Federal/State/County/City). When an industry is selected, only programs relevant to that industry are shown.

---

## Feature 2: Sample Search Prompts in Search Bar

### 2a. Add prompt suggestions to `AddressSearch.tsx`

Add a row of clickable sample search prompts below the search input that appear when the input is empty and no results are showing. These act as quick-start examples.

**Sample prompts (4-5 rotating/static suggestions):**
- `"7201 S Stony Island Ave"` — a real address in the SSA #50 area
- `"Ain't She Sweet Cafe"` — a known business in the dataset
- `"8701 S Baltimore Ave"` — another real address in the coverage area
- `"South Shore businesses"` — shows fuzzy name search
- `"Pharmacies near 60649"` — demonstrates category-based searching

Implementation:
- Show as small pill-style buttons below the search bar: `"Try: 7201 S Stony Island Ave"`
- Clicking a prompt fills the search input and triggers the lookup
- Prompts disappear once a query is entered or results are displayed
- Animate in with a slight delay after the search bar appears

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `lib/industries-data.ts` | **Create** | Industry-to-incentive mapping data |
| `components/lookup/AddressSearch.tsx` | **Edit** | Add sample prompt pills below search input |
| `app/page.tsx` | **Edit** | Add Industries section below Coverage |
| `app/programs/page.tsx` | **Edit** | Add industry filter alongside level tabs |

## Implementation Order
1. Create `lib/industries-data.ts` with industry definitions
2. Add sample search prompts to `AddressSearch.tsx`
3. Add Industries section to home page
4. Add industry filter to Programs page
5. Test and verify everything works together

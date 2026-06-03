# Curated anchor businesses (`neighborhood_anchors_by_community_area.json`)

This file lets the Neighborhood Economic Context report **name real anchor
businesses** (employers, institutions, corridors, hospitals, universities) for a
location. It is **human-curated and source-cited** — the app never generates
business names from an LLM or any unverified source. Where a community area has
no entry, the report simply omits the "Anchor Businesses" row.

## Source of truth → repo

The source of truth is the curated **Chicago Local Impact Anchor** workbook
(`.xlsx`, "Master Anchor Detail" sheet). Import it into the repo with:

```bash
npm run anchors:import -- --input="/path/to/chicago_local_impact_anchor_master.xlsx"
```

This re-keys the workbook by **community-area number (1–77)** and strips it to
the fields the public report shows. Re-run whenever a new batch workbook is
produced. The importer reads only aggregate/anchor-level fields — no owner,
contact, or mailing-address rows are introduced.

## How it reaches a report

1. The report resolves the address's **community area** from its lat/lon via
   `/api/neighborhood-anchors` (point-in-polygon against
   `public/data/community-areas.geojson`).
2. That endpoint returns the top anchors for the area, ranked by **Total Score**.
3. The report merges them into the Neighborhood Economic Context section as named
   anchors + multiplier drivers.

## Scoring (6 dimensions, 100 pts)

| Dimension | Max | Captures |
|---|---|---|
| Direct employment / payroll | 30 | Scale and stability of site jobs/payroll |
| Local hiring / workforce | 20 | Resident access to jobs, training, ladders |
| Local procurement / vendor fit | 15 | Local contractors, suppliers, services |
| Foot traffic / visitor draw | 15 | Workers, students, patients, visitors, events |
| Service-gap / essentiality | 10 | Keeps residents from leaving for basics |
| Community benefit / reinvestment | 10 | Mission fit, local ownership, retention |

This is a **strategy and diligence screen, not a formal input-output model**.
Each anchor carries `Impact Tier`, `Confidence`, `Local Impact Rationale`,
`Validation Needed`, a `Boundary / Leakage Caveat`, and `Source URLs`.

## Generated shape

```json
{
  "source": "chicago_local_impact_anchor_master",
  "communityAreaCount": 77,
  "anchorCount": 154,
  "byCommunityArea": {
    "1": {
      "communityArea": "Rogers Park",
      "anchors": [
        {
          "name": "S&C Electric Company",
          "type": "Employee-owned manufacturing headquarters",
          "scores": { "employment": 30, "localHiring": 19, "procurement": 15, "footTraffic": 5, "serviceGap": 7, "communityBenefit": 10 },
          "totalScore": 86,
          "impactTier": "High",
          "confidence": "High",
          "rationale": "…",
          "validationNeeded": "…",
          "leakageCaveat": "…",
          "sourceUrls": ["https://…"]
        }
      ]
    }
  }
}
```

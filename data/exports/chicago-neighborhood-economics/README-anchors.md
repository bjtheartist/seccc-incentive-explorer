# Curated anchor businesses (`neighborhood_anchors_by_zip.json`)

This file lets us **name real businesses** as neighborhood anchors in the
Neighborhood Economic Context report — without inventing data. It is a
human-curated file: the app never generates business names from an LLM or
unverified source. Where a ZIP has no entry, the report simply omits the
"Anchor Businesses" row (graceful).

The API (`/api/neighborhood-economics?zip=...`) reads this file, ranks the
anchors for the ZIP by a modeled **anchor score**, and surfaces the top names as
multiplier drivers. Employment and revenue are entered as **bands**, never exact
figures — they are banded estimates, not verified headcounts or sales.

## Shape

```json
{
  "60619": [
    {
      "name": "Example Anchor Co.",
      "category": "Manufacturing",
      "employmentBand": "100-249",
      "revenueBand": "5M-20M",
      "draw": "destination",
      "linkage": "high",
      "continuity": "established",
      "note": "Optional one-line context for partners.",
      "source": "curated"
    }
  ]
}
```

`name` is the only required field. Everything else defaults to `unknown`
(lowest weight) if omitted.

## Field values

| Field            | Allowed values                                                        | Meaning |
|------------------|-----------------------------------------------------------------------|---------|
| `employmentBand` | `1-9`, `10-49`, `50-99`, `100-249`, `250-499`, `500+`, `unknown`       | Size (who employs the most) |
| `revenueBand`    | `<500K`, `500K-1M`, `1M-5M`, `5M-20M`, `20M+`, `unknown`               | Revenue (who brings in the most) |
| `draw`           | `destination`, `mixed`, `neighborhood`, `unknown`                     | Pulls demand from outside the neighborhood? |
| `linkage`        | `high`, `medium`, `low`, `unknown`                                    | Re-spends locally (local supply chain, local hiring)? |
| `continuity`     | `established`, `new`, `unknown`                                       | Staying power / how anchored |

## Anchor score

`score = 2×employment + 2×revenue + draw + linkage + continuity`

Employment and revenue (raw size) are weighted double; `draw`, `linkage`, and
`continuity` are the multiplier-quality factors that turn "big" into "high local
multiplier." Top 5 by score are shown. See `lib/neighborhood-economic-models.ts`.

## Workflow

1. Research anchors for a ZIP externally and curate them into this file.
2. Commit the file. No code change or export run is required — the API picks it
   up immediately.

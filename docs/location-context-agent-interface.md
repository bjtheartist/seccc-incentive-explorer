# Location Context Agent / Partner Interface

## Purpose

The `LocationContext` contract is the internal source of truth for address-to-opportunity context. It lets the report, map snapshot, analytics, and future partner/agent workflows read the same source-backed object instead of rebuilding context in separate UI surfaces.

V1 is internal-only. Do not expose a public `/api/location-context` route until the governance rules below are implemented.

## Future Protected Endpoint Shape

A future protected endpoint can use this rough shape:

```http
POST /api/location-context
Authorization: Bearer <partner-token>
Content-Type: application/json
```

```json
{
  "address": "8701 S Bennett Ave, Chicago, IL",
  "lat": 41.73683,
  "lon": -87.57776,
  "project": {
    "industry": "food",
    "projectType": "rehabilitation",
    "proposedUse": "commercial"
  }
}
```

The response should return the internal `LocationContext` shape after public-surface sanitization.

## Safe To Expose

- Matched incentive zone keys and names.
- Program fit results with confidence labels and caveats.
- Parcel PIN, class, assessed value, zoning, district, and non-sensitive site details.
- Neighborhood economic context with measured/modeled labels.
- Local support organizations, websites, phones, source labels, and service geography.
- Site signals and logistics access as proximity context.
- Sources, freshness labels, and caveats.

## Do Not Expose Without Review

- User-entered notes or private project details beyond the fields intentionally submitted for the lookup.
- Personal email addresses collected through report email or inquiry flows.
- Parcel owner names or owner mailing addresses.
- Raw lead lists implying a business, owner, or property is seeking capital without explicit consent.
- Partner-specific corrections that were not approved for public reuse.

## Abuse And Privacy Constraints

- Require authentication and per-partner rate limits before any partner/agent endpoint ships.
- Log endpoint usage as analytics events, but avoid storing sensitive free-text inputs.
- Keep confidence and caveat fields in every response; do not return bare eligibility conclusions.
- Treat modeled leakage, multiplier, and market-intelligence outputs as context, not verified outcomes.
- Keep the public discovery tool free; treat partner/API access as a separate governed layer.

## Implementation Status

- Internal contract: `lib/location-context.ts`.
- Report attachment: `GeneratedReport.locationContext`.
- Map summary adapter: `summarizeLocationContextForMap`.
- Public endpoint: intentionally not implemented in v1.

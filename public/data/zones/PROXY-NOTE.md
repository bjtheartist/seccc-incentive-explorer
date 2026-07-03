# Zone Proxy Notice

**Updated:** 2026-07-02

## Files that remain proxy/approximation boundaries

The following zone files use a high-unemployment census-tract overlay as a proxy
for the DCEO "underserved area" statutory definition. They are **not** the official
boundaries and should be used only as a first-pass location screen.

| File | Key | Proxy basis |
|------|-----|-------------|
| `edge-zones.geojson` | `edgeZones` | 114-feature high-unemployment Cook County tracts |
| `rev-zones.geojson` | `revZones` | same 114-feature proxy |
| `micro-zones.geojson` | `microZones` | same 114-feature proxy |
| `data-center-zones.geojson` | `dataCenterZones` | same 114-feature proxy |

### Why these remain proxies

EDGE, REV, MICRO, Data Center, and Apprenticeship credits each provide a 25% bonus
credit for projects located in DCEO-certified "underserved areas." The statutory
definition (35 ILCS 10/5-5 and related) covers four qualifying criteria, not just
unemployment. The proxy files only capture the high-unemployment criterion and
therefore exclude tracts that qualify on poverty, SNAP, or low-income-family criteria.

## Official replacement available

**`edge-zones-official.geojson`** (`edgeZonesOfficial` key) contains the official DCEO
underserved area boundaries for 2026:

- **739 Cook County tracts** (versus 114 in the proxy)
- Source: DCEO "Underserved Census Tracts 2022-2026" Excel spreadsheet
  (downloadable from dceo.illinois.gov/expandrelocate/incentives/underservedareas.html)
- Geometry: Census TIGER 2024 tract boundaries
- `boundary_basis: "official-dceo"` in feature properties

### Migration recommendation

For any feature or query that determines EDGE/REV/MICRO/Data Center enhanced-credit
eligibility, switch to `edge-zones-official.geojson`. The proxy files (`edge-zones.geojson`,
etc.) are preserved untouched for backward compatibility with existing map layers.

## Expiration warning

The DCEO 2022-2026 designation expires at the end of calendar year 2026. A new
underserved-area list for 2027+ will need to be downloaded from DCEO and re-joined
to the then-current TIGER tract boundaries before January 1, 2027.

# Product Analytics Notes

The platform now has two analytics layers:

1. Vercel Web Analytics for page-level traffic after deployment.
2. First-party `report_events` records for product actions that matter to the Explorer.

## What We Can Count Retroactively

These counts come from existing Neon tables if they exist:

- `users`: people who created accounts or signed in.
- `saved_reports`: reports saved to a workspace.
- `business_projects`: project workspaces created from saved reports.
- `report_leads`: download-gate inquiries captured before PDF download.

Run:

```bash
DATABASE_URL="postgresql://..." npm run analytics:snapshot
```

## What Only Counts Going Forward

The `report_events` table starts capturing after this patch is deployed. It tracks:

- `site_page_viewed`
- `search_performed`
- `location_snapshot_requested`
- `location_snapshot_generated`
- `refined_report_generated`
- `vacancy_report_generated`
- `report_saved`
- `report_emailed`
- `report_pdf_downloaded`
- `spreadsheet_exported`
- `inquiry_submitted`
- `support_resource_viewed`
- `support_resource_clicked`
- `program_link_clicked`
- `share_link_copied`

## Mission Metrics

The dashboard treats report generation as top-of-funnel discovery. A report is counted as
activated when a user takes a post-report action: email, PDF download, save, vacancy
spreadsheet export, inquiry, or support/resource contact click.

The v1 mission proxy is `Local Resource Connections`: clicks on support-network or resource
contacts surfaced from a report. This is an impact proxy, not proof that a business received
capital or won an incentive.

## Practitioner Validation Sprint

The five facilitated links in `docs/practitioner-validation-sprint.md` use the
closed campaign set `practitioner-validation-2026-08-*`. Only those five exact
campaigns persist in session storage and roll up into the private dashboard's
Practitioner Validation panel. The attribution follows the same browser session
through report, local-support, and recorded support-request events without adding
participant names or documents to analytics.

Pilot counts are product events, not people. `Reports Generated`, `Support Viewed`,
and `Support Actions` are deduplicated by report key within each case. `Requests
Recorded` means a consented request was saved for review and routing; it does not
mean an organization acknowledged the request, made contact, approved a project,
or delivered assistance. The manual scorecard remains the primary evidence at a
five-session sample size.

The founder view also includes first-party traffic analytics: public page views, anonymous
visitor sessions, top pages, daily/weekly traffic tables, and coarse device breakdown
(`mobile`, `tablet`, `desktop`, `unknown`). Admin dashboard traffic is excluded. These
traffic counts are useful for frequency and audience-growth context, while activation and
resource-connection rates remain the mission metrics.

## Private Dashboard

Set `ANALYTICS_ADMIN_PASSWORD` and visit:

```text
/admin/analytics
```

The dashboard asks for the password and then sets a signed, HTTP-only session cookie.
It has a founder operating view and a partner-ready summary view. It supports 7, 30,
90, and 365 day windows.

## Admin Summary Endpoint

Set `ANALYTICS_ADMIN_TOKEN` in production if scripts need direct API access:

```text
GET /api/admin/analytics?days=30
Header: x-analytics-token: <token>
```

The response also accepts the private dashboard session cookie. It includes event counts
for the selected time window plus lifetime counts from the existing user, workspace,
report, and lead tables.

## Important Limitations

Vercel Analytics and `report_events` are not retroactive. Before this patch, we can only infer historical usage from records the app already persisted, such as saved reports and lead captures. Anonymous report generations, map searches, PDF downloads, spreadsheet exports, and public page views were not reliably stored before the first-party event layer existed.

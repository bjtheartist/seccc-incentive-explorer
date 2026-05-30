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

## Admin Summary Endpoint

Set `ANALYTICS_ADMIN_TOKEN` in production before using this endpoint:

```text
GET /api/admin/analytics?days=30
Header: x-analytics-token: <token>
```

The response includes event counts for the selected time window plus lifetime counts from the existing user, workspace, report, and lead tables.

## Important Limitations

Vercel Analytics and `report_events` are not retroactive. Before this patch, we can only infer historical usage from records the app already persisted, such as saved reports and lead captures. Anonymous report generations, map searches, PDF downloads, and spreadsheet exports were not reliably stored before the first-party event layer existed.

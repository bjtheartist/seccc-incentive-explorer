# Incentive Guide Evaluation Report

Run: 2026-07-12

## Launch Result

- The local deterministic suite passed all sourcing and boundary checks.
- Real browser verification passed for report-builder quick starts, internal-score refusal, and top-line-dollar refusal.
- NVIDIA Nemotron 3 Super and GPT OSS 120B were both exercised through Vercel AI Gateway with temporary $1-capped keys. The keys were revoked after the run.
- The team currently has free-tier Gateway access only. Most model calls were rejected with `GatewayRateLimitError`, so the run cannot be used to compare model quality.
- One sourced, boundary-respecting response completed from each candidate before provider throttling. No unsafe completed response was observed.

## Production Decision

The guide launches as a hybrid:

1. Common goals, report explanations, zone checks, navigation, scoring requests, and dollar-rollup requests use deterministic sourced responses with no model call.
2. Signed-in profile and packet changes remain behind model-proposed, user-approved tools and the existing authenticated APIs.
3. Vercel deployment OIDC authenticates model calls when Gateway capacity is available.
4. A full model comparison must be rerun after paid Gateway credits are enabled. Until then, no candidate is declared the quality winner.

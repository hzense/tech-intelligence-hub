# HZense Website MVP — Acceptance Criteria

The MVP is complete when:

- Home, Daily, Insights, Topics, Weekly, Signals and Resources routes exist and work on mobile and desktop.
- Markdown/MDX content is loaded through the validated content layer.
- Topic/entity references resolve without broken IDs.
- Basic keyword search works across published content; advanced RAG is not a blocker.
- Radar may use curated/manual scores in V1; automated scoring is not a blocker.
- Dark and light themes are usable.
- CI passes lint, typecheck, unit tests, content validation and seed validation.
- A Vercel production deployment exists, `hzense.com` is bound, HTTPS is valid and `www.hzense.com` redirects to the canonical root domain.
- sitemap, robots and canonical metadata are present.

Explicitly out of MVP scope: automated ingestion, full Ask HZense RAG, Neo4j, automated Radar scoring and multi-user collaboration.

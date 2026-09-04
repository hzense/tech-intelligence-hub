# ADR 0004 — Evolve search from FTS to hybrid retrieval

Status: Accepted.

V1 begins with keyword/full-text search. V2 combines keyword relevance, embeddings, entity matches, recency and importance. Search indexes are derived and rebuildable rather than sources of truth.

FTS-0 establishes the pre-migration contract in `@hzense/search`: six public source types, explicit
publication eligibility, nullable document dates, UI-complete canonical projections, stable
serialization/fingerprints, and a Chinese/English ranking corpus. The Web runtime continues using
the extracted in-process ranker. PostgreSQL persistence, tokenizer/index DDL, backfill, query parity,
and production cutover require later separately reviewed stages.

PR #41 completed and production-verified this FTS-0 boundary on 2026-09-04. Its final contract
adds a deterministic total order for otherwise fully tied results by ordinal source type and
document ID. The acceptance covered final review, complete CI, Search `23/23`, targeted Web `3/3`,
the exact merged Production deployment, a five-result production search check and bounded runtime
health/log evidence. It did not apply a database Migration, persist Search Documents, create a
PostgreSQL tokenizer/index, backfill, prove database-query parity or cut production search over;
those remain FTS-1. See the [sanitized acceptance record](../production-evidence/2026-09-04-operations-checkpoint.md#fts-0-pr-41-production-acceptance).

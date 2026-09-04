# ADR 0004 — Evolve search from FTS to hybrid retrieval

Status: Accepted.

V1 begins with keyword/full-text search. V2 combines keyword relevance, embeddings, entity matches, recency and importance. Search indexes are derived and rebuildable rather than sources of truth.

FTS-0 establishes the pre-migration contract in `@hzense/search`: six public source types, explicit
publication eligibility, nullable document dates, UI-complete canonical projections, stable
serialization/fingerprints, and a Chinese/English ranking corpus. The Web runtime continues using
the extracted in-process ranker. PostgreSQL persistence, tokenizer/index DDL, backfill, query parity,
and production cutover require later separately reviewed stages.

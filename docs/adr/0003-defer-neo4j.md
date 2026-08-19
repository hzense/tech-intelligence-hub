# ADR 0003 — Defer Neo4j

Status: Accepted.

Graph semantics are modeled from day one, but V1/V2 store relations in PostgreSQL. Neo4j is introduced only when multi-hop graph analytics, centrality, community detection or graph recommendation justify the operational cost.

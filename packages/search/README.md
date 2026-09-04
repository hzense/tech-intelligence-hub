# @hzense/search

`@hzense/search` owns the HZense search contract. FTS-0 extracted the deterministic in-process
ranking and canonical projection. FTS-1 adds the database projection, fixed parameterized query,
row validation and shared total-order comparator used by the PostgreSQL path.

Server-side projection consumers should import `@hzense/search/projection`. Ranking-only consumers
should import `@hzense/search/ranking`, which does not load the Node-only SHA-256 implementation.

## FTS-1 database boundary

The repository implementation now includes:

- the six public search source types: `daily`, `weekly`, `insight`, `topic`, `signal`, and
  `resource`;
- the existing NFKC, whitespace-delimited substring matching and weighted ranking behavior;
- an explicit publication-state input contract;
- a canonical Search Document projection, serialization, and SHA-256 fingerprint;
- a portable Chinese/English golden corpus for current Web parity and the PostgreSQL cutover gate;
- append-only migration `0003_search_documents_fts.sql`, including display fields, application-
  normalized fields, a generated weighted `tsvector`, GIN index and integrity constraints;
- transactional Search Document sync with dry-run, source/plan fingerprints, stale-row pruning,
  a production backup declaration gate and locked post-write verification;
- exact database scoring for the FTS-0 NFKC/substring contract, with the shared JavaScript
  comparator retaining `zh-CN` title ordering;
- `in-process`, `shadow` and fail-closed `database` Web modes sharing the existing one-connection
  Runtime pool.

Still outside FTS-1: embeddings, hybrid retrieval and RAG.

Repository delivery is not production cutover. Production remains `in-process` until `0003` is
applied, the canonical projection is synced, the expanded Runtime column ACL passes preflight,
shadow parity is accepted, and `HZENSE_SEARCH_MODE=database` is deployed and independently
verified. The existing Runtime ACL recovery-evidence blocker applies before running the updated
normalization script.

## Publication boundary

Callers pass the source's actual state through `SearchProjectionCandidate.publication`.
`projectPublishedSearchDocument(s)` is the only candidate-to-document boundary and excludes every
state outside this table:

| Source type            | Included states                   |
| ---------------------- | --------------------------------- |
| Daily, Weekly, Insight | `published`                       |
| Topic                  | `watching`, `active`, `strategic` |
| Signal                 | `reviewed`, `accepted`            |
| Resource               | `active`                          |

This keeps drafts, review-only editorial content, rejected/inbox Signals, archived Topics and
inactive Resources out of future database projections even if an upstream loader regresses.

## Canonical projection

`CanonicalSearchDocument` contains the existing database concepts plus the fields required to
rebuild the current search UI:

```ts
{
  id: 'searchdoc-insight-insight-agent-security-boundary',
  sourceId: 'insight-agent-security-boundary',
  sourceType: 'insight',
  title: 'AI 安全边界正扩展到智能体系统',
  summary: '...',
  href: '/insights/insight-agent-security-boundary',
  keywords: '...',
  body: '...',
  importance: 4,
  documentDate: '2024-06-22',
  topics: ['topic-ai-agents', 'topic-ai-security'],
  entities: ['company-anthropic'],
}
```

`documentDate` is `string | null`: Topic and Resource projections intentionally have no invented
date. Projection IDs are derived as `searchdoc-${sourceType}-${sourceId}`. `toSearchDocument`
retains the legacy Web-facing `id`, `type`, and optional `date` shape, so extraction does not change
routes, result keys, filters, labels, or ranking.

Migration `0003_search_documents_fts.sql` adds `summary`, `href`, `keywords`, four normalized text
columns and the generated `search_vector`. It refuses a lossy implicit upgrade when legacy rows
exist; the guarded synchronizer must rebuild the derived table from canonical sources.

## Stable serialization and fingerprint

`serializeCanonicalSearchDocuments` emits a compact, versioned JSON envelope with fixed field order
and documents sorted by ordinal ID. Builders normalize line endings, trim boundary whitespace,
collapse keyword whitespace, and sort/deduplicate Topic and Entity IDs. The serializer rejects
duplicate document IDs. `fingerprintCanonicalSearchDocuments` hashes the UTF-8 serialization as
`sha256:<hex>`.

The fingerprint is a rebuild/parity artifact, not a content source of truth and not an embedding
fingerprint.

## Ranking compatibility

All serving modes share a 120-character / 24 distinct normalized-term query limit. The page
shows a validation message before selecting a provider; invalid input never enters shadow
comparison or creates a database connection. Empty queries return no results without a query.

`SEARCH_RANKING_CONTRACT.version` is `nfkc-whitespace-substring-v1`. Query terms are split only at
Unicode whitespace; Chinese text is not segmented. All terms must occur as normalized literal
substrings. Scores retain the original Web weighting. Results are ordered by score, date and
`zh-CN` title as before, then by ordinal type and document ID so fully tied canonical identities
remain independent of source iteration order.

The golden corpus in `test/fixtures/search-ranking-golden.json` intentionally covers Chinese,
English, full-width Unicode, punctuation, type filtering, title-versus-body weighting, and the final
stable identity tie-breakers. PostgreSQL uses the built-in `simple` configuration for the weighted
`tsvector`. Because that tokenizer cannot exactly reproduce Chinese and arbitrary literal substring
matching, the FTS-1 query calculates compatibility filtering and scores over application-normalized
columns. The GIN index is available for later candidate retrieval, but cannot replace this parity
path without a separately versioned ranking contract.

## Commands

```bash
pnpm --filter @hzense/search build
pnpm --filter @hzense/search typecheck
pnpm --filter @hzense/search lint
pnpm --filter @hzense/search test
pnpm db:sync:search:local:dry-run
pnpm db:sync:search:local:apply
```

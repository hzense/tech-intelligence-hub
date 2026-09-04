# @hzense/search

`@hzense/search` owns the HZense search contract. FTS-0 extracts the existing deterministic
in-process ranking from the Web app and defines the canonical projection that a later PostgreSQL
FTS migration must persist.

Server-side projection consumers should import `@hzense/search/projection`. Ranking-only consumers
should import `@hzense/search/ranking`, which does not load the Node-only SHA-256 implementation.

## Current boundary

Implemented in FTS-0:

- the six public search source types: `daily`, `weekly`, `insight`, `topic`, `signal`, and
  `resource`;
- the existing NFKC, whitespace-delimited substring matching and weighted ranking behavior;
- an explicit publication-state input contract;
- a canonical Search Document projection, serialization, and SHA-256 fingerprint;
- a portable Chinese/English golden corpus for current Web parity and a future PostgreSQL FTS
  cutover gate.

Not implemented in FTS-0:

- a database migration for the additional projection fields;
- writes to `search_documents`, a PostgreSQL tokenizer/configuration, or query SQL;
- a switch from the current in-process Web search to PostgreSQL;
- embeddings, hybrid retrieval, or RAG.

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

The current physical `search_documents` table does not yet contain `summary`, `href`, or `keywords`.
Those fields are part of this canonical pre-migration contract and must be added by a separately
reviewed migration before database persistence or cutover.

## Stable serialization and fingerprint

`serializeCanonicalSearchDocuments` emits a compact, versioned JSON envelope with fixed field order
and documents sorted by ordinal ID. Builders normalize line endings, trim boundary whitespace,
collapse keyword whitespace, and sort/deduplicate Topic and Entity IDs. The serializer rejects
duplicate document IDs. `fingerprintCanonicalSearchDocuments` hashes the UTF-8 serialization as
`sha256:<hex>`.

The fingerprint is a rebuild/parity artifact, not a content source of truth and not an embedding
fingerprint.

## Ranking compatibility

`SEARCH_RANKING_CONTRACT.version` is `nfkc-whitespace-substring-v1`. Query terms are split only at
Unicode whitespace; Chinese text is not segmented. All terms must occur as normalized literal
substrings. Scores and tie-breaking remain identical to the original Web implementation.

The golden corpus in `test/fixtures/search-ranking-golden.json` intentionally covers Chinese,
English, full-width Unicode, punctuation, type filtering, and title-versus-body weighting. A future
PostgreSQL tokenizer may use different lexemes internally, but it must pass this user-visible corpus
before production search can switch.

## Commands

```bash
pnpm --filter @hzense/search build
pnpm --filter @hzense/search typecheck
pnpm --filter @hzense/search lint
pnpm --filter @hzense/search test
```

<p align="center">
  <img src="assets/brand/hzense-logo.png" alt="HZense logo" width="180" />
</p>

# HZense

> **Sense what matters in technology.**

HZense is a Technology Intelligence platform for turning fragmented technical information into structured, versioned intelligence.

- Website: **https://hzense.com** _(production)_
- Vercel Production: **https://tech-intelligence-hub-web.vercel.app/**
- GitHub Organization: **https://github.com/hzense**
- Main Repository: **https://github.com/hzense/tech-intelligence-hub**

## Intelligence pipeline

> **Sources → Signals → HZense Daily → HZense Weekly → Topics → Insights → Radar**

Daily candidates are generated deterministically from reviewed Signals, validated as immutable artifacts and designed to open as Draft PRs; publication remains a human-only decision. Automatic PR creation is currently feature-gated by an organization policy. See [Continuous Daily](docs/CONTINUOUS_DAILY.md).

## Product modules

- **HZense Daily** — daily technology intelligence brief
- **HZense Weekly** — weekly synthesis
- **HZense Signals** — atomic technology signals
- **HZense Insights** — deep analysis and original judgments
- **HZense Topics** — evolving topic knowledge bases
- **HZense Radar** — attention, trend, maturity and strategic-value tracking
- **HZense Resources** — people, companies, institutions, technologies, products, models, datasets, standards/protocols, papers and events
- **Ask HZense** — future AI-powered intelligence retrieval and analysis

## Architecture baseline

- TypeScript
- Next.js + React
- Markdown / MDX as formal content source of truth
- PostgreSQL + Drizzle ORM for structured intelligence
- pgvector for semantic retrieval
- PostgreSQL FTS → Hybrid Search
- Vercel for the web application
- Cloudflare R2 / S3-compatible storage for large media

> **Git / Markdown = content Source of Truth**  
> **PostgreSQL = entity / relation / signal / index Source of Truth**

`data/taxonomy/taxonomy.yaml` is the Source of Truth for Topic IDs, canonical English names, primary-parent hierarchy and cross-domain relations. `data/seed/topics.yaml` is its validated operational subset and owns runtime status; Markdown/MDX files under `content/topics/` own localized Topic pages and body content only. PostgreSQL `topics` is a complete derived projection of the Taxonomy, populated only by the reviewed synchronizer and never edited as an independent Topic authority. The synchronizer is implemented in the repository; production synchronization has not been executed.

## Repository structure

```text
apps/
  web/                     # Next.js application boundary
content/
  daily/
  weekly/
  insights/
  topics/
  briefings/
  papers/
packages/
  content/                 # Zod schemas + Markdown validation
  database/                # Drizzle physical schema
  search/                  # search boundary
  intelligence/            # ranking / RAG / Radar boundary
  ui/                      # design-system boundary
data/
  schema/
  taxonomy/
  seed/
  radar/
db/
  migrations/
scripts/
docs/
  adr/
.github/
  workflows/
```

## Project baselines

- [`docs/DESIGN.md`](docs/DESIGN.md) — product and information architecture
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — technical architecture
- [`docs/INFORMATION_MODEL.md`](docs/INFORMATION_MODEL.md) — knowledge/data model
- [`docs/DEVELOPMENT_FOUNDATION.md`](docs/DEVELOPMENT_FOUNDATION.md) — executable engineering foundation
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production deployment runbook
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — live development progress dashboard
- [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md) — engineering rules
- [`docs/MVP_ACCEPTANCE.md`](docs/MVP_ACCEPTANCE.md) — V1 acceptance criteria
- [`data/schema/information-model.yaml`](data/schema/information-model.yaml) — machine-readable information model
- [`data/taxonomy/taxonomy.yaml`](data/taxonomy/taxonomy.yaml) — controlled taxonomy

## Current status

**Website MVP — release candidate**

Completed:

- [x] Product / brand / domain baseline
- [x] GitHub Organization and public Organization profile
- [x] Technical architecture
- [x] Information Model v2.0.0 and taxonomy
- [x] pnpm workspace + Turborepo repository skeleton
- [x] Strict TypeScript / ESLint / Prettier baseline
- [x] Vitest / Playwright baseline
- [x] PostgreSQL / Drizzle physical schema
- [x] pgvector-enabled migration baseline
- [x] Executable Zod Front Matter validation
- [x] Seed topics, entities, relations and historical signals
- [x] Seed Daily / Weekly / Insight / Topic Markdown
- [x] CI workflow baseline
- [x] Next.js Home, Daily, Weekly, Insights, Topics, Signals and Resources routes
- [x] Basic keyword search across published content
- [x] Architecture Decision Records

Next milestone:

- [x] Initialize the Next.js application in `apps/web`
- [x] Build Home + HZense Daily first
- [x] Deploy to Vercel
- [x] Bind `hzense.com` and redirect `www.hzense.com` to the apex domain
- [x] Add Insights list and detail routes
- [x] Add Topics list and detail routes
- [x] Add Weekly / Signals / Resources
- [x] Add basic search
- [x] Publish the dedicated HZense Radar route

Next phase:

- [x] Connect deterministic Daily candidate generation and validate a real dry-run artifact
- [ ] Enable organization policy for automatic Continuous Daily Draft PR creation
- [x] Provision managed PostgreSQL 18 / pgvector 0.8.6
- [x] Complete and independently verify the initial production database migration (`0000`–`0001`)
- [x] Enforce the Taxonomy → Seed → Content authority chain
- [ ] Merge and independently verify the complete Topic projection synchronizer
- [ ] Apply and verify `0002_topic_projection.sql` in production
- [ ] Execute and independently verify the first production Topic synchronization
- [ ] Add the reviewed runtime database integration, health checks and observability

## Local foundation checks

```bash
corepack enable
corepack prepare pnpm@11.21.0 --activate
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm content:validate
pnpm seed:validate
```

The first dependency install should commit `pnpm-lock.yaml`. After that, CI should switch to a frozen lockfile install.

## Topic database projection contract

PostgreSQL projects every Topic in the authoritative Taxonomy. `topics.id`, `topics.title` and `topics.parent_id` come from Taxonomy; `topics.status` comes from Seed when present and otherwise falls back to `watching`. `topics.runtime_enabled` is true only when the Topic exists in Seed and its Seed status is not `archived`.

Topic Markdown/MDX is a mandatory completeness and consistency gate before a write, but localized titles, display fields and body content are never copied into `topics`. Cross-domain Topic relations remain authoritative only in `data/taxonomy/taxonomy.yaml` in this phase because the physical database has no `topic_relations` table.

The synchronizer is transactional, reuses the Migration advisory-lock namespace, and performs inserts and updates only. It never deletes Topic rows, and it fails closed if PostgreSQL contains an ID outside the authoritative Taxonomy. Its default mode is a non-persistent dry run: the transaction exercises the planned DML and verification, then rolls back. The result includes a source `fingerprint` for the authoritative projection and a `planFingerprint` bound to the current managed database fields plus the insert/update/no-op partition. Production apply requires both reviewed fingerprints and an operator declaration naming a newly created, independently verified backup, and must authenticate as the dedicated least-privilege `hzense_topic_sync` role rather than the Migration or Web Runtime role. Its preflight rejects access to every non-system Schema other than the exact `public` allowlist and any executable `SECURITY DEFINER` routine in a non-system Schema; effective relation, column and Sequence privileges plus object ownership are audited across all non-system Schemas. After acquiring the shared advisory lock and table lock, Apply recomputes and matches both fingerprints before any write, so source or managed Topic drift after dry run fails closed. Physical-Schema integrity is established separately by `db:verify:production` in the same maintenance window. Repository implementation does not imply production execution; the live status and guarded procedure are maintained in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The provider/cluster administrator must pre-create `hzense_topic_sync`; the reviewed, secret-free [`db/roles/configure_topic_sync.sql`](db/roles/configure_topic_sync.sql) is then run as the explicit database/Migration owner. It validates the fixed role and `0002`, uses the shared advisory lock and a transaction, revokes ambient `PUBLIC` database/schema/data ACLs in `current_database()`, closes that owner's future-object PUBLIC defaults across the database, and installs only the reviewed writer grants. Because these revocations affect every non-owner login relying on ambient or owner-default access in that database, other roles require separate reviewed direct grants. The full owner-side production verifier, ACL configuration, restricted-role dry run and Apply belong to one DDL-frozen maintenance window; the restricted preflight does not replace the full verifier.

The reviewed entry points are intentionally explicit:

```bash
pnpm db:sync:topics:local:dry-run
pnpm db:sync:topics:local:apply
pnpm db:sync:topics:production:dry-run
pnpm db:sync:topics:production:apply
```

Production uses `HZENSE_TOPIC_SYNC_DATABASE_URL` plus independently configured `HZENSE_TOPIC_SYNC_EXPECTED_HOST`, `HZENSE_TOPIC_SYNC_EXPECTED_PORT`, `HZENSE_TOPIC_SYNC_EXPECTED_NAME`, `HZENSE_TOPIC_SYNC_EXPECTED_USER`, `HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR` and `HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT`. Apply additionally requires `HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT`, `HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT` and `HZENSE_TOPIC_SYNC_BACKUP_ID`. The CLI validates only that the backup declaration is present and syntactically valid; it cannot call the provider or prove recoverability, which remains an operator gate. Values and credentials must never be committed or printed.

Local Topic sync is equally strict: use a dedicated loopback database, pre-create the same `NOINHERIT CONNECTION LIMIT 2` role, run the reviewed ACL script as that database's Migration owner, then put the restricted role's URL in `HZENSE_TOPIC_SYNC_DATABASE_URL`. A normal `postgres`, owner or Migrator URL is intentionally rejected. Exact local and production setup commands and the database-wide `PUBLIC` ACL impact are documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#本地-topic-同步角色).

## Database migration contract

`packages/database/src/schema.ts` is the Drizzle physical-schema declaration. Executable migrations are reviewed, sequential `NNNN_name.sql` files in `db/migrations/`; their immutable SHA-256 values are recorded in `db/migrations/checksums.json`. The runner applies each file in a transaction, serializes concurrent runs, and records the checksum in `hzense_schema_migrations`. Applied files must never be edited.

The repository Schema now contains three Migrations. `0002_topic_projection.sql` adds `topics.runtime_enabled` and its status constraint; it must be applied and verified before any Topic projection DML. The last production evidence still covers only the first two Migrations, so `0002` and the first production Topic sync remain `not_executed`.

Local development uses only a literal loopback PostgreSQL URL:

```bash
DATABASE_URL=postgresql://...@127.0.0.1:5432/hzense pnpm db:migrate:local
```

Production uses a dedicated non-pooling endpoint and a restricted database-owner role. The provider or database administrator must install the reviewed pgvector version first. `DATABASE_DIRECT_URL` must set `sslmode=verify-full`; its host, port, database and user must independently match the `HZENSE_DATABASE_EXPECTED_*` values. The safe order is:

```bash
pnpm db:preflight:production
# create and record a provider snapshot or pg_dump backup here
pnpm db:migrate
pnpm db:verify:production
```

Preflight is read-only and rejects a transaction-pooler-shaped operating model by requiring an explicitly reviewed direct endpoint; it also checks the authenticated/effective role, PostgreSQL major, TLS session, pgvector version, schema privileges, target ownership and migration history before any DDL. Production entry points reject Node's process-wide TLS certificate-validation bypass. Verification runs in a read-only transaction and checks table durability, ownership, RLS/policy/trigger state, the complete column/enum/key/index contract, `vector(1536)`, exact migration checksums and Radar evidence invariants. Never run `test:migrations` against a production server: it creates and drops disposable databases.

An older database created directly from `0000_foundation.sql` has no migration-history row. Standard production migration deliberately refuses to adopt it. The break-glass path requires a separate catalog review, confirmation that the exact checked-in file created the schema, and an explicit `HZENSE_DATABASE_BASELINE_CHECKSUM` passed only to the low-level local runner. Unknown legacy Source, Signal, or Radar rows stop the evidence migration with their IDs so provenance can be backfilled explicitly.

---

**HZense — Technology Intelligence**  
_Sense what matters in technology._

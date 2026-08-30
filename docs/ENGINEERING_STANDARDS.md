# HZense Engineering Standards v1.0

- Runtime: Node.js 24; package manager: pnpm 11.
- Monorepo: pnpm workspaces + Turborepo.
- Language: TypeScript strict mode; no unchecked index access; exact optional properties.
- Formatting: Prettier. Linting: ESLint flat config + typescript-eslint.
- Unit tests: Vitest. Browser/E2E: Playwright once `apps/web` is initialized.
- Secrets: never commit `.env`; only `.env.example` is versioned.
- Branching: `main` must stay releasable; development uses short-lived feature branches and PRs. Protected `main` requires an up-to-date branch plus `foundation`, `database-migrations` and `daily-publication-gate`; Daily changes additionally require the declared CODEOWNER.
- Workflow security: top-level token access is read-only, write permissions are job-scoped, third-party Actions use immutable commit SHAs and every job has a timeout.
- Commits: concise imperative messages; one architectural concern per commit where practical.
- Data changes: migrations and their checksum manifest are append-only after review. Never edit a migration already applied in any shared environment. Production DDL requires the direct-endpoint preflight, a recoverable backup and the read-only post-verifier; the destructive integration suite is local CI only.
- Topic changes: Taxonomy, Seed Topics and Topic Markdown must pass the complete authority checks in `pnpm content:validate` and `pnpm seed:validate`; database projection changes must additionally prove full-Taxonomy coverage, deterministic ordering, drift rejection, transaction rollback and an idempotent no-op rerun.
- Topic synchronization: default to dry run; Apply must use one transaction and the Migration advisory lock, insert/update only, fail closed on unknown database IDs and never delete. Dry run must expose both the authoritative source fingerprint and the plan fingerprint bound to current managed database fields plus insert/update/no-op sets. Production Apply receives the reviewed values through `HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT` and `HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT`, then recomputes and matches both while holding the advisory and table locks and before any write. It also requires `HZENSE_TOPIC_SYNC_BACKUP_ID` as the operator's declaration for a newly created and independently verified backup, and the independent least-privilege `hzense_topic_sync` role. Preflight must reject access to any non-system Schema other than the exact `public` allowlist and execution of any non-system `SECURITY DEFINER` routine; effective relation, column and Sequence privileges plus ownership checks must span every non-system Schema. The CLI validates only the backup declaration's presence and syntax, not provider existence or recoverability; Migrator and Runtime credentials are forbidden.
- Content changes: all Markdown front matter and Topic references must pass `pnpm content:validate`.
- Seed changes: Taxonomy membership, canonical Topic titles and cross references must pass `pnpm seed:validate`.
- Dependency policy: prefer stable releases; upgrades are reviewed through CI rather than floating `latest` tags.

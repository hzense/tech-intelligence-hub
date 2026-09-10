# ACL capture review — 2026-09-11 (Europe/Berlin)

## Completed read-only capture

- Source: [Production maintenance](https://github.com/hzense/tech-intelligence-hub/actions/runs/34535908960), attempt `1`, completed/success.
- Execution SHA: `f72ccb920bd04ad039dccd5eb555e5aa78b24abc`; matching main CI passed.
- The operator confirmed no concurrent production releases or database DDL/ACL changes, then approved the protected Environment deployment.
- Artifact: `acl-evidence-34535908960-1`, ID `10175444320`.
- GitHub artifact digest: `sha256:8bca12661d79353f04e9b3491230752e4be719692407c086a51e7091d299ccea`.
- Extracted `baseline.json` SHA-256: `611044ad8c716be7cf4cfdcb5642be86412e54a711531a81a5dce41354073455`; the working-tree copy matches the downloaded file byte-for-byte. These are different digest scopes.
- Capture approval digest: `c67f4c1d93e00d60766b179afa7941e3e4a3ee3eb1841cd0d0596dd6d83f0f3f`, matching the configured approval and hosted success log.

The envelope repository, SHA, run/attempt, format and risk status were checked.
Both full baselines were reconstructed using the shared catalog contract and
the reviewed backup binding. Both yielded:

`4e1732e0bc4efd3a59f1a973dae0af9de2c0b6e585499e46294cba3da016c30b`

Captures occurred at `2026-09-10T22:10:56.838Z` and
`2026-09-10T22:10:57.730Z`. Both identify database `hzense`, session/current user
and database owner `hzense_migrator`, PostgreSQL `180006`, repeatable-read and
read-only transactions. All 11 catalog-category fingerprints equal those in
the previously archived `34326646837-1/baseline.json`.

The collector opens and closes a separate read-only connection for each capture.
Successful collection, exact file preservation and historical catalog equality
do not prove restoration, historical pre-normalization ACL completeness, or an
independent human recovery audit. No new recovery rehearsal was performed.

## Risk and backup scope

The existing provider backup was visibly present for the production target;
its expiration checkbox remained unchecked. The dialog was cancelled without
changes. The operator explicitly accepted unverified recovery for this FTS-1
launch. Accordingly the artifact records `accept-unverified-fts1`,
`recoveryVerified: false` and `restoration: unverified-risk-accepted`.
Provider API verification and actual restoration remain unverified. Raw backup
identifiers and approval contents remain outside this public evidence.

## Migration — completed and verified

[Migration run](https://github.com/hzense/tech-intelligence-hub/actions/runs/34536488752),
attempt `1`, ran for the same main SHA after the operator approved the protected
Environment deployment. Its separate approval bound the reviewed full ACL
fingerprint above with expiry `2026-09-11T00:16:16.947Z` (02:16 Berlin).
Its approval digest is
`ac2cd6b8e505e8608072ecfa025ca535714496b661641dee76d9aed63802c730`.

The merged risk path accepts only `0003_search_documents_fts.sql` or no pending
migration, with a second scope check under the migration lock. The migration
refuses a nonempty legacy search table rather than clearing it; it adds search
columns, constraints and indexes, then runs schema verification. It does not
backfill documents, change Runtime ACLs, execute recovery SQL or switch search
mode. Those subsequent steps are not completed by this checkpoint.

The run completed successfully at `2026-09-10T22:18:28Z`. Its execution summary
at `2026-09-10T22:18:25.826Z` reports `operation: migrate`, `status: succeeded`,
`migrationCount: 4` and `tableCount: 13`, with `recoveryVerified: false` and the
approval digest above. The actual migration executor verifies the post-migration
schema contract before returning success. The FTS-1 migration is now applied;
this is not evidence that search backfill or cutover has completed.

## Backfill dry run — completed without commit

[Search dry-run](https://github.com/hzense/tech-intelligence-hub/actions/runs/34536947759)
ran for the same main SHA after rechecking main CI success and receiving the
operator's protected Environment approval. It completed successfully at
`2026-09-10T22:22:01Z`.

This is a rollback rehearsal of the search projection, **not a read-only SELECT
operation**: the shared implementation takes bounded advisory/table locks,
calculates the plan, performs transactional inserts/updates/deletes and verifies
the resulting projection, then rolls back. It does not commit search data.
Its resulting projection and plan fingerprints must be reviewed and bound to a
separate `search-apply` approval before committing the backfill. No recovery
rehearsal, Runtime ACL change or search-mode change is included.

The success summary at `2026-09-10T22:22:00.004Z` reports 38 desired documents,
38 inserts, zero updates/deletes/unchanged, and `committed: false`.
Reviewed projection fingerprint:
`a31b9083b2e2e7e1db25c8af33d956650470f2e0ed967a014cc8861d44742716`.
Reviewed plan fingerprint:
`71ecb1f9fda97b66a5a624d15b52cecc30f8bb7eb0e494d666527131497ee8ad`.

## Formal backfill — committed successfully

[Search apply](https://github.com/hzense/tech-intelligence-hub/actions/runs/34537194699),
attempt `1`, completed successfully after protected Environment approval on the same main SHA.
The separate approval binds the reviewed pre-change ACL baseline plus the exact
projection and dry-run plan above. Actual apply recomputes both fingerprints
under its transaction lock and rejects drift before committing.

Approval expiry: `2026-09-11T00:24:07.801Z` (02:24 Berlin).
Approval digest:
`7e0213830b888ed25fe9a64fda92544558fecd4b59e1160a25b90fd2be1601fb`.
Backup and recovery-risk declarations retain the same scope; recovery remains
unverified. Its success summary at `2026-09-10T22:27:50.199Z` reports
`committed: true`, 38 desired documents and 38 inserts, with zero updates,
deletes or unchanged records. Both fingerprints match the reviewed dry run;
the success log's approval digest also matches the configured approval above.
The transaction verified the resulting projection before committing.
Runtime permissions and the website search mode were not changed by this run.

## Independent post-commit no-op verification — completed

[Post-commit dry run](https://github.com/hzense/tech-intelligence-hub/actions/runs/34537704444)
ran for the same main SHA after main/CI revalidation and protected Environment
approval. Its successful execution summary at `2026-09-10T22:31:47.048Z`
reports 38 unchanged documents, zero inserts/updates/deletes, the same
projection fingerprint, and `committed: false`.
The no-op plan fingerprint is
`1aa0cb637287487319bb388b616526ac6ee42048ea98b07c2f14879f06dd8ab9`;
it differs from the initial insert plan as expected after committed backfill.

## Narrow Runtime column grant — committed and independently read back

The operator separately authorized the exact twelve-column Search SELECT grant.
The reviewed pre-change ACL capture grants Runtime only five Topic columns;
there were no direct Search column grants in that capture. A live read-only
probe at `2026-09-10T22:38:35.402737Z` confirmed no effective Search column or
table privileges, 18 physical columns, 38 rows, the expected owner and direct
Migrator identity. The production target fingerprint matched
`4de787f9e9c20f0fe8694e5641ccb0a27736f9d5b5fc6360b18593a0e993d3e9`.

Neon Console executed a bounded transaction with identity, relation, row-count,
role and pre-existing privilege assertions, the single GRANT, then exact
effective/direct privilege assertions before COMMIT. The grant is only
non-grantable SELECT on
`public.search_documents` columns `source_id`, `source_type`, `title`,
`summary`, `href`, `keywords`, `body`, `document_date`, `normalized_title`,
`normalized_summary`, `normalized_keywords`, and `normalized_body` to
`hzense_runtime`, matching the merged reader/preflight contract. It does not
grant table-level access, embedding access, write privileges or role membership.
The SQL result included a successful COMMIT. A separate read-only transaction
at `2026-09-10T22:40:47.82053Z` confirmed exactly these twelve effective SELECT
columns, the same target fingerprint, 18 columns and 38 rows. All eight checked
table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
MAINTAIN) remained false; the number of columns with INSERT, UPDATE, REFERENCES
or SELECT WITH GRANT OPTION remained zero. Embedding and every other unlisted
column remained unreadable. Runtime attributes were unchanged: login enabled,
NOINHERIT, connection limit 20, read-only default on, and no superuser,
CREATEDB, CREATEROLE, replication or BYPASSRLS capabilities.

No full normalization script, REVOKE, role alteration, password change, data
mutation or recovery operation was executed in this grant step. These checks
used Migrator catalog inspection; they are not a substitute for the hosted
preflight using the Runtime credential. Runtime preflight, shadow comparison
and search cutover were still pending at the grant checkpoint.

Hosted Runtime preflight was dispatched as
[run 34538678227](https://github.com/hzense/tech-intelligence-hub/actions/runs/34538678227)
on the same `main` SHA after rechecking successful main CI `34530817393` and
absence of active maintenance runs. After operator approval of
`production-maintenance`, it completed successfully at `2026-09-10T22:43:01Z`.
The bounded execution emitted `{"operation":"runtime-preflight","status":"succeeded"}`
at `2026-09-10T22:42:59.7558468Z`. This verifies the production-profile checks
using the separate Runtime credential, including the target and reserved-database
contracts; it is the first of two consecutive preflights required by the rollout
checklist. Shadow comparison and database-mode cutover remain pending.

The second independent Runtime preflight,
[run 34538913394](https://github.com/hzense/tech-intelligence-hub/actions/runs/34538913394),
was dispatched on the same SHA after rechecking current main, CI and the first
successful run. After operator approval, it succeeded; bounded execution emitted
`{"operation":"runtime-preflight","status":"succeeded"}` at
`2026-09-10T22:45:46.3047300Z`. Both consecutive Runtime preflights passed on
`f72ccb920bd04ad039dccd5eb555e5aa78b24abc`.

## Shadow deployment preparation

After checking unchanged main and successful CI, the Vercel Production-only
non-secret config `HZENSE_SEARCH_MODE=shadow` was added through the browser.
Preview and Development were explicitly unselected; the five existing Runtime
secrets were not read or changed. Vercel confirmed the save and showed `shadow`
on readback. The prior Production deployment remains
`dpl_7KvntRvkaFhiDQYWrhrzbXrqPx2j`, built from the same main SHA.
The first redeploy request returned `Failed to fetch`; a fresh deployment list
confirmed no new deployment before retry. The retry created Production deployment
`dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh`, which reached READY at
`2026-09-10T22:52:53.281Z` with the same main SHA and `hzense.com` assigned.
Browser and application-log verification then recorded 21/21 shadow matches,
including two rounds of all six type filters, healthy database endpoint and no
error/fatal/warning logs in the bounded early window. See
[shadow acceptance](./shadow-parity.md) for scope and captured parity records.

After reviewing those results and rechecking unchanged main, green main CI and
completed maintenance runs, Production-only `HZENSE_SEARCH_MODE` was updated to
`database` and read back in the Vercel UI. A new Production deployment was
requested with the same main source and latest settings. It reached READY as
`dpl_DV9WMCgbHpd3ScNCwAMXzd2hAFGo` at `2026-09-10T22:58:19.544Z`, with
`hzense.com` assigned. Production search/type checks, database health, observed
one-connection pool statistics and cloud health run `34540048804` then passed.
See [cutover acceptance](./cutover.md) for exact scope, early error window,
reviewed-but-unexercised application rollback and remaining recovery boundaries.

This changeset adds the evidence files to version control. Inclusion in main
requires the evidence PR to be merged; submission alone is not merged archival.

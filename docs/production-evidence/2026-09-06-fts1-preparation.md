# FTS-1 production preparation checkpoint — 2026-09-06

## Scope and outcome

The operator requested FTS-1 production migration, backfill, cutover and
acceptance. Preparation has started, but production cutover is **not complete**.
No production database mutation, ACL normalization, credential rotation,
Vercel environment change or redeployment was performed in this checkpoint.

## Verified baseline

- Local `main` and `origin/main` both point to `135811f45cedb3df63414ea01a35210716bb25be`.
- [Main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34058236872)
  and [scheduled production health](https://github.com/hzense/tech-intelligence-hub/actions/runs/34060877734)
  succeeded for that commit.
- The Vercel connector reports that the same commit's Production deployment is
  `READY` and has the `hzense.com` production alias.
- A direct request to `https://hzense.com/api/health/database` returned
  `{"status":"ok"}`. This is a baseline health observation, not FTS acceptance.
- Separate Neon SQL Editor reads on production and the new backup returned the
  same aggregate values: intended database matched, 3 migration records,
  62 Topics, 0 Search Documents, and no registered
  `0003_search_documents_fts.sql` migration.
- Those queries used `BEGIN READ ONLY`, a 10-second statement timeout and
  `ROLLBACK`; they emitted only counts and booleans, not business rows or secrets.

## Provider backup preparation

- Neon Console shows a 6-hour history window. That current window cannot reach
  the historical August/early-September ACL normalization period.
- The console also lists one older snapshot and two older backup branches.
  Their presence was checked, but their contents have not been independently
  extracted to reconstruct the historical ACL state. Historical recoverability
  therefore remains unresolved, not disproved.
- The current plan's snapshot slot is occupied; no snapshot was deleted and no
  plan upgrade was requested. Existing branch capacity allowed a new backup.
- A new child branch of production `main`, including both data and schema, was
  created successfully with seven-day retention. The provider success notice
  gives expiry **2026-09-13 23:26 Europe/Berlin (GMT+2)**.
- The new branch accepts independent read-only SQL and returns the aggregate
  baseline above. This proves branch creation and limited readability, **not**
  a full database/ACL restore rehearsal or comprehensive equality.
- Raw project, branch, endpoint and backup identifiers are intentionally omitted
  from this tracked record. The provider console retains the actual resource.
- If rollout is delayed or DDL changes, re-evaluate backup freshness before
  use. Do not treat an expired branch as a recovery resource.

## Remaining gates and handoff

The existing [FTS-1 rollout order](../DEPLOYMENT.md#fts-1-数据库搜索上线顺序)
and [ACL recovery requirements](../DEPLOYMENT.md#runtime-acl-恢复基线) still apply:

1. Supply the existing protected direct migration-owner connection and runtime
   connection. No relevant production connection variables are present in this
   process, and no local production environment file was found at task start.
   Browser SQL access is available, but it does not substitute for the approved
   shared implementation's identity/TLS checks and protected baseline output.
2. Establish a DDL-freeze window, verify recoverability of the new backup,
   capture the complete current ACL baseline twice, compare fingerprints,
   prepare/review the restoration plan and rehearse on an isolated restore.
3. Resolve historical evidence through available old backups, or obtain an
   explicit operator decision on the historical gap with a new verified baseline.
4. Only after the gates pass: run production preflight, migration and schema
   verification; review the search dry-run fingerprints; perform protected
   backfill; configure and verify runtime ACLs; then shadow, review, cut over,
   and validate health/search/filtering/pool limits/rollback.

A local `.env.fts1.local` template was initially prepared for protected operator
input, then populated with non-password connection parameters. On 2026-09-07,
the operator chose not to keep a credential configuration file. It was removed
without retaining a copy, and an interactive in-memory preflight entry point
was prepared and tested without production access.

The operator subsequently requested an entirely online maintenance workflow.
The temporary local interactive entry point, its dedicated tests and its usage
document were removed before commit. The credential file remains absent.
Shared migration, synchronization, ACL inspection and verification components
are retained with the operator's approval; existing CI and the online runner
require these components.

On 2026-09-07 the operator approved manually dispatched GitHub Actions with
protected environment secrets, Neon backup/recovery and Vercel deployment.
The dedicated `production-maintenance` Environment has been created and read
back through GitHub's API: one exact `main` branch policy, required reviewer
`zhenghu`, admin bypass disabled, and eight non-secret target variables.
Self-review is allowed for the single-operator workflow; this is not an
independent two-person approval guarantee. Existing Vercel-linked environments
were not changed. No production secret was present in the dedicated environment
at the verification checkpoint.

The new FTS maintenance workflow and safety tests have been prepared in the
worktree, not committed or merged. No new maintenance run, production migration,
backfill, ACL normalization, Vercel configuration change or cutover has occurred.
The [online runbook](../ONLINE_MAINTENANCE.md) separates environment setup,
code publication, credentials, run-bound write approval and production acceptance.
Complete protected online ACL archival/review and restore rehearsal still need
to be connected; retaining the capture code does not close that gate. No local
credential tooling will be used as a fallback. Do not paste secrets or full ACL
JSON into chat, PRs or logs.

Development verification for the online entry point passed using the installed
dependencies: 51 new maintenance guard/workflow-contract tests; 183 database
package tests in total, with 35 isolated-database integration tests skipped.
Actionlint 1.7.12, the repository workflow security validator, targeted ESLint,
Prettier and `git diff --check` also passed. This is development validation,
not a fresh locked-dependency CI run or production database verification.

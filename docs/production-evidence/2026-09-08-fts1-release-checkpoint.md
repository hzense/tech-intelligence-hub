# FTS-1 release acceptance checkpoint — 2026-09-08

## Outcome

Rollout acceptance was requested. PR #49 is merged as
`8ed8e879dffd1eba04614eeaa2a5fc48ac517f45`; its
[main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34228276396)
was independently confirmed completed/success. The rollout is **not complete**.

## Provider backup preparation

Using authenticated Neon Console, created a new branch from current production
main with both data and schema and a seven-day auto-delete policy. Creation was
verified on the new branch page. Existing branches, snapshots, production data,
roles, credentials, access settings and plan were not changed. The actual branch
ID remains in Neon and is intentionally not included in this public record.
The exact expiry must be re-read before constructing a run-bound approval.

The new backup and production main were independently queried through their
respective SQL Editor targets. A single read-only SELECT returned:

| Check                     | Production                                                         | New backup |
| ------------------------- | ------------------------------------------------------------------ | ---------- |
| Expected database         | true                                                               | true       |
| Migration records         | 3                                                                  | 3          |
| Topics                    | 62                                                                 | 62         |
| Search documents          | 0                                                                  | 0          |
| FTS migration registered  | false                                                              | false      |
| Topic data SHA-256        | `f4a4697dc8a1df2c7dc288b35bb7bc7192aeb6e0764f237540f384233be1026e` | same       |
| Migration records SHA-256 | `5afb12b3cfcf34c022a82b9e448df1874308181ee36b09c5e6182099d905c895` | same       |

Each digest is computed inside PostgreSQL over newline-joined `to_jsonb(row)::text`
values, sorted by that text using C collation, UTF-8 encoded, then SHA-256 hashed.
No business rows or credentials were exported. The SQL Editor initially did not
display a complete multi-statement result; that attempt is not acceptance evidence.
A separate ROLLBACK reported no transaction in progress, and the final single-SELECT
results above were visibly verified on both targets.

These checks establish readability and parity of the selected data, **not** a full
database comparison, provider restore rehearsal, complete ACL recovery or search
acceptance. Create-child was disabled on the new branch page; no API workaround,
upgrade or destructive reset was attempted.

## Maintenance window and isolated recovery preparation

The operator explicitly confirmed the requested DDL/ACL and production-release
freeze in the follow-up message "确认". This confirms the freeze for this acceptance
window, not successful restoration, historical ACL-gap acceptance or a workflow's
manual Environment approval.

Neon disabled both expiring FTS backup branches in the parent selector, while
non-expiring branches remained selectable. A separate data-and-schema recovery
baseline was therefore created from main with auto-delete set to Never. Its
creation and enabled Create child branch action were verified. Existing backups
were retained; no plan upgrade or production mutation was performed. This new
non-expiring baseline will require an explicit retention/cleanup follow-up.

An isolated data-and-schema child, `fts1-restore-rehearsal-20260908`, was created
from `pre-fts1-recovery-20260908` with one-day auto-delete. Its creation and parent
relationship were verified in Neon. The Reset from parent confirmation explicitly
targets only this rehearsal child and replaces its databases and roles from the
recovery baseline. Neon labels the operation irreversible and warns that child
connections will be interrupted. The operator subsequently answered "同意" to the
explicit request to reset only this child. The final Reset was clicked after
re-reading the exact target and source. The confirmation closed and the child
became accessible again. No production or backup-baseline reset was performed.

After reset, a fresh single-SELECT query on the child returned the expected
database, 3 migration records, 62 Topics, 0 search documents, and FTS migration
not registered. Both SHA-256 values matched the table above. The same query was
then run independently on the non-expiring recovery baseline and returned exactly
the same counts and digests (child query 195 ms; baseline query 200 ms).

This records execution of the provider's Reset from parent path and subsequent
selected-data parity. No deliberate corruption was introduced beforehand, and
this is not a complete schema/ACL comparison or an ACL restoration-SQL rehearsal.
Those remaining gates must not be marked complete from this result alone.

The new non-expiring baseline has no actual expiry timestamp. The deployed approval
contract requires a real finite `backupExpiresAt`; no timestamp has been invented
and no approval has been constructed. Retention must be reconciled before using
this baseline for a credentialed maintenance approval. After the rehearsal, the
baseline's Set expiration menu item was independently observed disabled. No child
was deleted and no expiry setting was changed to work around this restriction.

The operator subsequently approved a code change to support explicit non-expiring
backup declarations. The implementation submitted for review accepts
`backupNeverExpires: true` only when `backupExpiresAt` is absent, rejects ambiguous
or mistyped declarations, and retains approval expiry, run binding and all other
recovery/disclosure checks. This is not deployed: PR review, merge and main CI are
still required. No production approval or Secret was updated for this change.

Local code validation for this compatibility change: database package Vitest
371 passed / 35 skipped; ESLint passed for the changed runner and test; workflow
validation passed for 4 workflows and 14 immutable Action references; Prettier
and `git diff --check` passed. This validation did not connect to production and
does not replace the skipped database integration checks or production acceptance.

## Remaining gates

- The maintenance freeze is confirmed; it must still be bound to the exact
  operation, commit, workflow run and approval expiry before execution.
- Environment metadata shows the two connection Secret names. Neither
  `MAINTENANCE_BACKUP_ID` nor `MAINTENANCE_APPROVAL` has been added in this checkpoint.
- Independently verify the provider restore path, then use the real backup and
  actual freeze confirmation for the run-bound ACL capture approval. Do not
  mark `backupVerified` merely from the counts above.
- Capture and review the current ACL twice, archive its evidence under the
  explicitly authorized public policy, review restoration SQL and rehearse on an
  isolated target. Historical ACL evidence gap handling remains a separate gate.
- Only after those gates: migration, schema verification, reviewed backfill,
  Runtime ACL and preflight checks, shadow parity, database cutover and acceptance.

No maintenance workflow was dispatched during this checkpoint. No production
migration, backfill, ACL mutation, password rotation or Vercel configuration
change was executed. The website search mode has not been changed by this work.

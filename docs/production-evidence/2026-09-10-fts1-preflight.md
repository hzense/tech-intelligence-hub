# FTS-1 production preflight and current-state checkpoint

## Confirmed scope

The operator requested FTS-1 production rollout, declined further recovery
verification/rehearsal, and approved the explicit risk-acceptance implementation
in PR #56. The operator subsequently confirmed that other production releases
and database DDL/ACL changes are paused for this maintenance window.
This is not evidence that recovery was verified or that a migration ran.

## Hosted preflight

- Main: `9220df03d88ebb3c43461fc8317bd289246b2e81`.
- [Main CI](https://github.com/hzense/tech-intelligence-hub/actions/runs/34497860991):
  completed/success; main remained at this SHA during the checkpoint.
- [Production maintenance #3](https://github.com/hzense/tech-intelligence-hub/actions/runs/34498279486):
  operator-approved, completed/success, same SHA.
- Execute step at `2026-09-10T15:52:29.501Z` returned:

```json
{ "operation": "preflight", "status": "succeeded", "pendingMigrationCount": 1 }
```

The existing backup branch was visible in Neon, with parent main. Its expiration
checkbox was unchecked. The dialog was cancelled without changing any setting.
Existence and retention do not prove backup freshness, data parity, or restoration.

## Browser read-only production checks

The Neon UI selected production main and database `hzense`. A bounded,
repeatable-read/read-only transaction confirmed:

- authenticated role `hzense_migrator`, with session user equal to current user;
- PostgreSQL `180006`, transaction read-only `on`;
- all three expected Neon identity settings present, nonempty and postmaster;
- production identity digest
  `4de787f9e9c20f0fe8694e5641ccb0a27736f9d5b5fc6360b18593a0e993d3e9`;
- Search physical columns: 10; enabled event triggers: 0.

The shared query from `db/roles/fts_acl_recovery_state.sql` was then run in two
separate repeatable-read/read-only transactions, each ending with ROLLBACK.
An additional SELECT recorded query time and connection identity. Neither query
read business rows, credentials, or changed database privileges.

| Observation                  | First transaction                                                | Second transaction                                               |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Database-recorded time (UTC) | 2026-09-10 16:00:38.28444                                        | 2026-09-10 16:01:24.232305                                       |
| Backend PID                  | 1118                                                             | 1118                                                             |
| Database/role                | hzense / hzense_migrator                                         | hzense / hzense_migrator                                         |
| Read-only                    | on                                                               | on                                                               |
| State fingerprint            | aa0d5c51e5d21e6f49dc1d47a3b4d0c9da26c12e9fe21cff66567408ead2b824 | aa0d5c51e5d21e6f49dc1d47a3b4d0c9da26c12e9fe21cff66567408ead2b824 |

The format is `hzense-fts-acl-state/v1`, **not** the hosted full baseline format
`hzense-runtime-acl-recovery-baseline/v1`. Nonempty category row counts were:
columns 112, databases 5, default privileges 4, identity 1, memberships 15,
relations 37, role settings 3, roles 23, routines 118, schemas 1, types 50.

These are matching directory summaries from the same backend, not two independent
connection captures, not full catalog evidence, and not proof that the historical
baseline still matches. Do not substitute this state digest for the reviewed full
baseline fingerprint in a production write approval.

## Remaining execution boundary

At checkpoint SHA `9220df0`, PR #56 permits explicit unverified-recovery acceptance only for `migrate` and
`search-apply`. The existing `acl-capture` path still requires `backupVerified:
true` and rejects the new recovery-policy fields. The new backup-presence-only
declaration is not supported there. Do not fabricate that declaration or relax
the capture code outside review to complete this rollout.

The operator subsequently agreed to a reviewed code fix extending this explicit
policy to read-only ACL capture, preserving disclosure consent, independent dual
capture, backup/target/retention and freeze declarations, and protected approval.
This change is pending PR review/merge and a new hosted capture; it does not
retroactively turn these browser summaries into complete ACL evidence. Before
continuing, recheck current main/CI, the backup and maintenance window, and bind
a fresh approval to the exact capture run. No additional rehearsal is planned.

`MAINTENANCE_APPROVAL` still has the previously observed September 9 update time;
its value was not retrieved, overwritten, or reused. No new migration run was
dispatched. No migration, backfill, ACL normalization, search-mode switch, branch
creation/reset/extension, or password change was performed in this checkpoint.

# FTS-1 ACL capture checkpoint — 2026-09-09

## Scope and execution status

The operator requested completion of rollout steps 1–6 in order. Current main is
`b4619e64f8e39d08bd9b6adcd9ebb2b4923b7626`; its
[CI run](https://github.com/hzense/tech-intelligence-hub/actions/runs/34247603794)
was re-read as completed/success immediately before dispatch.

The existing DDL/ACL and production-release freeze remains a prerequisite for this
window. The operator must not make competing changes while approving/executing
maintenance. No previous run approval was reused.

## Provider recovery revalidation

Neon Console listed six branches, including the non-expiring recovery baseline
and its one-day rehearsal child. No existing branch was deleted or reset today;
the separately authorized Reset from parent and subsequent data comparison are
recorded in the [September 8 checkpoint](./2026-09-08-fts1-release-checkpoint.md).

Three separate SQL Editor targets (recovery baseline, restored child, production
main; database `hzense`) ran the same single read-only catalog aggregation. All
14 returned category counts and SHA-256 values matched. Query durations were
415 ms, 433 ms and 476 ms respectively. Only counts and hashes were returned.

| Category     | Records | SHA-256 (same on all three targets)                                |
| ------------ | ------: | ------------------------------------------------------------------ |
| column_acls  |     112 | `78cc00cf13a377203bb0c64438a1688b74180806cae616de56c9c5d69e4efaa1` |
| columns      |      82 | `0bf9f9469ace5cfe900df46b345f691e94a878170f8c786e1f15d2b03b685006` |
| constraints  |     116 | `ab8dd5e24a09f1dda113a6405d7a7c2400a5ecd641ade9daee0937f47fd36498` |
| databases    |       5 | `689a7365bb81bdb4aa00847a28b9d2c8ad0e56c745e9dbc1fdb726615091af9e` |
| default_acls |       4 | `1cbab1def06a7f1a4d37e893e95b9bdf8568e58886a7c82d7bf83a89d83dc7fb` |
| enums        |      63 | `d471e9ab247555042278f3ddb7a00b5d110781d68ecf682074b862da2dbacaa3` |
| extensions   |       2 | `dfb632fbf5df510a91c938ea508a3314db1f27161208167dec2ed035c5954731` |
| indexes      |      24 | `063cba1f28c4839861b27f9dbf0659d8b5cc52028afe22995b45355850d9420e` |
| memberships  |      15 | `6e2c235e3966a0d8198e56f55ea52055e26e40447f9dd5fff17b53ad506874a3` |
| relations    |      37 | `b0887067d541961dc12a68f05c27c50183d892c917c3a6b23612a52f79e58a9d` |
| roles        |      23 | `8bbc2480f7c40714c8511f029c6f12e6e197a7860f6f5695da72811b594f6d14` |
| routines     |     118 | `9722f54cdb1cf5b19b75aacc5793f25ecaa7044ea15b74a568e8d982131ec43f` |
| schemas      |       4 | `37f1779cc2b8112f7e2e608ac8bb65025793bbb3b68b03e93d811fe4e34649ad` |
| types        |      50 | `ce35692a29b1a3bbd323394bc0f54f3df1496c3f1f38b53884f2893c7cc89372` |

The query hashes C-sorted, newline-joined JSONB record text, UTF-8 encoded. Its
scope is public-schema columns, constraint definitions/validation, indexes,
relation ownership/ACL/RLS/options, column ACLs, public types/routine metadata,
non-temporary namespace ownership/ACL, enums, default ACLs, role non-password
attributes/configuration, memberships, database ownership/ACL and extension
identity/version. Some categories bind catalog OIDs, appropriate for these
provider branch copies but not a portable logical-restore fingerprint. Routine
definitions, other databases' internal objects, all data rows, and every possible
schema/security path are not covered. This is not the hosted ACL baseline format
and cannot supply `aclFingerprint` or `restoreEvidenceFingerprint` for writes.

A fresh production data query also returned 3 migration records, 62 Topics and
0 search documents, with FTS migration still absent. Topic and migration row
digests match the September 8 record. No business rows or credentials were
exported. These checks support the reviewed provider-backup declaration for
**read-only capture**, together with the actual isolated provider reset; they do
not establish an ACL restoration-SQL rehearsal or close the historical ACL gap.

## Protected capture request

Added `MAINTENANCE_BACKUP_ID` and `MAINTENANCE_APPROVAL` only to the existing
`production-maintenance` Environment. Metadata readback confirms both names;
the two connection Secrets were not changed. The real backup ID and full approval
are not included here. Approval uses the merged non-expiring mode and is bound
to operation `acl-capture`, the exact main SHA, run `34326646837`, attempt `1`,
with expiry `2026-09-09T10:00:00Z` (12:00 Europe/Berlin).

[ACL capture run](https://github.com/hzense/tech-intelligence-hub/actions/runs/34326646837)
was dispatched and independently re-read as **waiting** for the configured human
reviewer. The agent did not approve the Environment or bypass protection rules.
Current permissions still require the configured reviewer, main branch only,
and disallow administrator bypass.

After the operator reported approval, the run was re-read as completed/success
at `2026-09-09T08:12:23Z`, including the exact artifact upload step. Artifact
`acl-evidence-34326646837-1` contains two matching, independently rebuilt baselines.
The verified original and review are proposed for permanent archival under
[`acl/34326646837-1/`](./acl/34326646837-1/review.md). Capture is complete; permanent
main-branch archival remains subject to PR review/merge. The capture approval
must not be reused for writes or another run.

Steps 2–6 remain pending: full ACL baseline review/archival, reviewed restore SQL
and isolated verification, historical evidence-gap resolution, production
migration/backfill, Runtime permission checks, shadow/database cutover and final
acceptance/cleanup. No production migration, ACL mutation, backfill, password
rotation or Vercel configuration change was performed in this checkpoint.

# ACL baseline review — capture 34326646837, attempt 1

## Status

**Baseline integrity review passed; recovery approval remains pending.**
This archive contains the actual hosted capture, not a generated example.
No `restore.sql` is supplied yet because a complete restore plan has not been
reviewed and rehearsed. Do not set `restoreRehearsed` or `aclRecoveryReviewed`
from this document, and do not use its hash as approved restoration evidence.

## Provenance and verification

- [Run](https://github.com/hzense/tech-intelligence-hub/actions/runs/34326646837):
  completed/success, with Environment approval performed by the operator.
- Executed commit: `b4619e64f8e39d08bd9b6adcd9ebb2b4923b7626`.
- Exact artifact: `acl-evidence-34326646837-1`; GitHub reports it unexpired.
- GitHub-reported artifact archive digest:
  `sha256:12b87159ba886f12286c9e09540a7982910eb9fc636a2c8ad7ee6cd707a6d7e5`.
  This is provider metadata, not an independently recomputed ZIP digest.
- Extracted [baseline.json](./baseline.json): 459165 bytes; independently computed
  file SHA-256 `225815bd5317c8497f8b05076d311c651eaad12375c66bd22e7a424eab454c38`.
- Two captures: `2026-09-09T08:12:16.527Z` and `2026-09-09T08:12:18.773Z`.
- Both state fingerprints:
  `4e1732e0bc4efd3a59f1a973dae0af9de2c0b6e585499e46294cba3da016c30b`.
- Both hashed provider-backup references:
  `9fc66f42be24c4afd70e05562e6729ca57bd5b131618500f0ef1117fa45aa8f8`.

Both complete baseline objects were reconstructed using the checked-in
`buildRuntimeAclBaseline` and compared deeply, including normalized records,
category row counts/fingerprints, metadata and top-level fingerprint. Repository,
run/attempt, SHA, distinct capture timestamps and read-only owner identity were
checked. The extracted file is preserved without reformatting.

| Category          | Rows per capture |
| ----------------- | ---------------: |
| columns           |               82 |
| databaseAccess    |               24 |
| databases         |               24 |
| defaultPrivileges |               13 |
| enumTypes         |               11 |
| memberships       |                1 |
| relations         |              108 |
| roleMemberships   |               15 |
| routines          |              236 |
| runtimeRole       |                1 |
| schemas           |                6 |

The hosted serializer enforced exclusion of its actual credentials, connection
host and raw backup ID before uploading the approved artifact. Review additionally
rebuilt the baseline through the credential-field checks and scanned the file
for database URLs, Neon hostnames, private-key markers and the known raw backup
identifier; none were present. No production credential was retrieved for this
review. File inspection does not query the production database.

## Current ACL findings

- Runtime role: LOGIN, NOINHERIT, connection limit 20, role default read-only;
  no superuser, create-role, create-database, replication or bypass-RLS capability.
- Runtime has five non-grantable Topic column SELECT grants:
  `id`, `title`, `parent_id`, `status`, `runtime_enabled`; no relation-level grants.
- `topic_status` USAGE and public-schema USAGE are present for Runtime.
- Topic sync retains SELECT/INSERT/UPDATE on Topics and SELECT on migration
  history. A restore must preserve these other-role permissions.
- Provider-controlled memberships, routine grants and default privileges exist.
  In particular, the Runtime membership from `neondb_owner` is ADMIN-only with
  INHERIT/SET false. Do not normalize or regenerate provider ACLs merely because
  they appear in the archive.

This is a catalog review, not a successful Runtime credential preflight or proof
of database-global enforced read-only behavior. The provider exceptions and
residual governance boundaries in `DEPLOYMENT.md` still apply.

## Required next recovery work

1. Resolve the historical ACL gap: inspect a surviving pre-mutation branch/PITR,
   or obtain explicit operator acceptance of the missing historical evidence and
   establish this current-state baseline. Permission to publish is not acceptance
   of that gap; neither is an instruction to continue rollout.
2. Review the exact FTS migration and Runtime ACL delta against this snapshot.
   Separate schema/data rollback through the provider backup from ACL rollback.
   Restoring pre-FTS ACLs must not accidentally remove Topic sync access or rewrite
   provider-owned objects. Added search columns mean a post-migration full catalog
   cannot simply be compared to the pre-migration fingerprint without explanation.
3. Write and independently review the scoped recovery SQL with exact target,
   identity/ownership, transaction and drift guards; do not execute a generic
   grant/revoke reconstruction over all captured principals.
4. Rehearse on an isolated target, then perform fresh independent catalog capture
   and the appropriate Runtime credential verification. Verify branch lifetime
   before execution; the existing rehearsal child has automatic expiry.
5. Only bind write approvals to real reviewed restoration evidence after these
   checks. Baseline capture success does not authorize migration/backfill/cutover.

The baseline is proposed for permanent repository archival through PR review.
Until merged, this is not a completed permanent main-branch archive. The Actions
artifact has limited retention, so retain the reviewed repository copy.

# Production operations checkpoint — 2026-09-04

## Result

**PARTIAL / EXTERNAL BLOCKERS RECORDED** — the Continuous Daily repository
gate is blocked by an organization policy, the historical Hosted Alpha remains
public pending explicit authorization to restrict it, and the repository does
not contain enough pre-change evidence to reconstruct the historical Runtime
ACL state. An existing credential-handling exposure risk had already created
the normal rotation trigger; the operator knowingly chose to defer that
rotation during this work cycle. The separate bounded production database
health-alert path and forward-only Runtime ACL tooling were deployed and
accepted later in the checkpoint. Neither acceptance closed any of the four
unresolved items above.

This checkpoint preserves only sanitized state and decision evidence. It does
not supersede the earlier Runtime ACL, preflight or production-acceptance
records.

## Continuous Daily publication gate

The repository settings were read again on 2026-09-04 and reported:

- default workflow-token permission: `read`;
- `can_approve_pull_request_reviews`: `false`;
- repository variable `CONTINUOUS_DAILY_PUBLISH_ENABLED`: absent.

A narrowly scoped repository-settings request preserved the read-only default
and attempted to enable only the Actions pull-request capability. GitHub
rejected it with HTTP `409` because the organization does not allow GitHub
Actions to create or approve pull requests. The failed request changed no
repository setting. The fail-closed sequence stopped at that point: it did not
create the publication variable, dispatch the workflow, create an
`automation/daily-*` branch or open a Daily pull request.

This is an external organization-policy blocker, not a workflow-code failure.
An organization owner must first allow the capability. After that change, an
operator must re-read the repository setting, set the publication variable,
run the controlled workflow and verify that any candidate remains a Draft PR
subject to the existing human publication boundary.

## Production-health cadence observation

The most recent scheduled production-health record before this checkpoint was
[run 33837392325](https://github.com/hzense/tech-intelligence-hub/actions/runs/33837392325),
created at `2026-09-04T04:35:46Z` for `main@0b14a62` and completed successfully.
No later scheduled record was present before the controlled manual dispatch at
`2026-09-04T08:39:29Z`.

The manual [run 33854492063](https://github.com/hzense/tech-intelligence-hub/actions/runs/33854492063)
completed at `2026-09-04T08:39:44Z`; its
[`database-health` job](https://github.com/hzense/tech-intelligence-hub/actions/runs/33854492063/job/100964538956)
passed the existing exact HTTP 200 body, `Cache-Control: no-store` and less-than-eight-second
contract against the same `main@0b14a62` commit.

The absence of another scheduled record in that interval is recorded as a
scheduling-gap or delay observation only. It does not prove workflow failure,
database downtime or continuous health between probes. The successful manual
run proves only the bounded contract at that run time, and it predates any
detailed database-alerting change.

## Production database health-alert acceptance

[PR #40](https://github.com/hzense/tech-intelligence-hub/pull/40) merged at
`2026-09-04T08:50:59Z` as
`main@0012871acc1e293f3840b8e768f8ee1602590442`. Vercel Production deployment
`dpl_CvgXMJddp4QmKB1idta7hUaTzbfo` reached `READY` for that exact commit. A
direct request at `2026-09-04T08:51:41Z` returned HTTP `200`, exact body
`{"status":"ok"}`, `Cache-Control: no-store`, no `Retry-After`, and total time
`1.594908s`. The selected Vercel route view contained no runtime errors in its
preceding ten-minute window.

The controlled [run 33855492933](https://github.com/hzense/tech-intelligence-hub/actions/runs/33855492933)
first passed the real production health probe and then deliberately failed the
`Exercise controlled alert path` step. Its overall `failure` conclusion was
therefore expected test behavior, not a failed production probe. The
[`health-incident` job](https://github.com/hzense/tech-intelligence-hub/actions/runs/33855492933/job/100967745578)
succeeded and created the single open bot incident
[Issue #43](https://github.com/hzense/tech-intelligence-hub/issues/43) carrying
the fixed database-health marker.

The recovery [run 33855536113](https://github.com/hzense/tech-intelligence-hub/actions/runs/33855536113)
then completed both jobs successfully. The same Issue #43 received exactly one
bot recovery comment and closed at `2026-09-04T08:52:41Z`; no duplicate
marker-matching incident was created. This verifies the bounded
probe-to-singleton-issue-to-recovery transition against the merged production
commit.

The accepted application boundary safely classifies PostgreSQL connection
capacity (`53300`), query cancellation (`57014`), generic query failure and a
total health duration at or above five seconds; it keeps local pool total,
idle and waiting counts in sanitized logs. It does not claim direct Neon
PgBouncer client-capacity telemetry, continuous health between probes, or
provider-side threshold alerting.

## Hosted Alpha access audit

The historical Hosted Alpha was inspected read-only on 2026-09-04:

- lifecycle state: `active`;
- current version: `6`;
- access mode: `public`;
- owners: `1`;
- external visitors: `0`;
- workspace or tenant access groups: `0`;
- anonymous HTTP check: `200`;
- formal production site `https://hzense.com/`: HTTP `200`.

No access setting was changed. The counts above deliberately omit owner
identity, and this record contains no access token or bypass material. The old
site therefore remains publicly reachable even though `hzense.com` is the sole
formal production site.

Changing the old site from public to owner-only would remove public access and
requires explicit operator authorization. After authorization, the reversible
retirement sequence is to retain the sole owner, remove every non-owner access
path, verify that an anonymous request is denied, and independently confirm
that `https://hzense.com/` remains healthy. Permanent deletion is a separate,
destructive decision and is not authorized by this checkpoint.

## Runtime ACL recovery-evidence gap

The sanitized 2026-09-01 catalog checks prove that the then-current target
Runtime ACL matched the reviewed five-column allowlist. They do not preserve a
pre-normalization catalog dump, backup identifier, mutation actor or mutation
timestamp. No other tracked repository artifact supplies those missing fields.
Provider backup or point-in-time-recovery history predating the normalization was
not inspected in this checkpoint, so the repository cannot currently produce a
reviewed reverse plan for the historical pre-change ACL state.

Do not run `configure_runtime_reader.sql` or any equivalent destructive ACL
normalization again until an operator has:

1. inspected provider backup/PITR availability for any recoverable historical
   state;
2. independently verified a new recoverable provider backup for the planned
   maintenance window;
3. captured the complete current cluster/database ACL baseline twice under a
   DDL freeze and matched its deterministic fingerprints; and
4. prepared and reviewed a manual restoration plan, then rehearsed it on an
   isolated restore.

A future current-state baseline capture can protect later maintenance windows,
but it cannot infer the already-missing historical pre-change state. A capture
artifact is also not executable restoration SQL and does not itself prove
provider recoverability.

The forward-only repository contract merged through
[PR #42](https://github.com/hzense/tech-intelligence-hub/pull/42) for a future
maintenance window has four fail-closed properties:

1. it requires the raw provider backup identifier only through the protected
   `HZENSE_RUNTIME_ACL_BACKUP_ID` environment variable, emits only a
   `hzense-runtime-acl-backup-reference/v1` domain-separated SHA-256 reference,
   and binds that reference into the top-level baseline fingerprint;
2. after `BEGIN`, the capture fixes the transaction `search_path` to
   `pg_catalog, pg_temp` before TLS-evidence or catalog-inspection queries;
3. the snapshot preserves an explicit-empty default ACL as
   `aclState: "explicit"` instead of collapsing it into a missing/default row;
   and
4. before its first mutation, `configure_runtime_reader.sql` requires the same
   protected session to contain non-placeholder lowercase 64-hex values for
   `hzense.runtime_acl_backup_reference` and
   `hzense.runtime_acl_reviewed_fingerprint`.

Those declarations bind operator intent but do not verify external state. The
capture remains marked `providerApiVerified: false`; it does not prove that the
declared backup exists or can be restored, or that a human reviewed the
baseline. At this checkpoint, provider backup existence/recoverability for this
new gate has not been verified and no production Runtime ACL baseline has been
captured.

### PR #42 repository and deployment acceptance

An earlier PR #42 CI attempt exposed SQLSTATE `22023` (`ACL arrays must be
one-dimensional`) in empty column-ACL array handling. The corrected final head
passed all jobs in
[CI run 33856857848](https://github.com/hzense/tech-intelligence-hub/actions/runs/33856857848),
including `database-migrations`, and PR #42 squash-merged at
`2026-09-04T09:12:27Z` as
`main@0806e349cc3626199325570a224c13285fcac4ed`.

Vercel Production deployment `dpl_A6Z5U3LW8fzzkH5caJzMw7oxCk6Q` reached
`READY` for that exact commit. A direct request at
`2026-09-04T09:13:10Z` returned HTTP `200`, exact body `{"status":"ok"}`,
`Cache-Control: no-store`, and total time `1.404646s`. The selected Vercel route
view contained no runtime errors in its preceding ten-minute window.

This accepts the repository implementation, isolated PostgreSQL integration
gate and production deployment compatibility only. No Runtime ACL baseline was
captured from the production database, no provider backup or PITR record was
inspected or verified, and no production `configure_runtime_reader.sql`,
`GRANT`, `REVOKE`, `ALTER` or other database mutation was executed. The merged
tool is therefore available for a future protected maintenance window, but it
does not close or reconstruct the historical recovery-evidence gap.

## FTS-0 PR #41 production acceptance

[PR #41](https://github.com/hzense/tech-intelligence-hub/pull/41) final head
`6ad92d87a5b375d985e024fff159ffe64f0d7514` passed
[CI run 33857784633](https://github.com/hzense/tech-intelligence-hub/actions/runs/33857784633):
`foundation`, `database-migrations` and `daily-publication-gate` all completed
successfully. The final independent review reported no remaining Blocker, High
or Medium finding. Search tests passed `23/23`, targeted Web tests passed `3/3`,
and the final tie-break fix orders otherwise fully tied results by ordinal type
and document ID, producing a total order independent of source iteration.

PR #41 squash-merged at `2026-09-04T09:23:50Z` as
`main@83654c48d210002a19e5f6955a223cbf95e7bc87`. Vercel Production deployment
`dpl_Ggv8pzRwXWPao2AtKfARiHUJBAVV` reached `READY` for that exact commit. The
production request `/search?q=OpenAI` returned HTTP `200` with the expected five
results. At `2026-09-04T09:25:17Z`, `/api/health/database` returned HTTP `200`,
exact body `{"status":"ok"}`, `Cache-Control: no-store`, and total time
`1.384790s`. The selected ten-minute Vercel views for `/search` and
`/api/health/database` contained no runtime errors.

This accepts FTS-0 only: the canonical six-source Search Document projection,
stable serialization/fingerprint, extracted deterministic in-process ranker
and production compatibility. It did not add or apply a database Migration,
persist documents to PostgreSQL, configure a tokenizer or FTS index, run a
backfill, or switch the production search query path to PostgreSQL. Those
database-backed FTS-1 stages remain separately reviewed future work.

## Runtime credential retention decision

The existing rotation follow-up came from a previously recorded
credential-handling exposure risk. The operator was informed of that residual
and explicitly chose to defer rotation for this work cycle. During this
checkpoint, the credential value was not read, copied or recorded; no Neon role
credential, Vercel Production variable or deployment configuration was changed.
The functional/configuration record from 2026-09-03 therefore remains the
latest credential and complete database-preflight evidence. The later PR #40
and PR #42 deployment checks in this checkpoint establish exact-commit Web
compatibility only; they are not a fresh database preflight, credential change
or rotation.

Deferral does not lower the credential classification, erase the existing
exposure-derived residual or convert rotation into a completed control. The
credential remains highly sensitive and the rotation obligation remains open.
New evidence of misuse or additional exposure, unexpected authentication
activity, an access/ownership change or another incident/policy trigger requires
escalation. When rotation is performed, it must use the protected workflow and
repeat preflight, redeployment, bounded health/read and safe-log verification.

## Evidence boundary

This record contains no database URL, host, port, database user, password,
environment-variable value, provider project/branch/backup identifier, owner
identity, access token, bypass material or database row. HTTP `200` observations
prove reachability only; they do not prove content parity, database health or
access retirement. The rejected GitHub request proves the observed policy gate
at that time only and does not authorize an organization-level policy change.
A green manual health run does not establish schedule continuity. The PR #40
acceptance proves its bounded application-health incident transition, but does
not replace provider-side client-capacity telemetry or independent pool and
database threshold monitoring. PR #42's green CI and Web deployment do not
prove a provider backup, production ACL capture, reviewed restoration plan or
production database change; none was performed in this checkpoint.

PR #41 acceptance proves FTS-0 compatibility only. It is not evidence that the
future FTS-1 database Migration, persistence, index, backfill, query parity or
cutover occurred.

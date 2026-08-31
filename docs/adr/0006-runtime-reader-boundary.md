# ADR 0006 — Runtime Reader boundary

Status: Accepted.

## Context

The authoritative Taxonomy was projected to production PostgreSQL on 2026-08-31. Independent evidence confirmed 3 Migrations with 0 pending, 62 Topics, 0 unknown rows, the reviewed fingerprint and a 0-change no-op rerun. That completed projection does not authorize the Web application to reuse the Migrator or Topic Sync Writer.

The first runtime path needs one real database read and one health endpoint without exposing a broad ORM session, production identity, SQL text or credentials. Preview and CI must remain independent of production PostgreSQL.

## Decision

### Database role and ACL

The only Web database role is `hzense_runtime`. The provider or cluster administrator must create it with:

```text
LOGIN NOINHERIT CONNECTION LIMIT 20
NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
zero role memberships
default_transaction_read_only = on
```

The session default is a provider/cluster-administrator prerequisite. PostgreSQL 18 does not let the restricted database owner alter another role's defaults, so [`configure_runtime_reader.sql`](../../db/roles/configure_runtime_reader.sql) and [`runtime-reader-preflight.mjs`](../../packages/database/src/runtime-reader-preflight.mjs) verify it and fail closed instead of trying to set it.

Within the target database, the role receives only:

- target database `CONNECT`;
- `public` Schema `USAGE`;
- application enum type `topic_status` `USAGE`;
- column-level `SELECT` on `topics(id, title, parent_id, status, runtime_enabled)`.

Because PostgreSQL roles and database ACLs are cluster-wide, the provider or cluster administrator must also ensure that `hzense_runtime` has no effective `CONNECT`, `CREATE` or `TEMPORARY` on any other database whose `datallowconn` is true. PostgreSQL privileges are additive, so revoking a direct grant from `hzense_runtime` does not cancel a `PUBLIC` grant; the administrator must remove the relevant ambient grant while preserving reviewed direct access for other principals. The target-database owner script cannot safely make that cluster-wide change. Both the owner-side guard and restricted-role preflight enumerate the cluster catalog and fail closed on drift. A dedicated provider project is not sufficient evidence by itself because managed PostgreSQL can still contain reserved databases such as `postgres` and `template1`; rollout remains blocked until the live checks pass.

It receives no access to `metadata`, Migration history, other HZense tables or columns; no HZense-relation write, application DDL, `TEMPORARY`, Sequence, application routine, database/Migration-owner future-object `PUBLIC` default privilege, any principal's direct future-object default grant to Runtime, application-object ownership, grant option or role membership. All other application enum type privileges are removed. Other principals that can create application objects remain an external DDL-governance concern and must be included in the deployment inventory and freeze; the preflight rejects resulting effective Runtime access but does not rewrite every principal's `PUBLIC` defaults. `SECURITY INVOKER` pgvector functions may retain existing `PUBLIC EXECUTE` only when each routine owner equals the extension owner and that owner is neither Runtime nor the database owner. Routine auditing spans every non-system Schema without relying on Schema `USAGE`, preventing a private function from being reached indirectly through a public operator or cast. Any executable non-system `SECURITY DEFINER` routine, non-pgvector application routine, non-system PostgreSQL table-inheritance edge or path that bypasses application-table ACLs fails preflight.

The Type denylist claim is deliberately limited to non-system application enums. Provider-owned extension and other non-enum Types are outside that claim; they do not expand the fixed Web projection, and this ADR does not represent their ambient PostgreSQL `USAGE` as removed.

This is a least-privilege contract for the HZense application Schema and the fixed Web query, not proof of an immutable database-wide read-only principal. `default_transaction_read_only` is a user-settable default, and PostgreSQL system facilities such as Large Objects can permit an ordinary login to create database objects it owns. A provider-enforced read replica or cluster-administrator hardening of those system routines is required before claiming database-wide non-writability. The Runtime credential therefore remains highly sensitive.

### Connection and environment

`HZENSE_RUNTIME_DATABASE_URL` is a server-only, pooled, Production-only secret. It must use PostgreSQL, include an explicit port, set `sslmode=verify-full` and `channel_binding=prefer`, use an approved Neon hostname ending in `.neon.tech` with a pooler marker, match separately configured expected host / port / database / user, and authenticate as `hzense_runtime`. The Web driver also sets `enableChannelBinding: true`; stable `pg@8.23` uses SCRAM-SHA-256-PLUS when offered but does not implement fail-closed `require`, so this ADR does not claim that stronger property. `NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected.

Web request-time validation reads:

- `HZENSE_RUNTIME_EXPECTED_HOST`;
- `HZENSE_RUNTIME_EXPECTED_PORT`;
- `HZENSE_RUNTIME_EXPECTED_NAME`;
- `HZENSE_RUNTIME_EXPECTED_USER`.

`HZENSE_RUNTIME_EXPECTED_POSTGRES_MAJOR=18` and `HZENSE_RUNTIME_EXPECTED_CONNECTION_LIMIT=20` are non-sensitive deployment-preflight defaults, not Web request-time inputs. During rollout, the URL and expected connection identity must be supplied only through protected operator or Vercel Production configuration. Preview and CI receive none of those production connection values.

The server-only client creates a lazy singleton `pg.Pool` only during a request when `VERCEL_ENV=production`; its process-local maximum is 1. Builds do not initialize the pool. Preview, CI and any non-production request fail closed.

### Query, health and logs

The only initial business query reads from `ONLY public.topics`, selects the five allowed Topic columns, filters `runtime_enabled IS TRUE`, orders by `id` and uses a parameterized integer `LIMIT` from 1 through 50. `ONLY` excludes inherited child rows even before the independent inheritance checks run. Health uses a limit of 1.

`/api/health/database` is a dynamic Node.js route with a maximum duration of 10 seconds, covering the 3.5-second connection timeout and 3-second query timeout with platform cleanup headroom. Project-level [`apps/web/vercel.json`](../../apps/web/vercel.json) pins the Function to `iad1`; the route does not use the deprecated route-level region export. It always sends `Cache-Control: no-store`:

- success: HTTP 200 and only `{"status":"ok"}`;
- failure: HTTP 503 and only `{"status":"unavailable"}`, with `Retry-After: 5`.

Structured server logs may include only event, outcome, duration in milliseconds, request ID, a safe error code, SQLSTATE and pool total / idle / waiting counts. They must not include the URL, host, database, user, SQL, parameters or raw error.

## Consequences

- The deployed Web path is bounded to one fixed `SELECT`, and application-Schema ACLs deny HZense data mutation or unrelated inspection; the credential is not claimed to be database-wide immutable read-only.
- Migrator, Topic Sync Writer and Runtime Reader credentials remain non-interchangeable.
- Preview and CI verify fail-closed behavior without production database access.
- PostgreSQL major, role attributes, cross-database isolation and ACL drift are deployment-gate concerns; the request path remains bounded to connection identity and one query.
- The reproducible deployment gate is `pnpm db:preflight:runtime:production`; it accepts only the protected `HZENSE_RUNTIME_*` environment contract and a pooled production endpoint.
- Moving from channel-binding preference to strict requirement is a future driver-upgrade gate: it requires stable upstream support plus full authentication-flow tests covering alternate, absent and pipelined authentication; private driver hooks are not accepted.
- A healthy repository build does not prove provider or Vercel state.

This preparation branch records and implements the repository boundary, pending merge. Provider role creation and ACL application, Vercel Production variables, redeployment, live health response, real five-column query and safe-log verification remain `not_executed`.

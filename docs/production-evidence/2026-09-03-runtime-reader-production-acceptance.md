# Runtime Reader production acceptance — 2026-09-03

## Result

**FUNCTIONAL / CONFIGURATION PASS** — the Runtime Reader is configured in
Vercel Production, the runtime-configured deployment is `READY`, the public
database health route executes the bounded Topic query successfully, safe
runtime logs are present, and the scheduled production-health gate is enabled.
Post-acceptance credential rotation remains an open security follow-up; the
current credential must continue to be treated as high sensitivity until it is
replaced and the same acceptance sequence is repeated.

## Release identity

- Repository commit: `45af242e7274c71f67815cd687ac1fe56b166a4b`
  (`main`, PR #38)
- Vercel deployment: `dpl_3ALVUyh2MmHTmJxoN3oqC2Bot2Be`
- Deployment source: controlled redeploy of the same `main` commit
- Deployment target / region / state: `production` / `iad1` / `READY`
- Public alias verified: `https://hzense.com`

The preceding deployment was created before the Runtime variables were saved
and is not used as acceptance evidence.

## Production configuration

The following five server-only variables were present with **Production-only**
scope before the accepted deployment was triggered:

- `HZENSE_RUNTIME_DATABASE_URL`
- `HZENSE_RUNTIME_EXPECTED_HOST`
- `HZENSE_RUNTIME_EXPECTED_PORT`
- `HZENSE_RUNTIME_EXPECTED_NAME`
- `HZENSE_RUNTIME_EXPECTED_USER`

No value is recorded here. Preview and CI were not given the production
connection contract.

## Public health acceptance

The first request to `/api/health/database` after the deployment became ready
returned:

- HTTP status: `200`
- Exact response body: `{"status":"ok"}`
- Response size: 15 bytes
- Cache policy: `Cache-Control: no-store`
- `Retry-After`: absent on success
- Total request time: 1.540891 seconds

Three immediate repeat requests independently returned the same HTTP status,
body and cache contract in 0.675430, 0.334357 and 0.380793 seconds. This initial
four-request sequence passed before the repository health variable was
enabled. A later confirmation at 2026-09-03 15:34:15 UTC, after enablement,
returned the same contract in 0.235796 seconds.

This is a database-backed check, not a configuration-only response. The route
calls `readRuntimeTopics(1)`, which issues the fixed parameterized query against
`FROM ONLY public.topics`, selects only
`id, title, parent_id, status, runtime_enabled`, requires
`runtime_enabled = true`, orders by `id`, and rejects an empty result.

## Runtime logs

During the initial acceptance window, four structured
`runtime_reader_health` events with outcome `ok` were observed. Their recorded
durations were 695, 55, 4 and 4 ms. Every observed event reported:

- `pool_total = 1`
- `pool_idle = 1`
- `pool_waiting = 0`

Those four requests were cache misses, so the observations came from the
runtime route. A route-scoped runtime-error query over the selected ten-minute
window returned no errors; the exact UTC window endpoints were not retained.
The four inspected log records contained no connection URL, host, database,
user, SQL, query parameters or raw exception.

## Continuous health gate

The GitHub repository variable `PRODUCTION_DATABASE_HEALTH_ENABLED` was set to
`true` only after the initial four-request acceptance passed. The first
controlled manual run of [Production database health](https://github.com/hzense/tech-intelligence-hub/actions/runs/33773126074)
completed successfully against the same commit:

- Event: `workflow_dispatch`
- Head SHA: `45af242e7274c71f67815cd687ac1fe56b166a4b`
- Job: `database-health` (`100708110535`)
- Contract step: success

The existing `17 * * * *` schedule is therefore enabled. A green run proves the
bounded public health contract at that time; it is not a substitute for
connection-capacity, pool-wait, query-latency, timeout and error alerting.

## Evidence boundary

This record contains no environment-variable value, database connection URL or
endpoint, database host, port, database, user, password, token, provider
project/branch identifier, session identifier or database row. Database
identity, TLS, role, ACL and reserved-database catalog checks are covered separately by the
[production preflight evidence](./2026-09-03-runtime-reader-preflight.md).

# FTS-1 production database search — cutover verified

Verified on 2026-09-11 (Europe/Berlin); machine timestamps below are UTC.

## Release identity

- Commit: `f72ccb920bd04ad039dccd5eb555e5aa78b24abc` (unchanged main, successful CI `34530817393`).
- Vercel project: `tech-intelligence-hub-web`.
- Production deployment: `dpl_DV9WMCgbHpd3ScNCwAMXzd2hAFGo`.
- [Deployment](https://vercel.com/zhenghu25-6909s-projects/tech-intelligence-hub-web/DV9WMCgbHpd3ScNCwAMXzd2hAFGo).
- READY: `2026-09-10T22:58:19.544Z`; region `iad1`; `hzense.com` assigned; alias error null.
- Production config: `HZENSE_SEARCH_MODE=database`, saved and read back before redeploying the same source with latest settings and no existing build cache.
- Runtime secrets, Preview and Development configuration were not changed.

## Completed prerequisites

[Execution review](./review.md) records independently captured ACL evidence,
migration `0003`, 38 committed search documents, zero-change post-apply check,
the separately approved twelve-column SELECT grant and two successful hosted
Runtime production preflights (`34538678227`, `34538913394`).
[Shadow acceptance](./shadow-parity.md) records 21/21 ordered-result matches.

## Production verification

After the production alias moved, browser requests exercised `AI` with all
types and each of daily/weekly/insight/topic/signal/resource: counts were
19 and 1/1/3/3/9/2, exactly matching shadow. The eight golden input queries
were repeated against production content and again returned 3/0/2/1/11/2/0/0.
Synthetic fixture data was not inserted into production. This complements,
not replaces, the full fixture ranking tests in the same commit's green CI.

The public database health endpoint returned HTTP 200 at
`2026-09-10T22:59:09Z`, exact body `{"status":"ok"}`, `Cache-Control: no-store`,
and no Retry-After. In database mode its deployed implementation probes Topic
and the twelve required Search columns using the same bounded Runtime pool.

Two production health log entries on the exact new deployment reported:

| UTC      | Outcome | Duration ms | Pool total | Idle | Waiting |
| -------- | ------- | ----------: | ---------: | ---: | ------: |
| 22:59:08 | ok      |          84 |          1 |    1 |       0 |
| 22:59:16 | ok      |          77 |          1 |    1 |       0 |

The per-process pool limit is 1 in the deployed source; the observations above
are not a claim that the entire serverless fleet has only one connection.

[Cloud health run 34540048804](https://github.com/hzense/tech-intelligence-hub/actions/runs/34540048804)
passed the exact HTTP/body/cache contract and incident reconciliation. The
controlled alert exercise was explicitly disabled (`test_alert=false`), so this
was not an injected outage or a new alert/recovery drill. Existing hourly health
monitoring remains enabled (`PRODUCTION_DATABASE_HEALTH_ENABLED=true`).

An error/fatal/warning log scan of this exact deployment from
`2026-09-10T22:58:19Z` through `2026-09-10T22:59:43.682Z` returned no entries.
This is a bounded early post-release check, not a guarantee about future errors.

## Rollback and evidence boundary

Application fallback remains `HZENSE_SEARCH_MODE=in-process` followed by a new
Production deployment; the prior in-process deployment is
`dpl_7KvntRvkaFhiDQYWrhrzbXrqPx2j`. This path was reviewed, not exercised by
switching production back and forth. No destructive outage or ACL recovery
operation was performed. Derived search rows may remain during application
rollback; ACL restoration must not be inferred from this release.

The operator explicitly accepted the unverified-recovery path. Historical ACL
gaps and actual backup/restore capability remain unverified, not fixed or
rehearsed by this successful search cutover. This changeset submits the evidence
to version control; merged archival remains subject to PR review and merge.

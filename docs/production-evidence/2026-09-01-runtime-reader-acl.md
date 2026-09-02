# Neon Production Runtime Reader ACL verification — 2026-09-01

## Result

`PASS` — a bounded, read-only catalog verification performed between
`2026-09-01T13:58:00Z` and `2026-09-01T14:02:05Z` confirmed that the current
target-database ACL for `hzense_runtime` matches the reviewed application
allowlist.

The two result matrices contain 42 checked fields with 0 mismatches against
the expected values below.

- Environment label: Neon Production
- Logical branch/database: `main` / `hzense`
- Contract source: [`configure_runtime_reader.sql`](../../db/roles/configure_runtime_reader.sql)
  at PR #36 baseline commit `4d1edef710875cbee2f2e9ef6001e9c44206800e`
- Method: two catalog-only `SELECT` queries in the Neon SQL Editor
- Database mutations: none
- `SET ROLE`: not used

No connection URL, endpoint, password, token, provider project/branch ID,
backup ID, session identifier or raw catalog dump is recorded here. The raw
query history remains in the protected provider console; this file preserves
only booleans, counts and SHA-256 fingerprints.

## Effective privilege matrix

| Check                                                                                       |     Observed |     Expected |
| ------------------------------------------------------------------------------------------- | -----------: | -----------: |
| Target database selected                                                                    |       `true` |       `true` |
| PostgreSQL major is 18                                                                      |       `true` |       `true` |
| `LOGIN / NOINHERIT / NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION / NOBYPASSRLS` |   all `true` |   all `true` |
| Connection limit                                                                            |         `20` |         `20` |
| Role default read-only                                                                      |       `true` |       `true` |
| Provider membership count                                                                   |          `1` |          `1` |
| Provider membership exact                                                                   |       `true` |       `true` |
| Database `CONNECT`                                                                          |       `true` |       `true` |
| Database `CONNECT WITH GRANT OPTION`                                                        |      `false` |      `false` |
| Database `CREATE` / `TEMPORARY`                                                             | both `false` | both `false` |
| `public` Schema `USAGE`                                                                     |       `true` |       `true` |
| Schema grant option / `CREATE`                                                              | both `false` | both `false` |
| `topic_status` `USAGE`                                                                      |       `true` |       `true` |
| Type grant option                                                                           |      `false` |      `false` |
| Exact five Topic columns readable                                                           |       `true` |       `true` |
| `metadata` readable                                                                         |      `false` |      `false` |
| Whole `topics` table readable                                                               |      `false` |      `false` |
| Migration history readable                                                                  |      `false` |      `false` |
| Unexpected Table privileges                                                                 |          `0` |          `0` |
| Unexpected Column privileges                                                                |          `0` |          `0` |
| Unexpected Sequence privileges                                                              |          `0` |          `0` |

The five readable columns are `id`, `title`, `parent_id`, `status` and
`runtime_enabled`.

## Direct ACL source matrix

| Check                                                    | Observed | Expected |
| -------------------------------------------------------- | -------: | -------: |
| Runtime is not database owner                            |   `true` |   `true` |
| Direct database ACL is non-grantable `CONNECT` only      |   `true` |   `true` |
| Target database `PUBLIC` ACL entries                     |      `0` |      `0` |
| Direct `public` Schema ACL is non-grantable `USAGE` only |   `true` |   `true` |
| `public` Schema `PUBLIC` ACL entries                     |      `0` |      `0` |
| Direct `topic_status` ACL is non-grantable `USAGE` only  |   `true` |   `true` |
| `topic_status` `PUBLIC` ACL entries                      |      `0` |      `0` |
| Missing direct Topic-column grants                       |      `0` |      `0` |
| Unexpected direct Runtime column ACL entries             |      `0` |      `0` |
| Application-column `PUBLIC` ACL entries                  |      `0` |      `0` |
| Extra application Schema access                          |      `0` |      `0` |
| Extra application enum access                            |      `0` |      `0` |
| Unsafe incoming/outgoing memberships                     |      `0` |      `0` |

## Integrity fingerprints

| Artifact                          | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| Effective-privilege query         | `3304d829b55f976cd3fe78fed315ad7ec967866a35da51dbfc71a515f1466cd6` |
| Effective-privilege result matrix | `12152abeac4455d038c1608b2a26696b4e6a3f0c08a671f885f43b0e7f67c975` |
| Direct-source query               | `ba6e287fd29500b4a6305ff0feb038a47c4d934fe38a48c3b5db1bac7630ffe9` |
| Direct-source result matrix       | `b8fe7d9f1f7cfea61edf710f5b5ec92bdcd6d2437cd7ebd7f04c9dcede3e20dc` |

Query fingerprints cover the exact UTF-8 SQL Editor text. Result fingerprints
cover the UTF-8 JSON serialization of `{headers, cells}` in displayed column
order, retaining Neon's `t` / `f` and decimal cell strings.

## Evidence boundary

This proves the current bounded target-database ACL state. It does not prove
the timestamp or identity of the historical mutation transaction and does not
replace `pnpm db:preflight:runtime:production`. The following gates remain
unexecuted:

- independent protected Runtime credential rotation;
- Runtime-authenticated pooled TLS and identity verification;
- deep inspection of the accepted Neon reserved databases;
- complete routine, default-ACL, ownership and indirect-execution-path checks;
- Vercel Production environment configuration and redeployment;
- HTTP 200 health, real five-column query and safe-log acceptance;
- scheduled-monitor activation.

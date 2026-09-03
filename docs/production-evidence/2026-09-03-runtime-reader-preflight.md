# Neon Production Runtime Reader preflight — 2026-09-03

## Result

`PASS` — the protected `hzense_runtime` pooled credential completed the full
production preflight twice on 2026-09-03. Both runs verified:

- PostgreSQL major 18;
- role connection limit 20 and the reviewed role/membership shape;
- provider-configured and effective read-only defaults;
- the exact five-column Topic read projection;
- cluster database isolation and both approved Neon reserved databases;
- TLS 1.3 with an authorized, hostname-matched peer and
  `TLS_AES_256_GCM_SHA384` client evidence.

Each catalog query ran under the production runner's 8-second query timeout.
The two complete runs succeeded without retry or database mutation.

- Environment label: Neon Production
- Logical branch/database: `main` / `hzense`
- Branch base commit: `7848efc5b3ff`
- Contract source: [`runtime-reader-preflight.mjs`](../../packages/database/src/runtime-reader-preflight.mjs)
  and [`neon-reserved-provider-contract.mjs`](../../packages/database/src/neon-reserved-provider-contract.mjs)
- Reserved-provider contract source SHA-256:
  `ffda2f6e5b3da2fc785f3a4c2b01f29cba8681c7d5be218678dffd5817787819`
- Database mutations: none
- `SET ROLE`: not used

## Reserved provider contracts

The Runtime-authenticated catalog statement returned only the following
sanitized per-category counts and SHA-256 fingerprints. It did not return a
raw object inventory to the evidence record.

### `postgres`

| Category               | Count | SHA-256                                                            |
| ---------------------- | ----: | ------------------------------------------------------------------ |
| `access`               |   409 | `d4948e90513977f99858f0b79213a73cef5f0598aa050beff457d4285aeecf8e` |
| `access_method_path`   |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `cast_path`            |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `cluster_acl`          |     2 | `c48a047466094cdd6bfa63f77266b1b8f624a0ad504afc6f2845a1d62c164d27` |
| `collation`            |     1 | `f771a0e2041e68b74a33b558b9309ff1c0d12c303c777e64776ed58d90db8dc1` |
| `column`               |    88 | `e0ae0459cb58e864c69403679a975022c1516282be5606eca6b5e569a9921bac` |
| `conversion_path`      |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `event_trigger_path`   |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `extension`            |     3 | `ef00010ad1bc1a3ed5a7fa92f89d9440f087fa835db83fb7358609895e38956d` |
| `index`                |     4 | `bfcad804bf1f28525d07069a598b6f67a6f6e53a8632d3bb6854bc2572232ac4` |
| `inheritance`          |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `language_path`        |     1 | `a6b7605342b9eee5d820cf4ee6b7851fa61da279b7de62044a16586cadb1b3b2` |
| `opclass_path`         |     3 | `b85a941022cd28c87400667036eb9c0fcfb41724b733562bf9284325de547557` |
| `operator_path`        |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `relation`             |    11 | `46d2eb1662f0bcf522af4924ac0a39ebb0627f594102dbb196ffc8d6d8fd71b2` |
| `routine`              |    32 | `e8196ad70dd9e1a92487b5f000228055f27e806fd181ecf113158ce9ba63c8d3` |
| `runtime_ownership`    |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `schema`               |     3 | `b2e869dfd831d2dc0fdde3e5d794d8075c5537a06375bf207d377cce0465f27b` |
| `sequence`             |     1 | `b6faf55448ebcc9ec6fad504174863ce84876c9ac44628f95ddbc828ee717a4e` |
| `system_acl`           |   290 | `1dbfec7d500d12305971a3f96b66aedfed49ac5e8970f71f20b4e94e687787b0` |
| `system_schema_access` |     3 | `3030c68ce68894ce1039d337c43df0cc348a162d57e843fa7dbd6679eefb6ac1` |
| `text_search_path`     |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `type`                 |    22 | `a24ad3b2cc81a9b4fce6ee6ddc0229d18170553d6e84db206eb504ce43f99f73` |

### `template1`

| Category               | Count | SHA-256                                                            |
| ---------------------- | ----: | ------------------------------------------------------------------ |
| `access`               |   298 | `e9fee8a89c81258c4af59ba9290c3da752d50924a35900b09eb5ab28a090de59` |
| `access_method_path`   |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `cast_path`            |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `cluster_acl`          |     2 | `c48a047466094cdd6bfa63f77266b1b8f624a0ad504afc6f2845a1d62c164d27` |
| `collation`            |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `column`               |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `conversion_path`      |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `event_trigger_path`   |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `extension`            |     1 | `9f6cdae8e6afd79b270395fe92c29025d132abe418bc129bc3e5b15901a08028` |
| `index`                |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `inheritance`          |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `language_path`        |     1 | `a6b7605342b9eee5d820cf4ee6b7851fa61da279b7de62044a16586cadb1b3b2` |
| `opclass_path`         |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `operator_path`        |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `relation`             |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `routine`              |     3 | `99474588efacae6202672d9dc1eda67e67944e123110d078a6aaf254f6a5a90e` |
| `runtime_ownership`    |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `schema`               |     1 | `09728fda86962e16d49ecfb057c93d75ce0529678bbb68a0642ee3dd0aa016e9` |
| `sequence`             |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `system_acl`           |   289 | `07b165bf8182f1c3e3bccc3572eb4b9b5f11f969df4c75c30ca5ba0d5ebf1721` |
| `system_schema_access` |     3 | `3030c68ce68894ce1039d337c43df0cc348a162d57e843fa7dbd6679eefb6ac1` |
| `text_search_path`     |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `type`                 |     0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The contracts are checked independently and cannot be exchanged. A separate
sanitized audit returned zero direct Runtime ACL entries, zero Runtime-owned
objects across database, Schema, relation, routine, type, operator, operator
class/family, collation, conversion, language, text-search, event-trigger,
extension, FDW/server, large-object, statistics, publication, subscription,
tablespace and default-ACL catalogs, zero effective grant options, zero system
Schemas with `CREATE`, zero event triggers and zero normal-OID access methods
in both databases. The two cluster-ACL rows bind both built-in tablespaces;
there were no parameter ACL rows. Runtime could not `SELECT` the protected
system role catalog.

## Evidence boundary

No connection URL, endpoint, password, token, provider project/branch ID,
session identifier or raw object name is recorded here. The preflight commands
read the credential only from the user's protected saved value and did not
write it to the repository, the captured preflight command output or this
evidence file.

This evidence proves the Runtime credential and database preflight contract at
the time of the runs. It does not prove that Vercel Production contains the
five Runtime variables, that a Runtime-configured deployment is `READY`, or
that the public health endpoint and runtime logs have passed acceptance. Those
were separate rollout gates and later passed the independent
[production acceptance](./2026-09-03-runtime-reader-production-acceptance.md).

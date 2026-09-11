# FTS-1 Production shadow acceptance

Deployment: `dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh`, Production `iad1`,
main `f72ccb920bd04ad039dccd5eb555e5aa78b24abc`, READY at
`2026-09-10T22:52:53.281Z`, with `hzense.com` assigned and no alias error.

Browser requests exercised all eight golden-corpus query inputs against the
real production projection, plus `AI` and two rounds of its six type filters.
The synthetic golden fixture documents were NOT inserted into production;
the two synthetic tie-break queries consequently returned zero rows here.
Full fixture ranking is covered separately by the same commit's main CI
`34530817393`, including the PostgreSQL migration integration suite and the
12-test search ranking suite. Production samples returned 19 AI results;
daily/weekly/insight/topic/signal/resource counts were 1/1/3/3/9/2 in both rounds.

All 21 application parity records below report `match`; none report `mismatch`
or `unavailable`. The implementation compares ordered type, ID, title, summary,
href, date, keywords, body and score, not merely result counts. These application
logs contain no query text or content. Browser-observed queries are test inputs.

At `2026-09-10T22:55:02Z`, `/api/health/database` returned HTTP 200, exact body
`{"status":"ok"}`, `Cache-Control: no-store`, no Retry-After. In shadow mode
this health endpoint checks Topic, not Search; Search access is evidenced by
the parity records. An error/fatal/warning scan of this deployment from READY
through `2026-09-10T22:55:06.580Z` returned no logs. This is a bounded early
window, not a claim about future errors or unverified recovery capability.

## Captured application parity logs

## Runtime Logs

**Project:** prj_5aL5yF6ZeZ0xV2raNZ5UDHsg0x5h
**Deployment:** dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh
**Time range:** 2026-09-10T22:52:53.000Z → 2026-09-10T22:55:30.711Z

### 22:54:45 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":2,"event":"database_search_shadow","in_process_count":2,"outcome":"match"}

### 22:54:44 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":9,"event":"database_search_shadow","in_process_count":9,"outcome":"match"}

### 22:54:44 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":3,"event":"database_search_shadow","in_process_count":3,"outcome":"match"}

### 22:54:43 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":3,"event":"database_search_shadow","in_process_count":3,"outcome":"match"}

### 22:54:42 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":1,"event":"database_search_shadow","in_process_count":1,"outcome":"match"}

### 22:54:41 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":1,"event":"database_search_shadow","in_process_count":1,"outcome":"match"}

### 22:54:03 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":2,"event":"database_search_shadow","in_process_count":2,"outcome":"match"}

### 22:54:02 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":9,"event":"database_search_shadow","in_process_count":9,"outcome":"match"}

### 22:54:01 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":3,"event":"database_search_shadow","in_process_count":3,"outcome":"match"}

### 22:54:00 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":3,"event":"database_search_shadow","in_process_count":3,"outcome":"match"}

### 22:54:00 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":1,"event":"database_search_shadow","in_process_count":1,"outcome":"match"}

### 22:53:59 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":1,"event":"database_search_shadow","in_process_count":1,"outcome":"match"}

### 22:53:49 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":0,"event":"database_search_shadow","in_process_count":0,"outcome":"match"}

### 22:53:49 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":0,"event":"database_search_shadow","in_process_count":0,"outcome":"match"}

### 22:53:48 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":2,"event":"database_search_shadow","in_process_count":2,"outcome":"match"}

### 22:53:47 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":11,"event":"database_search_shadow","in_process_count":11,"outcome":"match"}

### 22:53:39 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":1,"event":"database_search_shadow","in_process_count":1,"outcome":"match"}

### 22:53:38 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":2,"event":"database_search_shadow","in_process_count":2,"outcome":"match"}

### 22:53:37 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":0,"event":"database_search_shadow","in_process_count":0,"outcome":"match"}

### 22:53:36 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":3,"event":"database_search_shadow","in_process_count":3,"outcome":"match"}

### 22:53:07 GET /search 200 [info/serverless]

dep=dpl_8dUG8Ae5Lg99bB2mNbBurqUm24hh branch=main cache=MISS
{"database_count":19,"event":"database_search_shadow","in_process_count":19,"outcome":"match"}

# Continuous Daily

Continuous Daily turns reviewed Signals into a deterministic candidate while preserving a hard human publication boundary.

```text
reviewed / accepted Signals
  → deterministic selection and evidence-only draft
  → Draft pull request
  → human fact-check and original analysis
  → status: published + ready-for-review
  → required CI and review
  → merge and production
```

Automation never marks a pull request ready, approves it, merges it, or writes `status: published`.

## Daily v1 contract

- The edition date and selection window are explicit. The regular window is `(previous day 07:00, current day 07:00]` in `Europe/Berlin`; stored timestamps include their UTC offset, including DST transitions.
- Eligible Signals are `reviewed` or `accepted`, have importance at least 3, were captured inside the window, occurred no later than the cutoff, use an active Source, and reference a non-archived Topic in the validated Seed projection of the authoritative Taxonomy.
- Signals already referenced by any Daily are not selected again.
- Tracking parameters are removed before source-URL deduplication. Ranking is a total order: accepted status, importance, strength, confidence, novelty, occurrence, capture, then stable ID.
- Selection takes the strongest Signal from each primary Topic first, then fills the remaining positions, with at most two Signals per Topic and five overall.
- Identical normalized input produces byte-identical Markdown and a `sha256:` input fingerprint.
- No eligible Signal is a successful no-op. The generator never creates an empty Daily.
- The target path is `content/daily/YYYY/YYYY-MM-DD.md`. Existing same-day content is never overwritten, including content edited by a reviewer.

`edition: historical_example` identifies retrospective sample content. It must still obey occurrence-date and evidence-integrity rules, but later catalog backfills do not pretend that the Signal was captured on the historical publication date. `edition: live` requires the complete generation provenance and capture window.

## Local deterministic generation

Run from the repository root with an explicit date:

```bash
pnpm daily:generate --date 2026-08-20
```

The command writes only when the target date does not already exist and at least one Signal is eligible. Validate the result with:

```bash
pnpm content:validate
pnpm daily:publication-check
```

The second command intentionally fails while any Daily remains `draft` or `review`. It succeeds only after a human chooses `published`, or intentionally chooses `archived` for a rollback.

## Scheduled workflow

`.github/workflows/continuous-daily.yml` runs at 07:17 and 07:47 Europe/Berlin. The second run is an idempotent recovery attempt for delayed or dropped schedules. `workflow_dispatch` supports a historical date and a `dry_run` mode.

The workflow separates authority:

1. `generate` has read-only repository access. It installs dependencies, creates one candidate and manifest in a temporary directory, then validates formatting, content, Seed data and content tests.
2. `publish` receives only the validated artifact. It does not install dependencies or execute repository code. It verifies the exact path, base commit and SHA-256 before pushing `automation/daily-YYYY-MM-DD` and opening a Draft PR. This job also requires the repository variable `CONTINUOUS_DAILY_PUBLISH_ENABLED=true`.

The publishing job uses only job-scoped `contents: write`, `pull-requests: write` and `actions: write`. It never force-pushes. An existing open PR is preserved; an orphan branch is accepted only if its diff and candidate checksum match the artifact. A push made with `GITHUB_TOKEN` does not start another workflow run, so the job explicitly dispatches `ci.yml` for the candidate commit.

That explicit dispatch reports `daily-candidate-validation`, which validates draft structure without impersonating the required publication check. Only pull-request and `main` push events report `daily-publication-gate`; on a candidate PR it intentionally remains red while the Daily is `draft` or `review`.

Repository Actions settings keep the default workflow token permission at read-only. Automatic Draft PR creation additionally requires the organization to allow “GitHub Actions to create and approve pull requests”; the workflow receives PR write permission but contains no approval operation.

As of 2026-09-04, the repository reports `default_workflow_permissions=read`, `can_approve_pull_request_reviews=false` and no `CONTINUOUS_DAILY_PUBLISH_ENABLED` variable. A repository-scoped request that preserved the read-only default and attempted to enable only the Actions pull-request capability returned HTTP `409`: the organization does not allow GitHub Actions to create or approve pull requests. The request changed no setting, and the fail-closed sequence stopped before setting the variable or dispatching the workflow; it created no automation branch or Draft PR. This is now a confirmed organization-policy blocker that requires an organization owner, rather than an unknown repository configuration issue. See the [sanitized operations checkpoint](./production-evidence/2026-09-04-operations-checkpoint.md).

The latest observed scheduled runs on 2026-09-03 completed as zero-candidate no-ops, so they created no artifact, branch or Draft PR. Scheduled and manual runs can generate, validate and retain an artifact when eligible Signals exist, but the publication jobs remain gated. The 2026-08-20 dry-run has been independently verified through its manifest and SHA-256.

GitHub references: [timezone-aware schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule), [`GITHUB_TOKEN` event behavior](https://docs.github.com/en/actions/concepts/security/github_token), and [repository Actions permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).

## Human publication checklist

Before marking the Draft PR ready:

1. Open every linked Signal and original source; verify title, dates, claims and source ownership.
2. Confirm the cutoff, unique references, Signal count, development count and rising Topics.
3. Replace all automated English summaries and every `待人工研判` placeholder with original Chinese analysis.
4. Remove `HZENSE_DAILY_CANDIDATE` and any human-review placeholder.
5. Do not hand-edit the window, Signal references or input fingerprint. If the selected evidence is wrong, close the candidate and correct the source Signal before regenerating it.
6. Change `status: draft` to `status: published`; this new commit makes `daily-publication-gate` eligible to pass.
7. Mark the PR ready, wait for `foundation`, `database-migrations` and `daily-publication-gate`, obtain the required CODEOWNER review, then merge.

Draft and review content is excluded from the public Daily list, detail routes, search and sitemap. A live edition is labeled “正式简报”; only retrospective content is labeled “历史回顾样例.”

Because the repository currently has one write-capable human, a self-authored change under `content/daily/` cannot satisfy its own CODEOWNER review. Normal Daily publication must therefore originate from the automation account. For an exceptional emergency correction, the administrator must keep all required checks enabled, temporarily disable only the Code Owner review requirement, merge the reviewed PR, immediately restore the requirement, verify the protection response and record the break-glass action on the PR. Adding a second trusted reviewer removes this exception.

## Recovery and rollback

- **No candidates:** inspect the Job Summary, then review Signal statuses, capture timestamps, Sources and Topics. Do not create an empty Daily.
- **Open PR already exists:** continue the human review on that PR. Reruns do not replace it.
- **Orphan automation branch:** if its only diff and checksum match, the workflow may recreate the Draft PR. Any mismatch fails closed and requires a human decision.
- **Base branch advanced:** artifact publication fails; rerun from the latest default branch.
- **Bad published Daily:** a Vercel rollback may temporarily restore traffic, but must be followed by an emergency Git PR that changes the Daily to `archived` or reverts its introducing commit. Verify the detail route returns 404, the Daily list and homepage fall back, and the sitemap omits the entry. A deployment-only rollback is not durable because the next deployment would reintroduce Git content.

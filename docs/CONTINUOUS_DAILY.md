# Continuous Daily（已永久停用）

2026-09-19，按操作者要求永久停用并删除 Continuous Daily candidate 工作流。定时运行、手动触发和自动候选 Draft PR 创建入口均已移除，专用发布变量 `CONTINUOUS_DAILY_PUBLISH_ENABLED` 已删除。现有日报内容、历史执行记录及内容校验规则保留。下文仅作为历史实现与内容兼容说明，不代表仍有自动任务运行。

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

## Daily v2 contract

- The edition date and selection window are explicit. The regular window is `(previous day 07:00, current day 07:00]` in `Europe/Berlin`; stored timestamps include their UTC offset, including DST transitions.
- Eligible Signals are `reviewed` or `accepted`, have importance at least 3, were captured inside the window, occurred within `[cutoff − 72 hours, cutoff]`, use an active Source, and reference a non-archived Topic in the validated Seed projection of the authoritative Taxonomy. The event window is exactly 72 elapsed hours, including DST transitions; both event boundaries are inclusive.
- `occurred_at` is the source-backed event or announcement timestamp, never the intake or approval timestamp. Historical backfills outside the event window remain in Signals and search but cannot become current Daily news. Do not change dates to manufacture eligibility. Date-only source records retain their documented timestamp convention; the selector does not invent a more precise event time or expand the window to whole calendar days.
- Draft sections show the event/announcement date from the source record. The generator logs otherwise-eligible stale Signal IDs even on a no-op, and includes them with the policy version and occurrence boundary in the manifest when a candidate is written.
- Signals already referenced by any Daily are not selected again.
- Tracking parameters are removed before source-URL deduplication. Ranking is a total order: accepted status, importance, strength, confidence, novelty, occurrence, capture, then stable ID.
- Selection takes the strongest Signal from each primary Topic first, then fills the remaining positions, with at most two Signals per Topic and five overall.
- Identical normalized input produces byte-identical Markdown and a `sha256:` input fingerprint.
- No eligible Signal is a successful no-op. The generator never creates an empty Daily.
- The target path is `content/daily/YYYY/YYYY-MM-DD.md`. Existing same-day content is never overwritten, including content edited by a reviewer.

`edition: historical_example` identifies retrospective sample content. It must still obey occurrence-date and evidence-integrity rules, but later catalog backfills do not pretend that the Signal was captured on the historical publication date. `edition: live` requires the complete generation provenance, capture window and `occurrence_start_at` (canonical UTC timestamp, 72 hours before cutoff), with `generator_version: daily-v2`. Both windows and the version are bound into the input fingerprint and independently recomputed by publication validation.

Older `daily-v1` live candidates must be regenerated and reviewed under v2; merely editing their version, dates or fingerprint is not a migration. Existing same-day content remains protected from overwrite: close an obsolete candidate PR and explicitly handle its old automation branch before regenerating. Historical samples are unchanged and are not relabeled as live editions.

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

## 工作流已删除

`.github/workflows/continuous-daily.yml` 及其专用写权限白名单已删除，原 07:17、07:47 Europe/Berlin 调度和 `workflow_dispatch` 入口不再存在。删除前已在 GitHub 停用该工作流；当前没有待处理候选 PR。

历史生成工具和发布校验继续保留，用于已有 Daily 内容的审计与兼容；它们不会自行调度或创建 PR。重新引入任何自动任务需要单独的明确授权和代码变更。

## Human publication checklist

Before marking the Draft PR ready:

1. Open every linked Signal and original source; verify title, dates, claims and source ownership.
2. Confirm the cutoff, capture window, 72-hour event window, source-backed event/announcement dates, unique references, Signal count, development count and rising Topics. Recent collection alone does not make an old event current news.
3. Replace all automated English summaries and every `待人工研判` placeholder with original Chinese analysis.
4. Remove `HZENSE_DAILY_CANDIDATE` and any human-review placeholder.
5. Do not hand-edit the window, Signal references or input fingerprint. If the selected evidence is wrong, close the candidate and correct the source Signal before regenerating it.
6. Change `status: draft` to `status: published`; this new commit makes `daily-publication-gate` eligible to pass.
7. Mark the PR ready, wait for `foundation`, `database-migrations` and `daily-publication-gate`, obtain the required CODEOWNER review, then merge.

Draft and review content is excluded from the public Daily list, detail routes, search and sitemap. A live edition is labeled “正式简报”; only retrospective content is labeled “历史回顾样例.”

Because the repository currently has one write-capable human, a self-authored change under `content/daily/` cannot satisfy its own CODEOWNER review. Normal Daily publication must therefore originate from the automation account. For an exceptional emergency correction, the administrator must keep all required checks enabled, temporarily disable only the Code Owner review requirement, merge the reviewed PR, immediately restore the requirement, verify the protection response and record the break-glass action on the PR. Adding a second trusted reviewer removes this exception.

## Recovery and rollback

- **No candidates:** inspect the Job Summary and generator log (including stale Signal exclusions), then review Signal statuses, event and capture timestamps, Sources and Topics. Do not create an empty Daily or refresh historical timestamps to fill it.
- **Open PR already exists:** continue the human review on that PR. Reruns do not replace it.
- **Orphan automation branch:** if its only diff and checksum match, the workflow may recreate the Draft PR. Any mismatch fails closed and requires a human decision.
- **Base branch advanced:** artifact publication fails; rerun from the latest default branch.
- **Bad published Daily:** a Vercel rollback may temporarily restore traffic, but must be followed by an emergency Git PR that changes the Daily to `archived` or reverts its introducing commit. Verify the detail route returns 404, the Daily list and homepage fall back, and the sitemap omits the entry. A deployment-only rollback is not durable because the next deployment would reintroduce Git content.

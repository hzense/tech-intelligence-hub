'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import controls from './admin-controls.module.css';
import styles from './candidate-review-editor.module.css';
import { reviewRequestIdentity } from './candidate-review-request';

export { reviewRequestIdentity } from './candidate-review-request';

export type ReviewDraft = {
  title: string;
  summary: string;
  eventDate: string | null;
  sourceUrls: string[];
  personIds: string[];
  organizationIds: string[];
  topicIds: string[];
  eventKey: string;
  publicEvidenceIds: string[];
  claims: { text: string; evidenceId: string }[];
};
type Decision = 'draft' | 'needs_evidence' | 'rejected' | 'submit_verification';
type ReviewRecord = {
  revision: number;
  decision: Decision;
  note: string;
  draft: ReviewDraft;
  created_at?: string;
};
type ReviewCatalog = {
  people: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  topics: { id: string; name: string }[];
  evidence: { id: string; source_url: string; excerpt: string }[];
};
type Props = {
  runId: string;
  candidateIndex: number;
  materialHash: string;
  initialDraft: Pick<ReviewDraft, 'title' | 'summary' | 'eventDate'>;
};
const decisions: Record<Decision, string> = {
  draft: '草稿',
  needs_evidence: '待补证',
  rejected: '已拒绝',
  submit_verification: '已送核验（未发布）',
};
const fields = {
  title: '标题',
  summary: '摘要',
  eventDate: '事件日期',
  sourceUrls: '公开来源链接',
  personIds: '正式人物 ID',
  organizationIds: '正式组织 ID',
  topicIds: 'Topic ID',
  eventKey: '事件唯一键',
  publicEvidenceIds: '公开证据 ID',
  claims: '主张与证据绑定',
} as const;
const listFields = [
  'sourceUrls',
  'personIds',
  'organizationIds',
  'topicIds',
  'publicEvidenceIds',
] as const;
export function reviewLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
export function reviewCodePoints(value: string, maximum: number) {
  return Array.from(value).slice(0, maximum).join('');
}
export function parseReviewClaims(value: string) {
  return reviewLines(value).map((line) => {
    const split = line.lastIndexOf('|');
    if (split < 1 || !line.slice(split + 1).trim())
      throw new Error('每条主张请使用“主张文本 | 证据 ID”格式。');
    return { text: line.slice(0, split).trim(), evidenceId: line.slice(split + 1).trim() };
  });
}
export function reviewChangedFields(previous: ReviewDraft | undefined, next: ReviewDraft) {
  return (Object.keys(fields) as (keyof ReviewDraft)[]).filter(
    (key) => JSON.stringify(previous?.[key]) !== JSON.stringify(next[key]),
  );
}
function displayValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '未填写';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function CandidateReviewEditor(props: Props) {
  // Keyed inner state prevents one candidate's unsaved input from leaking into another.
  return (
    <ReviewEditor key={`${props.runId}:${props.candidateIndex}:${props.materialHash}`} {...props} />
  );
}
function ReviewEditor({ runId, candidateIndex, materialHash, initialDraft }: Props) {
  const [draft, setDraft] = useState<ReviewDraft>(() => ({
    ...initialDraft,
    sourceUrls: [],
    personIds: [],
    organizationIds: [],
    topicIds: [],
    eventKey: '',
    publicEvidenceIds: [],
    claims: [],
  }));
  const [lists, setLists] = useState<Record<(typeof listFields)[number], string>>({
    sourceUrls: '',
    personIds: '',
    organizationIds: '',
    topicIds: '',
    publicEvidenceIds: '',
  });
  const [claims, setClaims] = useState('');
  const [note, setNote] = useState('');
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [catalog, setCatalog] = useState<ReviewCatalog | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('正在读取已保存审核记录…');
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const latest = reviews[0];
  const hydrate = useCallback((record: ReviewRecord) => {
    setDraft(record.draft);
    setNote(record.note);
    setLists(
      Object.fromEntries(listFields.map((key) => [key, record.draft[key].join('\n')])) as Record<
        (typeof listFields)[number],
        string
      >,
    );
    setClaims(record.draft.claims.map((claim) => `${claim.text} | ${claim.evidenceId}`).join('\n'));
    setDirty(false);
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/admin/candidate-review?runId=${encodeURIComponent(runId)}&candidateIndex=${candidateIndex}`,
        { cache: 'no-store', signal: signal ?? null },
      );
      if (!response.ok) throw new Error('无法读取审核记录，请重试；当前输入不会丢失。');
      const data = (await response.json()) as {
        reviews: ReviewRecord[];
        configured: boolean;
        catalog?: ReviewCatalog;
      };
      if (!Array.isArray(data.reviews)) throw new Error('审核记录格式异常，请联系管理员。');
      const records = [...data.reviews].sort((a, b) => b.revision - a.revision);
      setReviews(records);
      setCatalog(data.catalog ?? null);
      setConfigured(data.configured === true);
      setLoaded(true);
      if (records[0]) hydrate(records[0]);
      setConflict(false);
      pending.current = null;
      setMessage(
        data.configured
          ? '人工决定不等于核验通过；送核验不会自动发布。'
          : '审核存储尚未配置，暂不可保存。',
      );
    },
    [runId, candidateIndex, hydrate],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '读取失败，请重试。');
    });
    return () => controller.abort();
  }, [load]);
  function changed() {
    setDirty(true);
    pending.current = null;
  }
  async function refresh() {
    if (
      inFlight.current ||
      (dirty && !window.confirm('加载最新保存版本将替换当前未保存输入，是否继续？'))
    )
      return;
    inFlight.current = true;
    setBusy(true);
    try {
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取失败。');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function save(decision: Decision) {
    if (inFlight.current || !loaded || !configured || conflict) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const edited: ReviewDraft = {
        ...draft,
        ...Object.fromEntries(listFields.map((key) => [key, reviewLines(lists[key])])),
        claims: parseReviewClaims(claims),
      };
      const payload = {
        runId,
        candidateIndex,
        materialHash,
        expectedRevision: latest?.revision ?? 0,
        decision,
        note,
        draft: edited,
      };
      pending.current = reviewRequestIdentity(pending.current, JSON.stringify(payload), () =>
        crypto.randomUUID(),
      );
      const response = await fetch('/api/admin/candidate-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          request: { ...payload, requestId: pending.current.requestId },
        }),
      });
      if (response.status === 409) {
        setConflict(true);
        throw new Error(
          '保存版本冲突。当前输入已保留，请核对并加载最新版本后重新编辑；不要覆盖他人的审核。',
        );
      }
      if (!response.ok)
        throw new Error(
          response.status === 400 || response.status === 422
            ? '保存未通过校验。请检查字段格式；送核验需完整人物、组织、领域、公开证据与主张绑定。'
            : '保存结果未确认。输入已保留，原样再次保存会沿用同一请求编号，不会重复创建修订。',
        );
      const data = (await response.json()) as { review: ReviewRecord };
      if (!data.review?.draft || !Number.isInteger(data.review.revision))
        throw new Error('保存响应异常，请保持原输入重试。');
      setReviews((rows) => [
        data.review,
        ...rows.filter((row) => row.revision !== data.review.revision),
      ]);
      hydrate(data.review);
      pending.current = null;
      setMessage(`已保存 r${data.review.revision}：${decisions[data.review.decision]}。尚未发布。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，输入已保留。');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className={`${styles.editor} ${controls.scope}`}
      aria-labelledby="candidate-editor-heading"
    >
      <h2 id="candidate-editor-heading">编辑候选与审核决定</h2>
      <p>原始 AI 候选保持不变。这里保存人工修订；至少关联一位已建档人物，送核验不是正式发布。</p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        加载最新保存版本
      </button>
      {latest ? (
        <p>
          最新保存：r{latest.revision} · {decisions[latest.decision]}
          {dirty ? ' · 有未保存修改' : ''}
        </p>
      ) : (
        <p>尚无保存修订</p>
      )}
      {catalog ? (
        <details className={styles.history}>
          <summary>可关联的正式实体与公开证据（复制 ID 填写）</summary>
          <p>
            仅关联已建档的实体和已审核公开证据，不会将私有原文自动公开。目录为空时请先完成建档。
          </p>
          {(['people', 'organizations', 'topics'] as const).map((kind) => (
            <div key={kind}>
              <h4>{{ people: '人物', organizations: '组织', topics: '领域' }[kind]}</h4>
              {catalog[kind]?.length ? (
                <ul>
                  {catalog[kind].map((entry) => (
                    <li key={entry.id}>
                      {entry.name} · <code>{entry.id}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>暂无可用记录</p>
              )}
            </div>
          ))}
          <h4>已审核公开证据</h4>
          {catalog.evidence?.length ? (
            <ul>
              {catalog.evidence.map((entry) => (
                <li key={entry.id}>
                  <code>{entry.id}</code>
                  <p>{entry.source_url}</p>
                  <p>{entry.excerpt}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>暂无可用公开证据</p>
          )}
        </details>
      ) : null}
      <fieldset disabled={busy || !loaded || !configured} className={styles.fields}>
        <legend>人工修订内容</legend>
        <label>
          标题（最多 80 字）
          <input
            value={draft.title}
            onChange={(e) => {
              changed();
              setDraft({ ...draft, title: reviewCodePoints(e.target.value, 80) });
            }}
          />
        </label>
        <label>
          摘要（最多 500 字）
          <textarea
            rows={6}
            value={draft.summary}
            onChange={(e) => {
              changed();
              setDraft({ ...draft, summary: reviewCodePoints(e.target.value, 500) });
            }}
          />
        </label>
        <label>
          事件发生日期（不是采集日期）
          <input
            type="date"
            value={draft.eventDate ?? ''}
            onChange={(e) => {
              changed();
              setDraft({ ...draft, eventDate: e.target.value || null });
            }}
          />
        </label>
        {listFields.map((key) => (
          <label key={key}>
            {fields[key]}（每行一项）
            <textarea
              rows={3}
              value={lists[key]}
              onChange={(e) => {
                changed();
                setLists({ ...lists, [key]: e.target.value });
              }}
            />
          </label>
        ))}
        <label>
          事件唯一键
          <input
            value={draft.eventKey}
            onChange={(e) => {
              changed();
              setDraft({ ...draft, eventKey: e.target.value });
            }}
          />
        </label>
        <label>
          主张与公开证据绑定（每行：主张文本 | 证据 ID）
          <textarea
            rows={4}
            value={claims}
            onChange={(e) => {
              changed();
              setClaims(e.target.value);
            }}
          />
        </label>
        <label>
          审核意见 / 补证要求
          <textarea
            rows={3}
            maxLength={4000}
            value={note}
            onChange={(e) => {
              changed();
              setNote(e.target.value);
            }}
          />
        </label>
      </fieldset>
      <div className={controls.group}>
        {(
          [
            ['draft', '保存草稿'],
            ['needs_evidence', '标记待补证'],
            ['rejected', '拒绝候选'],
            ['submit_verification', '保存并送核验'],
          ] as const
        ).map(([decision, label]) => (
          <button
            key={decision}
            type="button"
            disabled={busy || !loaded || !configured || conflict}
            onClick={() => void save(decision)}
          >
            {label}
          </button>
        ))}
      </div>
      <h3>审核历史与修订对比</h3>
      {reviews.length === 0 ? (
        <p>保存后将在此保留每次决定、意见与内容修订。</p>
      ) : (
        reviews.map((record, index) => (
          <details key={record.revision} className={styles.history}>
            <summary>
              r{record.revision} · {decisions[record.decision]}
              {record.created_at ? ` · ${record.created_at}` : ''}
            </summary>
            <p>审核意见：{record.note || '未填写'}</p>
            {reviewChangedFields(reviews[index + 1]?.draft, record.draft).map((key) => (
              <div key={key}>
                <h4>{fields[key]}</h4>
                <div className={styles.comparison}>
                  <div>
                    <strong>上一版本</strong>
                    <pre>{displayValue(reviews[index + 1]?.draft[key])}</pre>
                  </div>
                  <div>
                    <strong>本次保存</strong>
                    <pre>{displayValue(record.draft[key])}</pre>
                  </div>
                </div>
              </div>
            ))}
          </details>
        ))
      )}
    </section>
  );
}

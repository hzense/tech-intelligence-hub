'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { editorialMissing, editorialNames, type EditorialDashboard } from '@/lib/editorial-review';
import controls from './admin-controls.module.css';
import styles from './editorial-publication-editor.module.css';

type Submission = {
  requestId: string;
  runId: string;
  candidateIndex: number;
  expectedRevision: number;
  materialHash: string;
  action: 'draft' | 'publish' | 'withdraw';
  content: EditorialDashboard['content'];
  consent: boolean;
};
const messages: Record<string, string> = {
  revision_conflict: '记录已被另一页面修改，请重新读取后核对。',
  material_changed: '原候选材料发生变化，请重新读取。',
  review_incomplete: '请补齐事件日期、组织、人物和领域。',
  confirmation_required: '请补齐事件日期、组织、人物和领域，并点击确认发布。',
  topic_reference_invalid: '领域已停用或名称有变化，请重新读取并选择。',
  not_configured: '人工发布尚未配置完成。',
  invalid_request: '字段格式不正确，请检查日期和名称长度。',
};

async function api(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 30_000);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json();
    return { response, body };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function EditorialPublicationEditor({
  runId,
  candidateIndex,
}: {
  runId: string;
  candidateIndex: number;
}) {
  const [data, setData] = useState<EditorialDashboard | null>(null);
  const [organizationText, setOrganizationText] = useState('');
  const [personText, setPersonText] = useState('');
  const [topicSearch, setTopicSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('正在读取发布信息…');
  const [pending, setPending] = useState<Submission | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const lock = useRef(false);
  const endpoint = `/api/admin/editorial-signals?runId=${encodeURIComponent(runId)}&candidateIndex=${candidateIndex}`;

  function adopt(next: EditorialDashboard) {
    setData(next);
    setOrganizationText(next.content.organizations.join('\n'));
    setPersonText(next.content.persons.join('\n'));
  }
  useEffect(() => {
    const controller = new AbortController();
    lock.current = true;
    setBusy(true);
    api(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(({ response, body }) => {
        if (!response.ok) throw new Error('读取失败');
        const next = body as EditorialDashboard;
        if (!controller.signal.aborted) {
          adopt(next);
          setNotice('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice('无法读取发布信息，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          lock.current = false;
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [endpoint]);

  async function reread() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const { response, body } = await api(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const next = body as EditorialDashboard;
      if (
        pending &&
        next.requestId !== pending.requestId &&
        next.revision === pending.expectedRevision
      ) {
        setNotice('尚未查到本次保存；可以重试原请求，不会重复创建记录。');
      } else {
        adopt(next);
        setPending(null);
        setNeedsRefresh(false);
        setNotice('已读取最新保存状态。');
      }
    } catch {
      setNotice('读取失败，原输入和请求仍保留。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit(action: Submission['action'], retry?: Submission) {
    if (!data || lock.current) return;
    if (
      action === 'withdraw' &&
      !retry &&
      !window.confirm('确认撤回这条正式信号？撤回后不再公开展示。')
    )
      return;
    const request = retry ?? {
      requestId: crypto.randomUUID(),
      runId,
      candidateIndex,
      expectedRevision: data.revision,
      materialHash: data.materialHash,
      action,
      content: {
        ...data.content,
        organizations: editorialNames(organizationText),
        persons: editorialNames(personText),
      },
      consent: action !== 'draft',
    };
    lock.current = true;
    setBusy(true);
    setPending(request);
    setNotice('正在保存…');
    try {
      const { response, body: receipt } = await api('/api/admin/editorial-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        setNotice(
          messages[receipt.error] ??
            (response.status >= 500
              ? '保存结果尚未确认，请核对状态或重试原请求。'
              : '操作未完成，请重新读取状态后核对。'),
        );
        return;
      }
      // An idempotent receipt can describe an older revision. Never present it
      // as the current publication state without a fresh read.
      if (
        receipt.requestId !== request.requestId ||
        receipt.action !== request.action ||
        receipt.revision !== request.expectedRevision + 1 ||
        !receipt.content
      )
        throw new Error('invalid_receipt');
      setPending(null);
      setNeedsRefresh(true);
      try {
        const current = await api(endpoint, { cache: 'no-store' });
        if (!current.response.ok || current.body.revision < receipt.revision) throw new Error();
        adopt(current.body as EditorialDashboard);
        setNeedsRefresh(false);
        setNotice(
          current.body.requestId !== receipt.requestId
            ? '原请求已保存；已读取后续修订，请以当前状态为准。'
            : current.body.action === 'publish'
              ? '已确认发布。'
              : current.body.action === 'withdraw'
                ? '已撤回发布。'
                : '补充信息已保存，尚未发布。',
        );
      } catch {
        setNotice('请求已保存成功，但当前发布状态尚未核对。请重新读取，不要重复发布。');
      }
    } catch {
      setNotice('保存结果尚未确认，原请求已保留。请核对状态，不要重复创建新请求。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const content = data
    ? {
        ...data.content,
        organizations: editorialNames(organizationText),
        persons: editorialNames(personText),
      }
    : null;
  const missing = content ? editorialMissing(content) : [];
  const invalidTopics =
    data?.content.topics.filter(
      (selected) =>
        !data.topicOptions.some(
          (topic) => topic.id === selected.id && topic.title === selected.title,
        ),
    ) ?? [];
  const disabled = busy || !!pending || needsRefresh || !data?.configured;
  return (
    <section className={styles.panel} aria-labelledby="editorial-heading">
      <h2 id="editorial-heading">确认发布</h2>
      <p>
        核对事件日期、组织、人物和领域；缺失时可直接补充。点击确认后按“管理员确认”公开，无需独立签名核验。
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {!data ? (
        <button
          type="button"
          className={controls.button}
          disabled={busy}
          onClick={() => void reread()}
        >
          重新读取
        </button>
      ) : (
        <>
          <article>
            <h3>{data.content.title}</h3>
            <p className={styles.summary}>{data.content.summary}</p>
          </article>
          {!data.configured ? (
            <p role="alert">
              人工发布尚未启用：需完成数据库迁移、专用权限及环境配置。目前不会发布。
            </p>
          ) : null}
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <p role="status">
            {needsRefresh
              ? '当前发布状态待核对'
              : data.action === 'publish'
                ? '已发布 · 管理员确认'
                : missing.length
                  ? `待补充：${missing.join('、')}`
                  : '待确认发布'}
          </p>
          <fieldset disabled={disabled} className={styles.fields}>
            <legend>四项发布信息</legend>
            <label>
              事件日期
              <input
                type="date"
                value={data.content.eventDate ?? ''}
                onChange={(event) =>
                  setData({
                    ...data,
                    content: { ...data.content, eventDate: event.target.value || null },
                  })
                }
              />
            </label>
            <label>
              组织
              <textarea
                aria-label="组织"
                rows={3}
                maxLength={4800}
                value={organizationText}
                onChange={(event) => setOrganizationText(event.target.value)}
                placeholder="填写组织名称，多项用换行或逗号分隔"
              />
            </label>
            <label>
              人物
              <textarea
                aria-label="人物"
                rows={3}
                maxLength={2400}
                value={personText}
                onChange={(event) => setPersonText(event.target.value)}
                placeholder="填写人物姓名，多项用换行或逗号分隔"
              />
            </label>
            <div className={styles.topics}>
              <label>
                领域
                <input
                  type="search"
                  value={topicSearch}
                  onChange={(event) => setTopicSearch(event.target.value)}
                  placeholder="输入名称查找领域"
                />
              </label>
              <p>从现有领域中选择，最多 5 项。</p>
              {invalidTopics.map((topic) => (
                <p key={topic.id}>
                  已选领域已停用或更名：{topic.title}{' '}
                  <button
                    type="button"
                    className={controls.button}
                    onClick={() =>
                      setData({
                        ...data,
                        content: {
                          ...data.content,
                          topics: data.content.topics.filter(
                            (selected) => selected.id !== topic.id,
                          ),
                        },
                      })
                    }
                  >
                    移除 {topic.title}
                  </button>
                </p>
              ))}
              {data.topicOptions
                .filter(
                  (topic) =>
                    topic.title.includes(topicSearch.trim()) ||
                    topic.id.includes(topicSearch.trim()) ||
                    data.content.topics.some((selected) => selected.id === topic.id),
                )
                .map((topic) => {
                  const checked = data.content.topics.some((selected) => selected.id === topic.id);
                  return (
                    <label key={topic.id} className={styles.option}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && data.content.topics.length >= 5}
                        onChange={() =>
                          setData({
                            ...data,
                            content: {
                              ...data.content,
                              topics: checked
                                ? data.content.topics.filter((selected) => selected.id !== topic.id)
                                : [...data.content.topics, topic],
                            },
                          })
                        }
                      />
                      {topic.title}
                    </label>
                  );
                })}
            </div>
          </fieldset>
          <p>
            确认发布会公开上方标题、摘要及四项信息。原始资料和证据仅用于下方辅助核对，不会自动公开。
          </p>
          <div className={controls.group}>
            <button
              type="button"
              className={controls.button}
              disabled={disabled || missing.length > 0 || invalidTopics.length > 0}
              onClick={() => void submit('publish')}
            >
              {data.action === 'publish' ? '确认更新发布' : '确认发布'}
            </button>
            {data.action !== 'publish' ? (
              <button
                type="button"
                className={controls.button}
                disabled={disabled}
                onClick={() => void submit('draft')}
              >
                保存补充
              </button>
            ) : (
              <button
                type="button"
                className={controls.button}
                disabled={disabled}
                onClick={() => void submit('withdraw')}
              >
                撤回发布
              </button>
            )}
            {data.publicId && !needsRefresh ? (
              <Link href={`/signals/${data.publicId}`} className={controls.button}>
                查看正式信号
              </Link>
            ) : null}
            <button
              type="button"
              className={controls.button}
              disabled={busy}
              onClick={() => {
                if (pending || window.confirm('重新读取会替换尚未保存的输入，是否继续？'))
                  void reread();
              }}
            >
              核对已保存状态
            </button>
            {pending ? (
              <button
                type="button"
                className={controls.button}
                disabled={busy}
                onClick={() => void submit(pending.action, pending)}
              >
                重试原请求
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

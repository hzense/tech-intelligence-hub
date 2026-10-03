'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  editorialMissing,
  editorialNames,
  editorialResourceSameKind,
  type EditorialDashboard,
} from '@/lib/editorial-review';
import { signalTypeLabels } from '@/lib/signal-presentation';
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
  review_incomplete: '请补齐事件类型、日期、组织、人物和领域。',
  confirmation_required: '请补齐事件类型、日期、组织、人物和领域，并点击确认发布。',
  topic_reference_invalid: '领域已停用或名称有变化，请重新读取并选择。',
  entity_reference_invalid: '所选资源已不可用或类型不一致，请重新读取并核对身份。',
  resource_identity_ambiguous: '存在同名资源，请核对并选择正确身份。',
  resource_source_required: '请为每项资源勾选至少一条对应的公开来源，作为资料依据。',
  not_configured: '人工发布尚未配置完成。',
  invalid_request: '字段格式不正确，请检查日期和名称长度。',
  excluded_person: '人物不收录国家元首或政府首脑，请移除该人物；不要用无事件依据的人物替代。',
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
        signalType: data.content.signalType ?? null,
        organizations:
          data.content.resources === undefined
            ? editorialNames(organizationText)
            : data.content.organizations,
        persons:
          data.content.resources === undefined ? editorialNames(personText) : data.content.persons,
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
        organizations:
          data.content.resources === undefined
            ? editorialNames(organizationText)
            : data.content.organizations,
        persons:
          data.content.resources === undefined ? editorialNames(personText) : data.content.persons,
      }
    : null;
  const missing = content
    ? editorialMissing(content, data?.resourceOptions, data?.resourceSourceOptions)
    : [];
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
        核对事件类型、日期、组织、人物、领域和来源。生成的资源草稿将在确认发布时一并保存并建立关联。
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
            <legend>发布信息</legend>
            <label>
              事件类型
              <select
                aria-label="事件类型"
                value={data.content.signalType ?? ''}
                onChange={(event) =>
                  setData({
                    ...data,
                    content: {
                      ...data.content,
                      signalType:
                        (event.target.value as NonNullable<
                          EditorialDashboard['content']['signalType']
                        >) || null,
                    },
                  })
                }
              >
                <option value="">请选择事件类型</option>
                {Object.entries(signalTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
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
                readOnly={data.content.resources !== undefined}
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
                readOnly={data.content.resources !== undefined}
                onChange={(event) => setPersonText(event.target.value)}
                placeholder="填写人物姓名，多项用换行或逗号分隔"
              />
              {data.content.resources !== undefined && data.content.persons.length === 0 ? (
                <span>原文未提取到可支持的人物</span>
              ) : null}
            </label>
            {data.content.resources === undefined ? (
              <p>
                人物和组织名称唯一匹配已有公开资源时会建立关联；未建档或存在同名歧义时保留名称。
              </p>
            ) : (
              <div className={styles.resources}>
                <h3>关联资源</h3>
                <p>
                  以下资料与原文绑定。已存在的身份复用，缺失的身份在确认发布时创建；此处不会再次调用
                  AI。
                </p>
                {data.content.resources.map((resource, index) => {
                  const option = data.resourceOptions?.find(
                    (entry) =>
                      entry.name === resource.name && editorialResourceSameKind(entry, resource),
                  );
                  const sources =
                    data.resourceSourceOptions?.find(
                      (entry) =>
                        entry.name === resource.name && editorialResourceSameKind(entry, resource),
                    )?.sourceUrls ?? [];
                  const hasSelectedSource = sources.some((url) =>
                    data.content.sourceUrls.includes(url),
                  );
                  const typeLabel =
                    resource.type === 'person'
                      ? '人物'
                      : resource.type === 'company'
                        ? '公司'
                        : '机构';
                  const selected = option?.matches.find(
                    (match) =>
                      match.id === resource.entity_id && editorialResourceSameKind(match, resource),
                  );
                  return (
                    <article className={styles.resource} key={`${resource.type}:${resource.name}`}>
                      <h4>
                        {resource.name} · {typeLabel}
                      </h4>
                      <p>
                        {resource.entity_id === '__new__'
                          ? '发布时新建独立身份'
                          : resource.entity_id
                            ? `复用资源：${selected?.name ?? resource.name}`
                            : option?.status === 'ambiguous'
                              ? '存在同名资源，待核对身份'
                              : '发布时新建资源'}
                      </p>
                      {option && option.matches.length > 0 ? (
                        <label>
                          {resource.name} 的资源身份
                          <select
                            aria-label={`${resource.name} 的资源身份`}
                            value={resource.entity_id ?? ''}
                            onChange={(event) =>
                              setData({
                                ...data,
                                content: {
                                  ...data.content,
                                  resources: (data.content.resources ?? []).map(
                                    (entry, resourceIndex) =>
                                      index === resourceIndex
                                        ? { ...entry, entity_id: event.target.value || null }
                                        : entry,
                                  ),
                                },
                              })
                            }
                          >
                            <option value="">请选择已核实的身份</option>
                            {option.matches.map((match) => (
                              <option
                                key={match.id}
                                value={match.id}
                                disabled={!editorialResourceSameKind(match, resource)}
                              >
                                {match.name}（{match.id}） ·
                                {match.type === 'person'
                                  ? '人物'
                                  : match.type === 'company'
                                    ? '公司'
                                    : '机构'}
                              </option>
                            ))}
                            <option value="__new__">不是以上身份，新建独立资源</option>
                          </select>
                        </label>
                      ) : null}
                      {selected ? (
                        <p>
                          请核对是否为同一{resource.type === 'person' ? '人物' : '组织'}。
                          <Link
                            href={
                              selected.type === 'person'
                                ? `/persons/${selected.id}`
                                : `/resources/${selected.id}`
                            }
                            target="_blank"
                          >
                            查看已有资源
                          </Link>
                        </p>
                      ) : null}
                      {option?.status === 'ambiguous' &&
                      !option.matches.some((match) =>
                        editorialResourceSameKind(match, resource),
                      ) ? (
                        <p>已有同名资源的类型与生成资料不一致，需核对原文后重新生成。</p>
                      ) : null}
                      <p>简介：{resource.introduction ?? '原文未提供足够资料'}</p>
                      <p>本次事件角色：{resource.event_role ?? '原文未明确'}</p>
                      <div>
                        <p>{resource.name} 的资料对应来源：</p>
                        {sources.length ? (
                          <>
                            <ul>
                              {sources.map((url) => (
                                <li key={url}>
                                  <a href={url} target="_blank" rel="noreferrer">
                                    {url}
                                  </a>
                                  {data.content.sourceUrls.includes(url)
                                    ? ' · 已勾选'
                                    : ' · 未勾选'}
                                </li>
                              ))}
                            </ul>
                            <p>
                              {hasSelectedSource
                                ? '已选择此资源的公开来源。'
                                : '请在下方公开来源中勾选至少一条对应链接。'}
                            </p>
                          </>
                        ) : (
                          <p>没有可供公开的对应来源，请补充资料或核对来源状态后重新读取。</p>
                        )}
                      </div>
                      <details>
                        <summary>查看原文证据（{resource.evidence.length} 条）</summary>
                        {resource.evidence.map((evidence, evidenceIndex) => (
                          <blockquote key={`${evidence.fragment_id}:${evidenceIndex}`}>
                            <p>{evidence.quote}</p>
                            <cite>原文片段 {evidence.fragment_id}</cite>
                          </blockquote>
                        ))}
                      </details>
                    </article>
                  );
                })}
              </div>
            )}
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
              <p>新生成候选会自动匹配领域，可手动调整，最多 5 项；未匹配时请手动选择。</p>
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
            <div className={styles.topics}>
              <h3>公开来源</h3>
              <p>
                核对导入来源链接后，勾选允许随信号公开的链接。
                {data.content.resources?.length
                  ? '每项关联资源须至少勾选一条与其资料对应的来源，请核对上方资源卡片。'
                  : ''}
              </p>
              {(data.sourceOptions ?? []).length ? (
                (data.sourceOptions ?? []).map((url) => (
                  <label key={url} className={styles.option}>
                    <input
                      type="checkbox"
                      checked={data.content.sourceUrls.includes(url)}
                      onChange={(event) =>
                        setData({
                          ...data,
                          content: {
                            ...data.content,
                            sourceUrls: event.target.checked
                              ? [...data.content.sourceUrls, url]
                              : data.content.sourceUrls.filter((source) => source !== url),
                          },
                        })
                      }
                    />
                    公开来源：{url}
                  </label>
                ))
              ) : (
                <p>没有可供公开的导入来源链接。文件与受保护链接不会自动公开。</p>
              )}
            </div>
          </fieldset>
          <p>
            确认发布会公开上方标题、摘要、发布信息及勾选的来源链接。
            {data.content.resources?.length ? '同时保存资源档案并建立信号关联。' : ''}
            原始文件和未勾选的来源不会公开。
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

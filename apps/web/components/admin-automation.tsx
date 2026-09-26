'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AutomationConfig } from '../../../packages/database/src/automation-contract.mjs';
import type {
  AutomationConfigRecord,
  AutomationRun,
} from '../../../packages/database/src/automation-store.mjs';
import styles from './admin-automation.module.css';

type Kind = AutomationConfig['kind'];
type Profile = { id: string; revision: number; name: string; ready: boolean };
type Topic = { id: string; name: string };
type ConfigView = Pick<
  AutomationConfigRecord,
  'id' | 'revision' | 'config' | 'enabled' | 'next_run_at' | 'created_at' | 'updated_at'
>;
type RunView = Pick<
  AutomationRun,
  | 'id'
  | 'snapshot'
  | 'status'
  | 'phase'
  | 'result'
  | 'error_code'
  | 'created_at'
  | 'finished_at'
  | 'charged_microusd'
  | 'cost_source'
  | 'publication_status'
>;
type Dashboard = { configs: ConfigView[]; runs: RunView[] };
const blank = (kind: Kind): AutomationConfig => ({
  name: '',
  kind,
  enabled: false,
  frequency: kind === 'topic_insight' ? 'weekly' : 'manual',
  sourceUrls: [],
  topicIds: [],
  profileId: null,
  profileRevision: null,
});
const errors: Record<string, string> = {
  not_configured: '此功能尚未完成数据库、权限和预算配置。',
  revision_conflict: '配置已由其他会话修改，请刷新后核对。',
  request_id_conflict: '请求编号与已有任务不匹配，请先核对任务。',
  task_active: '该配置已有正在执行的任务，请查看列表。',
  budget_exceeded: '今日或单次预算不足，任务未启动。',
  profile_not_ready: '所选模型配置未就绪。',
  source_url_invalid: '来源链接格式或地址不符合导入规则。',
  insight_stale: '证据信号已改变或撤回，请重新生成报告。',
  dispatch_unknown: '任务已保存，但派发结果未知；请先刷新核对。',
};
async function api<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/admin/automation', {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] ?? '操作结果未确认，请刷新列表核对。');
  return result;
}
const money = (microusd: number) => `$${(microusd / 1_000_000).toFixed(4)}`;
const time = (date: string | Date | null) => (date ? new Date(date).toLocaleString('zh-CN') : '—');
function TopicReport({ result }: { result: Record<string, unknown> }) {
  const report = result.report as
    | {
        title?: string;
        summary?: string;
        sections?: { heading: string; body: string; signalIds: string[] }[];
        uncertainties?: string[];
      }
    | undefined;
  if (!report) return <p>报告结构不可用，请勿确认公开。</p>;
  return (
    <div className={styles.report}>
      <h3>{report.title}</h3>
      <p>{report.summary}</p>
      {report.sections?.map((section, index) => (
        <section key={index}>
          <h4>{section.heading}</h4>
          <p>{section.body}</p>
          <p>
            引用：
            {section.signalIds.map((id) => (
              <Link href={`/signals/${encodeURIComponent(id)}`} key={id}>
                {id}
              </Link>
            ))}
          </p>
        </section>
      ))}
      {report.uncertainties?.length ? (
        <>
          <h4>不确定性</h4>
          <ul>
            {report.uncertainties.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
function SourceResult({ result }: { result: Record<string, unknown> }) {
  const ids = Array.isArray(result.generationIds)
    ? result.generationIds.filter((id): id is string => typeof id === 'string')
    : [];
  return (
    <div className={styles.report}>
      {typeof result.batchId === 'string' ? (
        <Link href="/admin/imports">查看导入批次 · {result.batchId}</Link>
      ) : null}
      {ids.map((id) => (
        <Link key={id} href={`/admin/signal-generation/${id}`}>
          查看私有候选任务 · {id}
        </Link>
      ))}
      <p>资料或候选登记未完成：{Number(result.failed) || 0} 项。候选任务仍需各自完成生成与审核。</p>
    </div>
  );
}

export function AdminAutomation({
  kind,
  configured,
  loadError,
  initial,
  profiles,
  topics,
}: {
  kind: Kind;
  configured: boolean;
  loadError: boolean;
  initial: Dashboard;
  profiles: Profile[];
  topics: Topic[];
}) {
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState<ConfigView | null>(null);
  const [draft, setDraft] = useState<AutomationConfig>(() => blank(kind));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const createId = useRef<string | null>(null);
  const requestIds = useRef<Record<string, string>>({});
  async function refresh() {
    const next = await api<Dashboard>();
    setState(next);
    return next;
  }
  function edit(row: ConfigView | null) {
    setEditing(row);
    setDraft(row ? row.config : blank(kind));
    createId.current = null;
    setMessage('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !configured) return;
    createId.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ config: ConfigView }>({
        action: 'save',
        request: {
          id: editing?.id ?? createId.current,
          expectedRevision: editing?.revision ?? 0,
          config: draft,
          consent: true,
        },
      });
      createId.current = null;
      setEditing(result.config);
      setDraft(result.config.config);
      await refresh();
      setMessage(`配置已保存为 r${result.config.revision}。保存配置不会启动任务。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存结果未确认');
    } finally {
      setBusy(false);
    }
  }
  async function run(row: ConfigView) {
    if (
      busy ||
      !window.confirm(
        `确认启动“${row.config.name}”？运行可能产生导入或模型费用，结果需在任务列表中核对。`,
      )
    )
      return;
    requestIds.current[row.id] ??= crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ run: RunView }>({
        action: 'trigger',
        request: {
          configId: row.id,
          expectedRevision: row.revision,
          requestId: requestIds.current[row.id],
          consent: true,
        },
      });
      delete requestIds.current[row.id];
      await refresh();
      setMessage(`任务 ${result.run.id} 已保存，请在下方查看进度。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '启动结果未确认');
    } finally {
      setBusy(false);
    }
  }
  async function publish(row: RunView, confirm: boolean) {
    if (
      busy ||
      !window.confirm(
        confirm ? '确认公开这份专题洞察？请先阅读报告及其引用。' : '确认撤回这份公开洞察？',
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await api({ action: 'publish', id: row.id, confirm });
      await refresh();
      setMessage(confirm ? '专题洞察已确认公开。' : '专题洞察已撤回。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '结果未确认');
    } finally {
      setBusy(false);
    }
  }
  const configs = state.configs.filter((row) => row.config.kind === kind);
  const runs = state.runs.filter((row) => row.snapshot.kind === kind);
  return (
    <main className={`section-shell ${styles.main}`}>
      <header className={styles.header}>
        <p className="kicker">管理后台 · 自动任务</p>
        <h1>{kind === 'source_collection' ? '自动采集配置' : '专题洞察配置'}</h1>
        <p>
          {kind === 'source_collection'
            ? '登记可信来源链接，按配置频率导入并建立私有信号生成任务。'
            : '按专题选择当前公开信号，生成附有引用的私有报告，确认后公开。'}
        </p>
        {loadError ? (
          <p role="alert">
            任务列表读取失败，已停用操作；请检查专用数据库连接及权限，不要将空列表当作没有任务。
          </p>
        ) : !configured ? (
          <p role="status">数据库、专用权限和任务开关尚未启用；当前仅展示配置入口。</p>
        ) : null}
      </header>
      <section className={styles.card} aria-labelledby="config-title">
        <div className={styles.row}>
          <h2 id="config-title">
            {editing ? `编辑 ${editing.config.name} · r${editing.revision}` : '新建配置'}
          </h2>
          <button type="button" onClick={() => edit(null)}>
            新建配置
          </button>
        </div>
        <form onSubmit={save} className={styles.form}>
          <label>
            配置名称
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            执行频率
            <select
              value={draft.frequency}
              onChange={(e) =>
                setDraft({ ...draft, frequency: e.target.value as AutomationConfig['frequency'] })
              }
            >
              <option value="manual">仅手动</option>
              <option value="daily">每日（UTC）</option>
              <option value="weekly">每周一（UTC）</option>
            </select>
          </label>
          <label>
            分阶段模型配置
            <select
              required
              value={draft.profileId ?? ''}
              onChange={(e) => {
                const profile = profiles.find((row) => row.id === e.target.value);
                setDraft({
                  ...draft,
                  profileId: profile?.id ?? null,
                  profileRevision: profile?.revision ?? null,
                });
              }}
            >
              <option value="">选择已就绪配置</option>
              {profiles
                .filter((row) => row.ready)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · r{row.revision}
                  </option>
                ))}
            </select>
          </label>
          {kind === 'source_collection' ? (
            <label className={styles.full}>
              来源链接（每行一个，最多 8 个）
              <textarea
                rows={5}
                value={draft.sourceUrls.join('\n')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sourceUrls: e.target.value
                      .split('\n')
                      .map((url) => url.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="https://example.com/article"
              />
            </label>
          ) : (
            <fieldset className={styles.full}>
              <legend>分析专题（最多 5 个）</legend>
              <div className={styles.topics}>
                {topics.map((topic) => (
                  <label key={topic.id}>
                    <input
                      type="checkbox"
                      checked={draft.topicIds.includes(topic.id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          topicIds: e.target.checked
                            ? [...draft.topicIds, topic.id]
                            : draft.topicIds.filter((id) => id !== topic.id),
                        })
                      }
                    />
                    {topic.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            允许定时执行
          </label>
          <button type="submit" disabled={!configured || busy || !draft.profileId}>
            {busy ? '处理中…' : '保存配置'}
          </button>
        </form>
      </section>
      <section className={styles.card} aria-labelledby="saved-title">
        <div className={styles.row}>
          <h2 id="saved-title">已保存配置</h2>
          <button
            type="button"
            disabled={!configured || busy}
            onClick={() => void refresh().catch(() => setMessage('读取失败，请稍后刷新。'))}
          >
            刷新
          </button>
        </div>
        {configs.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>频率</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.config.name} · r{row.revision}
                    </td>
                    <td>{row.config.frequency}</td>
                    <td>{row.enabled ? '定时开启' : '仅手动'}</td>
                    <td>
                      <button type="button" disabled={busy} onClick={() => edit(row)}>
                        编辑
                      </button>
                      <button type="button" disabled={busy} onClick={() => void run(row)}>
                        立即运行
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>暂无配置。</p>
        )}
      </section>
      <section className={styles.card} aria-labelledby="runs-title">
        <h2 id="runs-title">运行记录</h2>
        {runs.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>创建时间</th>
                  <th>配置</th>
                  <th>状态与阶段</th>
                  <th>记账</th>
                  <th>结果与操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {time(row.created_at)}
                      <small>{row.id}</small>
                    </td>
                    <td>{row.snapshot.name}</td>
                    <td>
                      {row.status} · {row.phase}
                      {row.error_code ? <small>{row.error_code}</small> : null}
                    </td>
                    <td>
                      {money(row.charged_microusd)}
                      <small>{row.cost_source ?? '未结算'}</small>
                    </td>
                    <td>
                      {row.snapshot.kind === 'topic_insight' &&
                      row.status === 'completed' &&
                      row.result ? (
                        <>
                          <details>
                            <summary>阅读私有报告</summary>
                            <TopicReport result={row.result} />
                          </details>
                          <button
                            type="button"
                            disabled={busy || row.publication_status === 'published'}
                            onClick={() => void publish(row, true)}
                          >
                            确认公开
                          </button>
                          {row.publication_status === 'published' ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void publish(row, false)}
                            >
                              撤回
                            </button>
                          ) : null}
                        </>
                      ) : row.snapshot.kind === 'source_collection' && row.result ? (
                        <SourceResult result={row.result} />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>暂无运行记录。</p>
        )}
      </section>
      {message ? (
        <p role="status" className={styles.message}>
          {message}
        </p>
      ) : null}
    </main>
  );
}

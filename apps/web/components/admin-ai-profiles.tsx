'use client';

import { useRef, useState, type FormEvent } from 'react';
import type {
  AiConnection,
  AiProfile,
  AiProfileSaveRequest,
  AiProbe,
} from '../../../packages/database/src/ai-config-store.mjs';
import { aiRequest, AiAvailability } from './admin-ai-shared';
import { AdminAiModelPicker } from './admin-ai-model-picker';
import { useAiModelDiscovery } from '../lib/use-ai-model-discovery';
import { isValidAiModelId } from '../../../packages/database/src/ai-model-id.mjs';
import {
  aiProfileDefaultPrompts,
  aiProfileDefaultTemperature,
  aiProfileDefaultOutputTokens,
} from '../lib/admin-ai-profile-defaults';
import styles from './admin-ai.module.css';

const stages = [
  ['extract', '信号提取'],
  ['verify', '独立核验'],
  ['analyze', '专题分析'],
] as const;
type Stage = (typeof stages)[number][0];
type Selection = { connection_id: string; model_id: string };
function selectionsFor(profile: AiProfile | null): Record<Stage, Selection> {
  return {
    extract: {
      connection_id: profile?.stages.extract.connection_id ?? '',
      model_id: profile?.stages.extract.model_id ?? '',
    },
    verify: {
      connection_id: profile?.stages.verify.connection_id ?? '',
      model_id: profile?.stages.verify.model_id ?? '',
    },
    analyze: {
      connection_id: profile?.stages.analyze.connection_id ?? '',
      model_id: profile?.stages.analyze.model_id ?? '',
    },
  };
}
const noProbes: AiProbe[] = [];

export function AdminAiProfiles({
  connections: initialConnections,
  initialProfiles,
  initialProbes = noProbes,
  configured,
  available,
}: {
  connections: AiConnection[];
  initialProfiles: AiProfile[];
  initialProbes?: AiProbe[];
  configured: boolean;
  available: boolean;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [connections, setConnections] = useState(initialConnections);
  const [editing, setEditing] = useState<AiProfile | null>(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [selections, setSelections] = useState(() => selectionsFor(null));
  const [formRevision, setFormRevision] = useState(0);
  const discovery = useAiModelDiscovery(initialProbes, available);
  const disabled = busy || !available || discovery.loading;
  const createId = useRef<string | null>(null);

  function edit(profile: AiProfile | null) {
    setEditing(profile);
    setSelections(selectionsFor(profile));
    setFormRevision((value) => value + 1);
    createId.current = null;
    setHistory(null);
    setMessage('');
  }
  function selectConnection(stage: Stage, connectionId: string) {
    setSelections((old) => ({ ...old, [stage]: { connection_id: connectionId, model_id: '' } }));
    const connection = connections.find((row) => row.id === connectionId);
    if (connection) void discovery.load(connection);
  }

  async function refresh() {
    const [profileResult, connectionResult] = await Promise.all([
      aiRequest<{ profiles: AiProfile[] }>('profiles'),
      aiRequest<{ connections: AiConnection[] }>('connections'),
    ]);
    setProfiles(profileResult.profiles);
    setSelections((old) => {
      const next = { ...old };
      for (const [stage] of stages) {
        const before = connections.find((row) => row.id === old[stage].connection_id);
        const after = connectionResult.connections.find(
          (row) => row.id === old[stage].connection_id,
        );
        if (!after) next[stage] = { connection_id: '', model_id: '' };
        else if (after.revision !== before?.revision || !after.enabled || !after.has_key)
          next[stage] = { ...old[stage], model_id: '' };
      }
      return next;
    });
    setConnections(connectionResult.connections);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const draft = {} as AiProfileSaveRequest['stages'];
    for (const [key] of stages) {
      const connection = connections.find((item) => item.id === selections[key].connection_id);
      if (!connection || !connection.enabled || !connection.has_key) {
        setMessage('请为每个阶段选择一个已启用且具有密钥的可用连接。');
        return;
      }
      if (!isValidAiModelId(selections[key].model_id)) {
        setMessage('请为每个阶段选择或填写有效的模型 ID。');
        return;
      }
      draft[key] = {
        connection_id: connection.id,
        connection_revision: connection.revision,
        model_id: selections[key].model_id,
        prompt: String(data.get(`${key}.prompt`)),
        temperature: aiProfileDefaultTemperature,
        max_output_tokens: Number(data.get(`${key}.tokens`)),
        require_tools: data.get(`${key}.tools`) === 'on',
      };
    }
    createId.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const payload: AiProfileSaveRequest = {
        ...(editing
          ? { id: editing.id, expected_revision: editing.revision }
          : { id: createId.current }),
        name: String(data.get('name')),
        stages: draft,
      };
      const result = await aiRequest<{ profile: AiProfile }>('profiles', 'POST', payload);
      setEditing(result.profile);
      createId.current = null;
      setMessage(`已保存配置 r${result.profile.revision}。本次未启动任何任务。`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存结果未确认，请刷新后核对。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AiAvailability configured={configured} available={available} />
      <p className={styles.notice}>
        三个阶段可以选择不同连接和模型。保存前必须通过同一连接修订、同一模型的基础连接与结构化输出测试；启用工具要求时还需通过工具调用测试。测试证明有效期
        24 小时，修改连接后需重新测试。这里保存配置，不创建采集、核验或分析任务。
      </p>
      <p className={styles.muted}>
        选择 AI
        连接后自动加载当前修订的模型列表；已有成功列表会复用，没有时读取一次，失败不自动重试。
        模型列表读取受测试次数、并发与预算门禁约束，不运行生成或能力测试。 随机性统一为适中（
        {aiProfileDefaultTemperature}）；保存新修订时采用该值，历史配置不改写。
      </p>
      {!discovery.pendingState.available ? (
        <p className={styles.notice}>
          无法安全保存／恢复模型列表请求编号，请允许会话存储；暂不发起请求，仍可手填模型 ID。
        </p>
      ) : null}
      {discovery.pendingState.request ? (
        <div className={styles.notice}>
          <p>
            有待确认测试 {discovery.pendingState.request.id}；暂停新的模型列表请求，不会自动重试。
          </p>
          <button
            className={styles.button}
            type="button"
            disabled={disabled}
            onClick={() => void discovery.queryPending()}
          >
            查询原编号
          </button>
        </div>
      ) : null}
      {discovery.pendingMessage ? (
        <p className={styles.notice} role="status">
          {discovery.pendingMessage}
        </p>
      ) : null}
      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}
      <div className={styles.grid}>
        <section className={styles.stack} aria-label="配置列表">
          <div className={styles.actions}>
            <button className={styles.button} disabled={disabled} onClick={() => edit(null)}>
              新建配置
            </button>
            <button
              className={styles.button}
              disabled={disabled}
              onClick={async () => {
                setBusy(true);
                try {
                  await refresh();
                  setMessage('配置状态与连接修订已刷新；变更后的连接仍需重新通过能力测试。');
                } catch {
                  setMessage('读取失败，请稍后重试。');
                } finally {
                  setBusy(false);
                }
              }}
            >
              刷新状态
            </button>
          </div>
          {!profiles.length ? <p className={styles.muted}>尚无分阶段配置。</p> : null}
          {profiles.map((profile) => (
            <article className={styles.card} key={profile.id}>
              <h2>
                {profile.name} · r{profile.revision}
              </h2>
              <p className={styles.badge}>
                {profile.readiness.ready ? '测试证明有效' : '尚不可用，需要更新测试或配置'}
              </p>
              {profile.readiness.reasons.length ? (
                <ul>
                  {profile.readiness.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <dl className={styles.facts}>
                {stages.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {profile.stages[key].model_id} · r{profile.stages[key].connection_revision}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className={styles.actions}>
                <button className={styles.button} disabled={disabled} onClick={() => edit(profile)}>
                  编辑新修订
                </button>
                <button
                  className={styles.button}
                  disabled={disabled}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await aiRequest<{ history: unknown }>(
                        `profiles/${profile.id}/history`,
                      );
                      setHistory(result.history);
                    } catch {
                      setMessage('无法读取版本历史。');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  版本历史
                </button>
              </div>
            </article>
          ))}
          {history ? (
            <details open className={styles.card}>
              <summary>配置版本历史</summary>
              <pre className={styles.code}>{JSON.stringify(history, null, 2)}</pre>
            </details>
          ) : null}
        </section>
        <section className={styles.card} aria-labelledby="profile-edit-title">
          <h2 id="profile-edit-title">
            {editing ? `编辑 ${editing.name}（当前 r${editing.revision}）` : '新建分阶段配置'}
          </h2>
          <form
            method="post"
            className={styles.form}
            key={`${editing ? `${editing.id}:${editing.revision}` : 'new'}:${formRevision}`}
            onSubmit={save}
          >
            <fieldset disabled={disabled}>
              <label>
                配置名称
                <input name="name" required maxLength={100} defaultValue={editing?.name ?? ''} />
              </label>
              {stages.map(([key, label]) => {
                const connection = connections.find(
                  (row) => row.id === selections[key].connection_id,
                );
                const catalog = discovery.catalogue(connection);
                const statusId = `ai-profile-${key}-model-status`;
                return (
                  <fieldset key={key} className={styles.card}>
                    <legend>{label}</legend>
                    <label>
                      AI 连接
                      <select
                        name={`${key}.connection`}
                        required
                        value={selections[key].connection_id}
                        onChange={(event) => selectConnection(key, event.target.value)}
                      >
                        <option value="" disabled>
                          请选择连接
                        </option>
                        {connections.map((connection) => (
                          <option
                            key={connection.id}
                            value={connection.id}
                            disabled={!connection.enabled || !connection.has_key}
                          >
                            {connection.name} · r{connection.revision}
                            {!connection.enabled || !connection.has_key ? '（不可用）' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <AdminAiModelPicker
                      key={`${connection?.id}:${connection?.revision}:${catalog.listed?.id}:${disabled}`}
                      name={`${key}.model`}
                      required
                      models={catalog.models}
                      value={selections[key].model_id}
                      onChange={(model) =>
                        setSelections((old) => ({
                          ...old,
                          [key]: { ...old[key], model_id: model },
                        }))
                      }
                      disabled={
                        disabled || !connection || !connection.enabled || !connection.has_key
                      }
                      describedBy={statusId}
                    />
                    <p id={statusId} className={styles.muted}>
                      {catalog.message ||
                        (!connection
                          ? '先选择 AI 连接，即可自动加载模型列表。'
                          : catalog.listed
                            ? `当前连接 r${connection.revision} 的已保存列表有 ${catalog.models.length} 个模型；可搜索、选择或手填。`
                            : '暂无当前修订的模型列表；可重新读取，也可手填完整模型 ID。')}
                      {catalog.listed ? ` 列表时间：${catalog.listed.created_at}。` : ''}
                      {catalog.listed?.result.truncated === true
                        ? ' 列表已截断；仍可手填未列出的模型 ID。'
                        : ''}
                    </p>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={
                        disabled ||
                        !connection ||
                        !connection.enabled ||
                        !connection.has_key ||
                        !discovery.pendingState.available ||
                        discovery.pendingState.request !== null
                      }
                      onClick={() => {
                        if (connection) void discovery.load(connection, true);
                      }}
                    >
                      重新读取模型列表
                    </button>
                    <label>
                      提示词（不填写密钥）
                      <textarea
                        name={`${key}.prompt`}
                        required
                        maxLength={4000}
                        defaultValue={editing?.stages[key].prompt ?? aiProfileDefaultPrompts[key]}
                      />
                    </label>
                    <div className={styles.fields}>
                      <label>
                        输出 token 上限
                        <input
                          name={`${key}.tokens`}
                          type="number"
                          required
                          min="128"
                          max="8192"
                          step="1"
                          defaultValue={
                            editing?.stages[key].max_output_tokens ??
                            aiProfileDefaultOutputTokens[key]
                          }
                        />
                      </label>
                    </div>
                    <label className={styles.checkbox}>
                      <input
                        name={`${key}.tools`}
                        type="checkbox"
                        defaultChecked={editing?.stages[key].require_tools ?? false}
                      />
                      要求模型具备工具调用能力
                    </label>
                  </fieldset>
                );
              })}
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                保存为新修订
              </button>
            </fieldset>
          </form>
        </section>
      </div>
    </>
  );
}

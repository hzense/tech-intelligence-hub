'use client';

import { useRef, useState, type FormEvent } from 'react';
import type {
  AiConnection,
  AiProfile,
  AiProfileSaveRequest,
} from '../../../packages/database/src/ai-config-store.mjs';
import { aiRequest, AiAvailability } from './admin-ai-shared';
import styles from './admin-ai.module.css';

const stages = [
  ['extract', '信号提取'],
  ['verify', '独立核验'],
  ['analyze', '专题分析'],
] as const;

export function AdminAiProfiles({
  connections,
  initialProfiles,
  configured,
  available,
}: {
  connections: AiConnection[];
  initialProfiles: AiProfile[];
  configured: boolean;
  available: boolean;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [editing, setEditing] = useState<AiProfile | null>(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const createId = useRef<string | null>(null);

  async function refresh() {
    const result = await aiRequest<{ profiles: AiProfile[] }>('profiles');
    setProfiles(result.profiles);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const draft = {} as AiProfileSaveRequest['stages'];
    for (const [key] of stages) {
      const connection = connections.find(
        (item) => item.id === String(data.get(`${key}.connection`)),
      );
      if (!connection) {
        setMessage('请为每个阶段选择一个可用连接。');
        return;
      }
      draft[key] = {
        connection_id: connection.id,
        connection_revision: connection.revision,
        model_id: String(data.get(`${key}.model`)),
        prompt: String(data.get(`${key}.prompt`)),
        temperature: Number(data.get(`${key}.temperature`)),
        max_output_tokens: Number(data.get(`${key}.tokens`)),
        require_tools: data.get(`${key}.tools`) === 'on',
      };
    }
    createId.current ??= crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const result = await aiRequest<{ profile: AiProfile }>('profiles', 'POST', {
        id: editing?.id ?? createId.current,
        ...(editing ? { expected_revision: editing.revision } : {}),
        name: String(data.get('name')),
        stages: draft,
      });
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
      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}
      <div className={styles.grid}>
        <section className={styles.stack} aria-label="配置列表">
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={busy || !available}
              onClick={() => {
                setEditing(null);
                createId.current = null;
                setHistory(null);
                setMessage('');
              }}
            >
              新建配置
            </button>
            <button
              className={styles.button}
              disabled={busy || !available}
              onClick={async () => {
                setBusy(true);
                try {
                  await refresh();
                  setMessage('列表已刷新。连接变更后，请刷新页面更新连接修订。');
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
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() => {
                    setEditing(profile);
                    setHistory(null);
                    setMessage('');
                  }}
                >
                  编辑新修订
                </button>
                <button
                  className={styles.button}
                  disabled={busy}
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
            key={editing ? `${editing.id}:${editing.revision}` : 'new'}
            onSubmit={save}
          >
            <fieldset disabled={busy || !available}>
              <label>
                配置名称
                <input name="name" required maxLength={100} defaultValue={editing?.name ?? ''} />
              </label>
              {stages.map(([key, label]) => (
                <fieldset key={key} className={styles.card}>
                  <legend>{label}</legend>
                  <label>
                    AI 连接
                    <select
                      name={`${key}.connection`}
                      required
                      defaultValue={editing?.stages[key].connection_id ?? ''}
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
                  <label>
                    模型 ID
                    <input
                      name={`${key}.model`}
                      required
                      maxLength={200}
                      autoComplete="off"
                      defaultValue={editing?.stages[key].model_id ?? ''}
                    />
                  </label>
                  <label>
                    提示词（不填写密钥）
                    <textarea
                      name={`${key}.prompt`}
                      required
                      maxLength={4000}
                      defaultValue={editing?.stages[key].prompt ?? ''}
                    />
                  </label>
                  <div className={styles.fields}>
                    <label>
                      温度（0—2）
                      <input
                        name={`${key}.temperature`}
                        type="number"
                        required
                        min="0"
                        max="2"
                        step="0.1"
                        defaultValue={editing?.stages[key].temperature ?? 0}
                      />
                    </label>
                    <label>
                      输出 token 上限
                      <input
                        name={`${key}.tokens`}
                        type="number"
                        required
                        min="128"
                        max="8192"
                        step="1"
                        defaultValue={editing?.stages[key].max_output_tokens ?? 2048}
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
              ))}
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

'use client';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type {
  AiConnection,
  AiConnectionSettings,
  AiProbe,
  AiProbeKind,
  AiProbeRequest,
} from '../../../packages/database/src/ai-config-store.mjs';
import {
  aiRequest,
  AiAvailability,
  AiEndpointFields,
  ProbeSummary,
  probeLabels,
} from './admin-ai-shared';
import { aiEndpointChanged, aiEndpointMessage, inspectAiEndpoint } from '../lib/admin-ai-endpoint';
import {
  readPendingAiProbe,
  persistPendingAiProbe,
  clearPendingAiProbe,
} from '../lib/admin-ai-pending';
import styles from './admin-ai.module.css';
import { isValidAiModelId } from '../../../packages/database/src/ai-model-id.mjs';

const defaults: AiConnectionSettings = {
  timeout_ms: 10000,
  max_concurrency: 1,
  daily_budget_microusd: 1000000,
  input_price_microusd_per_million: 0,
  output_price_microusd_per_million: 0,
};
const number = (form: FormData, name: string) => Number(form.get(name));
const string = (form: FormData, name: string) => String(form.get(name) ?? '');
const pendingEvent = 'hzense-ai-pending-changed';
function subscribePending(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(pendingEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(pendingEvent, listener);
  };
}
const pendingSnapshot = () => JSON.stringify(readPendingAiProbe());
const serverPendingSnapshot = () => '{"available":false,"request":null}';

export function AdminAiConsole({
  initialConnections,
  initialProbes,
  configured,
  available,
  allowedHosts,
}: {
  initialConnections: AiConnection[];
  initialProbes: AiProbe[];
  configured: boolean;
  available: boolean;
  allowedHosts: string[];
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [probes, setProbes] = useState(initialProbes);
  const [editing, setEditing] = useState<AiConnection | null>(null);
  const [selectedId, setSelectedId] = useState(initialConnections[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<unknown>(null);
  const pendingState = JSON.parse(
    useSyncExternalStore(subscribePending, pendingSnapshot, serverPendingSnapshot),
  ) as ReturnType<typeof readPendingAiProbe>;
  const pending = pendingState.request;
  const createId = useRef<string | null>(null);
  const settings = editing?.settings ?? defaults;
  const selected = connections.find((row) => row.id === selectedId);
  const listed = probes.find(
    (row) =>
      row.connection_id === selectedId &&
      row.connection_revision === selected?.revision &&
      row.kind === 'models' &&
      row.status === 'succeeded',
  );
  const models = Array.isArray(listed?.result.models)
    ? listed.result.models.flatMap((item) =>
        item && typeof item === 'object' && 'id' in item && isValidAiModelId(item.id)
          ? [item.id]
          : [],
      )
    : [];
  async function refresh() {
    const [a, b] = await Promise.all([
      aiRequest<{ connections: AiConnection[] }>('connections'),
      aiRequest<{ probes: AiProbe[] }>('probes'),
    ]);
    setConnections(a.connections);
    setProbes(b.probes);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const baseUrl = string(data, 'base_url');
    const endpoint = inspectAiEndpoint(baseUrl, allowedHosts);
    if (!endpoint.valid) {
      setMessage(aiEndpointMessage(endpoint));
      return;
    }
    const replaceEndpoint =
      !editing || aiEndpointChanged(editing.base_url, baseUrl, editing.base_url);
    if (editing && replaceEndpoint && !string(data, 'api_key')) {
      setMessage('更换接口地址时必须重新填写密钥，不能沿用原接口的密钥。');
      return;
    }
    const patch = {
      name: string(data, 'name'),
      protocol: 'openai-compatible',
      // Do not re-normalize an unchanged stored endpoint when saving other fields.
      ...(replaceEndpoint ? { base_url: baseUrl } : {}),
      enabled: data.get('enabled') === 'on',
      settings: {
        timeout_ms: number(data, 'timeout_ms'),
        max_concurrency: number(data, 'max_concurrency'),
        daily_budget_microusd: Math.round(number(data, 'daily_budget') * 1e6),
        input_price_microusd_per_million: Math.round(number(data, 'input_price') * 1e6),
        output_price_microusd_per_million: Math.round(number(data, 'output_price') * 1e6),
      },
      ...(string(data, 'api_key') ? { api_key: string(data, 'api_key') } : {}),
    };
    if (!editing && !createId.current) createId.current = crypto.randomUUID();
    setBusy(true);
    setMessage('');
    try {
      const result = await aiRequest<{ connection: AiConnection }>(
        'connections',
        editing ? 'PATCH' : 'POST',
        editing
          ? { ...patch, id: editing.id, expected_revision: editing.revision }
          : { ...patch, id: createId.current },
      );
      form.reset();
      setEditing(result.connection);
      setSelectedId(result.connection.id);
      setModel('');
      createId.current = null;
      await refresh();
      setMessage('连接已保存。测试结果只适用于当前修订；保存本身不会调用模型。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存未确认，请刷新。');
    } finally {
      setBusy(false);
    }
  }
  async function change(connection: AiConnection, revoke = false) {
    setBusy(true);
    setMessage('');
    try {
      const result = await aiRequest<{ connection: AiConnection }>('connections', 'PATCH', {
        id: connection.id,
        expected_revision: connection.revision,
        ...(revoke ? { revoke_key: true } : { enabled: !connection.enabled }),
      });
      if (editing?.id === connection.id) setEditing(result.connection);
      if (selectedId === connection.id) setModel('');
      await refresh();
      setMessage(
        revoke
          ? '密钥已撤销，连接已停用；后续请求不可复用旧密钥。'
          : '启用状态已更新，旧能力测试需要重新确认。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未确认。');
    } finally {
      setBusy(false);
    }
  }
  async function probe(request: AiProbeRequest) {
    if (!persistPendingAiProbe(request)) {
      setMessage('无法安全保存测试编号，或已有另一项待确认测试；未发起模型调用。请先查询原记录。');
      return;
    }
    window.dispatchEvent(new Event(pendingEvent));
    setBusy(true);
    setMessage(`测试编号 ${request.id} 已生成；正在提交并预留预算。`);
    try {
      const result = await aiRequest<{ probe: AiProbe }>('probes', 'POST', request);
      await refresh();
      if (!['pending', 'running', 'unknown'].includes(result.probe.status)) releasePending();
      setMessage(`测试 ${request.id}：${result.probe.status}。结果已保存，可通过测试详情查询。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '测试结果未确认，请使用原编号查询。');
    } finally {
      setBusy(false);
    }
  }
  async function queryPending() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await aiRequest<{ probe: AiProbe }>(`probes/${pending.id}`);
      await refresh();
      setMessage(`原测试状态：${result.probe.status}`);
      if (!['pending', 'running', 'unknown'].includes(result.probe.status)) releasePending();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '查询失败。');
    } finally {
      setBusy(false);
    }
  }
  function releasePending() {
    if (!clearPendingAiProbe()) {
      setMessage('无法清除本地测试编号，保留待确认状态；不会自动创建新测试。');
      return;
    }
    window.dispatchEvent(new Event(pendingEvent));
  }
  async function viewHistory(connection: AiConnection) {
    setBusy(true);
    try {
      setHistory(
        (await aiRequest<{ history: unknown }>(`connections/${connection.id}/history`)).history,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '查询失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <AiAvailability configured={configured} available={available} />
      {!pendingState.available ? (
        <p className={styles.notice}>
          尚不能安全保存／恢复测试编号，模型测试保持禁用；请允许此站点使用会话存储。仅保存测试编号和非密钥配置引用，不保存
          API key。
        </p>
      ) : null}
      <p className={styles.muted}>
        允许的接口域名：{allowedHosts.join('、') || '未配置'}
        。所有请求走服务端；测试可能产生费用，但不会采集资料或发布信号。
      </p>
      <p className={styles.notice} role="status" aria-live="polite">
        {message || '先保存并启用连接，再分别进行连接和能力测试。'}
      </p>
      <div className={styles.grid}>
        <section className={styles.stack} aria-label="已保存的 AI 连接">
          <div className={styles.actions}>
            <h2>我的连接</h2>
            <button
              className={styles.button}
              disabled={busy || !available}
              onClick={() => {
                setEditing(null);
                createId.current = null;
                setHistory(null);
              }}
            >
              新建连接
            </button>
          </div>
          {connections.length === 0 ? (
            <p className={styles.muted}>尚无连接。模型不会因打开此页面而被调用。</p>
          ) : null}
          {connections.map((connection) => (
            <article className={styles.card} key={connection.id}>
              <h3>{connection.name}</h3>
              <p className={styles.badge}>
                r{connection.revision} · {connection.enabled ? '已启用' : '已停用'} ·{' '}
                {connection.has_key ? '密钥已保存' : '无可用密钥'}
              </p>
              <p className={styles.muted}>{connection.base_url}</p>
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() => {
                    setEditing(connection);
                    if (selectedId !== connection.id) setModel('');
                    setSelectedId(connection.id);
                    setHistory(null);
                  }}
                >
                  编辑
                </button>
                <button
                  className={styles.button}
                  disabled={busy || !connection.has_key}
                  onClick={() => change(connection)}
                >
                  {connection.enabled ? '停用' : '启用'}
                </button>
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() => viewHistory(connection)}
                >
                  版本记录
                </button>
              </div>
              <details>
                <summary>撤销密钥</summary>
                <p className={styles.muted}>
                  此操作清除当前密文并停用连接，不能从版本记录恢复旧密钥。已发出的供应商请求无法撤销。
                </p>
                <button
                  className={styles.button}
                  disabled={busy || !connection.has_key}
                  onClick={() => change(connection, true)}
                >
                  确认撤销此连接密钥
                </button>
              </details>
            </article>
          ))}
          {history ? (
            <details open className={styles.card}>
              <summary>配置版本（不含密钥）</summary>
              <pre className={styles.code}>{JSON.stringify(history, null, 2)}</pre>
            </details>
          ) : null}
        </section>
        <section className={styles.card}>
          <h2>{editing ? `编辑连接 · r${editing.revision}` : '新建 AI 连接'}</h2>
          <form
            method="post"
            key={editing ? `${editing.id}:${editing.revision}` : 'new'}
            className={styles.form}
            onSubmit={save}
            autoComplete="off"
          >
            <fieldset disabled={busy || !available}>
              <label>
                连接名称
                <input name="name" required maxLength={100} defaultValue={editing?.name ?? ''} />
              </label>
              <AiEndpointFields
                initialBaseUrl={editing?.base_url ?? 'https://ai-gateway.vercel.sh/v1'}
                editing={editing !== null}
                allowedHosts={allowedHosts}
              />
              <label className={styles.checkbox}>
                <input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? false} />
                允许此连接接受测试和后续受控调用
              </label>
              <div className={styles.fields}>
                <label>
                  超时（毫秒）
                  <input
                    name="timeout_ms"
                    type="number"
                    min={3000}
                    max={20000}
                    step={1000}
                    required
                    defaultValue={settings.timeout_ms}
                  />
                </label>
                <label>
                  最大并发测试
                  <input
                    name="max_concurrency"
                    type="number"
                    min={1}
                    max={3}
                    required
                    defaultValue={settings.max_concurrency}
                  />
                </label>
                <label>
                  每日估算预算（USD）
                  <input
                    name="daily_budget"
                    type="number"
                    min={0.000001}
                    max={100}
                    step="0.000001"
                    required
                    defaultValue={settings.daily_budget_microusd / 1e6}
                  />
                </label>
                <label>
                  输入单价（USD／百万 token）
                  <input
                    name="input_price"
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.000001"
                    required
                    defaultValue={editing ? settings.input_price_microusd_per_million / 1e6 : ''}
                  />
                </label>
                <label>
                  输出单价（USD／百万 token）
                  <input
                    name="output_price"
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.000001"
                    required
                    defaultValue={editing ? settings.output_price_microusd_per_million / 1e6 : ''}
                  />
                </label>
              </div>
              <p className={styles.muted}>
                请按所测试模型的供应商价格填写。0
                表示明确按免费估算；此预算不是供应商账单上限。无自动重试，每日最多 100
                次测试，失败或未知结果保留预算占用。
              </p>
              <button className={`${styles.button} ${styles.primary}`} type="submit">
                {busy ? '处理中…' : '保存连接'}
              </button>
            </fieldset>
          </form>
        </section>
      </div>
      <section className={styles.card} style={{ marginTop: 24 }}>
        <h2>模型与能力测试</h2>
        <div className={styles.form}>
          <fieldset disabled={busy || !available || !pendingState.available || pending !== null}>
            <label>
              测试连接
              <select
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setModel('');
                }}
              >
                <option value="">请选择连接</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} · r{connection.revision}
                    {connection.enabled ? '' : '（已停用）'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              从模型列表选择
              <select
                value={models.includes(model) ? model : ''}
                disabled={models.length === 0}
                onChange={(event) => setModel(event.target.value)}
                aria-describedby="ai-model-list-status"
              >
                <option value="">
                  {models.length ? '请选择模型（不会自动调用）' : '请先读取模型列表'}
                </option>
                {models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <p id="ai-model-list-status" className={styles.muted}>
              {listed
                ? `当前连接 r${selected?.revision} 的列表包含 ${models.length} 个模型；选择后只填写模型 ID，不自动测试。`
                : '点击“读取模型列表”后可从下拉列表选择；也可手动填写完整模型 ID。'}
            </p>
            <label>
              模型 ID（列表选择或手动输入）
              <input
                list="ai-model-choices"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                maxLength={200}
                placeholder="先读取列表，也可以直接填写供应商模型 ID"
              />
            </label>
            <datalist id="ai-model-choices">
              {models.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            {listed?.result.truncated === true ? (
              <p className={styles.muted}>模型列表已截断；仍可手动填写完整模型 ID。</p>
            ) : null}
            <div className={styles.actions}>
              {(['models', 'connection', 'structured_output', 'tool_calling'] as AiProbeKind[]).map(
                (kind) => (
                  <button
                    className={styles.button}
                    key={kind}
                    type="button"
                    disabled={
                      !selected?.enabled ||
                      !selected.has_key ||
                      (kind !== 'models' && !isValidAiModelId(model))
                    }
                    onClick={() => {
                      if (selected)
                        void probe({
                          id: crypto.randomUUID(),
                          connection_id: selected.id,
                          connection_revision: selected.revision,
                          kind,
                          ...(kind === 'models' ? {} : { model_id: model }),
                        });
                    }}
                  >
                    {kind === 'models' ? '读取模型列表' : `测试${probeLabels[kind]}`}
                  </button>
                ),
              )}
            </div>
          </fieldset>
        </div>
        <p className={styles.muted}>
          基础连接成功不代表支持结构化输出或工具调用。分阶段配置必须绑定当前连接修订、相同模型及最近
          24 小时内的独立测试。更换模型时请先核对估算单价。
        </p>
        {pending ? (
          <div className={styles.notice}>
            <p>待确认测试：{pending.id}。请先查询原记录，不要重复创建付费测试。</p>
            <div className={styles.actions}>
              <button className={styles.button} disabled={busy} onClick={queryPending}>
                查询原编号
              </button>
              <button className={styles.button} disabled={busy} onClick={() => probe(pending)}>
                原编号重试
              </button>
              <button className={styles.button} disabled={busy} onClick={releasePending}>
                结束查询，允许新测试（可能再次计费）
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <section className={styles.stack} style={{ marginTop: 24 }} aria-label="最近模型测试">
        <h2>最近测试记录</h2>
        {probes.map((probe) => (
          <ProbeSummary key={probe.id} probe={probe} />
        ))}
        {probes.length === 0 ? <p className={styles.muted}>暂无测试记录。</p> : null}
      </section>
    </>
  );
}

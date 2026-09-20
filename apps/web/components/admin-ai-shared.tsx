'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { AiProbe } from '../../../packages/database/src/ai-config-store.mjs';
import {
  aiEndpointChanged,
  aiEndpointMessage,
  aiPresetForEndpoint,
  aiProviderPresets,
  inspectAiEndpoint,
  type AiProviderPresetId,
} from '../lib/admin-ai-endpoint';
import styles from './admin-ai.module.css';

const messages: Record<string, string> = {
  unauthorized: '登录已过期，请重新登录。',
  forbidden_origin: '请求来源不受信任。',
  ai_not_configured: 'AI 后台尚未配置完成。',
  invalid_request: '请检查字段格式、模型名称和数值范围。',
  invalid_configuration:
    '接口基础地址未通过服务端校验。请检查 HTTPS 基础路径和本页允许域名；修改 Production 的 HZENSE_AI_ALLOWED_HOSTS 后须重新部署并刷新页面。',
  revision_conflict: '配置已变化，请刷新后重新编辑。',
  request_id_conflict:
    '该请求编号已用于不同内容，或已有配置已被修改。请刷新核对原记录，不要覆盖重试。',
  endpoint_key_required: '更换接口地址时必须重新填写密钥，不能沿用原接口的密钥。',
  key_unavailable: '密钥已撤销或不可用。',
  connection_unavailable: '连接不可用，请检查启用状态及密钥。',
  keyring_unavailable: '服务端加密密钥暂不可用，请联系管理员。',
  profile_not_ready:
    '模型需要通过当前连接修订、同一模型的连接及结构化输出测试；要求工具调用时还需通过工具测试。测试超过 24 小时仅提醒，不会因此禁止生成。',
  daily_budget_exceeded: '已达到本连接的每日估算预算。',
  concurrency_limit: '已有测试运行中，请稍后查询结果。',
  daily_probe_limit: '已达到每日测试次数限制。',
  not_found: '记录不存在。',
};
export function aiErrorMessage(code: unknown) {
  return typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code]
    : '操作结果未确认，请刷新记录；模型测试请使用原编号查询或重试。';
}
export async function aiRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/ai/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(60_000),
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(aiErrorMessage(result.error));
  return result as T;
}
export const probeLabels: Record<string, string> = {
  models: '模型列表',
  connection: '基础连接',
  structured_output: '结构化输出',
  tool_calling: '工具调用',
};
export const statusLabels: Record<string, string> = {
  pending: '已预留',
  running: '运行中',
  succeeded: '通过',
  failed: '失败',
  unknown: '结果未知',
  stale: '配置已变化',
};
export const usd = (micros: string | number) => `$${(Number(micros) / 1_000_000).toFixed(6)}`;
export function AiNavigation() {
  return (
    <nav className={styles.actions} aria-label="AI 后台导航">
      <Link className={styles.button} href="/admin">
        管理后台
      </Link>
      <Link className={styles.button} href="/admin/ai">
        AI 连接与测试
      </Link>
      <Link className={styles.button} href="/admin/ai/profiles">
        分阶段模型配置
      </Link>
    </nav>
  );
}
export function AiAvailability({
  configured,
  available,
}: {
  configured: boolean;
  available: boolean;
}) {
  if (available) return null;
  return (
    <div className={styles.notice} role="status">
      {configured
        ? 'AI 配置数据库暂不可用，所有写入和测试已关闭。'
        : 'AI 后台尚未配置完成：需要独立数据库角色、服务端加密根密钥及允许访问的接口域名。'}{' '}
      不要把密钥发送到对话或填写在普通文本字段中。此页面不启动采集或发布。
    </div>
  );
}

/** Keyed by the enclosing form's connection/revision, not by provider choice. */
export function AiEndpointFields({
  initialBaseUrl,
  editing,
  allowedHosts,
}: {
  initialBaseUrl: string;
  editing: boolean;
  allowedHosts: string[];
}) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const storedBaseUrl = editing ? initialBaseUrl : undefined;
  const [preset, setPreset] = useState<AiProviderPresetId>(() =>
    aiPresetForEndpoint(initialBaseUrl, storedBaseUrl),
  );
  const [keyNotice, setKeyNotice] = useState('');
  const keyInput = useRef<HTMLInputElement>(null);
  const guidance = inspectAiEndpoint(baseUrl, allowedHosts);
  const suggestedPreset = !guidance.valid
    ? aiProviderPresets.find((item) => item.baseUrl === guidance.suggestedBaseUrl)
    : undefined;
  const endpointChanged = aiEndpointChanged(initialBaseUrl, baseUrl, storedBaseUrl);

  function updateEndpoint(next: string) {
    if (aiEndpointChanged(baseUrl, next, storedBaseUrl)) {
      if (keyInput.current) keyInput.current.value = '';
      setKeyNotice('接口地址已改变，请为当前地址重新填写 API Key；不会沿用之前填写或保存的密钥。');
    }
    setBaseUrl(next);
  }

  return (
    <>
      <label>
        供应商预设
        <select
          value={preset}
          onChange={(event) => {
            const next = aiProviderPresets.find((item) => item.id === event.target.value);
            setPreset(next?.id ?? 'custom');
            if (next) updateEndpoint(next.baseUrl);
          }}
        >
          {aiProviderPresets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}（{allowedHosts.includes(item.host) ? '已授权' : '未授权'}）
            </option>
          ))}
          <option value="custom">自定义</option>
        </select>
      </label>
      <p className={styles.muted}>
        预设只填写基础地址，不自动保存、授权或发起请求；其他配置字段保留。
      </p>
      <label>
        接口基础地址
        <input
          name="base_url"
          type="url"
          required
          value={baseUrl}
          onChange={(event) => {
            updateEndpoint(event.target.value);
            setPreset(aiPresetForEndpoint(event.target.value, storedBaseUrl));
          }}
          aria-invalid={!guidance.valid}
          aria-describedby="ai-endpoint-guidance"
          maxLength={2048}
        />
      </label>
      <p id="ai-endpoint-guidance" className={styles.muted} role="status">
        {guidance.valid
          ? '此域名在当前服务端白名单中；保存时仍由服务端校验。'
          : aiEndpointMessage(guidance)}
      </p>
      {!guidance.valid && guidance.suggestedBaseUrl ? (
        <>
          <p className={styles.muted}>
            {suggestedPreset
              ? `建议基础地址：${suggestedPreset.baseUrl}`
              : '修正只移除末尾请求路径，域名保持不变；请在保存前核对基础地址。'}
          </p>
          <button
            className={styles.button}
            type="button"
            onClick={() => {
              const next = guidance.suggestedBaseUrl;
              if (!next) return;
              updateEndpoint(next);
              setPreset(aiPresetForEndpoint(next, storedBaseUrl));
            }}
          >
            使用建议的基础地址
          </button>
        </>
      ) : null}
      <p className={styles.muted}>
        首批协议：OpenAI-compatible Chat
        Completions。修改接口地址时必须重新填写密钥；不沿用旧密钥访问新端点。
      </p>
      {keyNotice ? <p className={styles.muted}>{keyNotice}</p> : null}
      <label>
        {editing ? '替换 API Key（不替换则留空）' : 'API Key'}
        <input
          ref={keyInput}
          name="api_key"
          type="password"
          required={!editing || endpointChanged}
          minLength={8}
          maxLength={4096}
          autoComplete="new-password"
          spellCheck={false}
        />
      </label>
    </>
  );
}
export function ProbeSummary({ probe }: { probe: AiProbe }) {
  return (
    <article className={styles.card}>
      <h3>
        {probeLabels[probe.kind]} · {statusLabels[probe.status]}
      </h3>
      <dl className={styles.facts}>
        <dt>测试编号</dt>
        <dd>
          <Link href={`/admin/ai/tests/${probe.id}`}>{probe.id}</Link>
        </dd>
        <dt>连接修订／模型</dt>
        <dd>
          r{probe.connection_revision} · {probe.model_id ?? '模型列表读取'}
        </dd>
        <dt>创建时间</dt>
        <dd>{probe.created_at}</dd>
        <dt>预算保留／记账</dt>
        <dd>
          {usd(probe.reserved_microusd)} / {usd(probe.charged_microusd)}（估算）
        </dd>
        <dt>输入／输出 token</dt>
        <dd>
          {probe.input_tokens ?? '未知'} / {probe.output_tokens ?? '未知'}
        </dd>
      </dl>
      {probe.error_code ? (
        <p className={styles.muted}>分类：{probe.error_code}；失败不等于供应商未计费。</p>
      ) : null}
      <details>
        <summary>查看安全测试摘要</summary>
        <pre className={styles.code}>{JSON.stringify(probe.result, null, 2)}</pre>
      </details>
    </article>
  );
}

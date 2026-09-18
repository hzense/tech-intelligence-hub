'use client';

import { useRef, useState } from 'react';
import type { GenerationPreflightResult } from '../lib/signal-generation-preflight';
import styles from './admin-signal-generation.module.css';

const labels = {
  configuration: 'Production 连接配置',
  connection: '专用凭据连接',
  tls: 'TLS 证书验证',
  identity: '真实身份与目标数据库',
  readOnly: '只读事务',
  permissions: '最小权限合约',
} as const;
const messages: Record<string, string> = {
  configuration_invalid: '请核对 Production Secret、专用角色、预期目标及 TLS 参数。',
  connection_failed: '数据库连接未建立，请核对凭据、网络及连接容量。',
  tls_unverified: '未能确认经过证书验证的 TLS 连接。',
  identity_mismatch: '当前连接的真实身份或数据库与要求不符。',
  read_only_required: '未能确认只读事务，预检已停止。',
  permissions_invalid: '最小权限合约未通过，请核对授权；不要直接扩大权限。',
  cleanup_failed: '预检连接清理未确认，请核对后再试。',
  unauthorized: '管理员登录已失效，请重新登录。',
  forbidden: '访问校验未通过，请从本站后台重新进入。',
};

export function AdminGenerationPreflight() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerationPreflightResult | null>(null);
  const [message, setMessage] = useState('尚未运行预检。');
  async function run() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setResult(null);
    setMessage('正在运行只读预检，不会生成信号或调用模型。');
    try {
      const response = await fetch('/api/admin/signal-generation/preflight', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json();
      const valid =
        data &&
        ['ok', 'unavailable'].includes(data.status) &&
        data.checks &&
        Object.keys(labels).every((key) => typeof data.checks[key] === 'boolean');
      if (valid) setResult(data);
      if (
        response.ok &&
        valid &&
        data.status === 'ok' &&
        Object.keys(labels).every((key) => data.checks[key] === true)
      ) {
        setMessage('只读连接预检通过。此结果不代表 AI 生成已启用或已完成真实模型验收。');
      } else {
        const hint =
          typeof data?.error === 'string' && Object.hasOwn(messages, data.error)
            ? messages[data.error]
            : '请核对配置或稍后手动重试。';
        setMessage(`只读连接预检未通过。${hint}`);
      }
    } catch {
      setMessage('只读连接预检未完成，请核对登录和网络后手动重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="生成数据库只读预检">
      <h2>生成数据库只读预检</h2>
      <p>
        生成关闭时也可检查。只验证连接、TLS、身份及权限，不读取候选正文、不更新任务、不调用 AI。
      </p>
      <button type="button" disabled={busy} aria-busy={busy} onClick={() => void run()}>
        运行只读连接预检
      </button>
      <p role="status">{message}</p>
      {result && (
        <ul>
          {(Object.keys(labels) as Array<keyof typeof labels>).map((key) => (
            <li key={key}>
              {labels[key]}：{result.checks[key] ? '通过' : '未确认'}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

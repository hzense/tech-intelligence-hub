'use client';

import { useState, type FormEvent } from 'react';
import controls from './admin-controls.module.css';

export function AdminPublicationForm({
  configured,
  databaseMode,
}: {
  configured: boolean;
  databaseMode: boolean;
}) {
  const [operation, setOperation] = useState<'publish' | 'withdraw'>('publish');
  const [pending, setPending] = useState(false);
  const [requestKey, setRequestKey] = useState('');
  const [message, setMessage] = useState('');
  const disabled = !configured || (operation === 'publish' && !databaseMode);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;
    const data = new FormData(event.currentTarget);
    const fields =
      operation === 'publish'
        ? [
            'signal_id',
            'source_version',
            'target_version',
            'expected_revision',
            'reason_code',
            'run_id',
            'lease_owner',
            'fencing_token',
          ]
        : ['signal_id', 'target_version', 'expected_revision', 'reason_code'];
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    const command: Record<string, string | number> = { request_key: key };
    for (const field of fields) {
      const value = String(data.get(field) ?? '');
      command[field] = [
        'source_version',
        'target_version',
        'expected_revision',
        'fencing_token',
      ].includes(field)
        ? Number(value)
        : value;
    }
    setPending(true);
    setMessage('正在核对当前资格并提交操作…');
    try {
      const response = await fetch(`/api/admin/signals/${operation}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(
          response.status === 401
            ? '登录已过期，请重新登录后重试。'
            : result.error === 'publication_outcome_unknown'
              ? '数据库确认暂不可用，结果未知。请保留同一请求号重试，不要创建新请求。'
              : response.status === 503
                ? '发布服务尚未配置完成。'
                : '操作未生效。请核对请求、当前发布修订及核验／运行资格，不要盲目重复新请求。',
        );
      } else {
        setMessage(
          `已记录${result.outcome === 'replay' ? '（重复请求，返回原回执）' : ''}。发布修订 ${result.publication_revision}，内容版本 ${result.content_version}；该回执对应版本当前${result.current_public ? '可公开' : '不可公开'}。`,
        );
      }
    } catch {
      setMessage('未收到确认，结果未知。请保留同一请求号重试，不要创建新请求以免重复操作。');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={`admin-publication ${controls.scope}`} aria-labelledby="publication-title">
      <h2 id="publication-title">受限信号发布</h2>
      <p>
        只接受已核验且已封存组装的候选版本，不接受正文、核验结论或人物身份覆盖。采集任务配置界面仍待开发。
      </p>
      {!configured && (
        <p role="status">
          发布服务尚未配置：需要独立 Publisher 角色与生产配置。本页面不会使用迁移账号代替。
        </p>
      )}
      {!databaseMode && <p>网站仍使用旧版信号数据源，暂不开放新发布；已配置服务时仍可安全撤回。</p>}
      <form method="post" onSubmit={submit}>
        <fieldset disabled={pending}>
          <legend>操作与版本</legend>
          <label>
            操作
            <select
              value={operation}
              onChange={(event) => {
                setOperation(event.target.value as 'publish' | 'withdraw');
                setRequestKey('');
                setMessage('');
              }}
            >
              <option value="publish">发布已核验候选</option>
              <option value="withdraw">撤回公开信号</option>
            </select>
          </label>
          <label>
            信号标识
            <input name="signal_id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          </label>
          {operation === 'publish' && (
            <label>
              已组装候选版本
              <input
                name="source_version"
                required
                type="number"
                min="1"
                max="2147483647"
                step="1"
              />
            </label>
          )}
          <label>
            {operation === 'publish' ? '新的内容版本' : '当前内容版本'}
            <input name="target_version" required type="number" min="1" max="2147483647" step="1" />
          </label>
          <label>
            预期当前发布修订
            <input
              name="expected_revision"
              required
              type="number"
              min="0"
              max="2147483647"
              step="1"
            />
          </label>
          <label>
            原因
            <select name="reason_code" key={operation}>
              {operation === 'publish' ? (
                <>
                  <option value="initial_publication">首次发布</option>
                  <option value="content_correction">内容纠正</option>
                  <option value="republication">重新发布</option>
                </>
              ) : (
                <>
                  <option value="operator_request">管理员撤回</option>
                  <option value="factual_error">事实错误</option>
                  <option value="privacy">隐私风险</option>
                  <option value="evidence_revoked">证据失效</option>
                </>
              )}
            </select>
          </label>
          {operation === 'publish' && (
            <>
              <p>运行信息必须来自已有受控任务。填写标识不会创建任务、续租或授予发布权限。</p>
              <label>
                运行 ID
                <input name="run_id" required />
              </label>
              <label>
                租约持有者 ID
                <input name="lease_owner" required />
              </label>
              <label>
                租约隔离序号
                <input
                  name="fencing_token"
                  required
                  type="number"
                  min="1"
                  max="2147483647"
                  step="1"
                />
              </label>
            </>
          )}
          <label>
            请求号
            <input value={requestKey} readOnly placeholder="提交时自动生成，重试复用" />
          </label>
          <button
            type="button"
            onClick={() => {
              setRequestKey(crypto.randomUUID());
              setMessage('已创建新请求号，请重新核对版本。');
            }}
          >
            开始一个新请求
          </button>
          <label>
            <input type="checkbox" required />
            我已确认版本和操作；撤回将立即影响公开列表、详情及搜索。
          </label>
          <button type="submit" disabled={disabled || pending}>
            {pending ? '处理中…' : operation === 'publish' ? '核对并发布' : '安全撤回'}
          </button>
        </fieldset>
      </form>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

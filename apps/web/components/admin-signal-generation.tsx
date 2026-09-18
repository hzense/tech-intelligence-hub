'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ImportBatch } from '../../../packages/database/src/import-store.mjs';
import type { GenerationSourceInspection } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import styles from './admin-signal-generation.module.css';
import controls from './admin-controls.module.css';
import { AdminGenerationPreflight } from './admin-generation-preflight';
import { PrivateResult } from './private-generation-result';

type Profile = {
  id: string;
  revision: number;
  name: string;
  provider_host?: string;
  readiness: { ready: boolean; reasons: string[] };
};
type GenerationRun = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  batch_id: string;
  item_id: string;
  profile_id: string;
  profile_revision: number;
  result?: unknown;
  created_at: string;
  error_code?: string | null;
  reserved_microusd: number | string;
  charged_microusd: number | string;
};
type PendingRequest = {
  id: string;
  batchId: string;
  itemId: string;
  profileId: string;
  profileRevision: number;
};
type ListResponse = { runs: GenerationRun[]; profiles: Profile[]; batches: ImportBatch[] };
const storageKey = 'hzense.signal-generation.pending.v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses: Record<GenerationRun['status'], string> = {
  pending: '待执行',
  running: '生成中',
  completed: '生成完成（私有候选）',
  failed: '失败',
  unknown: '结果未知，待对账',
  cancelled: '已取消',
};
const errorMessages: Record<string, string> = {
  generation_timeout:
    '生成达到本次任务的截止时间，未能确认完整结果。请先对账原任务，不要重复调用。',
  generation_provider_rejected: '供应商拒绝了生成请求。请核对模型与接口配置；该分类不代表未计费。',
  generation_network_error: '生成请求发生网络错误，结果与费用需核对，不要重复调用。',
  generation_dns_failed: '供应商域名解析失败。请核对服务端网络，不要重复提交任务。',
  generation_blocked_target: '供应商目标未通过安全校验，请核对已授权域名和地址。',
  generation_redirect_blocked: '供应商返回了不允许的跳转，请核对接口基础地址。',
  generation_response_too_large: '供应商响应超出安全大小限制，未采用结果；费用仍需核对。',
  generation_invalid_response: '供应商响应格式不符合要求，未采用结果；费用仍需核对。',
  generation_invalid_configuration: '生成配置未通过调用前校验，请核对连接和模型配置版本。',
  generation_invalid_output:
    '生成结果未通过结构或原文证据校验，未保存为可用候选。请先核对原任务及费用。',
  generation_output_rejected: '生成结果触发内容安全校验，未保存为可用候选。',
  generation_sdk_error: '模型调用发生未分类异常，请按任务编号核对脱敏日志与费用，不要重复调用。',
  generation_postflight_failed: '模型调用后的资料或配置复核失败，结果未交付；请核对原任务及费用。',
  generation_unknown: '旧记录未保留具体调用失败分类，结果及费用待核对，不要重复调用。',
  generation_failed: '生成未得到可用候选，请核对原任务及费用。',
  input_too_large: '解析文本超过首版 48,000 字节上限。请先拆分资料；此页面不会自动截断或调用模型。',
  invalid_source: '解析结果格式无效。请在导入页核对资料是否完整解析。',
  source_unavailable: '所选资料尚不可用，可能未完成解析或已被取消。',
  profile_not_ready: '模型配置尚未就绪。请核对抽取阶段模型、连接及能力测试。',
  revision_conflict:
    '模型配置版本已变化，原请求不能直接改用新版本。请核对任务；仅未创建的请求可放弃编号后刷新配置。',
  budget_exceeded: '预算不足，暂不能执行生成。请核对批次、每日及连接预算，不要重复提交。',
  not_configured: 'AI 信号生成尚未完成生产授权或配置，请联系管理员核对。',
  invalid_request: '请求参数未通过校验。请保留原请求编号并联系管理员核对。',
  request_id_conflict: '原请求编号已关联其他输入，禁止重新使用或自动更换编号。',
  response_identity_mismatch:
    '返回任务与所选资料或配置不一致。已保留原请求编号，未执行 AI；请联系管理员核对。',
  connection_unavailable: '所选 AI 连接暂不可用，请核对连接状态与授权。',
  worker_busy: '当前连接正在处理其他任务。请查询当前状态，稍后再手动操作。',
  configuration_changed: '任务创建后模型配置发生变化，本次结果不能直接采用。',
  source_changed: '原资料在任务创建后发生变化，请先核对来源与任务状态。',
  stale_attempt: '任务处理资格已失效，请查询最新状态，不要重复调用模型。',
  commit_unknown: '服务端尚无法确认任务记录，请保持原编号并查询，不要新建重复任务。',
  not_found: '暂未查到原任务。请保留原编号；确认配置后可使用原编号重新确认创建，不会自动调用 AI。',
  cancelled: '该资料或任务已取消，不能继续生成。',
  limit_exceeded: '请求超出允许范围，请核对资料及配置限制。',
  unauthorized: '管理员登录已失效。请重新登录后按原请求编号核对。',
  forbidden: '当前请求未通过访问校验，请从本站管理页面重新进入并核对原请求。',
};
class SafeRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super('request_failed');
  }
}
function knownErrorMessage(code: unknown): string | null {
  return typeof code === 'string' && Object.hasOwn(errorMessages, code)
    ? errorMessages[code]!
    : null;
}

function pendingRequest(value: unknown): PendingRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !== 'batchId,id,itemId,profileId,profileRevision' ||
    !['id', 'batchId', 'itemId', 'profileId'].every(
      (key) => typeof row[key] === 'string' && uuid.test(row[key]),
    ) ||
    typeof row.profileRevision !== 'number' ||
    !Number.isSafeInteger(row.profileRevision) ||
    row.profileRevision < 1
  )
    return null;
  return row as PendingRequest;
}

function storePending(request: PendingRequest): boolean {
  try {
    if (!pendingRequest(request)) return false;
    const encoded = JSON.stringify(request);
    const previous = sessionStorage.getItem(storageKey);
    if (previous !== null && previous !== encoded) return false;
    sessionStorage.setItem(storageKey, encoded);
    return sessionStorage.getItem(storageKey) === encoded;
  } catch {
    return false;
  }
}

function replacePending(expected: PendingRequest, replacement: PendingRequest | null): boolean {
  try {
    if (sessionStorage.getItem(storageKey) !== JSON.stringify(expected)) return false;
    if (replacement === null) {
      sessionStorage.removeItem(storageKey);
      return sessionStorage.getItem(storageKey) === null;
    }
    if (!pendingRequest(replacement)) return false;
    const encoded = JSON.stringify(replacement);
    sessionStorage.setItem(storageKey, encoded);
    return sessionStorage.getItem(storageKey) === encoded;
  } catch {
    return false;
  }
}

async function requestApi(body?: unknown) {
  const response = await fetch('/api/admin/signal-generation', {
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  // Only fixed allowlisted codes have display messages. Never expose raw bodies,
  // provider errors, stack traces, or unknown codes to the browser UI.
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new SafeRequestError(
      knownErrorMessage(result?.error) ? result.error : 'request_failed',
      response.status,
    );
  }
  return response.json();
}

function requestFor(run: GenerationRun): PendingRequest {
  return {
    id: run.id,
    batchId: run.batch_id,
    itemId: run.item_id,
    profileId: run.profile_id,
    profileRevision: run.profile_revision,
  };
}

function money(value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? `$${(amount / 1_000_000).toFixed(4)}` : '待核对';
}

export function AdminSignalGeneration({
  configured,
  historyConfigured = configured,
}: {
  configured: boolean;
  historyConfigured?: boolean;
}) {
  const [data, setData] = useState<ListResponse>({ runs: [], profiles: [], batches: [] });
  const [batchId, setBatchId] = useState('');
  const [itemId, setItemId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [rejectedCreateId, setRejectedCreateId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<GenerationRun | null>(null);
  const [inspection, setInspection] = useState<
    (GenerationSourceInspection & { batchId: string; itemId: string; fence: number }) | null
  >(null);
  const [inspectionError, setInspectionError] = useState('');
  const sourceBlocked = Boolean(inspectionError || (inspection && !inspection.ready));
  const profile = data.profiles.find((entry) => entry.id === profileId);
  const batches = data.batches.filter(
    (batch) => !batch.cancelled && batch.items.some((item) => item.status === 'completed'),
  );
  const items =
    batches
      .find((batch) => batch.id === batchId)
      ?.items.filter((item) => item.status === 'completed') ?? [];
  const tracked = data.runs.find((run) => run.id === pending?.id);
  const recipientProfile = pending
    ? data.profiles.find(
        (entry) => entry.id === pending.profileId && entry.revision === pending.profileRevision,
      )
    : profile;
  const terminal = tracked && ['completed', 'failed', 'cancelled'].includes(tracked.status);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const restored =
        raw === null ? null : raw.length < 1024 ? pendingRequest(JSON.parse(raw)) : null;
      if (raw !== null && restored === null) throw new Error('invalid_pending');
      setPending(restored);
      setStorageReady(true);
      if (restored) setMessage('已恢复原请求 ID。请先查询状态；不会自动调用 AI 或重试。');
    } catch {
      setMessage('无法安全保存或恢复请求 ID，生成操作已关闭。请保留原浏览器会话并联系管理员核对。');
    }
  }, []);

  useEffect(() => {
    if (!historyConfigured) return;
    let active = true;
    void requestApi()
      .then((result: ListResponse) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setMessage('列表读取失败。请手动刷新；不会自动调用 AI。');
      });
    return () => {
      active = false;
    };
  }, [historyConfigured, configured]);

  function acceptRun(run: GenerationRun) {
    setData((previous) => ({
      ...previous,
      runs: [run, ...previous.runs.filter((entry) => entry.id !== run.id)],
    }));
    setDetail(run);
  }

  async function perform(operation: () => Promise<void>, readOnly = false) {
    if (busyRef.current || !(readOnly ? historyConfigured : configured)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      setMessage(
        `${error instanceof SafeRequestError ? (knownErrorMessage(error.code) ?? '请求未确认完成。') : '请求未确认完成。'} 请按原请求 ID 查询状态；不要新建重复任务。此页面不会自动重试或重新计费。`,
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function create() {
    if (
      !storageReady ||
      !consent ||
      (!pending && sourceBlocked) ||
      (!pending && (!profile?.readiness.ready || !items.some((item) => item.id === itemId)))
    )
      return;
    await perform(async () => {
      const request = pending ?? {
        id: crypto.randomUUID(),
        batchId,
        itemId,
        profileId,
        profileRevision: profile!.revision,
      };
      if (!storePending(request)) {
        setStorageReady(false);
        setMessage('请求 ID 保存失败，未发送创建或 AI 请求。');
        return;
      }
      setPending(request);
      setRejectedCreateId(null);
      let run: GenerationRun;
      try {
        ({ run } = await requestApi({ action: 'create', ...request, consent: true }));
      } catch (error) {
        if (
          error instanceof SafeRequestError &&
          ((error.status === 400 &&
            ['input_too_large', 'invalid_source', 'invalid_request'].includes(error.code)) ||
            (error.status === 409 && error.code === 'revision_conflict'))
        )
          // These create-time rejections occur before the task write. Abandonment
          // still requires an explicit action, a fresh not_found and a storage CAS.
          setRejectedCreateId(request.id);
        throw error;
      }
      if (
        !run ||
        typeof run.id !== 'string' ||
        !uuid.test(run.id) ||
        run.batch_id !== request.batchId ||
        run.item_id !== request.itemId ||
        run.profile_id !== request.profileId ||
        run.profile_revision !== request.profileRevision
      )
        throw new SafeRequestError('response_identity_mismatch');
      const canonical = { ...request, id: run.id };
      if (!replacePending(request, canonical)) {
        setStorageReady(false);
        setMessage('服务器已返回任务，但请求编号未能安全同步。已停止后续生成，请保留原编号核对。');
        return;
      }
      setPending(canonical);
      if (canonical.id !== request.id) setConsent(false);
      acceptRun(run);
      setMessage(
        canonical.id === request.id
          ? '任务已创建。尚未调用 AI；请核对任务与外发授权，再手动执行生成。'
          : '已复用相同资料与配置的原任务，并对齐原任务编号。本次未调用 AI；请核对已有结果或重新确认外发授权。',
      );
    });
  }

  async function command(action: 'run' | 'cancel' | 'detail', id: string) {
    if (action === 'run' && (!consent || !storageReady || pending?.id !== id)) return;
    await perform(async () => {
      if (action === 'run') {
        const run = data.runs.find((entry) => entry.id === id);
        if (!run || run.status !== 'pending') return;
        const request = requestFor(run);
        if (!storePending(request)) {
          setStorageReady(false);
          setMessage('请求 ID 保存失败，未调用 AI。');
          return;
        }
        setPending(request);
      }
      const { run } = await requestApi({ action, id });
      acceptRun(run);
      setMessage(
        action === 'detail'
          ? '已查询原任务，不触发 AI 调用。'
          : '任务状态已更新。结果仅管理员可见，不会发布。',
      );
    }, action === 'detail');
  }

  function finishTracking() {
    if (!pending || !terminal) return;
    try {
      const stored = pendingRequest(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'));
      if (stored?.id !== pending.id) throw new Error('pending_mismatch');
      sessionStorage.removeItem(storageKey);
      if (sessionStorage.getItem(storageKey) !== null) throw new Error('pending_not_removed');
      setPending(null);
      setConsent(false);
      setMessage('已结束本次任务跟踪。新任务需重新选择输入并确认外发授权。');
    } catch {
      setStorageReady(false);
      setMessage('请求记录未能安全清除，已暂停新任务；请保留原请求 ID 进行核对。');
    }
  }

  async function abandonRejected() {
    const request = pending;
    if (!request || rejectedCreateId !== request.id || tracked || !storageReady) return;
    await perform(async () => {
      try {
        const { run } = await requestApi({ action: 'detail', id: request.id });
        acceptRun(run);
        setRejectedCreateId(null);
        setMessage('服务器已存在此任务，不能放弃原编号。请先核对任务状态。');
        return;
      } catch (error) {
        if (!(
          error instanceof SafeRequestError &&
          error.status === 404 &&
          error.code === 'not_found'
        ))
          throw error;
      }
      if (!replacePending(request, null)) {
        setStorageReady(false);
        setMessage('请求记录未能安全清除，已暂停新任务；请保留原请求 ID 进行核对。');
        return;
      }
      setPending(null);
      setRejectedCreateId(null);
      setConsent(false);
      setItemId('');
      setMessage(
        '已核对服务器未创建原请求，并放弃该编号。可以重新选择资料或刷新模型配置；新任务仍需重新确认授权。',
      );
    });
  }

  function trackRun(run: GenerationRun) {
    if (pending || busy || !storageReady) return;
    const request = requestFor(run);
    if (!storePending(request)) {
      setStorageReady(false);
      setMessage('请求 ID 保存失败，未调用 AI。');
      return;
    }
    setPending(request);
    setConsent(false);
    setMessage('已选择原任务。请核对接收方并重新确认外发授权；未调用 AI。');
  }

  async function inspectSource() {
    await perform(async () => {
      setInspection(null);
      setInspectionError('');
      try {
        const result = await requestApi({ action: 'inspect_source', batchId, itemId });
        if (result.inspection?.batchId !== batchId || result.inspection?.itemId !== itemId)
          throw new SafeRequestError('response_identity_mismatch');
        setInspection(result.inspection);
        setMessage('资料检查完成，未创建任务、预留预算或调用 AI。检查通过不代表事实已核验。');
      } catch (error) {
        setInspectionError(
          error instanceof SafeRequestError
            ? (knownErrorMessage(error.code) ?? '资料检查失败，请稍后手动重试。')
            : '资料检查失败，请稍后手动重试。',
        );
        setMessage('资料检查未通过，未创建任务或调用 AI。');
      }
    });
  }

  return (
    <main className={`section-shell ${styles.main}`}>
      <Link className={controls.button} href="/admin">
        返回管理后台
      </Link>
      <h1>AI 信号生成</h1>
      <AdminGenerationPreflight />
      <p>
        从已完成解析的私有资料生成候选信号。创建任务与调用 AI 分开执行，不自动重试，不发布到网站。
      </p>
      <p>候选中的摘要、事件发生时间、证据、人物与组织均需核验；没有足够依据时可以不生成候选。</p>
      <p>首版每次处理一份资料，解析文本最多 48,000 字节；超限会停止，不自动截断。</p>
      <p>当前接口总时限 5 分钟，模型最多等待 4 分 45 秒，预留时间用于校验和保存；不会自动重试。</p>
      {!configured && (
        <p role="status">
          AI 信号生成已关闭或尚未完成配置，不可创建或执行新任务。
          {historyConfigured
            ? '仍可查看历史任务与已保存候选，不调用 AI。'
            : '历史记录数据库尚未配置，请联系管理员核对。'}
        </p>
      )}
      <nav className={controls.group} aria-label="候选生成相关管理">
        <Link className={controls.button} href="/admin/imports">
          导入与解析资料
        </Link>
        <Link className={controls.button} href="/admin/ai/profiles">
          管理分阶段模型配置
        </Link>
      </nav>
      <button
        disabled={!historyConfigured || busy}
        onClick={() =>
          void perform(async () => {
            setData(await requestApi());
            setConsent(false);
            setMessage('列表已刷新；未调用 AI。');
          }, true)
        }
      >
        手动刷新列表
      </button>
      <fieldset disabled={!configured || busy || Boolean(pending)} className={styles.panel}>
        <legend>选择输入与配置</legend>
        <label>
          导入批次
          <select
            value={batchId}
            onChange={(event) => {
              setBatchId(event.target.value);
              setItemId('');
              setConsent(false);
              setInspection(null);
              setInspectionError('');
            }}
          >
            <option value="">请选择批次</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          已完成解析的资料
          <select
            value={itemId}
            onChange={(event) => {
              setItemId(event.target.value);
              setConsent(false);
              setInspection(null);
              setInspectionError('');
            }}
          >
            <option value="">请选择资料</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.declaration.name ?? item.declaration.url ?? item.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          分阶段模型配置
          <select
            value={profileId}
            onChange={(event) => {
              setProfileId(event.target.value);
              setConsent(false);
            }}
          >
            <option value="">请选择配置</option>
            {data.profiles.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} · r{entry.revision}
                {entry.readiness.ready ? '' : '（未就绪）'}
              </option>
            ))}
          </select>
        </label>
        {profile && !profile.readiness.ready && (
          <p role="status">配置尚未就绪：{profile.readiness.reasons.join('、')}</p>
        )}
        {configured && batches.length === 0 && <p>暂无已完成解析的资料，请先在导入页完成解析。</p>}
        <button type="button" disabled={!batchId || !itemId} onClick={() => void inspectSource()}>
          检查生成资料（不调用 AI）
        </button>
        {inspectionError && <p role="alert">{inspectionError}</p>}
        {inspection && (
          <section aria-label="生成资料检查结果">
            <h2>{inspection.ready ? '资料大小符合生成要求' : '资料超出单次生成上限'}</h2>
            <p>
              {inspection.fragmentCount} 个片段 · 输入 {inspection.sourceBytes.toLocaleString()}{' '}
              字节 / 上限 {inspection.limitBytes.toLocaleString()} 字节 · 解析版本{' '}
              {inspection.fence}
            </p>
            <p>大小按包含片段编号和定位的 UTF-8 来源 JSON 计算，不是原文件大小或 token 数。</p>
            <ul>
              {inspection.locators.map(({ id, locator }) => (
                <li key={id}>
                  {id}：{JSON.stringify(locator)}
                </li>
              ))}
            </ul>
            <p>上方仅展示前 3 个片段的定位；未展示或外发正文。</p>
            {!inspection.ready && (
              <p>
                请先拆分资料并重新导入。当前不支持长文切片，不会静默截断；此次检查不产生模型费用。
              </p>
            )}
            <p>创建和执行时仍会重新检查资料、模型与预算。此结果不是发布资格证明。</p>
          </section>
        )}
      </fieldset>
      {(profile || pending) && (
        <p>
          资料发送至：{recipientProfile?.provider_host ?? '所选任务模型供应商（请先核对配置快照）'}
        </p>
      )}
      <label className={styles.consent}>
        <input
          type="checkbox"
          checked={consent}
          disabled={!configured || busy}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          我允许把所选资料的私有解析文本发送给对应任务模型配置中的 AI
          供应商，并了解手动执行可能产生费用；仅生成私有候选，不授权发布。
        </span>
      </label>
      <p>费用受服务端预算控制。预留金额不等于最终账单；结果未知时需先对账，不得重复调用。</p>
      <button
        disabled={
          !configured ||
          busy ||
          !storageReady ||
          !consent ||
          Boolean(tracked) ||
          (!pending && sourceBlocked) ||
          (!pending && (!profile?.readiness.ready || !items.some((item) => item.id === itemId)))
        }
        onClick={() => void create()}
      >
        {pending ? '使用原编号重新确认创建（不调用 AI）' : '创建生成任务（不调用 AI）'}
      </button>
      {pending && (
        <section className={styles.panel} aria-label="当前请求">
          <h2>当前请求</h2>
          <p className={styles.id}>请求 ID：{pending.id}</p>
          <p className={styles.id}>
            资料：{pending.itemId} · 配置：{pending.profileId} r{pending.profileRevision}
          </p>
          <button
            disabled={!historyConfigured || busy}
            onClick={() => void command('detail', pending.id)}
          >
            按原请求 ID 查询状态
          </button>
          <button disabled={busy || !terminal || !storageReady} onClick={finishTracking}>
            已核对，准备下一次生成
          </button>
          {rejectedCreateId === pending.id && !tracked && (
            <button
              disabled={!configured || busy || !storageReady}
              onClick={() => void abandonRejected()}
            >
              核对并放弃未创建请求
            </button>
          )}
        </section>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section className={styles.panel} aria-label="生成任务列表">
        <h2>生成任务</h2>
        <p>
          显示已保存状态；查看不会改写任务。长期停留“生成中”或结果未知的任务需人工对账，不要重复调用。
        </p>
        {data.runs.length === 0 && <p>暂无生成任务。</p>}
        {data.runs.map((run) => (
          <article key={run.id} className={styles.run}>
            <h3>{statuses[run.status]}</h3>
            <p className={styles.id}>请求 ID：{run.id}</p>
            <p className={styles.id}>
              资料：{run.item_id} · 配置：{run.profile_id} r{run.profile_revision}
            </p>
            <p>
              预留：{money(run.reserved_microusd)} · 记账金额：{money(run.charged_microusd)}
              （非供应商最终账单）
            </p>
            {knownErrorMessage(run.error_code) && <p>{knownErrorMessage(run.error_code)}</p>}
            <div className={styles.actions}>
              <Link
                className={controls.button}
                href={`/admin/signal-generation/${run.id}`}
                prefetch={false}
              >
                固定链接
              </Link>
              <button
                disabled={!historyConfigured || busy}
                onClick={() => void command('detail', run.id)}
              >
                查看任务与私有候选
              </button>
              {run.status === 'pending' && (
                <>
                  {!pending && (
                    <button
                      disabled={!configured || busy || !storageReady}
                      onClick={() => trackRun(run)}
                    >
                      选择此任务并核对接收方
                    </button>
                  )}
                  <button
                    disabled={
                      !configured || busy || !consent || !storageReady || pending?.id !== run.id
                    }
                    onClick={() => void command('run', run.id)}
                  >
                    执行生成（调用 AI，可能计费）
                  </button>
                  <button
                    disabled={!configured || busy}
                    onClick={() => void command('cancel', run.id)}
                  >
                    取消未执行任务
                  </button>
                </>
              )}
            </div>
            {run.status === 'unknown' && (
              <p>供应商调用结果尚未确认，禁止重复执行。请先人工对账；刷新与查询不会调用模型。</p>
            )}
          </article>
        ))}
      </section>
      {detail?.result !== undefined && <PrivateResult result={detail.result} />}
    </main>
  );
}

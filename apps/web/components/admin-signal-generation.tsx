'use client';

import { importItemName } from '../lib/import-labels';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ImportBatch } from '../../../packages/database/src/import-store.mjs';
import type { SignalGenerationDailyUsage } from '../../../packages/database/src/signal-generation-store.mjs';
import type { GenerationSourceInspection } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import styles from './admin-signal-generation.module.css';
import controls from './admin-controls.module.css';
import { AdminGenerationPreflight } from './admin-generation-preflight';
import { PrivateResult } from './private-generation-result';
import { GenerationProgress, generationIsActive } from './generation-progress';

type Profile = {
  id: string;
  revision: number;
  name: string;
  provider_host?: string;
  readiness: { ready: boolean; reasons: string[]; warnings?: string[] };
};
type GenerationRun = {
  id: string;
  source_name?: string;
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
  can_delete?: boolean;
  retry_of?: string | null;
  progress_phase?: string | null;
  progress_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};
type PendingRequest = {
  id: string;
  batchId: string;
  itemId: string;
  profileId: string;
  profileRevision: number;
  retryOf?: string;
};
type ListResponse = {
  runs: GenerationRun[];
  profiles: Profile[];
  batches: ImportBatch[];
  dailyUsage?: SignalGenerationDailyUsage | null;
};
const storageKey = 'hzense.signal-generation.pending.v1';
const recoveryKey = 'hzense.signal-generation.rejection.v1';
const rejectionCodes = [
  'input_too_large',
  'invalid_source',
  'invalid_request',
  'revision_conflict',
  'task_deleted',
] as const;
type CreateRejection = {
  request: PendingRequest;
  code: (typeof rejectionCodes)[number];
  previousId?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses: Record<GenerationRun['status'], string> = {
  pending: '待执行',
  running: '生成中',
  completed: '生成完成（私有候选）',
  failed: '失败',
  unknown: '结果待核对',
  cancelled: '已取消',
};
const errorMessages: Record<string, string> = {
  generation_dispatch_failed: '后台任务未能开始或排队已超时，未自动重试。请核对任务与配置。',
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
  generation_output_truncated:
    '模型达到输出 token 上限，结果不完整（推理也可能占用额度）。未自动重试，请核对费用后调整模型或资料。',
  generation_capability_failed:
    '模型目录未声明本次所需的结构化输出能力，已在生成调用前停止。请选择支持 JSON Schema 的模型。',
  generation_invalid_model: '模型不在当前供应商目录中或能力信息缺失，请刷新模型列表后重新配置。',
  generation_output_rejected: '生成结果触发内容安全校验，未保存为可用候选。',
  generation_sdk_error: '模型调用发生未分类异常，请按任务编号核对脱敏日志与费用，不要重复调用。',
  generation_postflight_failed: '模型调用后的资料或配置复核失败，结果未交付；请核对原任务及费用。',
  generation_unknown: '旧记录未保留具体调用失败分类，结果及费用待核对，不要重复调用。',
  outcome_unknown: '执行已超时，未确认完整结果，按失败处理；费用记录保留。',
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
  task_active: '任务仍在执行或执行保护期未结束，暂不能删除或重新生成；请稍后查询状态。',
  task_deleted:
    '同一资料与配置的任务已删除。可手动创建重新生成任务，执行时可能再次计费；也可点击“核对并放弃未创建请求”选择其他资料。',
  duplicate_source: '该资料与已有解析内容重复，请从列表选择保留的资料。',
  limit_exceeded: '请求超出允许范围，请核对资料及配置限制。',
  unauthorized: '管理员登录已失效。请重新登录后按原请求编号核对。',
  forbidden: '当前请求未通过访问校验，请从本站管理页面重新进入并核对原请求。',
};
class SafeRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly previousId?: string,
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
    Object.keys(row).sort().join(',') !==
      `batchId,id,itemId,profileId,profileRevision${Object.hasOwn(row, 'retryOf') ? ',retryOf' : ''}` ||
    (Object.hasOwn(row, 'retryOf') &&
      (typeof row.retryOf !== 'string' || !uuid.test(row.retryOf) || row.retryOf === row.id)) ||
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

// A receipt restores UI choices, not authority to forget a task. Abandonment
// still requires a fresh server not_found; retries still use server deduplication.
function readRejection(request: PendingRequest): CreateRejection | null {
  const raw = sessionStorage.getItem(recoveryKey);
  if (raw === null || raw.length > 2048) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (
      Object.keys(value).sort().join(',') !==
        (Object.hasOwn(value, 'previousId') ? 'code,previousId,request' : 'code,request') ||
      !rejectionCodes.includes(value.code) ||
      !pendingRequest(value.request) ||
      JSON.stringify(value.request) !== JSON.stringify(request) ||
      (Object.hasOwn(value, 'previousId') &&
        (value.code !== 'task_deleted' ||
          typeof value.previousId !== 'string' ||
          !uuid.test(value.previousId)))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

function storeRejection(request: PendingRequest, rejection: CreateRejection | null): boolean {
  try {
    if (sessionStorage.getItem(storageKey) !== JSON.stringify(request)) return false;
    if (rejection === null) {
      sessionStorage.removeItem(recoveryKey);
      return sessionStorage.getItem(recoveryKey) === null;
    }
    const encoded = JSON.stringify(rejection);
    sessionStorage.setItem(recoveryKey, encoded);
    return sessionStorage.getItem(recoveryKey) === encoded;
  } catch {
    return false;
  }
}

function replacePending(expected: PendingRequest, replacement: PendingRequest | null): boolean {
  try {
    if (sessionStorage.getItem(storageKey) !== JSON.stringify(expected)) return false;
    if (!storeRejection(expected, null)) return false;
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

async function requestApi(body?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/admin/signal-generation', {
    cache: 'no-store',
    ...(signal ? { signal } : {}),
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
      result?.error === 'task_deleted' &&
        typeof result.previous_id === 'string' &&
        uuid.test(result.previous_id)
        ? result.previous_id
        : undefined,
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
    ...(run.retry_of ? { retryOf: run.retry_of } : {}),
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
  const [taskQuery, setTaskQuery] = useState('');
  const [taskStatus, setTaskStatus] = useState('all');
  const [batchId, setBatchId] = useState('');
  const [itemId, setItemId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [rejectedCreateId, setRejectedCreateId] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const taskListRef = useRef<HTMLElement>(null);
  const [listNavigation, setListNavigation] = useState(0);
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<GenerationRun | null>(null);
  const [inspection, setInspection] = useState<
    (GenerationSourceInspection & { batchId: string; itemId: string; fence: number }) | null
  >(null);
  const [inspectionError, setInspectionError] = useState('');
  const sourceBlocked = Boolean(inspectionError || (inspection && !inspection.ready));
  const profile = data.profiles.find((entry) => entry.id === profileId);
  const batches = data.batches.filter(
    (batch) =>
      !batch.cancelled &&
      batch.items.some((item) => item.status === 'completed' && !item.duplicate_of),
  );
  const items =
    batches
      .find((batch) => batch.id === batchId)
      ?.items.filter((item) => item.status === 'completed' && !item.duplicate_of) ?? [];
  const parsedSources = batches.flatMap((batch) =>
    batch.items
      .filter((item) => item.status === 'completed' && !item.duplicate_of)
      .map((item) => ({ batchId: batch.id, item })),
  );
  const sourceNames = new Map(
    data.batches.flatMap((batch) =>
      batch.items.map((item) => [item.id, importItemName(item)] as const),
    ),
  );
  const tracked = data.runs.find((run) => run.id === pending?.id);
  const recipientProfile = pending
    ? data.profiles.find(
        (entry) => entry.id === pending.profileId && entry.revision === pending.profileRevision,
      )
    : profile;
  const terminal =
    tracked &&
    ['completed', 'failed', 'cancelled', 'unknown'].includes(tracked.status) &&
    tracked.can_delete === true;
  const activeIds = data.runs
    .filter(generationIsActive)
    .map((run) => run.id)
    .sort()
    .join(',');
  const [pollError, setPollError] = useState(false);

  useEffect(() => {
    if (!listNavigation) return;
    taskListRef.current?.focus({ preventScroll: true });
    taskListRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [listNavigation]);

  useEffect(() => {
    if (busy || !pending || !terminal || !storageReady) return;
    if (!replacePending(pending, null)) {
      setStorageReady(false);
      setMessage('浏览器请求记录未能安全清除，已暂停新任务；请保留原请求编号核对。');
      return;
    }
    setPending(null);
    setConsent(false);
    setRejectedCreateId(null);
    setRetryTarget(null);
  }, [busy, pending, terminal, storageReady]);

  useEffect(() => {
    if (!historyConfigured || busy || !activeIds) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        // Read existing task IDs only; never dispatch, retry or create from polling.
        const updates: GenerationRun[] = [];
        for (const id of activeIds.split(',')) {
          const { run } = await requestApi({ action: 'detail', id }, controller.signal);
          if (!run || run.id !== id) throw new Error('identity_mismatch');
          updates.push(run);
        }
        if (controller.signal.aborted) return;
        const byId = new Map(updates.map((run) => [run.id, run]));
        setData((previous) => ({
          ...previous,
          runs: previous.runs.map((run) => byId.get(run.id) ?? run),
        }));
        setDetail((previous) => (previous ? (byId.get(previous.id) ?? previous) : null));
        setPollError(false);
        timer = setTimeout(poll, 5000);
      } catch {
        if (!controller.signal.aborted) setPollError(true);
      }
    }
    timer = setTimeout(poll, 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeIds, historyConfigured, busy]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const restored =
        raw === null ? null : raw.length < 1024 ? pendingRequest(JSON.parse(raw)) : null;
      if (raw !== null && restored === null) throw new Error('invalid_pending');
      setPending(restored);
      setStorageReady(true);
      if (restored) {
        const rejection = readRejection(restored);
        if (rejection) {
          setRejectedCreateId(restored.id);
          setRetryTarget(rejection.previousId ?? null);
          setMessage(
            `已恢复原请求及创建拒绝原因：${errorMessages[rejection.code]} 不会自动创建任务或调用 AI。`,
          );
        } else {
          setMessage('已恢复原请求 ID。请先查询状态；不会自动调用 AI 或重试。');
        }
      }
    } catch {
      setStorageReady(false);
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
    if (pending?.id === run.id) {
      setRejectedCreateId(null);
      setRetryTarget(null);
      if (!storeRejection(pending, null)) setStorageReady(false);
    }
    setData((previous) => ({
      ...previous,
      runs: [run, ...previous.runs.filter((entry) => entry.id !== run.id)],
    }));
    setDetail(run);
  }

  async function perform(operation: () => Promise<void>, allowWithoutGeneration = false) {
    if (busyRef.current || !(allowWithoutGeneration ? historyConfigured : configured)) return;
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

  async function create(retry = false) {
    if (
      !storageReady ||
      !consent ||
      (retry && (!pending || !retryTarget || rejectedCreateId !== pending.id)) ||
      (!pending && sourceBlocked) ||
      (!pending && (!profile?.readiness.ready || !items.some((item) => item.id === itemId)))
    )
      return;
    if (
      retry &&
      !window.confirm(
        '创建重新生成任务？旧结果和费用会保留；手动执行新任务将再次调用 AI，并可能再次计费。',
      )
    )
      return;
    await perform(async () => {
      const request = retry
        ? { ...pending!, id: crypto.randomUUID(), retryOf: retryTarget! }
        : (pending ?? {
            id: crypto.randomUUID(),
            batchId,
            itemId,
            profileId,
            profileRevision: profile!.revision,
          });
      if (!(retry ? replacePending(pending!, request) : storePending(request))) {
        setStorageReady(false);
        setMessage('请求 ID 保存失败，未发送创建或 AI 请求。');
        return;
      }
      setPending(request);
      setRejectedCreateId(null);
      setRetryTarget(null);
      // Revoke an older definite rejection before any new request is sent.
      // A lost/unknown response must never restore stale abandonment rights.
      if (!storeRejection(request, null)) {
        setStorageReady(false);
        setMessage('恢复记录未能安全更新，未发送创建或 AI 请求。请保留原编号核对。');
        return;
      }
      let run: GenerationRun;
      try {
        ({ run } = await requestApi({ action: 'create', ...request, consent: true }));
      } catch (error) {
        if (
          error instanceof SafeRequestError &&
          ((error.status === 400 &&
            ['input_too_large', 'invalid_source', 'invalid_request'].includes(error.code)) ||
            (error.status === 409 && ['revision_conflict', 'task_deleted'].includes(error.code)))
        ) {
          // These rejections do not create a new task. A deleted receipt remains
          // protected by server deduplication. Clearing local tracking still needs
          // an explicit action, a fresh not_found and a storage CAS.
          const rejection: CreateRejection = {
            request,
            code: error.code as CreateRejection['code'],
            ...(error.code === 'task_deleted' && error.previousId
              ? { previousId: error.previousId }
              : {}),
          };
          if (!storeRejection(request, rejection)) {
            setStorageReady(false);
            setMessage('创建已拒绝，但恢复记录未能安全保存。请保留原编号核对，未调用 AI。');
            return;
          }
          setRejectedCreateId(request.id);
          setRetryTarget(rejection.previousId ?? null);
        }
        throw error;
      }
      if (
        !run ||
        typeof run.id !== 'string' ||
        !uuid.test(run.id) ||
        run.batch_id !== request.batchId ||
        run.item_id !== request.itemId ||
        run.profile_id !== request.profileId ||
        run.profile_revision !== request.profileRevision ||
        (run.retry_of ?? undefined) !== request.retryOf
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
      setTaskQuery('');
      setTaskStatus('all');
      setListNavigation((value) => value + 1);
      setMessage(
        canonical.id === request.id
          ? request.retryOf
            ? '重新生成任务已创建，旧任务与费用保留。尚未调用 AI；手动执行将再次调用模型，并可能再次计费。'
            : '任务已创建。尚未调用 AI；请核对任务与外发授权，再手动执行生成。'
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

  async function deleteTask(id: string) {
    if (!window.confirm('删除此任务？任务将从列表移除，必要的费用和防重复调用记录会保留。')) return;
    await perform(async () => {
      const deleted = await requestApi({ action: 'delete', id });
      if (deleted.id !== id || deleted.deleted !== true)
        throw new SafeRequestError('response_identity_mismatch');
      setData((current) => ({ ...current, runs: current.runs.filter((run) => run.id !== id) }));
      if (detail?.id === id) setDetail(null);
      if (pending?.id === id) {
        try {
          const stored = pendingRequest(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'));
          if (stored?.id !== id) throw new Error('pending_mismatch');
          if (!replacePending(pending, null)) throw new Error('pending_not_removed');
          setPending(null);
          setConsent(false);
        } catch {
          setStorageReady(false);
          setMessage('任务已删除，但浏览器请求记录未能安全清除，已暂停新建。请保留请求编号核对。');
          return;
        }
      }
      setMessage('任务已删除。');
    }, true);
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
      setRetryTarget(null);
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

  const visibleRuns = data.runs.filter(
    (run) =>
      (taskStatus === 'all' || run.status === taskStatus) &&
      `${run.source_name ?? sourceNames.get(run.item_id) ?? '生成任务'} ${run.id}`
        .toLowerCase()
        .includes(taskQuery.trim().toLowerCase()),
  );
  return (
    <main className={`section-shell ${styles.main}`}>
      <Link className={controls.button} href="/admin">
        返回管理后台
      </Link>
      <h1>AI 信号生成</h1>
      <section className={styles.panel} aria-label="今日 AI 调用费用">
        <h2>今日 AI 调用费用总额</h2>
        <p>
          <strong>{data.dailyUsage ? money(data.dailyUsage.charged_microusd) : '暂不可用'}</strong>
          （美元 · 系统记账）
        </p>
        {data.dailyUsage && (
          <p>
            {data.dailyUsage.day}（UTC） · 含预留的预算占用：
            {money(data.dailyUsage.budget_used_microusd)}
          </p>
        )}
        <p>
          统计当前管理员当天执行的信号生成，包含失败及已删除任务，不含连接能力测试。API
          返回费用优先，缺失时使用预估；历史记录可能为预估，合计并非全部已确认实际费用。进行中的调用可能仅有预留。打开页面或手动刷新列表时更新。
        </p>
      </section>
      <p>
        从已完成解析的私有资料生成候选信号。创建任务与调用 AI 分开执行，不自动重试，不发布到网站。
      </p>
      <details className={styles.diagnostics}>
        <summary>诊断与使用说明</summary>
        <AdminGenerationPreflight />
        <p>候选中的摘要、事件发生时间、证据、人物与组织均需核验；没有足够依据时可以不生成候选。</p>
        <p>首版每次处理一份资料，解析文本最多 48,000 字节；超限会停止，不自动截断。</p>
        <p>
          执行后立即提交后台长任务，模型最多等待 25
          分钟。可关闭页面，重新打开查看进度；不会自动重试模型调用。
        </p>
      </details>
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
          导入已解析资料
          <select
            value={itemId}
            onChange={(event) => {
              const source = parsedSources.find(({ item }) => item.id === event.target.value);
              setBatchId(source?.batchId ?? '');
              setItemId(source?.item.id ?? '');
              setConsent(false);
              setInspection(null);
              setInspectionError('');
            }}
          >
            <option value="">请选择资料</option>
            {parsedSources.map(({ item }) => (
              <option key={item.id} value={item.id}>
                {importItemName(item)} · {item.id.slice(0, 8)}
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
        {!!profile?.readiness.warnings?.length && (
          <p role="status">
            部分能力测试已超过 24 小时，建议按需复测；此提醒不阻止生成，也不会自动调用模型。
          </p>
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
      <p>
        费用受服务端预算控制，预留金额不等于最终账单。重新生成会保留旧费用，并可能再次计费；不会自动重试。
      </p>
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
      {pending && !tracked && (
        <section className={styles.panel} aria-label="请求恢复">
          <h2>请求恢复</h2>
          <p className={styles.id}>请求 ID：{pending.id}</p>
          <p className={styles.id}>
            资料：{pending.itemId} · 配置：{pending.profileId} r{pending.profileRevision}
          </p>
          {!tracked && rejectedCreateId !== pending.id && (
            <p>
              当前保留原请求，暂不能更换资料。请先查询状态；若仍未找到，请重新勾选上方授权，再点击
              “使用原编号重新确认创建（不调用
              AI）”。该操作只确认或创建任务，不执行模型；若明确被拒绝，
              将显示安全退出入口。仅凭未找到或网络异常不会放弃原编号。
            </p>
          )}
          <button
            disabled={!historyConfigured || busy}
            onClick={() => void command('detail', pending.id)}
          >
            按原请求 ID 查询状态
          </button>
          {rejectedCreateId === pending.id && !tracked && (
            <button
              disabled={!configured || busy || !storageReady}
              onClick={() => void abandonRejected()}
            >
              核对并放弃未创建请求
            </button>
          )}
          {retryTarget && rejectedCreateId === pending.id && !tracked && (
            <button
              disabled={!configured || busy || !storageReady || !consent}
              onClick={() => void create(true)}
            >
              重新生成（创建新任务，不调用 AI）
            </button>
          )}
        </section>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section
        ref={taskListRef}
        tabIndex={-1}
        className={styles.taskSection}
        aria-label="生成任务列表"
      >
        <h2>生成任务</h2>
        <div className={styles.tableToolbar}>
          <label>
            搜索已加载任务
            <input
              type="search"
              placeholder="资料名称或任务编号"
              value={taskQuery}
              onChange={(event) => setTaskQuery(event.target.value)}
            />
          </label>
          <label>
            任务状态
            <select
              aria-label="任务状态"
              value={taskStatus}
              onChange={(event) => setTaskStatus(event.target.value)}
            >
              <option value="all">全部状态</option>
              {Object.entries(statuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {pollError && (
          <p role="alert">进度刷新失败，显示最后一次状态。请手动刷新核对；不会重复调用 AI。</p>
        )}
        <p>
          显示已保存状态；查看不会改写任务。长期停留“生成中”或结果未知的任务需人工对账，不要重复调用。
        </p>
        {data.runs.length === 0 && <p>暂无生成任务。</p>}
        <div
          className={styles.tableScroll}
          role="region"
          aria-label="生成任务表格，可横向滚动"
          tabIndex={0}
        >
          <table className={styles.taskTable}>
            <caption>
              生成任务 ·{' '}
              <span role="status" aria-live="polite" aria-atomic="true">
                显示 {visibleRuns.length} / {data.runs.length} 条已加载记录
              </span>
            </caption>
            <thead>
              <tr>
                <th scope="col">资料 / 任务</th>
                <th scope="col">状态</th>
                <th scope="col">模型配置</th>
                <th scope="col">创建时间</th>
                <th scope="col">费用</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleRuns.length === 0 && (
                <tr>
                  <td colSpan={6}>没有匹配的已加载任务。</td>
                </tr>
              )}
              {visibleRuns.map((run) => (
                <tr key={run.id}>
                  <th scope="row" className={styles.sourceCell}>
                    <Link
                      href={`/admin/signal-generation/${run.id}`}
                      prefetch={false}
                      className={styles.sourceTitle}
                    >
                      {run.source_name ?? sourceNames.get(run.item_id) ?? '生成任务'}
                    </Link>
                    <span className={styles.taskId} title={run.id}>
                      {run.id.slice(0, 8)}
                    </span>
                  </th>
                  <td>
                    <span className={styles.statusBadge} data-status={run.status}>
                      <span aria-hidden="true" className={styles.statusDot} />
                      {statuses[run.status]}
                    </span>
                    {generationIsActive(run) && <GenerationProgress run={run} />}
                    {knownErrorMessage(run.error_code) && (
                      <p className={styles.taskError}>{knownErrorMessage(run.error_code)}</p>
                    )}
                  </td>
                  <td>
                    <span>
                      {data.profiles.find(
                        (profile) =>
                          profile.id === run.profile_id &&
                          profile.revision === run.profile_revision,
                      )?.name ?? '历史配置'}
                    </span>
                    <span className={styles.taskId}>r{run.profile_revision}</span>
                  </td>
                  <td className={styles.timeCell}>
                    {Number.isFinite(Date.parse(run.created_at)) ? (
                      <time dateTime={run.created_at}>
                        {new Date(run.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC
                      </time>
                    ) : (
                      '时间未记录'
                    )}
                  </td>
                  <td className={styles.costCell}>
                    <strong>{money(run.charged_microusd)}</strong>
                    <span className={styles.taskId}>记账金额</span>
                    <span className={styles.taskId}>预留 {money(run.reserved_microusd)}</span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <Link
                        className={controls.button}
                        href={`/admin/signal-generation/${run.id}`}
                        prefetch={false}
                      >
                        任务详情
                      </Link>
                      <details className={styles.moreActions}>
                        <summary>更多操作</summary>
                        <p className={styles.id}>请求 ID：{run.id}</p>
                        {run.retry_of && (
                          <p className={styles.id}>重新生成自任务：{run.retry_of}；旧费用保留。</p>
                        )}
                        <p className={styles.id}>
                          资料：{run.item_id} · 配置：{run.profile_id} r{run.profile_revision}
                        </p>
                        <button
                          disabled={!historyConfigured || busy}
                          onClick={() => void command('detail', run.id)}
                        >
                          查看任务与私有候选
                        </button>
                        <button
                          disabled={
                            !historyConfigured ||
                            busy ||
                            !(run.can_delete ?? !['running', 'unknown'].includes(run.status))
                          }
                          onClick={() => void deleteTask(run.id)}
                        >
                          删除任务
                        </button>
                      </details>
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
                              !configured ||
                              busy ||
                              !consent ||
                              !storageReady ||
                              pending?.id !== run.id
                            }
                            onClick={() => void command('run', run.id)}
                          >
                            {run.progress_phase === 'queued'
                              ? '核对后重新提交原任务（不重复调用）'
                              : '执行生成（调用 AI，可能计费）'}
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
                    {run.can_delete === false && run.status !== 'running' && (
                      <p>
                        {configured
                          ? '执行保护期尚未结束，暂不能删除；稍后手动刷新列表。'
                          : '当前处于只读或受限状态，暂不能删除任务。'}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.tableNote}>
          窄屏可横向滚动表格。费用为系统记账与预留金额，并非供应商最终账单。候选尚未审核或发布。
        </p>
      </section>
      {detail?.result !== undefined && <PrivateResult result={detail.result} reviewTask={detail} />}
    </main>
  );
}

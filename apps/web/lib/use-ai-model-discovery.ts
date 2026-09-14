'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import type {
  AiConnection,
  AiProbe,
  AiProbeRequest,
} from '../../../packages/database/src/ai-config-store.mjs';
import { isValidAiModelId } from '../../../packages/database/src/ai-model-id.mjs';
import { aiRequest, statusLabels } from '../components/admin-ai-shared';
import {
  clearPendingAiProbe,
  persistPendingAiProbe,
  readPendingAiProbe,
  type PendingAiProbeState,
} from './admin-ai-pending';

const pendingEvent = 'hzense-ai-pending-changed';
const snapshot = () => JSON.stringify(readPendingAiProbe());
const serverSnapshot = () => '{"available":false,"request":null}';
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(pendingEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(pendingEvent, listener);
  };
}
const connectionKey = (connection: Pick<AiConnection, 'id' | 'revision'>) =>
  `${connection.id}:${connection.revision}`;
const settled = (probe: AiProbe) => ['succeeded', 'failed', 'stale'].includes(probe.status);
function matchesRequest(probe: AiProbe, request: AiProbeRequest) {
  return (
    probe &&
    probe.id === request.id &&
    probe.connection_id === request.connection_id &&
    probe.connection_revision === request.connection_revision &&
    probe.kind === request.kind &&
    (probe.model_id ?? null) === (request.model_id ?? null) &&
    ['pending', 'running', 'unknown', 'succeeded', 'failed', 'stale'].includes(probe.status)
  );
}

/** One shared catalogue per connection revision. Only an explicit selection/refresh can start discovery. */
export function useAiModelDiscovery(initialProbes: AiProbe[], available: boolean) {
  const [probes, setProbes] = useState(initialProbes);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [pendingMessage, setPendingMessage] = useState('');
  const pendingState = JSON.parse(
    useSyncExternalStore(subscribe, snapshot, serverSnapshot),
  ) as PendingAiProbeState;
  const active = useRef(false);
  const attempted = useRef(new Set<string>());
  const records = useRef(initialProbes);

  function remember(probe: AiProbe) {
    records.current = [probe, ...records.current.filter((row) => row.id !== probe.id)];
    setProbes(records.current);
  }
  function release(expectedId: string) {
    if (!clearPendingAiProbe(undefined, expectedId)) {
      setPendingMessage(
        '原测试编号已变化或无法清除，不会清除其他请求或自动发起新请求。请查询当前原编号。',
      );
      return;
    }
    window.dispatchEvent(new Event(pendingEvent));
  }
  function catalogue(connection?: AiConnection) {
    const listed =
      connection &&
      probes.find(
        (probe) =>
          probe.connection_id === connection.id &&
          probe.connection_revision === connection.revision &&
          probe.kind === 'models' &&
          probe.status === 'succeeded',
      );
    const models = Array.isArray(listed?.result.models)
      ? listed.result.models.flatMap((row) =>
          row && typeof row === 'object' && 'id' in row && isValidAiModelId(row.id) ? [row.id] : [],
        )
      : [];
    return {
      listed,
      models,
      message: connection ? messages[connectionKey(connection)] : undefined,
    };
  }
  async function load(connection: AiConnection, force = false) {
    if (!available || !connection.enabled || !connection.has_key) return;
    const key = connectionKey(connection);
    if (
      !force &&
      records.current.some(
        (probe) =>
          probe.connection_id === connection.id &&
          probe.connection_revision === connection.revision &&
          probe.kind === 'models' &&
          probe.status === 'succeeded',
      )
    )
      return;
    // Completed failures are not automatically retried when a second stage selects the same connection.
    if (!force && attempted.current.has(key)) return;
    const stored = readPendingAiProbe();
    if (active.current || !stored.available || stored.request) {
      setMessages((old) => ({
        ...old,
        [key]: '模型列表暂未读取：请先查询原编号或恢复会话存储；仍可手填模型 ID。',
      }));
      return;
    }
    const request: AiProbeRequest = {
      id: crypto.randomUUID(),
      connection_id: connection.id,
      connection_revision: connection.revision,
      kind: 'models',
    };
    if (!persistPendingAiProbe(request)) {
      setMessages((old) => ({
        ...old,
        [key]: '无法安全保存模型列表请求编号，未发出请求；仍可手填模型 ID。',
      }));
      window.dispatchEvent(new Event(pendingEvent));
      return;
    }
    active.current = true;
    attempted.current.add(key);
    setLoading(true);
    setPendingMessage('');
    setMessages((old) => ({ ...old, [key]: '正在读取当前连接的模型列表…' }));
    window.dispatchEvent(new Event(pendingEvent));
    try {
      const { probe } = await aiRequest<{ probe: AiProbe }>('probes', 'POST', request);
      if (!matchesRequest(probe, request)) throw new Error('Unexpected probe receipt');
      remember(probe);
      setMessages((old) => ({
        ...old,
        [key]:
          probe.status === 'succeeded'
            ? '模型列表已加载；选择模型不会启动能力测试。'
            : `模型列表${statusLabels[probe.status] ?? '未确认'}；可手填模型 ID，或先查询原编号。`,
      }));
      if (settled(probe)) release(request.id);
    } catch {
      setMessages((old) => ({
        ...old,
        [key]: '模型列表结果未确认，请查询原编号；不会自动重试，仍可手填模型 ID。',
      }));
    } finally {
      active.current = false;
      setLoading(false);
    }
  }
  async function queryPending() {
    const stored = readPendingAiProbe();
    if (!available || active.current || !stored.available || !stored.request) return;
    active.current = true;
    setLoading(true);
    try {
      const { probe } = await aiRequest<{ probe: AiProbe }>(`probes/${stored.request.id}`);
      if (!matchesRequest(probe, stored.request)) throw new Error('Unexpected probe receipt');
      remember(probe);
      setPendingMessage(`原测试状态：${statusLabels[probe.status] ?? '未确认'}`);
      if (probe.kind === 'models')
        setMessages((old) => ({
          ...old,
          [`${probe.connection_id}:${probe.connection_revision}`]:
            probe.status === 'succeeded'
              ? '原编号的模型列表已恢复，未重新调用供应商。'
              : `原模型列表状态：${statusLabels[probe.status] ?? '未确认'}；可手填模型 ID。`,
        }));
      if (settled(probe)) release(stored.request.id);
    } catch {
      setPendingMessage('原编号查询失败，保留待确认状态；不会自动发起新请求。');
    } finally {
      active.current = false;
      setLoading(false);
    }
  }
  return { catalogue, load, queryPending, loading, pendingState, pendingMessage };
}

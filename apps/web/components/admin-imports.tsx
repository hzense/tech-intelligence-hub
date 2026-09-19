'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { importBatchName } from '../lib/import-labels';
import { upload } from '@vercel/blob/client';
import type { ImportBatch } from '../../../packages/database/src/import-store.mjs';
import type { ImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { validateImportManifest } from '../../../packages/ingestion/src/import-manifest.mjs';
import styles from './admin-imports.module.css';
import controls from './admin-controls.module.css';
import {
  ImportClientError,
  canUploadAfterConfirmError,
  importFailureHint,
} from '../lib/import-client-error';
const capabilities = {
  parsers: ['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx'] as const,
  ocr: false,
  urlFetch: true,
};
const labels: Record<string, string> = {
  awaiting_upload: '等待原件',
  queued: '等待处理',
  running: '处理中',
  completed: '解析完成',
  partial_success: '部分完成',
  failed: '失败',
  unknown: '结果未知，待对账',
  cancelled: '已取消',
};
type TaskView = 'current' | 'history';
async function api(body?: unknown, before?: string, view: TaskView = 'current') {
  const query = new URLSearchParams({ view });
  if (before) query.set('before', before);
  const response = await fetch(
    `/api/admin/imports${body ? '' : `?${query}`}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        }
      : { cache: 'no-store' },
  );
  const result = await response.json();
  if (!response.ok) throw new ImportClientError(result.error ?? 'unavailable', result.reason);
  return result;
}
export function AdminImports({
  configured,
  diagnostics,
}: {
  configured: boolean;
  diagnostics?: { enabled: boolean; valid: boolean; issues: string[] };
}) {
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [files, setFiles] = useState<File[]>([]),
    [urls, setUrls] = useState('');
  const [batches, setBatches] = useState<ImportBatch[]>([]),
    [busy, setBusy] = useState(configured),
    [message, setMessage] = useState(''),
    [output, setOutput] = useState<{ name: string; data: ImportOutput } | null>(null);
  const resultDialog = useRef<HTMLDialogElement>(null);
  const resultOpener = useRef<HTMLButtonElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (output) resultDialog.current?.showModal();
    else {
      resultDialog.current?.close();
      resultOpener.current?.focus();
    }
  }, [output]);
  const requestId = useRef<string | null>(null);
  const [pageCursors, setPageCursors] = useState<string[]>([]);
  const [view, setView] = useState<TaskView>('current');
  const manifest = {
    files: files.map((file, i) => ({
      clientItemId: `file-${i}`,
      name: file.name,
      size: file.size,
    })),
    urlLines: urls,
  };
  const validation = validateImportManifest(manifest, { capabilities });
  const refresh = async () => setBatches((await api(undefined, pageCursors.at(-1), view)).batches);
  async function changeView(next: TaskView) {
    setBusy(true);
    try {
      setBatches((await api(undefined, undefined, next)).batches);
      setView(next);
      setPageCursors([]);
      setOutput(null);
      setMessage(next === 'current' ? '已显示当前任务。' : '已显示历史记录。');
    } catch {
      setMessage('任务列表读取失败，已保留原列表。');
    } finally {
      setBusy(false);
    }
  }
  async function turnPage(older: boolean) {
    const next = older ? [...pageCursors, batches.at(-1)!.id] : pageCursors.slice(0, -1);
    setBusy(true);
    try {
      setBatches((await api(undefined, next.at(-1), view)).batches);
      setPageCursors(next);
      setOutput(null);
      setMessage('批次页面已更新。');
    } catch {
      setMessage('批次页面读取失败。');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    if (configured) {
      setBusy(true);
      void api()
        .then((data) => {
          if (active) {
            setBatches(data.batches);
            setView('current');
            setPageCursors([]);
          }
        })
        .catch(() => {
          if (active) setMessage('导入服务暂不可用，请检查生产配置与权限。');
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    } else setBusy(false);
    return () => {
      active = false;
    };
  }, [configured]);
  async function action(body: unknown) {
    setBusy(true);
    setMessage('正在处理…');
    try {
      const result = await api(body);
      await refresh();
      setMessage(
        result.original_cleanup === 'pending'
          ? '任务状态已记录，但原件清理尚未确认。请检查清理告警；不能视为已删除。'
          : result.original_cleanup === 'deleted'
            ? '任务状态已记录，临时原件已清理。'
            : '操作已完成。',
      );
      return result;
    } catch (error) {
      setMessage(
        `操作未完成：${error instanceof Error ? error.message : 'unavailable'}。请刷新状态后再操作。`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!validation.valid) return;
    setBusy(true);
    setMessage('创建批次并上传私有原件…');
    try {
      requestId.current ??= crypto.randomUUID();
      const batch: ImportBatch = await api({
        action: 'create',
        request: { id: requestId.current, intent: 'preview', manifest },
      });
      for (const item of batch.items.filter(
        (i) => i.kind === 'file' && i.status === 'awaiting_upload',
      )) {
        const file = files[Number(item.declaration.clientItemId?.replace('file-', ''))];
        if (!file) throw new Error('missing_file');
        // Recovery after a lost callback: attempt server-side confirmation before uploading again.
        try {
          await api({ action: 'confirm', batchId: batch.id, itemId: item.id });
          continue;
        } catch (error) {
          if (!canUploadAfterConfirmError(error)) throw error;
        }
        await upload(`imports/${batch.id}/${item.id}`, file, {
          access: 'private',
          contentType: 'application/octet-stream',
          handleUploadUrl: '/api/admin/imports/upload',
          clientPayload: JSON.stringify({ batchId: batch.id, itemId: item.id }),
          multipart: file.size > 4 * 1024 * 1024,
        });
        await api({ action: 'confirm', batchId: batch.id, itemId: item.id });
      }
      setBatches((await api()).batches);
      setView('current');
      setPageCursors([]);
      setMessage('原件已接收。点击「处理」执行隔离解析；不会自动发布。');
      requestId.current = null;
      setFiles([]);
      setUrls('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (error) {
      setMessage(
        `导入未完全完成：${error instanceof Error ? error.message : 'unavailable'}。${importFailureHint(error)}`,
      );
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={`section-shell ${styles.main}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>内容工作台 · 第一步</p>
          <h1>文档与链接批量导入</h1>
          <p>导入资料，解析后再选择是否生成私有信号候选。不会自动发布。</p>
        </div>
        <Link className={controls.button} href="/admin">
          返回管理后台
        </Link>
      </header>
      <section className={styles.statusBar} aria-label="导入配置诊断">
        <span className={styles.badge}>{configured ? '导入配置就绪' : '导入不可用'}</span>
        <span>原件仅临时存放 · 处理结束立即清理</span>
        {diagnostics && (
          <details>
            <summary>配置详情</summary>
            <p>
              导入开关：{diagnostics.enabled ? '开启' : '关闭'} · 配置校验：
              {diagnostics.valid ? '通过' : '未通过'}
            </p>
            <p>仅检查配置格式，不代表数据库认证、权限及解析验收已通过。</p>
            <ul>
              {diagnostics.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {!configured && (
        <p role="status">
          生产导入尚未配置。需专用数据库权限、私有 Blob、隔离解析镜像及预算后启用。
        </p>
      )}
      <fieldset disabled={!configured || busy} className={styles.panel}>
        <legend>新建批次</legend>
        <div className={styles.uploadGrid}>
          <div className={styles.uploadZone}>
            <label>
              上传文档（最多 20 个，每个 25 MiB）
              <input
                type="file"
                ref={fileInput}
                multiple
                accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.csv,.xlsx"
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                  requestId.current = null;
                }}
              />
            </label>
            <p>
              支持文本型 PDF、DOCX、Markdown、TXT、HTML、CSV、XLSX。扫描件与图片暂不支持，外部 OCR
              关闭。
            </p>
            {files.length > 0 && (
              <ul className={styles.fileList}>
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>{file.name}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label>
              HTTPS 链接（每行一个，最多 100 个）
              <textarea
                rows={6}
                value={urls}
                onChange={(event) => {
                  setUrls(event.target.value);
                  requestId.current = null;
                }}
              />
            </label>
            <p>可与文件一起提交；重复链接会自动合并。</p>
          </div>
        </div>
        <p className={styles.notice}>
          原件不归档：解析成功、失败或取消后立即尝试删除。失败后需重新导入；解析结果与审计记录保留。未处理及异常遗留原件最长可读取
          24 小时，由定时清理兜底，物理删除可能因平台故障延迟。
        </p>
        <div className={styles.toolbar}>
          <p>
            已选择 {validation.totals.files} 个文件、{validation.totals.uniqueLinks}{' '}
            个不重复链接。整个批次须通过检查才能提交。
          </p>
          {!validation.valid && (files.length > 0 || urls.length > 0) && (
            <p role="alert">
              {[
                ...validation.batchErrors,
                ...validation.files.flatMap((f) => f.errors),
                ...validation.urls.flatMap((u) => u.errors),
              ].join('、')}
            </p>
          )}
          <button disabled={!validation.valid} onClick={() => void create()}>
            创建并上传
          </button>
        </div>
      </fieldset>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <section aria-labelledby="import-tasks-title" className={styles.tasks}>
        <div className={styles.toolbar}>
          <div>
            <h2 id="import-tasks-title">导入任务</h2>
            <p>先处理资料，再查看解析结果；生成候选是独立操作。</p>
          </div>
          <button disabled={!configured || busy} onClick={() => void actionRefresh()}>
            刷新任务状态
          </button>
        </div>
        <div className={controls.group} role="group" aria-label="任务视图">
          <button
            disabled={!configured || busy}
            aria-pressed={view === 'current'}
            onClick={() => void changeView('current')}
          >
            当前任务
          </button>
          <button
            disabled={!configured || busy}
            aria-pressed={view === 'history'}
            onClick={() => void changeView('history')}
          >
            历史记录
          </button>
        </div>
        <p>
          {view === 'current'
            ? '显示待处理、处理中及异常任务；已完成和已取消的批次请到历史记录查看。'
            : '仅显示已完成、已取消的批次。保留解析结果与审计记录，不代表上传原件仍被保存。'}
        </p>
        {batches.length === 0 && (
          <p className={styles.empty}>
            {busy
              ? '正在读取任务…'
              : pageCursors.length > 0
                ? '本页暂无任务，可返回较新批次。'
                : view === 'current'
                  ? '暂无当前任务。可新建导入，或查看历史记录。'
                  : '暂无历史记录。'}
          </p>
        )}
        {batches.some((batch) => batch.items.some((item) => item.duplicate_of)) && (
          <p>
            本页已合并{' '}
            {batches.flatMap((batch) => batch.items).filter((item) => item.duplicate_of).length}{' '}
            份重复资料。勾选下方选项可查看或删除重复任务。
          </p>
        )}
        <label>
          <input
            type="checkbox"
            checked={showDuplicates}
            onChange={(event) => setShowDuplicates(event.target.checked)}
          />
          显示重复资料（相同解析片段默认合并）
        </label>
        {batches
          .filter((batch) => showDuplicates || batch.items.some((item) => !item.duplicate_of))
          .map((batch) => (
            <section className={styles.panel} key={batch.id}>
              <div className={styles.toolbar}>
                <h3>{importBatchName(batch)}</h3>
                <span>{labels[batch.status] ?? batch.status}</span>
                <span>{batch.items.length} 项资料</span>
              </div>
              <p className={styles.id}>批次 {batch.id}</p>
              <button
                disabled={
                  busy || batch.items.some((item) => ['running', 'unknown'].includes(item.status))
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `删除“${importBatchName(batch)}”？该任务和资料将从列表移除，必要的费用记录会保留。`,
                    )
                  )
                    void action({ action: 'delete', batchId: batch.id });
                }}
              >
                删除任务
              </button>
              {!batch.cancelled && batch.status !== 'completed' && (
                <button
                  disabled={busy}
                  onClick={() => void action({ action: 'cancel', batchId: batch.id })}
                >
                  取消未完成项
                </button>
              )}
              <ul>
                {batch.items
                  .filter((item) => showDuplicates || !item.duplicate_of)
                  .map((item) => (
                    <li key={item.id}>
                      <p className={styles.name}>{item.declaration.name ?? item.declaration.url}</p>
                      {item.duplicate_of && (
                        <p>重复资料：解析片段与已有资料相同，生成页已自动去重。</p>
                      )}
                      <p>
                        {labels[item.status] ?? item.status}
                        {item.error_code ? ` · ${item.error_code}` : ''}
                      </p>
                      {item.status === 'queued' && !batch.cancelled && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action({ action: 'run', batchId: batch.id, itemId: item.id })
                          }
                        >
                          处理（使用已配置预算）
                        </button>
                      )}
                      {item.status === 'running' && !batch.cancelled && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action({ action: 'recover', batchId: batch.id, itemId: item.id })
                          }
                        >
                          核对超时状态
                        </button>
                      )}
                      {item.status === 'failed' && item.fence >= 5 && (
                        <p>已达 5 次尝试上限，不能再次重试。</p>
                      )}
                      {item.error_code === 'source_unavailable' && (
                        <p>原件已过期或不存在，请新建批次重新导入。</p>
                      )}
                      {item.status === 'failed' && (item.kind === 'file' || item.sha256) && (
                        <p>原件不保留，请新建批次重新导入。</p>
                      )}
                      {item.status === 'failed' &&
                        item.kind === 'url' &&
                        !item.sha256 &&
                        item.fence < 5 &&
                        item.error_code !== 'source_unavailable' &&
                        !batch.cancelled && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void action({ action: 'retry', batchId: batch.id, itemId: item.id })
                            }
                          >
                            重新排队
                          </button>
                        )}
                      {item.status === 'awaiting_upload' && !batch.cancelled && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action({ action: 'confirm', batchId: batch.id, itemId: item.id })
                          }
                        >
                          确认已上传原件
                        </button>
                      )}
                      {item.status === 'completed' && (
                        <button
                          disabled={busy}
                          onClick={(event) => {
                            resultOpener.current = event.currentTarget;
                            void action({
                              action: 'output',
                              batchId: batch.id,
                              itemId: item.id,
                            }).then((result) => {
                              if (result)
                                setOutput({
                                  name: item.declaration.name ?? item.declaration.url ?? '导入资料',
                                  data: result,
                                });
                            });
                          }}
                        >
                          查看私有解析结果
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        <nav aria-label="批次分页">
          <button
            disabled={!configured || busy || pageCursors.length === 0}
            onClick={() => void turnPage(false)}
          >
            较新批次
          </button>
          <span>第 {pageCursors.length + 1} 页</span>
          <button
            disabled={!configured || busy || batches.length < 50}
            onClick={() => void turnPage(true)}
          >
            更早批次
          </button>
        </nav>
      </section>
      <dialog
        ref={resultDialog}
        className={styles.drawer}
        aria-labelledby="import-result-title"
        onCancel={() => setOutput(null)}
      >
        {output && (
          <>
            <div className={styles.toolbar}>
              <h2 id="import-result-title">私有解析结果</h2>
              <button onClick={() => setOutput(null)}>关闭</button>
            </div>
            <p className={styles.name}>{output.name}</p>
            <p>以下为提取的私有文本，不是已发布信号。原件不归档。</p>
            {output.data.warnings?.length > 0 && (
              <ul>
                {output.data.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
            <div className={styles.fragments}>
              {output.data.fragments.map((fragment, index) => (
                <article key={index}>
                  <h3>片段 {index + 1}</h3>
                  <p className={styles.locator}>
                    {Object.entries(fragment.locator)
                      .map(
                        ([name, value]) =>
                          `${({ page: '页', paragraph: '段落', sheet: '工作表', row: '行', column: '列', region: '区域' } as Record<string, string>)[name] ?? name} ${value}`,
                      )
                      .join(' · ')}
                  </p>
                  <p className={styles.output}>{fragment.text}</p>
                </article>
              ))}
            </div>
            <details>
              <summary>查看结构化数据</summary>
              <pre className={styles.output}>{JSON.stringify(output.data, null, 2)}</pre>
            </details>
            <div className={styles.nextStep}>
              <Link className={controls.button} href="/admin/signal-generation">
                前往 AI 信号生成
              </Link>
              <p>在生成页选择对应批次和资料，再确认模型与预算；此按钮不会调用 AI。</p>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
  async function actionRefresh() {
    setBusy(true);
    try {
      await refresh();
      setMessage('状态已刷新。');
    } catch {
      setMessage('状态读取失败。');
    } finally {
      setBusy(false);
    }
  }
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { upload } from '@vercel/blob/client';
import type { ImportBatch } from '../../../packages/database/src/import-store.mjs';
import { validateImportManifest } from '../../../packages/ingestion/src/import-manifest.mjs';
import styles from './admin-imports.module.css';
import controls from './admin-controls.module.css';
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
async function api(body?: unknown, before?: string) {
  const response = await fetch(
    `/api/admin/imports${before ? `?before=${encodeURIComponent(before)}` : ''}`,
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
  if (!response.ok) throw new Error(result.error ?? 'unavailable');
  return result;
}
export function AdminImports({ configured }: { configured: boolean }) {
  const [files, setFiles] = useState<File[]>([]),
    [urls, setUrls] = useState(''),
    [intent, setIntent] = useState('preview');
  const [batches, setBatches] = useState<ImportBatch[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [output, setOutput] = useState('');
  const requestId = useRef<string | null>(null);
  const [pageCursors, setPageCursors] = useState<string[]>([]);
  const manifest = {
    files: files.map((file, i) => ({
      clientItemId: `file-${i}`,
      name: file.name,
      size: file.size,
    })),
    urlLines: urls,
  };
  const validation = validateImportManifest(manifest, { capabilities });
  const refresh = async () => setBatches((await api(undefined, pageCursors.at(-1))).batches);
  async function turnPage(older: boolean) {
    const next = older ? [...pageCursors, batches.at(-1)!.id] : pageCursors.slice(0, -1);
    setBusy(true);
    try {
      setBatches((await api(undefined, next.at(-1))).batches);
      setPageCursors(next);
      setOutput('');
      setMessage('批次页面已更新。');
    } catch {
      setMessage('批次页面读取失败。');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (configured)
      void api()
        .then((data) => setBatches(data.batches))
        .catch(() => setMessage('导入服务暂不可用，请检查生产配置与权限。'));
  }, [configured]);
  async function action(body: unknown) {
    setBusy(true);
    setMessage('正在处理…');
    try {
      const result = await api(body);
      await refresh();
      setMessage('操作已完成。');
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
        request: { id: requestId.current, intent, manifest },
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
        } catch {
          /* Not received yet. */
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
      setPageCursors([]);
      setMessage('原件已接收。点击「处理」执行隔离解析；不会自动发布。');
      requestId.current = null;
    } catch (error) {
      setMessage(
        `导入未完全完成：${error instanceof Error ? error.message : 'unavailable'}。保留原输入再次提交可续传同一批次。`,
      );
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={`section-shell ${styles.main}`}>
      <Link className={controls.button} href="/admin">
        返回管理后台
      </Link>
      <h1>文档与链接批量导入</h1>
      <p>原件与解析结果仅管理员可见。接收、解析、AI 生成与发布是不同步骤；此入口目前完成前两步。</p>
      <p>原件自上传起保留 7 天，到期停止读取并由定时任务清理；解析结果和审计记录不随原件删除。</p>
      {!configured && (
        <p role="status">
          生产导入尚未配置。需专用数据库权限、私有 Blob、隔离解析镜像及预算后启用。
        </p>
      )}
      <fieldset disabled={!configured || busy} className={styles.panel}>
        <legend>新建批次</legend>
        <label>
          上传文档（最多 20 个，每个 25 MiB）
          <input
            type="file"
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
        <label>
          后续意图
          <select
            value={intent}
            onChange={(event) => {
              setIntent(event.target.value);
              requestId.current = null;
            }}
          >
            <option value="preview">仅预览解析结果</option>
            <option value="generate_publish">后续生成并申请发布（尚未接通）</option>
          </select>
        </label>
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
      </fieldset>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <button disabled={!configured || busy} onClick={() => void actionRefresh()}>
        刷新任务状态
      </button>
      {batches.map((batch) => (
        <section className={styles.panel} key={batch.id}>
          <h2>{labels[batch.status] ?? batch.status}</h2>
          <p className={styles.id}>批次 {batch.id}</p>
          {!batch.cancelled && (
            <button
              disabled={busy}
              onClick={() => void action({ action: 'cancel', batchId: batch.id })}
            >
              取消未完成项
            </button>
          )}
          <ul>
            {batch.items.map((item) => (
              <li key={item.id}>
                <p className={styles.name}>{item.declaration.name ?? item.declaration.url}</p>
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
                {item.status === 'failed' &&
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
                    onClick={() =>
                      void action({ action: 'output', batchId: batch.id, itemId: item.id }).then(
                        (result) => {
                          if (result) setOutput(JSON.stringify(result, null, 2));
                        },
                      )
                    }
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
      {output && (
        <section className={styles.panel}>
          <h2>私有解析结果</h2>
          <button onClick={() => setOutput('')}>关闭</button>
          <pre className={styles.output}>{output}</pre>
        </section>
      )}
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

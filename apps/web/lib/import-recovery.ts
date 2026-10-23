import { readImportFetchDiagnostic } from '../../../packages/ingestion/src/import-fetch-diagnostic.mjs';

/** Stable internal IDs are UUID-shaped, but need not use an RFC version/variant. */
export function parseImportRecoveryBatchId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length === 36 &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

/** Only fixed diagnostic categories may become UI text; never show raw provider errors. */
export function importFetchFailureMessage(value: unknown): string {
  const diagnostic = readImportFetchDiagnostic(value);
  if (!diagnostic) return '原文抓取失败；该记录未保存具体 HTTP 或网络原因，不能据此判断为 403。';
  if (diagnostic.reason === 'http_status') {
    if (diagnostic.status === 401 || diagnostic.status === 403)
      return `原文网站拒绝程序访问（HTTP ${diagnostic.status}）。请使用允许读取的替代来源，或上传获准使用的文档；不要反复重跑整轮付费检索。`;
    if (diagnostic.status === 404 || diagnostic.status === 410)
      return `原文链接不存在或已移除（HTTP ${diagnostic.status}）。请核对来源并导入有效替代链接。`;
    if (diagnostic.status === 429)
      return '原文网站限制请求频率（HTTP 429）。请稍后核对或导入其他获准使用的资料，不会自动重试。';
    return `原文网站返回 HTTP ${diagnostic.status}，未获得可解析正文。请核对来源后再处理，无需重新付费检索。`;
  }
  const labels = {
    dns: '原文网站域名解析失败。请核对域名和网络，或使用可访问的替代来源。',
    timeout: '读取原文超时。请稍后核对来源，或上传获准使用的文档。',
    encoding: '原文网站返回当前抓取器不支持的编码。可上传获准使用的文档进行解析。',
    network: '原文网络连接失败。请核对网络，或使用可访问的替代来源。',
  };
  return labels[diagnostic.reason];
}

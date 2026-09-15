import { createHash } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { validateImportManifest } from './import-manifest.mjs';
const hasControl = (value) =>
  [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

export class ImportTaskError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function importFail(code = 'invalid_request') {
  throw new ImportTaskError(code);
}
export function importUuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value) ||
    value.length !== 36
  )
    importFail();
  return value;
}
export function importOwner(value) {
  if (typeof value !== 'string' || !value || value.length > 200 || hasControl(value)) importFail();
  return value;
}
export function parseImportCreate(value, capabilities) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['id', 'intent', 'manifest'].includes(key))
  )
    importFail();
  const id = importUuid(value.id);
  if (!['preview', 'generate_publish'].includes(value.intent)) importFail();
  const validation = validateImportManifest(value.manifest, { capabilities });
  if (!validation.valid) importFail('manifest_rejected');
  const items = [
    ...validation.files.map((file) => ({
      kind: 'file',
      declaration: {
        clientItemId: file.clientItemId,
        name: file.name,
        size: file.size,
        mime: file.mime,
        format: file.format,
        pageCount: file.pageCount,
        requiresOcr: file.requiresOcr,
      },
    })),
    ...validation.urls
      .filter((url) => url.status === 'valid')
      .map((url) => ({
        kind: 'url',
        declaration: { lineNumber: url.lineNumber, url: url.canonicalUrl },
      })),
  ];
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ intent: value.intent, items }))
    .digest('hex');
  return { id, intent: value.intent, fingerprint, items };
}

/** Worker output is untrusted data, never HTML or instructions. Exact locator schema. */
export function parseImportOutput(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['fragments', 'warnings'].includes(key))
  )
    importFail('invalid_output');
  if (!Array.isArray(value.fragments) || !value.fragments.length || value.fragments.length > 10000)
    importFail('invalid_output');
  let bytes = 0;
  const fragments = value.fragments.map((fragment, index) => {
    if (
      !fragment ||
      typeof fragment !== 'object' ||
      Array.isArray(fragment) ||
      Object.keys(fragment).some((key) => !['text', 'locator'].includes(key))
    )
      importFail('invalid_output');
    if (
      typeof fragment.text !== 'string' ||
      !fragment.text.trim() ||
      Array.from(fragment.text).length > 20000 ||
      fragment.text.includes('\0')
    )
      importFail('invalid_output');
    bytes += new TextEncoder().encode(fragment.text).length;
    if (bytes > 1000000) importFail('output_too_large');
    const locator = fragment.locator;
    if (
      !locator ||
      typeof locator !== 'object' ||
      Array.isArray(locator) ||
      Object.keys(locator).some(
        (key) => !['page', 'paragraph', 'sheet', 'row', 'column', 'region'].includes(key),
      )
    )
      importFail('invalid_output');
    if (!Object.keys(locator).length) importFail('invalid_output');
    for (const [key, number] of Object.entries(locator)) {
      if (key === 'sheet' || key === 'region') {
        if (
          typeof number !== 'string' ||
          !number ||
          Array.from(number).length > 150 ||
          hasControl(number)
        )
          importFail('invalid_output');
      } else if (
        !Number.isSafeInteger(number) ||
        number < 1 ||
        number > (key === 'page' ? 300 : 1000000)
      )
        importFail('invalid_output');
    }
    return { index, text: fragment.text, locator: { ...locator } };
  });
  const warnings = value.warnings ?? [];
  if (
    !Array.isArray(warnings) ||
    warnings.length > 20 ||
    warnings.some(
      (code) =>
        ![
          'formula_cached_only',
          'ocr_uncertain',
          'truncated_source',
          'no_public_evidence',
        ].includes(code),
    )
  )
    importFail('invalid_output');
  return { classification: 'private', fragments, warnings: [...warnings] };
}

export function importBatchStatus(batch, items) {
  if (batch.cancelled) return 'cancelled';
  if (items.some((item) => item.status === 'running')) return 'running';
  if (items.some((item) => item.status === 'awaiting_upload')) return 'awaiting_upload';
  if (items.some((item) => item.status === 'queued')) return 'queued';
  if (items.every((item) => item.status === 'completed')) return 'completed';
  if (items.some((item) => item.status === 'completed')) return 'partial_success';
  return items.some((item) => item.status === 'unknown') ? 'unknown' : 'failed';
}

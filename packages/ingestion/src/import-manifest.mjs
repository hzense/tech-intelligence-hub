/** Declaration-only preflight. No bytes, network, storage, identities or AI are created. */
export const IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 25 * 1024 * 1024,
  maxFiles: 20,
  maxLinks: 100,
  maxBatchBytes: 200 * 1024 * 1024,
  maxDocumentPages: 300,
});

const envelopeLimits = Object.freeze({ files: 1000, lines: 1000, urlCharacters: 262144 });
const parserFormats = ['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx'];
const extensions = Object.freeze({
  pdf: 'pdf',
  docx: 'docx',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  xlsx: 'xlsx',
  png: 'png',
  jpeg: 'jpeg',
  jpg: 'jpeg',
});
const mimeTypes = Object.freeze({
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  markdown: ['text/markdown', 'text/x-markdown', 'text/plain'],
  text: ['text/plain'],
  html: ['text/html'],
  csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  png: ['image/png'],
  jpeg: ['image/jpeg'],
});
const conversions = new Set([
  'doc',
  'dot',
  'xls',
  'ppt',
  'docm',
  'dotm',
  'xlsm',
  'xltm',
  'xlam',
  'xlsb',
  'pptm',
  'potm',
  'ppam',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
]);
const conversionMimes = new Set([
  'application/msword',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',
]);
const hasControls = (value) => /[\p{Cc}\p{Cf}]/u.test(value);
const faults = new WeakMap();
const error = (code) => {
  const failure = new Error('Import preflight failed');
  faults.set(failure, code);
  throw failure;
};

function appendOwn(array, value) {
  Object.defineProperty(array, String(array.length), {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function record(value, allowed, code) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    error(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) error(code);
  // Missing fields must stay missing even when Object.prototype is polluted.
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !descriptor ||
      !Object.hasOwn(descriptor, 'value')
    )
      error(code);
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value, maximum, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) error(code);
  const size = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(size) || size < 0) error(code);
  if (size > maximum) error(code === 'invalid_capabilities' ? code : 'manifest_too_large');
  if (Reflect.ownKeys(value).length !== size + 1) error(code);
  const result = [];
  for (let index = 0; index < size; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) error(code);
    appendOwn(result, descriptor.value);
  }
  return result;
}

function capabilitiesFrom(options) {
  const option = record(
    options === undefined ? {} : options,
    ['capabilities'],
    'invalid_capabilities',
  );
  const value = record(
    option.capabilities === undefined ? {} : option.capabilities,
    ['parsers', 'ocr', 'urlFetch'],
    'invalid_capabilities',
  );
  const parsers = denseArray(
    value.parsers === undefined ? [] : value.parsers,
    parserFormats.length,
    'invalid_capabilities',
  );
  if (
    parsers.some((format) => !parserFormats.includes(format)) ||
    new Set(parsers).size !== parsers.length ||
    (value.ocr !== undefined && typeof value.ocr !== 'boolean') ||
    (value.urlFetch !== undefined && typeof value.urlFetch !== 'boolean')
  )
    error('invalid_capabilities');
  return { parsers, ocr: value.ocr === true, urlFetch: value.urlFetch === true };
}

function baseResult(batchErrors = []) {
  return {
    stage: 'preflight',
    classification: 'private',
    valid: false,
    files: [],
    urls: [],
    batchErrors,
    totals: { files: 0, links: 0, uniqueLinks: 0, totalDeclaredBytes: 0 },
    requiresContentVerification: true,
  };
}

function checkFile(value, index, capabilities, clientIds) {
  const result = {
    inputIndex: index,
    clientItemId: null,
    name: null,
    size: null,
    mime: null,
    format: null,
    pageCount: null,
    requiresOcr: false,
    status: 'invalid',
    errors: [],
  };
  let file;
  try {
    file = record(
      value,
      ['clientItemId', 'name', 'size', 'mime', 'pageCount', 'requiresOcr'],
      'invalid_file_descriptor',
    );
  } catch {
    appendOwn(result.errors, 'invalid_file_descriptor');
    return result;
  }
  const id = file.clientItemId;
  if (typeof id !== 'string' || id.match(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)?.[0] !== id) {
    appendOwn(result.errors, 'invalid_client_item_id');
  } else {
    result.clientItemId = id;
    if (clientIds.has(id)) appendOwn(result.errors, 'duplicate_client_item_id');
    else clientIds.add(id);
  }

  if (
    typeof file.name !== 'string' ||
    !file.name ||
    file.name.length > 255 ||
    file.name !== file.name.trim() ||
    /[\\/:]/u.test(file.name) ||
    hasControls(file.name) ||
    ['.', '..'].includes(file.name)
  ) {
    appendOwn(result.errors, 'invalid_file_name');
  } else {
    result.name = file.name;
    const extension = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase();
    if (conversions.has(extension)) appendOwn(result.errors, 'conversion_required');
    else if (!Object.hasOwn(extensions, extension ?? ''))
      appendOwn(result.errors, 'unsupported_format');
    else result.format = extensions[extension];
  }

  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    appendOwn(result.errors, 'invalid_file_size');
  else {
    result.size = file.size;
    if (file.size > IMPORT_LIMITS.maxFileBytes) appendOwn(result.errors, 'file_too_large');
  }
  if (
    file.mime !== undefined &&
    (typeof file.mime !== 'string' || file.mime.length > 128 || hasControls(file.mime))
  ) {
    appendOwn(result.errors, 'invalid_mime');
  } else {
    const mime = (file.mime ?? '').trim().toLowerCase();
    result.mime = mime;
    if (conversionMimes.has(mime) || mime.includes('macroenabled'))
      appendOwn(result.errors, 'conversion_required');
    else if (
      result.format &&
      mime &&
      mime !== 'application/octet-stream' &&
      !mimeTypes[result.format].includes(mime)
    )
      appendOwn(result.errors, 'mime_mismatch');
  }
  if (file.pageCount !== undefined) {
    if (!Number.isSafeInteger(file.pageCount) || file.pageCount < 1)
      appendOwn(result.errors, 'invalid_page_count');
    else {
      result.pageCount = file.pageCount;
      if (file.pageCount > IMPORT_LIMITS.maxDocumentPages)
        appendOwn(result.errors, 'document_page_limit');
    }
  }
  if (file.requiresOcr !== undefined && typeof file.requiresOcr !== 'boolean')
    appendOwn(result.errors, 'invalid_ocr_declaration');
  result.requiresOcr = ['png', 'jpeg'].includes(result.format) || file.requiresOcr === true;
  if (
    result.format &&
    ((parserFormats.includes(result.format) && !capabilities.parsers.includes(result.format)) ||
      (result.requiresOcr && !capabilities.ocr))
  )
    appendOwn(result.errors, 'capability_unavailable');
  result.errors = [...new Set(result.errors)];
  return result;
}

function canonicalUrl(originalUrl) {
  if (originalUrl.length > 2048) error('url_too_long');
  if (hasControls(originalUrl) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(originalUrl))
    error('invalid_url');
  const candidate = originalUrl.trim();
  if (!/^https:\/\//i.test(candidate) || /\s|\\/u.test(candidate)) error('invalid_url');
  let url;
  try {
    url = new globalThis.URL(candidate);
  } catch {
    error('invalid_url');
  }
  const authority = /^https:\/\/([^/?#]*)/i.exec(candidate)?.[1] ?? '';
  if (!authority) error('invalid_url');
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    authority.includes('@')
  )
    error('blocked_url_target');
  const host = url.hostname;
  if (
    !host ||
    host.includes(':') ||
    /^\d+(?:\.\d+)*$/.test(host) ||
    host.endsWith('.') ||
    host.split('.').length < 2 ||
    host.length > 253 ||
    host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|arpa)$/.test(host)
  )
    error('blocked_url_target');
  // Do not touch searchParams: its order, repeated keys and escaping can be semantic.
  url.hash = '';
  return url.href;
}

/** A valid result means declarations passed only, never that inputs were uploaded or accepted. */
export function validateImportManifest(input, options) {
  try {
    const manifest = record(input, ['files', 'urlLines'], 'invalid_manifest');
    const capabilities = capabilitiesFrom(options);
    const files = denseArray(
      manifest.files === undefined ? [] : manifest.files,
      envelopeLimits.files,
      'invalid_manifest',
    );
    const urlLines = manifest.urlLines === undefined ? '' : manifest.urlLines;
    if (typeof urlLines !== 'string') error('invalid_manifest');
    if (urlLines.length > envelopeLimits.urlCharacters) error('manifest_too_large');
    const lines = urlLines.split(/\r?\n/);
    if (lines.length > envelopeLimits.lines) error('manifest_too_large');
    const result = baseResult();
    const clientIds = new Set();
    const batchErrors = new Set();
    let totalBytes = 0n;
    let unknownBytes = false;
    result.files = files.map((file, index) => {
      const checked = checkFile(file, index, capabilities, clientIds);
      if (index >= IMPORT_LIMITS.maxFiles) appendOwn(checked.errors, 'file_count_exceeded');
      if (checked.size === null) unknownBytes = true;
      else {
        totalBytes += BigInt(checked.size);
        if (totalBytes > BigInt(IMPORT_LIMITS.maxBatchBytes))
          appendOwn(checked.errors, 'batch_bytes_exceeded');
      }
      checked.status = checked.errors.length ? 'invalid' : 'valid';
      return checked;
    });
    const seenUrls = new Map();
    for (const [index, originalUrl] of lines.entries()) {
      // Blank lines are not inputs; positions of all nonblank lines remain intact.
      if (/^[ \t]*$/u.test(originalUrl)) continue;
      const checked = {
        lineNumber: index + 1,
        originalUrl,
        canonicalUrl: null,
        duplicateOfLine: null,
        status: 'invalid',
        errors: [],
      };
      try {
        checked.canonicalUrl = canonicalUrl(originalUrl);
      } catch (failure) {
        appendOwn(checked.errors, faults.get(failure) ?? 'invalid_url');
      }
      if (checked.canonicalUrl) {
        checked.duplicateOfLine = seenUrls.get(checked.canonicalUrl) ?? null;
        if (checked.duplicateOfLine === null)
          seenUrls.set(checked.canonicalUrl, checked.lineNumber);
        if (!capabilities.urlFetch || (!capabilities.parsers.length && !capabilities.ocr))
          appendOwn(checked.errors, 'capability_unavailable');
      }
      if (result.urls.length >= IMPORT_LIMITS.maxLinks)
        appendOwn(checked.errors, 'link_count_exceeded');
      checked.status = checked.errors.length
        ? 'invalid'
        : checked.duplicateOfLine === null
          ? 'valid'
          : 'duplicate';
      appendOwn(result.urls, checked);
    }
    if (!files.length && !result.urls.length) batchErrors.add('empty_batch');
    if (files.length > IMPORT_LIMITS.maxFiles) batchErrors.add('file_count_exceeded');
    if (result.urls.length > IMPORT_LIMITS.maxLinks) batchErrors.add('link_count_exceeded');
    if (totalBytes > BigInt(IMPORT_LIMITS.maxBatchBytes)) batchErrors.add('batch_bytes_exceeded');
    result.batchErrors = [...batchErrors];
    result.totals = {
      files: files.length,
      links: result.urls.length,
      uniqueLinks: seenUrls.size,
      totalDeclaredBytes:
        unknownBytes || totalBytes > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(totalBytes),
    };
    result.valid =
      !result.batchErrors.length &&
      [...result.files, ...result.urls].every((item) => item.errors.length === 0);
    return result;
  } catch (failure) {
    // Never return arbitrary exceptions, getters, filenames, URLs or configuration diagnostics.
    return baseResult([faults.get(failure) ?? 'invalid_manifest']);
  }
}

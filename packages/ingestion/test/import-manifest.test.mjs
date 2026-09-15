import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execPath } from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { IMPORT_LIMITS, validateImportManifest } from '@hzense/ingestion';

const capabilities = Object.freeze({
  parsers: Object.freeze(['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx']),
  ocr: true,
  urlFetch: true,
});
const file = (overrides = {}) => ({
  clientItemId: 'file-1',
  name: 'report.pdf',
  size: 1,
  ...overrides,
});
const validate = (input, available = capabilities) =>
  validateImportManifest(input, { capabilities: available });
const oneFile = (overrides = {}, available = capabilities) =>
  validate({ files: [file(overrides)] }, available);
const oneUrl = (urlLines, available = capabilities) => validate({ urlLines }, available);
const checkFileError = (overrides, code) => {
  const result = oneFile(overrides);
  assert.equal(result.valid, false);
  assert.ok(result.files[0].errors.includes(code), JSON.stringify(result.files[0].errors));
};

test('fixed limits and preflight metadata do not promise upload or persistence', () => {
  assert.deepEqual(IMPORT_LIMITS, {
    maxFileBytes: 25 * 1024 * 1024,
    maxFiles: 20,
    maxLinks: 100,
    maxBatchBytes: 200 * 1024 * 1024,
    maxDocumentPages: 300,
  });
  assert.ok(Object.isFrozen(IMPORT_LIMITS));
  const result = oneFile();
  assert.equal(result.valid, true);
  assert.equal(result.stage, 'preflight');
  assert.equal(result.classification, 'private');
  assert.equal(result.requiresContentVerification, true);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'stage',
      'classification',
      'valid',
      'files',
      'urls',
      'batchErrors',
      'totals',
      'requiresContentVerification',
    ].sort(),
  );
  assert.equal(result.files[0].clientItemId, 'file-1');
  assert.equal(result.files[0].inputIndex, 0);
});

test('all supported extensions, aliases and corresponding MIME declarations are recognized', () => {
  const cases = [
    ['PDF', 'pdf', 'application/pdf'],
    ['docx', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['md', 'markdown', 'text/markdown'],
    ['markdown', 'markdown', 'text/plain'],
    ['txt', 'text', 'text/plain'],
    ['html', 'html', 'text/html'],
    ['htm', 'html', 'text/html'],
    ['csv', 'csv', 'text/csv'],
    ['xlsx', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['png', 'png', 'image/png'],
    ['jpeg', 'jpeg', 'image/jpeg'],
    ['jpg', 'jpeg', 'image/jpeg'],
  ];
  for (const [extension, format, mime] of cases) {
    const result = oneFile({ name: `中文资料.${extension}`, mime });
    assert.equal(result.valid, true, extension);
    assert.equal(result.files[0].format, format);
  }
});

test('empty and octet-stream MIME are declarations only, not true type verification', () => {
  for (const mime of [undefined, '', '  ', 'application/octet-stream', ' APPLICATION/PDF ']) {
    const result = oneFile({ mime });
    assert.equal(result.valid, true);
    assert.equal(result.requiresContentVerification, true);
  }
  checkFileError({ mime: 'text/html' }, 'mime_mismatch');
  checkFileError({ mime: 'application/pdf; charset=utf-8' }, 'mime_mismatch');
  for (const mime of [null, 42, 'x'.repeat(129), 'application/pdf\n'])
    checkFileError({ mime }, 'invalid_mime');
});

test('ambiguous Excel MIME is declaration-compatible only with CSV and still requires byte verification', () => {
  const mime = 'application/vnd.ms-excel';
  const csv = oneFile({ name: 'report.csv', mime });
  assert.equal(csv.valid, true);
  assert.equal(csv.files[0].format, 'csv');
  assert.equal(csv.requiresContentVerification, true);
  checkFileError({ name: 'report.xls', mime }, 'conversion_required');
  checkFileError({ name: 'report.exe', mime }, 'unsupported_format');
  checkFileError({ name: 'report.xlsx', mime }, 'mime_mismatch');
});

test('legacy, macro and archive extensions require conversion even with benign MIME', () => {
  for (const extension of [
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
  ]) {
    checkFileError(
      { name: `report.${extension}`, mime: 'application/octet-stream' },
      'conversion_required',
    );
  }
  for (const mime of [
    'application/msword',
    'application/zip',
    'application/vnd.ms-word.document.macroEnabled.12',
  ]) {
    checkFileError({ mime }, 'conversion_required');
  }
  for (const name of ['file.exe', 'file', 'file.svg', 'file.pdf.exe'])
    checkFileError({ name }, 'unsupported_format');
});

test('filenames cannot smuggle paths, controls, hidden bidi or surrounding whitespace', () => {
  for (const name of [
    '',
    '.',
    '..',
    '../report.pdf',
    'a/report.pdf',
    'a\\report.pdf',
    'C:report.pdf',
    'file\u0000.pdf',
    'file\n.pdf',
    'file\u202e.pdf',
    ' report.pdf',
    'report.pdf ',
    `${'x'.repeat(252)}.pdf`,
    null,
    1,
  ]) {
    const result = oneFile({ name });
    assert.ok(result.files[0].errors.includes('invalid_file_name'));
    assert.equal(result.files[0].name, null);
  }
  assert.equal(oneFile({ name: `${'x'.repeat(251)}.pdf` }).valid, true);
});

test('sizes must be positive safe integers and the exact per-file boundary is inclusive', () => {
  for (const size of [
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    null,
  ]) {
    checkFileError({ size }, 'invalid_file_size');
  }
  assert.equal(oneFile({ size: IMPORT_LIMITS.maxFileBytes }).valid, true);
  checkFileError({ size: IMPORT_LIMITS.maxFileBytes + 1 }, 'file_too_large');
});

test('20 files pass and the 21st remains visible with per-item and batch errors', () => {
  const files = Array.from({ length: 21 }, (_, index) => file({ clientItemId: `file-${index}` }));
  assert.equal(validate({ files: files.slice(0, 20) }).valid, true);
  const result = validate({ files });
  assert.equal(result.valid, false);
  assert.equal(result.files.length, 21);
  assert.deepEqual(result.files[20].errors, ['file_count_exceeded']);
  assert.deepEqual(result.batchErrors, ['file_count_exceeded']);
  assert.equal(result.files[19].status, 'valid');
});

test('200 MiB declared byte boundary is exact and crossing items are not dropped', () => {
  const files = Array.from({ length: 8 }, (_, index) =>
    file({ clientItemId: `file-${index}`, size: IMPORT_LIMITS.maxFileBytes }),
  );
  const exact = validate({ files });
  assert.equal(exact.valid, true);
  assert.equal(exact.totals.totalDeclaredBytes, IMPORT_LIMITS.maxBatchBytes);
  const exceeded = validate({ files: [...files, file({ clientItemId: 'extra' })] });
  assert.equal(exceeded.valid, false);
  assert.equal(exceeded.files.length, 9);
  assert.equal(exceeded.totals.totalDeclaredBytes, IMPORT_LIMITS.maxBatchBytes + 1);
  assert.deepEqual(exceeded.files[8].errors, ['batch_bytes_exceeded']);
  assert.deepEqual(exceeded.batchErrors, ['batch_bytes_exceeded']);
});

test('unknown or unsafe summed bytes never report a deceptively smaller budget', () => {
  assert.equal(oneFile({ size: null }).totals.totalDeclaredBytes, null);
  const result = validate({
    files: [
      file({ size: Number.MAX_SAFE_INTEGER }),
      file({ clientItemId: 'file-2', size: Number.MAX_SAFE_INTEGER }),
    ],
  });
  assert.equal(result.totals.totalDeclaredBytes, null);
  assert.ok(result.batchErrors.includes('batch_bytes_exceeded'));
});

test('declared pages are bounded and OCR declarations cannot replace content detection', () => {
  assert.equal(oneFile({ pageCount: 300 }).valid, true);
  checkFileError({ pageCount: 301 }, 'document_page_limit');
  for (const pageCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])
    checkFileError({ pageCount }, 'invalid_page_count');
  checkFileError({ requiresOcr: 'false' }, 'invalid_ocr_declaration');
  const result = oneFile({ requiresOcr: false });
  assert.equal(result.requiresContentVerification, true);
});

test('unconfigured and format-specific parser capabilities fail closed', () => {
  const unavailable = validateImportManifest({ files: [file()] });
  assert.equal(unavailable.valid, false);
  assert.deepEqual(unavailable.files[0].errors, ['capability_unavailable']);
  assert.equal(oneFile({}, { parsers: ['pdf'] }).valid, true);
  assert.equal(oneFile({}, { parsers: ['text'] }).valid, false);
  assert.equal(oneFile({ requiresOcr: true }, { parsers: ['pdf'], ocr: false }).valid, false);
  assert.equal(oneFile({ requiresOcr: true }, { parsers: ['pdf'], ocr: true }).valid, true);
  assert.equal(oneFile({ requiresOcr: true }, { ocr: true }).valid, false);
  for (const name of ['photo.png', 'photo.jpeg']) {
    assert.equal(oneFile({ name, requiresOcr: false }, { ocr: false }).valid, false);
    const result = oneFile({ name }, { ocr: true });
    assert.equal(result.valid, true);
    assert.equal(result.files[0].requiresOcr, true);
  }
});

test('URL fetch and at least one content capability must both be configured', () => {
  assert.deepEqual(
    oneUrl('https://example.org/report', { parsers: ['html'], urlFetch: false }).urls[0].errors,
    ['capability_unavailable'],
  );
  assert.deepEqual(oneUrl('https://example.org/report', { urlFetch: true }).urls[0].errors, [
    'capability_unavailable',
  ]);
  assert.equal(
    oneUrl('https://example.org/report', { parsers: ['html'], urlFetch: true }).valid,
    true,
  );
  assert.equal(oneUrl('https://example.org/report', { ocr: true, urlFetch: true }).valid, true);
  const result = oneUrl('http://localhost/private', { urlFetch: false });
  assert.ok(result.urls[0].errors.includes('invalid_url'));
});

test('URL normalization preserves query semantics and raw private input, dropping only fragments', () => {
  const original = '  HTTPS://EXAMPLE.org:443/report?q=a+b&q=%2F&b=2&a=1#section  ';
  const result = oneUrl(original);
  assert.equal(result.valid, true);
  assert.equal(result.urls[0].originalUrl, original);
  assert.equal(result.urls[0].canonicalUrl, 'https://example.org/report?q=a+b&q=%2F&b=2&a=1');
  assert.equal(result.classification, 'private');
  const reordered = oneUrl('https://example.org/?a=1&b=2\nhttps://example.org/?b=2&a=1');
  assert.equal(reordered.totals.uniqueLinks, 2);
});

test('blank space/TAB/CRLF lines are removed without losing original nonblank positions', () => {
  const result = oneUrl(
    ' \t\r\nhttps://example.org/a#one\r\n\t\r\nhttps://example.org/a#two\r\nhttps://example.org/b\r\n',
  );
  assert.equal(result.valid, true);
  assert.deepEqual(
    result.urls.map(({ lineNumber, duplicateOfLine, status }) => ({
      lineNumber,
      duplicateOfLine,
      status,
    })),
    [
      { lineNumber: 2, duplicateOfLine: null, status: 'valid' },
      { lineNumber: 4, duplicateOfLine: 2, status: 'duplicate' },
      { lineNumber: 5, duplicateOfLine: null, status: 'valid' },
    ],
  );
  assert.deepEqual(result.totals, { files: 0, links: 3, uniqueLinks: 2, totalDeclaredBytes: 0 });
  assert.ok(oneUrl('https://exam\tple.org/a').urls[0].errors.includes('invalid_url'));
  assert.ok(oneUrl('\u0000').urls[0].errors.includes('invalid_url'));
});

test('100 links pass and duplicates still count toward the 101-line business limit', () => {
  const links = Array.from({ length: 101 }, () => 'https://example.org/report');
  assert.equal(oneUrl(links.slice(0, 100).join('\n')).valid, true);
  const result = oneUrl(links.join('\n'));
  assert.equal(result.valid, false);
  assert.equal(result.urls.length, 101);
  assert.equal(result.urls[100].lineNumber, 101);
  assert.equal(result.urls[100].duplicateOfLine, 1);
  assert.deepEqual(result.urls[100].errors, ['link_count_exceeded']);
  assert.deepEqual(result.batchErrors, ['link_count_exceeded']);
});

test('literal IP variants, private/special names, credentials and ports are blocked', () => {
  for (const url of [
    'https://127.0.0.1/',
    'https://8.8.8.8/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0177.0.0.1/',
    'https://[::1]/',
    'https://[2001:4860:4860::8888]/',
    'https://[::ffff:127.0.0.1]/',
    'https://localhost/',
    'https://internal/',
    'https://a.localhost/',
    'https://a.local/',
    'https://a.internal/',
    'https://a.lan/',
    'https://a.home/',
    'https://a.test/',
    'https://a.invalid/',
    'https://a.arpa/',
    'https://example.org./',
    'https://example.org:444/',
    'https://example.org:80/',
    'https://user:secret@example.org/',
    'https://@example.org/',
  ]) {
    const result = oneUrl(url);
    assert.equal(result.valid, false, url);
    assert.deepEqual(result.urls[0].errors, ['blocked_url_target'], url);
    assert.equal(result.urls[0].canonicalUrl, null);
  }
  assert.equal(oneUrl('https://example.org:443/').valid, true);
});

test('malformed, protocol-confused, control and escape URLs are rejected without fallback', () => {
  for (const url of [
    'http://example.org/',
    'ftp://example.org/',
    '//example.org/',
    'https:example.org/',
    'https:///example.org/',
    'https://',
    'https://example.org\\@localhost/',
    'https://example.org/a b',
    'https://example.org/a\u0000b',
    'https://example.org/a\u202eb',
    'https://example.org/a%00b',
    'https://example.org/a%0ab',
    'https://example.org/a%1Fb',
    'https://example.org/a%7Fb',
  ]) {
    assert.equal(oneUrl(url).valid, false, url);
  }
  assert.deepEqual(oneUrl(`https://example.org/${'a'.repeat(2048)}`).urls[0].errors, [
    'url_too_long',
  ]);
});

test('all mixed input errors retain positions rather than short-circuiting other items', () => {
  const result = validate({
    files: [file({ name: '../private.pdf' }), file({ clientItemId: 'good', name: 'good.txt' })],
    urlLines: 'http://localhost/\nhttps://example.org/good',
  });
  assert.equal(result.valid, false);
  assert.equal(result.files.length, 2);
  assert.equal(result.urls.length, 2);
  assert.equal(result.files[1].status, 'valid');
  assert.equal(result.urls[1].status, 'valid');
});

test('duplicate caller markers are reported and are not generated storage IDs', () => {
  const result = validate({ files: [file(), file(), file({ clientItemId: 'file-3' })] });
  assert.equal(result.valid, false);
  assert.equal(result.files[0].status, 'valid');
  assert.deepEqual(result.files[1].errors, ['duplicate_client_item_id']);
  assert.equal(result.files[2].status, 'valid');
  for (const clientItemId of ['', '../file', 'a\n', 'x'.repeat(129), null, 1])
    checkFileError({ clientItemId }, 'invalid_client_item_id');
});

test('unknown keys and non-plain manifests fail with stable envelope errors', () => {
  for (const input of [
    null,
    undefined,
    1,
    [],
    new Date(),
    { files: null },
    { urlLines: null },
    { unknown: true },
    { [Symbol('hidden')]: 1 },
    Object.create({ files: [] }),
  ]) {
    assert.deepEqual(validate(input).batchErrors, ['invalid_manifest']);
  }
  const nullPrototype = Object.assign(Object.create(null), { files: [file()] });
  assert.equal(validate(nullPrototype).valid, true);
  assert.deepEqual(oneFile({ extra: true }).files[0].errors, ['invalid_file_descriptor']);
});

test('manifest and file data getters are rejected without invoking user code', () => {
  let calls = 0;
  const input = Object.defineProperty({}, 'files', {
    get() {
      calls++;
      throw new Error('private getter');
    },
  });
  assert.deepEqual(validate(input).batchErrors, ['invalid_manifest']);
  const declaration = Object.defineProperty(file(), 'size', {
    get() {
      calls++;
      throw new Error('private getter');
    },
  });
  assert.deepEqual(validate({ files: [declaration] }).files[0].errors, ['invalid_file_descriptor']);
  assert.equal(calls, 0);
});

test('sparse, extended and accessor arrays are rejected without getter invocation', () => {
  let calls = 0;
  const sparse = new Array(2);
  sparse[1] = file();
  const extended = [file()];
  extended.extra = 'hidden';
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    get() {
      calls++;
      return file();
    },
    configurable: true,
  });
  for (const files of [sparse, extended, accessor])
    assert.deepEqual(validate({ files }).batchErrors, ['invalid_manifest']);
  assert.equal(calls, 0);
});

test('malformed capabilities fail closed instead of assuming production availability', () => {
  for (const options of [
    null,
    { extra: true },
    { capabilities: null },
    { capabilities: { extra: true } },
    { capabilities: { parsers: ['doc'] } },
    { capabilities: { parsers: ['pdf', 'pdf'] } },
    { capabilities: { parsers: new Array(1) } },
    {
      capabilities: {
        parsers: ['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx', 'unknown'],
      },
    },
    { capabilities: { ocr: 1 } },
    { capabilities: { urlFetch: 'true' } },
  ]) {
    assert.deepEqual(validateImportManifest({ files: [file()] }, options).batchErrors, [
      'invalid_capabilities',
    ]);
  }
  let calls = 0;
  const options = Object.defineProperty({}, 'capabilities', {
    get() {
      calls++;
      return capabilities;
    },
  });
  assert.deepEqual(validateImportManifest({ files: [file()] }, options).batchErrors, [
    'invalid_capabilities',
  ]);
  assert.equal(calls, 0);
});

test('hard envelope overflows are explicit whole-input failures, not silent truncation', () => {
  for (const input of [
    { files: Array.from({ length: 1001 }, () => file()) },
    { urlLines: '\n'.repeat(1000) },
    { urlLines: 'x'.repeat(262145) },
  ]) {
    const result = validate(input);
    assert.equal(result.valid, false);
    assert.deepEqual(result.batchErrors, ['manifest_too_large']);
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.urls, []);
  }
});

test('empty batches and blank-only URL inputs do not create accepted items', () => {
  for (const input of [{}, { files: [], urlLines: '' }, { urlLines: ' \t\r\n\t ' }]) {
    const result = validate(input);
    assert.deepEqual(result.batchErrors, ['empty_batch']);
    assert.equal(result.valid, false);
    assert.deepEqual(result.urls, []);
  }
});

test('frozen declarations and capabilities are not mutated', () => {
  const item = Object.freeze(file());
  const files = Object.freeze([item]);
  const input = Object.freeze({ files, urlLines: 'https://example.org/report#section' });
  assert.equal(validate(input).valid, true);
  assert.equal(input.urlLines, 'https://example.org/report#section');
  assert.equal(item.name, 'report.pdf');
});

test('hostile inspection failures cannot leak arbitrary exception values or invoke their getters', () => {
  let calls = 0;
  const failure = new Proxy(
    {},
    {
      get() {
        calls++;
        throw new Error('private diagnostics');
      },
    },
  );
  const input = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw failure;
      },
    },
  );
  const result = validate(input);
  assert.deepEqual(result.batchErrors, ['invalid_manifest']);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(result).includes('private diagnostics'), false);
});

test('inherited values and getters cannot supply capabilities, manifest files or file declarations', () => {
  // Every scenario gets its own process; Object.prototype is never modified in this runner.
  const scenarios = [
    {
      inherited: { capabilities: { parsers: ['pdf'] } },
      input: { files: [file()] },
      expectedBatch: [],
      expectedFile: ['capability_unavailable'],
    },
    {
      inherited: { files: [file()] },
      input: {},
      options: { capabilities: { parsers: ['pdf'] } },
      expectedBatch: ['empty_batch'],
    },
    {
      inherited: file(),
      input: { files: [{}] },
      options: { capabilities: { parsers: ['pdf'] } },
      expectedBatch: [],
      expectedFile: ['invalid_client_item_id', 'invalid_file_name', 'invalid_file_size'],
    },
  ];
  for (const scenario of scenarios) {
    for (const getter of [false, true]) {
      const source = `
        import { validateImportManifest } from '@hzense/ingestion';
        import { stdout } from 'node:process';
        const scenario = ${JSON.stringify(scenario)};
        let getterCalls = 0;
        let result;
        const keys = Object.keys(scenario.inherited);
        try {
          for (const key of keys) {
            const value = scenario.inherited[key];
            const descriptor = ${getter}
              ? { configurable: true, get() { getterCalls++; return value; } }
              : { configurable: true, writable: true, value };
            Object.defineProperty(Object.prototype, key, descriptor);
          }
          result = validateImportManifest(scenario.input, scenario.options);
        } finally {
          for (const key of keys) delete Object.prototype[key];
        }
        stdout.write(JSON.stringify({ result, getterCalls }));
      `;
      const output = execFileSync(execPath, ['--input-type=module', '-e', source], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
        timeout: 5000,
      });
      const { result, getterCalls } = JSON.parse(output);
      assert.equal(result.valid, false);
      assert.deepEqual(result.batchErrors, scenario.expectedBatch);
      if (scenario.expectedFile) assert.deepEqual(result.files[0].errors, scenario.expectedFile);
      else assert.deepEqual(result.files, []);
      assert.equal(getterCalls, 0);
    }
  }
});

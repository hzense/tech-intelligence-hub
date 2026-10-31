import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { importParserSource } from '../src/import-parser-source.mjs';
import { parseImportOutput } from '../src/import-task-contract.mjs';
// Synthetic files only; Python creates/removes its own bounded temporary fixtures.
function parse(format, source, setup = '') {
  const harness = `import tempfile,os,sys,json,io,zipfile\nwith tempfile.TemporaryDirectory(prefix='hzense-parser-test-') as d:\n os.chdir(d)\n source=json.loads(sys.stdin.read())\n ${setup || "open('input','wb').write(source.encode('utf-8'))"}\n sys.argv=['parser','input',${JSON.stringify(format)},'output']\n exec(${JSON.stringify(importParserSource)})\n print(open('output').read())`;
  const result = spawnSync(process.env.HZENSE_PARSER_TEST_PYTHON ?? 'python3', ['-c', harness], {
    encoding: 'utf8',
    input: JSON.stringify(source),
    timeout: 10000,
    maxBuffer: 2000000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('real text, Markdown and HTML parsers preserve private paragraph locators', () => {
  for (const format of ['text', 'markdown']) {
    const r = parse(format, '第一段\n\nsecond');
    const fragments = parseImportOutput(r.output).fragments;
    assert.equal(fragments.length, 1);
    assert.equal(fragments[0].text, '第一段\n\nsecond');
    assert.equal(fragments[0].locator.region, 'paragraphs 1-2');
  }
  const html = parse('html', '<h1>标题</h1><script>SECRET_SCRIPT</script><p>正文 &amp; 引文</p>');
  const content = parseImportOutput(html.output);
  assert.equal(content.fragments.length, 1);
  assert.equal(content.fragments[0].text, '标题\n\n正文 & 引文');
  assert.ok(!JSON.stringify(content).includes('SECRET_SCRIPT'));
});
test('CSV formulas remain inert text and cells have locations', () => {
  const out = parseImportOutput(parse('csv', 'name,value\nAlice,"=HYPERLINK(1)"').output);
  assert.equal(out.fragments[3].text, '=HYPERLINK(1)');
  assert.deepEqual(out.fragments[3].locator, { row: 2, column: 2 });
});
test('section-aware packing reduces fragments without mixing headings', () => {
  const out = parseImportOutput(
    parse('markdown', '# 第一章\n\n背景\n\n解释\n## 第二章\n\n结论').output,
  );
  assert.deepEqual(
    out.fragments.map((f) => f.text),
    ['# 第一章\n\n背景\n\n解释', '## 第二章\n\n结论'],
  );
  assert.equal(out.fragments[1].locator.paragraph, 4);
});
test('HTML closing blocks, inline tags and line breaks preserve readable context', () => {
  const out = parseImportOutput(
    parse(
      'html',
      '<h2>一</h2><div><p>Hello <b>world</b><br>again.</p><p>证据。</p></div><h4>二</h4><p>结论。</p>',
    ).output,
  );
  assert.deepEqual(
    out.fragments.map((f) => f.text),
    ['一\n\nHello world again.\n\n证据。', '二\n\n结论。'],
  );
});
test('long paragraphs split near sentence boundaries with source character locators', () => {
  const text = '甲'.repeat(900) + '。' + '乙'.repeat(900) + '。';
  const out = parseImportOutput(parse('text', text).output);
  assert.equal(out.fragments.length, 2);
  assert.equal(out.fragments[0].text, '甲'.repeat(900) + '。');
  assert.equal(out.fragments.map((f) => f.text).join(''), text);
  assert.equal(out.fragments[1].locator.region, 'paragraph 1 chars 902-1802');
  assert.deepEqual(parse('text', text), parse('text', text));
});
test('packing preserves all short blocks and normalizes CRLF', () => {
  const paragraphs = Array.from({ length: 100 }, (_, i) => `第${i}段证据`);
  const out = parseImportOutput(parse('text', paragraphs.join('\r\n\r\n')).output);
  assert.ok(out.fragments.length < 10);
  assert.equal(out.fragments.map((f) => f.text).join('\n\n'), paragraphs.join('\n\n'));
  assert.equal(parse('text', '正文\u0000尾部').error, 'limit_exceeded');
});
test('chunk boundaries retain whitespace and exact character ranges', () => {
  const source = 'A'.repeat(900) + '.  \n  ' + 'B'.repeat(900);
  const out = parseImportOutput(parse('text', source).output);
  assert.equal(out.fragments.map((f) => f.text).join(''), source);
  for (const fragment of out.fragments) {
    const [, start, end] = fragment.locator.region.match(/chars (\d+)-(\d+)/);
    assert.equal(
      fragment.text,
      Array.from(source)
        .slice(Number(start) - 1, Number(end))
        .join(''),
    );
  }
});
test('HTML pre blocks retain internal whitespace and inline markup text', () => {
  const out = parseImportOutput(
    parse('html', '<p>背景</p><pre>a\n  <code>b</code>\n\n    c</pre><p>结论</p>').output,
  );
  assert.equal(out.fragments[0].text, '背景\n\na\n  b\n\n    c\n\n结论');
});

test('HTML preserves first publication metadata in one primary main article and isolates related content', () => {
  const html =
    '<html><head><meta property="article:published_time" content="2026-10-30T18:00:21+00:00">' +
    '<meta property="article:modified_time" content="2026-10-31T02:00:00+00:00">' +
    '<script type="application/ld+json">{"@graph":[{"@type":"Article","datePublished":"2026-10-30T18:00:21+00:00","dateModified":"2026-10-31T02:00:00+00:00"},{"@type":"WebPage","datePublished":"2026-10-28"}]}</script></head>' +
    '<body><main><h1>A product announcement</h1><p>Company Alpha released its first public model.</p>' +
    '<h2>Technical details</h2><p>The new model improves retrieval accuracy.</p>' +
    '<div class="related-posts"><h2>Another article</h2><div><p>Company Beta released a different model.</p></div><time itemprop="datePublished" datetime="2026-10-20">October 20</time></div>' +
    '<p>The Alpha model is available today.</p></main><footer>Footer text</footer></body></html>';
  const output = parseImportOutput(parse('html', html).output);
  const primary = output.fragments.filter((f) => f.locator.region.startsWith('html article 1;'));
  assert.ok(primary.some((f) => f.text.includes('Company Alpha')));
  assert.ok(primary.some((f) => f.text.includes('Technical details')));
  assert.ok(primary.some((f) => f.text.includes('The Alpha model is available')));
  assert.ok(!primary.some((f) => f.text.includes('Company Beta')));
  const metadata = primary.filter((f) => f.locator.region.endsWith('publication metadata'));
  assert.deepEqual(
    metadata.map((f) => f.text),
    [
      'article:published_time: 2026-10-30T18:00:21+00:00',
      'datePublished: 2026-10-30T18:00:21+00:00',
    ],
  );
  assert.ok(!JSON.stringify(output).includes('2026-10-31T02:00:00'));
  assert.ok(!output.fragments.some((f) => f.text === 'datePublished: 2026-10-20'));
  assert.ok(output.fragments.some((f) => f.text.includes('October 20')));
});

test('HTML publication header time keeps its value while a bare or updated time is not a publication date', () => {
  for (const [classes, expected] of [
    ['single-pub__date', true],
    ['published', true],
    ['event-date', false],
    ['entry-date', false],
    ['post-date', false],
    ['updated published', false],
    ['', false],
  ]) {
    const html = `<main><header><h1>A research publication</h1><p class="${classes}"><time datetime="2026-10-29">October 29, 2026</time></p></header><p>A study introduces a new retrieval algorithm.</p></main>`;
    const output = parseImportOutput(parse('html', html).output);
    assert.equal(
      output.fragments.some(
        (f) =>
          f.text === 'time[datetime]: 2026-10-29' &&
          f.locator.region === 'html article 1; publication metadata',
      ),
      expected,
      classes,
    );
    assert.ok(output.fragments.some((f) => f.text.includes('October 29, 2026')));
  }
});

test('visible update labels before or after header time cannot become first publication dates', () => {
  const time = '<time datetime="2026-10-31T08:00:00Z">October 31, 2026</time>';
  for (const classes of ['entry-date', 'post-date', 'published', 'single-pub__date']) {
    for (const label of ['Updated', 'Last modified', '更新时间', '最后修订']) {
      for (const inner of [`${label} ${time}`, `${time} ${label}`]) {
        const output = parseImportOutput(
          parse(
            'html',
            `<article><header><h1>Original article</h1><div class="${classes}">${inner}</div></header><p>ACME announced an older processor.</p></article>`,
          ).output,
        );
        assert.ok(
          !output.fragments.some((fragment) =>
            fragment.locator.region.endsWith('publication metadata'),
          ),
          `${classes}: ${inner}`,
        );
      }
    }
  }
});

test('contradictory visible labels also reject a datePublished time property while keeping exact source text', () => {
  const output = parseImportOutput(
    parse(
      'html',
      '<article><header><h1>Original article</h1><span>Up<b>dated</b> <time itemprop="datePublished" datetime="2026-10-31">October 31, 2026</time></span></header><p>ACME announced an older processor.</p></article>',
    ).output,
  );
  assert.ok(
    !output.fragments.some((fragment) => fragment.locator.region.endsWith('publication metadata')),
  );
  assert.ok(
    output.fragments.some((fragment) => fragment.text.includes('Updated October 31, 2026')),
  );
});

test('non-header time never supplies an automatic publication date even with a datePublished property', () => {
  const time = '<time itemprop="datePublished" datetime="2026-10-31">October 31, 2026</time>';
  for (const inner of [
    `Updated ${time}`,
    `${time} Updated`,
    `更新 ${time}`,
    `${time} 最后修订`,
    time,
  ]) {
    const output = parseImportOutput(
      parse(
        'html',
        `<article><h1>Original article</h1><div class="published">${inner}</div><p>ACME announced an older processor.</p></article>`,
      ).output,
    );
    assert.ok(
      !output.fragments.some((fragment) =>
        fragment.locator.region.endsWith('publication metadata'),
      ),
      inner,
    );
    assert.ok(output.fragments.some((fragment) => fragment.text.includes('October 31, 2026')));
  }
  const output = parseImportOutput(
    parse(
      'html',
      `<article><h1>Original article</h1><meta itemprop="datePublished" content="2026-10-06"><div class="published">Updated ${time}</div><p>ACME announced an older processor.</p></article>`,
    ).output,
  );
  assert.deepEqual(
    output.fragments
      .filter((fragment) => fragment.locator.region.endsWith('publication metadata'))
      .map((fragment) => fragment.text),
    ['datePublished: 2026-10-06'],
  );
});

test('updated times do not override or invalidate explicit first publication metadata in the same header', () => {
  const metadata = '<meta itemprop="datePublished" content="2026-10-06">';
  const updated =
    '<div class="published"><time datetime="2026-10-31T08:00:00Z">October 31, 2026</time> Updated</div>';
  const first = '<div class="published"><time datetime="2026-10-06">October 6, 2026</time></div>';
  for (const inner of [metadata + first + updated, updated + metadata + first]) {
    const output = parseImportOutput(
      parse(
        'html',
        `<article><header><h1>Original article</h1>${inner}</header><p>ACME announced an older processor.</p></article>`,
      ).output,
    );
    assert.deepEqual(
      output.fragments
        .filter((fragment) => fragment.locator.region.endsWith('publication metadata'))
        .map((fragment) => fragment.text),
      ['datePublished: 2026-10-06'],
    );
  }
});

test('HTML cannot bind page metadata to multiple main articles, related articles or non-Article JSON-LD', () => {
  const meta = '<head><meta property="article:published_time" content="2026-10-30"></head>';
  for (const body of [
    '<main><h1>First article</h1><p>First story.</p><h1>Second article</h1><p>Second story.</p></main>',
    '<main><h1>Main story</h1><p>Some primary text.</p><article><h2>Related story</h2><p>Other facts.</p></article></main>',
    '<article><h1>First article</h1><p>First story.</p></article><article><h1>Second article</h1><p>Second story.</p></article>',
  ]) {
    const output = parseImportOutput(parse('html', meta + body).output);
    assert.ok(
      output.fragments.some(
        (f) =>
          f.text === 'article:published_time: 2026-10-30' &&
          f.locator.region === 'html document; publication metadata',
      ),
    );
  }
  const ambiguous = parseImportOutput(
    parse(
      'html',
      '<article><meta itemprop="datePublished" content="2026-10-30"><h1>First article</h1><p>First story.</p><h1>Second article</h1><p>Second story.</p></article>',
    ).output,
  );
  assert.ok(
    ambiguous.fragments.every((fragment) => !fragment.locator.region.startsWith('html article')),
  );
  for (const json of [
    '{"@type":"Event","datePublished":"2026-10-30"}',
    '{"@type":"Article","dateModified":"2026-10-30"}',
    '{invalid',
  ]) {
    const output = parseImportOutput(
      parse(
        'html',
        '<head><script type="application/ld+json">' +
          json +
          '</script></head><main><h1>Title</h1><p>Body text.</p></main>',
      ).output,
    );
    assert.ok(!output.fragments.some((f) => f.locator.region.includes('publication metadata')));
    assert.ok(!JSON.stringify(output).includes('dateModified'));
  }
});
test('Markdown fenced code is not mistaken for a new section', () => {
  const source = '# 章节\n\n~~~python\n# comment\n\nprint(1)\n~~~\n\n解释';
  const out = parseImportOutput(parse('markdown', source).output);
  assert.equal(out.fragments.length, 1);
  assert.equal(out.fragments[0].text, source);
});
test('Python parser and persistence use Unicode code points for astral text limits', () => {
  for (const count of [15000, 20000]) {
    const text = '😀'.repeat(count);
    const fragments = parseImportOutput(parse('text', text).output).fragments;
    assert.equal(fragments.map((fragment) => fragment.text).join(''), text);
    assert.ok(fragments.every((fragment) => Array.from(fragment.text).length <= 1600));
  }
  assert.ok(parse('text', '😀'.repeat(20001)).output);
});
test('DOCX ZIP parser reads real XML without executing embedded instructions', () => {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>synthetic source</w:t></w:r></w:p></w:body></w:document>';
  const result = parse(
    'docx',
    xml,
    "z=zipfile.ZipFile('input','w'); z.writestr('word/document.xml',source); z.close()",
  );
  assert.equal(parseImportOutput(result.output).fragments[0].text, 'synthetic source');
});
test('DOCX title styles delimit groups and preserve original paragraph numbers', () => {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题一</w:t></w:r></w:p>' +
    '<w:p/><w:p><w:r><w:t>正文</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>标题二</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const out = parseImportOutput(
    parse(
      'docx',
      xml,
      "z=zipfile.ZipFile('input','w'); z.writestr('word/document.xml',source); z.close()",
    ).output,
  );
  assert.deepEqual(
    out.fragments.map((f) => f.text),
    ['标题一\n\n正文', '标题二'],
  );
  assert.equal(out.fragments[0].locator.region, 'paragraphs 1-3');
  assert.equal(out.fragments[1].locator.paragraph, 4);
});
test('DOCX preserves run tabs and line breaks without separating styled word fragments', () => {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>' +
    '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
    '<w:r><w:t>Author Alice</w:t><w:tab/><w:t>Exam</w:t></w:r>' +
    '<w:r><w:rPr><w:b/></w:rPr><w:t>ple University</w:t><w:br/>' +
    '<w:t>New research result.</w:t><w:cr/><w:t>Second line.</w:t></w:r>' +
    '</w:p></w:body></w:document>';
  const out = parseImportOutput(
    parse(
      'docx',
      xml,
      "z=zipfile.ZipFile('input','w'); z.writestr('word/document.xml',source); z.close()",
    ).output,
  );
  assert.equal(out.fragments.length, 1);
  assert.equal(
    out.fragments[0].text,
    'Author Alice\tExample University\nNew research result.\nSecond line.',
  );
  assert.deepEqual(out.warnings, []);
});
test('parser fails closed on hostile XML, oversized fragments and unsupported content', () => {
  assert.equal(
    parse(
      'docx',
      '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a/>',
      "z=zipfile.ZipFile('input','w'); z.writestr('word/document.xml',source); z.close()",
    ).error,
    'unsupported_content',
  );
  assert.equal(parse('text', 'x'.repeat(1000001)).error, 'limit_exceeded');
  assert.equal(parse('pdf', 'not a PDF').error, 'unsupported_content');
  assert.equal(parse('png', 'not supported').error, 'unsupported_content');
});
test('XLSX real workbook resolves sheet names, coordinates and cached formulas', () => {
  const files = {
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Research" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>evidence</t></is></c><c r="B1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
  };
  const result = parse(
    'xlsx',
    JSON.stringify(files),
    "z=zipfile.ZipFile('input','w'); [z.writestr(k,v) for k,v in json.loads(source).items()]; z.close()",
  );
  const out = parseImportOutput(result.output);
  assert.equal(out.fragments[0].text, 'evidence');
  assert.deepEqual(out.fragments[1].locator, { sheet: 'Research', row: 1, column: 2 });
  assert.deepEqual(out.warnings, ['formula_cached_only']);
  const sheet = files['xl/worksheets/sheet1.xml'];
  for (const row of [1000000, 1000001, 1048576]) {
    files['xl/worksheets/sheet1.xml'] = sheet
      .replaceAll('A1', `A${row}`)
      .replaceAll('B1', `B${row}`);
    const boundary = parse(
      'xlsx',
      JSON.stringify(files),
      "z=zipfile.ZipFile('input','w'); [z.writestr(k,v) for k,v in json.loads(source).items()]; z.close()",
    );
    if (row === 1000000)
      assert.equal(parseImportOutput(boundary.output).fragments[0].locator.row, row);
    else assert.equal(boundary.error, 'limit_exceeded');
  }
});
test(
  'PDF text extraction, scanned-page refusal and page cap',
  { skip: !process.env.HZENSE_PARSER_TEST_PYTHON },
  () => {
    const setup =
      "from pypdf import PdfWriter; from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject; w=PdfWriter(); p=w.add_blank_page(400,400); font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')}); p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(font)})}); s=DecodedStreamObject(); s.set_data(b'BT /F1 12 Tf 50 300 Td (Synthetic PDF evidence) Tj ET'); p[NameObject('/Contents')]=w._add_object(s); w.write('input')";
    assert.equal(
      parseImportOutput(parse('pdf', '', setup).output).fragments[0].text,
      'Synthetic PDF evidence',
    );
    const longText = 'A'.repeat(900) + '. ' + 'B'.repeat(900);
    const paged = parseImportOutput(
      parse(
        'pdf',
        '',
        setup
          .replace('Synthetic PDF evidence', longText)
          .replace("w.write('input')", "w.add_page(p); w.write('input')"),
      ).output,
    );
    assert.deepEqual(
      paged.fragments.map((f) => f.locator.page),
      [1, 1, 2, 2],
    );
    assert.ok(paged.fragments.every((f) => f.text.length <= 1600));
    assert.equal(
      parse(
        'pdf',
        '',
        "from pypdf import PdfWriter; w=PdfWriter(); w.add_blank_page(100,100); w.write('input')",
      ).error,
      'ocr_required',
    );
    assert.equal(
      parse(
        'pdf',
        '',
        "from pypdf import PdfWriter; w=PdfWriter(); [w.add_blank_page(100,100) for _ in range(301)]; w.write('input')",
      ).error,
      'limit_exceeded',
    );
  },
);

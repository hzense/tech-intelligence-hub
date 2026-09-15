import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { importParserSource } from '../src/import-parser-source.mjs';
import { parseImportOutput } from '../src/import-task-contract.mjs';
// Synthetic files only; Python creates/removes its own bounded temporary fixtures.
function parse(format, source, setup = '') {
  const harness = `import tempfile,os,sys,json,io,zipfile\nwith tempfile.TemporaryDirectory(prefix='hzense-parser-test-') as d:\n os.chdir(d)\n source=${JSON.stringify(source)}\n ${setup || "open('input','wb').write(source.encode('utf-8'))"}\n sys.argv=['parser','input',${JSON.stringify(format)},'output']\n exec(${JSON.stringify(importParserSource)})\n print(open('output').read())`;
  const result = spawnSync(process.env.HZENSE_PARSER_TEST_PYTHON ?? 'python3', ['-c', harness], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 2000000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('real text, Markdown and HTML parsers preserve private paragraph locators', () => {
  for (const format of ['text', 'markdown']) {
    const r = parse(format, '第一段\n\nsecond');
    assert.equal(parseImportOutput(r.output).fragments.length, 2);
  }
  const html = parse('html', '<h1>标题</h1><script>SECRET_SCRIPT</script><p>正文 &amp; 引文</p>');
  const content = parseImportOutput(html.output);
  assert.equal(content.fragments.length, 2);
  assert.ok(!JSON.stringify(content).includes('SECRET_SCRIPT'));
});
test('CSV formulas remain inert text and cells have locations', () => {
  const out = parseImportOutput(parse('csv', 'name,value\nAlice,"=HYPERLINK(1)"').output);
  assert.equal(out.fragments[3].text, '=HYPERLINK(1)');
  assert.deepEqual(out.fragments[3].locator, { row: 2, column: 2 });
});
test('Python parser and persistence use Unicode code points for astral text limits', () => {
  for (const count of [15000, 20000]) {
    const text = '😀'.repeat(count);
    assert.equal(parseImportOutput(parse('text', text).output).fragments[0].text, text);
  }
  assert.equal(parse('text', '😀'.repeat(20001)).error, 'limit_exceeded');
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
test('parser fails closed on hostile XML, oversized fragments and unsupported content', () => {
  assert.equal(
    parse(
      'docx',
      '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a/>',
      "z=zipfile.ZipFile('input','w'); z.writestr('word/document.xml',source); z.close()",
    ).error,
    'unsupported_content',
  );
  assert.equal(parse('text', 'x'.repeat(20001)).error, 'limit_exceeded');
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

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const yaml = async (path) => parse(await readFile(path, 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalizedUrl = (input) => {
  try {
    const url = new URL(input);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
};

async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...(await walk(resolve(dir, entry.name))));
    else if (entry.isFile() && !entry.name.startsWith('.')) result.push(resolve(dir, entry.name));
  }
  return result.sort();
}

async function inventory(inputRoot) {
  const signals = await yaml(resolve(root, 'data/seed/signals.yaml'));
  const files = [];
  const unsupported = [];
  for (const path of await walk(inputRoot)) {
    if (extname(path).toLowerCase() !== '.md') {
      unsupported.push(relative(inputRoot, path));
      continue;
    }
    const bytes = await readFile(path);
    const text = bytes.toString('utf8');
    const lines = text.split('\n');
    const urls = [...new Set(text.match(/https?:\/\/[^\s<>\])"`]+/gu) ?? [])];
    const urlKeys = new Set(urls.map(normalizedUrl));
    files.push({
      file: relative(inputRoot, path),
      sha256: digest(bytes),
      bytes: bytes.length,
      lines: text.endsWith('\n') ? lines.length - 1 : lines.length,
      cited_url_count: urls.length,
      matched_existing_signals: signals
        .filter((s) => urlKeys.has(normalizedUrl(s.source_url)))
        .map((s) => s.id),
      // Literal URL matches are hints only, never semantic event deduplication.
      technology_section_headings: lines.flatMap((line, index) =>
        /^#{1,3}\s/.test(line) &&
        /AI|人工智能|科技|半导体|机器人|算力|SemiAnalysis|芯片|数据中心/i.test(line)
          ? [{ line: index + 1, heading: line.replace(/^#+\s*/, '') }]
          : [],
      ),
    });
  }
  return {
    schema: 'hzense-daily-signal-review-inventory-v1',
    input_root_hint: 'datas/日报',
    reviewed_on: '2026-09-29',
    file_count: files.length,
    total_bytes: files.reduce((n, f) => n + f.bytes, 0),
    total_lines: files.reduce((n, f) => n + f.lines, 0),
    unsupported_files: unsupported,
    files,
  };
}

if (process.argv[2] === 'inventory') {
  if (!process.argv[3])
    throw new Error('Usage: node analysis/audit.mjs inventory /path/to/datas/日报');
  console.log(JSON.stringify(await inventory(resolve(process.argv[3])), null, 2));
} else {
  const signals = await yaml(resolve(root, 'data/seed/signals.yaml'));
  const entities = new Map(
    (await yaml(resolve(root, 'data/seed/entities.yaml'))).map((e) => [e.id, e]),
  );
  const counts = (items) =>
    Object.fromEntries(
      [...new Set(items)].sort().map((key) => [key, items.filter((x) => x === key).length]),
    );
  console.log(
    JSON.stringify(
      {
        signals: signals.length,
        type_counts: counts(signals.map((s) => s.type)),
        topic_counts: counts(signals.flatMap((s) => s.topics)),
        missing_people: signals
          .filter((s) => !s.entities.some((id) => entities.get(id)?.type === 'person'))
          .map((s) => s.id),
        missing_organizations: signals
          .filter(
            (s) =>
              !s.entities.some((id) => ['company', 'institution'].includes(entities.get(id)?.type)),
          )
          .map((s) => s.id),
      },
      null,
      2,
    ),
  );
}

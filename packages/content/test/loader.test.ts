import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadContent } from '../src/loader.js';

const temporaryRoots: string[] = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hzense-content-'));
  temporaryRoots.push(root);
  const contentRoot = join(root, 'content');
  const seedRoot = join(root, 'seed');
  await Promise.all([
    mkdir(join(contentRoot, 'daily', '2024'), { recursive: true }),
    mkdir(seedRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(seedRoot, 'topics.yaml'),
      '- id: topic-ai\n  title: Artificial Intelligence\n  status: active\n',
    ),
    writeFile(join(seedRoot, 'entities.yaml'), '[]\n'),
    writeFile(join(seedRoot, 'radar.yaml'), '[]\n'),
    writeFile(join(seedRoot, 'relations.yaml'), '[]\n'),
    writeFile(
      join(seedRoot, 'sources.yaml'),
      '- id: source-example\n  name: Example\n  type: website\n  trust_score: 80\n  active: true\n  allowed_hosts: [example.com]\n',
    ),
    writeFile(
      join(seedRoot, 'signals.yaml'),
      `- id: signal-example
  title: Example signal
  type: technology
  occurred_at: 2024-06-19T00:00:00Z
  captured_at: 2024-06-20T00:00:00Z
  status: accepted
  source_id: source-example
  source_url: https://example.com/signal
  summary: Example summary
  importance: 3
  strength: 3
  confidence: 0.8
  novelty: 0.7
  topics: [topic-ai]
  entities: []
`,
    ),
  ]);
  return { contentRoot, seedRoot };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('loadContent', () => {
  it('loads Markdown and MDX into deterministic, render-ready entries', async () => {
    const { contentRoot, seedRoot } = await createFixture();
    await writeFile(
      join(contentRoot, 'daily', '2024', '2024-06-20.md'),
      `---
id: daily-2024-06-20
title: 示例简报
type: daily
status: published
edition: historical_example
date: 2024-06-20
language: zh-CN
summary: 来自 front matter 的摘要。
signal_count: 1
major_developments: 1
rising_topics: [topic-ai]
signal_refs: [signal-example]
---
# 示例简报

## 执行摘要
这是第一段。

## 基础模型｜平台变化
这是第二段。
`,
    );
    await mkdir(join(contentRoot, 'topics'), { recursive: true });
    await writeFile(
      join(contentRoot, 'topics', 'ai.md'),
      `---
id: topic-ai
title: 人工智能
type: topic
status: active
language: zh-CN
---
# 人工智能

没有显式摘要时使用正文第一段。
`,
    );

    const entries = await loadContent({ contentRoot, seedRoot });

    expect(entries.map((entry) => entry.relativePath)).toEqual([
      'daily/2024/2024-06-20.md',
      'topics/ai.md',
    ]);
    const [daily, topic] = entries;
    if (!daily || !topic || daily.frontMatter.type !== 'daily')
      throw new Error('Expected Daily and Topic entries');
    expect(daily.slug).toBe('daily/2024/2024-06-20');
    expect(daily.frontMatter.date).toBe('2024-06-20');
    expect(daily.summary).toBe('来自 front matter 的摘要。');
    expect(daily.sections).toEqual([
      { heading: '执行摘要', level: 2, paragraphs: ['这是第一段。'] },
      { heading: '基础模型｜平台变化', level: 2, paragraphs: ['这是第二段。'] },
    ]);
    expect(topic.summary).toBe('没有显式摘要时使用正文第一段。');
  });

  it('rejects broken cross-references with the file and field', async () => {
    const { contentRoot, seedRoot } = await createFixture();
    await writeFile(
      join(contentRoot, 'daily', '2024', '2024-06-20.md'),
      `---
id: daily-2024-06-20
title: Broken
type: daily
status: published
edition: historical_example
date: 2024-06-20
language: en
summary: Broken reference.
signal_count: 1
major_developments: 1
rising_topics: [topic-ai]
signal_refs: [signal-missing]
---
## 执行摘要
Broken reference.

## Signal
Broken reference.
`,
    );

    await expect(loadContent({ contentRoot, seedRoot })).rejects.toThrow(
      'daily/2024/2024-06-20.md: signal_refs missing signal "signal-missing"',
    );
  });

  it('reports the complete Topic parent cycle through the content validation path', async () => {
    const { contentRoot, seedRoot } = await createFixture();
    const topicsRoot = join(contentRoot, 'topics');
    await mkdir(topicsRoot, { recursive: true });
    await Promise.all([
      writeFile(
        join(topicsRoot, 'a.md'),
        `---
id: topic-a
title: Topic A
type: topic
status: active
parent: topic-b
---
Topic A.
`,
      ),
      writeFile(
        join(topicsRoot, 'b.md'),
        `---
id: topic-b
title: Topic B
type: topic
status: active
parent: topic-a
---
Topic B.
`,
      ),
    ]);

    await expect(loadContent({ contentRoot, seedRoot })).rejects.toThrow(
      'topics/a.md: parent cycle topic "topic-a -> topic-b -> topic-a"',
    );
  });
});

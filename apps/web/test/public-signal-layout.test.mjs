import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { primaryNavigation, repositoryUrl } from '../lib/site-navigation.ts';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('public Signal index is a unified chronological card stream without a search toolbar', async () => {
  const page = await source('../app/signals/page.tsx');
  assert.match(page, /getPublicExploration\(\)/);
  assert.match(page, /right\.occurred_at\.localeCompare\(left\.occurred_at\)/);
  assert.match(page, /<PublicSignalCards signals=\{entries\}/);
  assert.doesNotMatch(page, /<form|archive=1|当前公开信号|历史档案|应用筛选/);
});

test('search stays separate and contact opens the HZense GitHub repository', async () => {
  assert.deepEqual(
    primaryNavigation.map((item) => item.label),
    ['雷达', '信号', '洞察', '资源'],
  );
  assert.equal(repositoryUrl, 'https://github.com/hzense/tech-intelligence-hub');
  assert.match(await source('../app/search/page.tsx'), /role="search"/);
  for (const component of ['../components/site-shell.tsx', '../components/mobile-navigation.tsx']) {
    const text = await source(component);
    assert.match(text, /href=\{repositoryUrl\}/);
    assert.doesNotMatch(text, /mailto:hello@hzense\.com/);
  }
});

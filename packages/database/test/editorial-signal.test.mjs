import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { readEditorialSignal, saveEditorialSignal } from '../src/editorial-signal-store.mjs';
import {
  normalizeEditorialContent,
  normalizeEditorialRequest,
  contentReadiness,
} from '../src/editorial-signal-contract.mjs';
export function editorialFixture() {
  const content = {
    title: 'Publication',
    summary: 'Human-confirmed event',
    eventDate: '2026-09-25',
    signalType: 'product',
    organizations: ['Organization'],
    persons: ['Person'],
    topics: [{ id: 'ai', title: 'AI' }],
    sourceUrls: ['https://example.com/event'],
  };
  const material = {
    materialHash: 'a'.repeat(64),
    title: content.title,
    summary: content.summary,
    sourceUrls: content.sourceUrls,
  };
  return {
    content,
    material,
    request: {
      requestId: '11111111-1111-1111-1111-111111111111',
      runId: '22222222-2222-2222-2222-222222222222',
      candidateIndex: 0,
      expectedRevision: 0,
      materialHash: material.materialHash,
      action: 'publish',
      content,
      consent: true,
    },
  };
}
describe('editorial confirmation contract', () => {
  it('still validates structure and immutable content before historical replay lookup', () => {
    const { request, material } = editorialFixture();
    for (const patch of [
      { extra: true },
      { consent: 'true' },
      { materialHash: 'b'.repeat(64) },
      { content: { ...request.content, title: 'Changed' } },
      { content: { ...request.content, sourceUrls: ['javascript:alert(1)'] } },
      { content: { ...request.content, signalType: 'made_up' } },
    ])
      expect(() =>
        normalizeEditorialRequest({ ...request, ...patch }, material, { checkPublication: false }),
      ).toThrow();
    const historical = {
      ...request,
      content: { ...request.content, persons: ['Donald J. Trump'], signalType: null },
      consent: false,
    };
    expect(
      normalizeEditorialRequest(
        historical,
        { ...material, sourceOptions: [] },
        { checkPublication: false },
      ),
    ).toEqual(historical);
    expect(() => normalizeEditorialRequest(historical, material)).toThrow('excluded_person');
  });
  it('returns a committed legacy receipt before current source and classification policy, rejecting changed replays', async () => {
    const { request, material } = editorialFixture();
    delete request.content.signalType;
    const legacy = normalizeEditorialRequest(request, material, { checkPublication: false });
    const old = {
      request_id: request.requestId,
      owner_id: 'owner',
      revision: 1,
      action: 'publish',
      content: legacy.content,
      request_hash: createHash('sha256')
        .update(JSON.stringify({ owner: 'owner', ...legacy }))
        .digest('hex'),
    };
    const queries = [];
    const pool = {
      connect: async () => ({
        query: async (sql) => {
          queries.push(sql);
          if (sql.startsWith('SELECT id FROM public.signal_generation_runs'))
            return { rows: [{ id: request.runId }] };
          if (sql.includes('WHERE request_id=$1')) return { rows: [old] };
          if (sql.startsWith('SELECT') && sql.includes('editorial_signal_revisions'))
            throw new Error(
              'replay must not depend on the later revision that removed this source',
            );
          return { rows: [] };
        },
        release: () => {},
      }),
    };
    const args = {
      pool,
      owner: 'owner',
      request,
      material: { ...material, sourceUrls: [], sourceOptions: [] },
    };
    const receipt = await saveEditorialSignal(args);
    expect(receipt.content).toEqual(legacy.content);
    expect(Object.hasOwn(receipt.content, 'signalType')).toBe(false);
    expect(receipt.revision).toBe(1);
    expect(receipt).not.toHaveProperty('request_hash');
    expect(queries.some((sql) => sql.startsWith('INSERT'))).toBe(false);
    await expect(
      saveEditorialSignal({
        ...args,
        request: { ...request, content: { ...request.content, persons: ['Changed'] } },
      }),
    ).rejects.toThrow('request_id_conflict');
    await expect(saveEditorialSignal({ ...args, owner: 'other' })).rejects.toThrow(
      'request_id_conflict',
    );
  });
  it('checks new writes under the transaction and retains only latest saved sources', async () => {
    const { request, material } = editorialFixture();
    let latest = null;
    const writes = [];
    const pool = {
      connect: async () => ({
        query: async (sql, values) => {
          if (sql.startsWith('SELECT id FROM public.signal_generation_runs'))
            return { rows: [{ id: request.runId }] };
          if (sql.includes('WHERE request_id=$1')) return { rows: [] };
          if (sql.startsWith('SELECT') && sql.includes('editorial_signal_revisions'))
            return { rows: latest ? [latest] : [] };
          if (sql.startsWith('SELECT id,title FROM public.topics'))
            return { rows: request.content.topics };
          if (sql.startsWith('INSERT INTO public.editorial_signal_revisions')) {
            const row = {
              request_id: values[0],
              revision: values[4],
              action: values[6],
              content: JSON.parse(values[7]),
            };
            writes.push(row);
            return { rows: [row] };
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    };
    const args = {
      pool,
      owner: 'owner',
      request,
      material: { ...material, sourceUrls: [], sourceOptions: [] },
    };
    const noType = { ...request.content, sourceUrls: [] };
    delete noType.signalType;
    await expect(
      saveEditorialSignal({ ...args, request: { ...request, content: noType } }),
    ).rejects.toThrow('confirmation_required');
    await expect(saveEditorialSignal(args)).rejects.toThrow('material_changed');
    expect(writes).toHaveLength(0);
    latest = { revision: 1, action: 'publish', content: request.content };
    const update = { ...request, expectedRevision: 1 };
    expect((await saveEditorialSignal({ ...args, request: update })).content.sourceUrls).toEqual(
      request.content.sourceUrls,
    );
    await expect(
      saveEditorialSignal({
        ...args,
        request: {
          ...update,
          content: { ...update.content, sourceUrls: ['https://forged.example/source'] },
        },
      }),
    ).rejects.toThrow('material_changed');
    expect(
      (
        await saveEditorialSignal({
          ...args,
          request: { ...update, action: 'withdraw', content: { ...noType, sourceUrls: [] } },
        })
      ).content,
    ).toEqual(latest.content);
    expect(writes).toHaveLength(2);
  });
  it('preserves legacy payloads and validates new classification and explicitly selected source subset', () => {
    const { request, material, content } = editorialFixture();
    const legacyContent = { ...content };
    delete legacyContent.signalType;
    expect(normalizeEditorialContent(legacyContent)).toEqual(legacyContent);
    expect(Object.hasOwn(normalizeEditorialContent(legacyContent), 'signalType')).toBe(false);
    expect(() =>
      normalizeEditorialRequest({ ...request, content: legacyContent }, material),
    ).toThrow('confirmation_required');
    expect(
      normalizeEditorialRequest({ ...request, content: legacyContent }, material, {
        checkPublication: false,
      }).content,
    ).toEqual(legacyContent);
    const bound = {
      ...material,
      sourceOptions: ['https://example.com/event', 'https://example.com/second'],
    };
    const classified = { ...content, signalType: 'product' };
    expect(
      normalizeEditorialRequest({ ...request, content: classified }, bound).content.signalType,
    ).toBe('product');
    expect(
      normalizeEditorialRequest({ ...request, content: { ...classified, sourceUrls: [] } }, bound)
        .content.sourceUrls,
    ).toEqual([]);
    expect(() =>
      normalizeEditorialRequest(
        { ...request, content: { ...classified, sourceUrls: ['https://forged.example/source'] } },
        bound,
      ),
    ).toThrow('material_changed');
    expect(() => normalizeEditorialContent({ ...content, signalType: 'unknown' })).toThrow(
      'invalid_request',
    );
    expect(() =>
      normalizeEditorialRequest({ ...request, content: { ...content, signalType: null } }, bound),
    ).toThrow('confirmation_required');
    expect(
      normalizeEditorialRequest(
        { ...request, action: 'draft', content: { ...content, signalType: null } },
        bound,
      ).action,
    ).toBe('draft');
    expect(
      normalizeEditorialRequest(
        { ...request, action: 'withdraw' },
        { ...material, sourceOptions: [] },
      ).action,
    ).toBe('withdraw');
  });
  it.each([
    'Donald J. Trump',
    '习近平（会议主持者）',
    'Donald J. Trump (speaker)',
    '李强 / 国务院',
  ])('blocks %s on new writes without changing historical reads or withdrawal', (person) => {
    const { request, material } = editorialFixture();
    const content = { ...request.content, persons: [person] };
    expect(normalizeEditorialContent(content)).toEqual(content);
    for (const action of ['draft', 'publish']) {
      expect(() => normalizeEditorialRequest({ ...request, content, action }, material)).toThrow(
        'excluded_person',
      );
    }
    expect(
      normalizeEditorialRequest({ ...request, content, action: 'withdraw' }, material).action,
    ).toBe('withdraw');
    expect(
      normalizeEditorialRequest(
        {
          ...request,
          content: { ...request.content, persons: ['Scott Bessent', 'Ted Lieu'] },
        },
        material,
      ).action,
    ).toBe('publish');
  });
  it('normalizes immutable material consistently across draft, publish and withdraw', () => {
    const { request, material } = editorialFixture();
    material.title = ` ${material.title}\n`;
    material.summary = `\t${material.summary} `;
    material.sourceUrls = material.sourceUrls.map((url) => ` ${url} `);
    for (const action of ['draft', 'publish', 'withdraw']) {
      for (const padded of [false, true]) {
        const content = padded
          ? {
              ...request.content,
              title: material.title,
              summary: material.summary,
              sourceUrls: material.sourceUrls,
            }
          : request.content;
        expect(
          normalizeEditorialRequest({ ...request, content, action }, material).content,
        ).toEqual(request.content);
      }
    }
  });
  it('destroys clients after read or transactional query failures, retaining domain errors', async () => {
    const { request, material } = editorialFixture();
    const releases = [];
    let mode = 'timeout';
    const pool = {
      async connect() {
        return {
          async query(sql) {
            if (mode === 'timeout') throw new Error('synthetic query timeout');
            if (mode === 'rollback-failure' && sql === 'ROLLBACK')
              throw new Error('synthetic rollback timeout');
            return { rows: [] };
          },
          release(discard) {
            releases.push(discard);
          },
        };
      },
    };
    await expect(
      readEditorialSignal({ pool, owner: 'owner', runId: request.runId, candidateIndex: 0 }),
    ).rejects.toThrow('database_unavailable');
    expect(releases.at(-1)).toBe(true);
    await expect(saveEditorialSignal({ pool, owner: 'owner', request, material })).rejects.toThrow(
      'database_unavailable',
    );
    expect(releases.at(-1)).toBe(true);
    mode = 'domain';
    await expect(saveEditorialSignal({ pool, owner: 'owner', request, material })).rejects.toThrow(
      'not_found',
    );
    expect(releases.at(-1)).toBe(false);
    mode = 'rollback-failure';
    await expect(saveEditorialSignal({ pool, owner: 'owner', request, material })).rejects.toThrow(
      'not_found',
    );
    expect(releases.at(-1)).toBe(true);
    mode = 'healthy';
    expect(
      await readEditorialSignal({ pool, owner: 'owner', runId: request.runId, candidateIndex: 0 }),
    ).toBeNull();
    expect(releases.at(-1)).toBe(false);
  });
  it('requires classification and completed editorial fields without implying verification', () => {
    const { request, material } = editorialFixture();
    expect(normalizeEditorialRequest(request, material)).toEqual(request);
    expect(contentReadiness(request.content)).toEqual({ ready: true, missing: [] });
    for (const key of ['eventDate', 'organizations', 'persons', 'topics', 'signalType']) {
      const content = {
        ...request.content,
        [key]: ['eventDate', 'signalType'].includes(key) ? null : [],
      };
      expect(contentReadiness(content)).toEqual({ ready: false, missing: [key] });
      expect(() => normalizeEditorialRequest({ ...request, content }, material)).toThrow(
        'confirmation_required',
      );
      expect(
        normalizeEditorialRequest(
          { ...request, content, action: 'draft', consent: false },
          material,
        ).action,
      ).toBe('draft');
    }
  });
  it('rejects malformed fields, implicit consent, changed generated text and hidden keys', () => {
    const { request, material, content } = editorialFixture();
    for (const patch of [
      { consent: false },
      { consent: 'true' },
      { verified: true },
      { materialHash: 'b'.repeat(64) },
    ])
      expect(() => normalizeEditorialRequest({ ...request, ...patch }, material)).toThrow();
    for (const patch of [
      { eventDate: '2026-02-30' },
      { title: 'x'.repeat(81) },
      { persons: ['a', 'a'] },
      { persons: Array(13).fill('a') },
      { organizations: [''] },
      { topics: [{ id: 'ai', title: 'AI', verified: true }] },
      { sourceUrls: ['javascript:bad'] },
      { secret: 'raw source' },
    ])
      expect(() => normalizeEditorialContent({ ...content, ...patch })).toThrow();
    for (const patch of [{ title: 'Changed' }, { summary: 'Changed' }, { sourceUrls: [] }])
      expect(() =>
        normalizeEditorialRequest({ ...request, content: { ...content, ...patch } }, material),
      ).toThrow('material_changed');
  });
});

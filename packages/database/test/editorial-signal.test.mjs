import { describe, it, expect } from 'vitest';
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
  it('accepts exactly four completed editorial fields without implying verification', () => {
    const { request, material } = editorialFixture();
    expect(normalizeEditorialRequest(request, material)).toEqual(request);
    expect(contentReadiness(request.content)).toEqual({ ready: true, missing: [] });
    for (const key of ['eventDate', 'organizations', 'persons', 'topics']) {
      const content = { ...request.content, [key]: key === 'eventDate' ? null : [] };
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

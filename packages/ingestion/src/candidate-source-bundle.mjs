import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { URL } from 'node:url';
import { validateGenerationSource } from './signal-generation-contract.mjs';

const version = 'candidate-source-bundle-v1';
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const supplementKeys = ['batchId', 'itemId', 'fence', 'contentHash', 'sourceUrl', 'source'];
const provenanceKeys = [
  'fragmentId',
  'kind',
  'originalFragmentId',
  'batchId',
  'itemId',
  'fence',
  'contentHash',
  'sourceUrl',
];

export class CandidateSourceBundleError extends Error {
  constructor() {
    super('invalid_candidate_source_bundle');
    this.name = 'CandidateSourceBundleError';
    this.code = 'invalid_candidate_source_bundle';
  }
}
const fail = () => {
  throw new CandidateSourceBundleError();
};

// Same sorted-object, ordered-array JSON hashing as signalGenerationSourceHash,
// without depending on the database package. Inspect descriptors before reading.
function canonical(value, depth = 0) {
  if (depth > 30) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') fail();
  if (Array.isArray(value)) {
    if (value.length > 10000 || Reflect.ownKeys(value).length !== value.length + 1) fail();
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail();
      return canonical(descriptor.value, depth + 1);
    });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) fail();
  const result = {};
  for (const key of keys.sort()) {
    if (
      [
        '__proto__',
        'constructor',
        'prototype',
        'api_key',
        'apiKey',
        'encrypted_key',
        'authorization',
      ].includes(key)
    )
      fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    result[key] = canonical(descriptor.value, depth + 1);
  }
  return result;
}
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
function exact(value, keys) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function sourceUrl(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) fail();
  let url;
  try {
    url = new URL(value);
  } catch {
    fail();
  }
  const host = url.hostname.toLowerCase();
  // Declaration only: this contract never fetches a URL or verifies publication rights.
  // Literal IPs and local/reserved names are not accepted as source declarations.
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    value.includes('#') ||
    !host.includes('.') ||
    host.endsWith('.') ||
    isIP(host) ||
    host.includes(':') ||
    !/^[a-z0-9.-]+$/.test(host) ||
    /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|onion)$/.test(host)
  )
    fail();
  return value;
}
function guarded(operation) {
  try {
    return operation();
  } catch {
    fail();
  }
}

/** Build a private, immutable evidence snapshot; no public verification is implied. */
export function buildCandidateSourceBundle(input) {
  return guarded(() => {
    const value = canonical(input);
    exact(value, ['baseMaterialHash', 'source', 'supplements']);
    if (
      !hashPattern.test(value.baseMaterialHash) ||
      typeof value.baseMaterialHash !== 'string' ||
      !Array.isArray(value.supplements) ||
      value.supplements.length > 3
    )
      fail();
    const original = validateGenerationSource(value.source);
    const fragments = [...original.fragments];
    const provenance = original.fragments.map((fragment) => ({
      fragmentId: fragment.id,
      kind: 'original',
      originalFragmentId: fragment.id,
      batchId: null,
      itemId: null,
      fence: null,
      contentHash: null,
      sourceUrl: null,
    }));
    const itemIds = new Set();
    const originalHash = digest(original);
    const hashes = new Set();
    for (const supplement of value.supplements) {
      exact(supplement, supplementKeys);
      if (
        typeof supplement.batchId !== 'string' ||
        !uuidPattern.test(supplement.batchId) ||
        typeof supplement.itemId !== 'string' ||
        !uuidPattern.test(supplement.itemId) ||
        !Number.isSafeInteger(supplement.fence) ||
        supplement.fence < 1 ||
        typeof supplement.contentHash !== 'string' ||
        !hashPattern.test(supplement.contentHash)
      )
        fail();
      const source = validateGenerationSource(supplement.source);
      const declaredUrl = sourceUrl(supplement.sourceUrl);
      if (
        supplement.contentHash !== digest(source) ||
        itemIds.has(supplement.itemId) ||
        hashes.has(supplement.contentHash) ||
        (supplement.contentHash === originalHash && declaredUrl === null)
      )
        fail();
      itemIds.add(supplement.itemId);
      hashes.add(supplement.contentHash);
      // Identical original text may acquire one independently checked URL
      // attribution. It remains private and consumes the same combined budget.
      for (const fragment of source.fragments) {
        const id = `fragment-${fragments.length + 1}`;
        fragments.push({ ...fragment, id });
        provenance.push({
          fragmentId: id,
          kind: 'supplement',
          originalFragmentId: fragment.id,
          batchId: supplement.batchId,
          itemId: supplement.itemId,
          fence: supplement.fence,
          contentHash: supplement.contentHash,
          sourceUrl: declaredUrl,
        });
      }
    }
    const payload = {
      version,
      baseMaterialHash: value.baseMaterialHash,
      source: validateGenerationSource({ classification: 'private', fragments }),
      provenance,
    };
    return { ...payload, sourceBundleHash: digest(payload) };
  });
}

/** Reconstruct every source and verify provenance and hashes; caller still binds baseMaterialHash. */
export function validateCandidateSourceBundle(bundle) {
  return guarded(() => {
    const value = canonical(bundle);
    exact(value, ['version', 'baseMaterialHash', 'sourceBundleHash', 'source', 'provenance']);
    if (
      value.version !== version ||
      typeof value.sourceBundleHash !== 'string' ||
      !hashPattern.test(value.sourceBundleHash) ||
      !Array.isArray(value.provenance)
    )
      fail();
    const combined = validateGenerationSource(value.source);
    if (value.provenance.length !== combined.fragments.length) fail();
    const original = { classification: 'private', fragments: [] };
    const supplements = [];
    for (let index = 0; index < combined.fragments.length; index++) {
      const entry = value.provenance[index];
      exact(entry, provenanceKeys);
      if (entry.fragmentId !== combined.fragments[index].id) fail();
      let target;
      if (entry.kind === 'original') {
        if (
          supplements.length ||
          ['batchId', 'itemId', 'fence', 'contentHash', 'sourceUrl'].some(
            (key) => entry[key] !== null,
          )
        )
          fail();
        target = original;
      } else if (entry.kind === 'supplement') {
        let current = supplements.at(-1);
        if (!current || current.itemId !== entry.itemId) {
          current = {
            batchId: entry.batchId,
            itemId: entry.itemId,
            fence: entry.fence,
            contentHash: entry.contentHash,
            sourceUrl: entry.sourceUrl,
            source: { classification: 'private', fragments: [] },
          };
          supplements.push(current);
          if (supplements.length > 3) fail();
        }
        if (
          ['batchId', 'itemId', 'fence', 'contentHash', 'sourceUrl'].some(
            (key) => current[key] !== entry[key],
          )
        )
          fail();
        target = current.source;
      } else fail();
      const originalId = `fragment-${target.fragments.length + 1}`;
      if (entry.originalFragmentId !== originalId) fail();
      target.fragments.push({ ...combined.fragments[index], id: originalId });
    }
    const rebuilt = buildCandidateSourceBundle({
      baseMaterialHash: value.baseMaterialHash,
      source: original,
      supplements,
    });
    if (rebuilt.sourceBundleHash !== value.sourceBundleHash || digest(rebuilt) !== digest(value))
      fail();
    return rebuilt;
  });
}

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  currentPublicSignalColumns,
  currentPublicSignalViewHashes,
} from '../src/current-publication-catalog.mjs';
import {
  currentPublicSignalViewFixture,
  signalImmutabilityQueryFixture,
} from './signal-immutability-fixtures.mjs';
import {
  canonicalCatalogExpression,
  canonicalCatalogExpressionWithLiterals,
} from '../src/verify.mjs';

describe('database catalog expression canonicalization', () => {
  it('pins the independently captured public view columns and full fail-closed definition', () => {
    const view = currentPublicSignalViewFixture();
    const hash = (definition) => createHash('sha256').update(definition.trim()).digest('hex');
    expect(view.columns).toEqual(currentPublicSignalColumns);
    expect(currentPublicSignalViewHashes.has(hash(view.definition))).toBe(true);
    expect(view.options).toEqual(['security_barrier=true']);
    expect(signalImmutabilityQueryFixture('/* hzense:current-publication:views */').rows).toEqual([
      view,
    ]);
    for (const changed of [
      view.definition.replace('AND hzense_public_signal_is_current(head.event_id)', ''),
      view.definition.replace("head.status = 'published'::text", 'true'),
      view.definition.replace("'name', source.name", "'metadata', source.metadata"),
      view.definition.replace("'name', entity.name", "'private_quote', entity.metadata"),
      view.definition.replace("link.relation = 'supports'::text", 'true'),
    ])
      expect(currentPublicSignalViewHashes.has(hash(changed))).toBe(false);
  });
  it('preserves regex grouping to detect canonical event-key constraint weakening', () => {
    const correct = `CHECK ((event_key COLLATE "C") ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)`;
    const weakened = `CHECK ((event_key COLLATE "C") ~ '^([a-z0-9]+-)([a-z0-9]+)*$'::text)`;
    expect(canonicalCatalogExpressionWithLiterals(correct)).toBe(
      `event_keycollate"C"~'^[a-z0-9]+(-[a-z0-9]+)*$'`,
    );
    expect(canonicalCatalogExpressionWithLiterals(weakened)).not.toBe(
      canonicalCatalogExpressionWithLiterals(correct),
    );
  });

  it('preserves literal whitespace, case, escaped quotes and quoted identifiers', () => {
    expect(canonicalCatalogExpressionWithLiterals(`CHECK (label ~ ' A(B) C''D '::text)`)).toBe(
      `label~' A(B) C''D '`,
    );
    expect(canonicalCatalogExpressionWithLiterals(`CHECK ("Quoted" = 'x'::text)`)).toBe(
      `"Quoted"='x'`,
    );
    expect(
      canonicalCatalogExpressionWithLiterals(`CHECK (key = '__hzense_catalog_token_0__'::text)`),
    ).toBe(`key='__hzense_catalog_token_0__'`);
  });

  it('normalizes PostgreSQL casts and pretty-printing without losing operators', () => {
    expect(
      canonicalCatalogExpression(
        'CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))',
      ),
    ).toBe('confidence>=0andconfidence<=1');
    expect(canonicalCatalogExpression("'watching'::topic_status")).toBe("'watching'");
    expect(
      canonicalCatalogExpression(
        "CHECK ((NOT runtime_enabled) OR (status <> 'archived'::topic_status))",
      ),
    ).toBe("notruntime_enabledorstatus<>'archived'");
    expect(canonicalCatalogExpression('now()')).toBe('now');
    expect(canonicalCatalogExpression('CHECK (("position" >= 0))')).toBe('"position">=0');
  });

  it('keeps semantic weakening visible to exact contract comparison', () => {
    expect(
      canonicalCatalogExpression('CHECK (((confidence >= 0) AND (confidence <= 1)) OR true)'),
    ).toBe('confidence>=0andconfidence<=1ortrue');
    expect(canonicalCatalogExpression("now() + interval '1 day'")).toBe("now+interval'1day'");
    expect(
      canonicalCatalogExpression(
        'CHECK ((confidence::integer >= 0) AND (confidence::integer <= 1))',
      ),
    ).toBe('confidence::integer>=0andconfidence::integer<=1');
  });
});

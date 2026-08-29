import { describe, expect, it } from 'vitest';
import { canonicalCatalogExpression } from '../src/verify.mjs';

describe('database catalog expression canonicalization', () => {
  it('normalizes PostgreSQL casts and pretty-printing without losing operators', () => {
    expect(
      canonicalCatalogExpression(
        'CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))',
      ),
    ).toBe('confidence>=0andconfidence<=1');
    expect(canonicalCatalogExpression("'watching'::topic_status")).toBe("'watching'");
    expect(canonicalCatalogExpression('now()')).toBe('now');
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

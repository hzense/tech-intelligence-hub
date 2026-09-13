import { describe, expect, it } from 'vitest';
import {
  affiliationCatalogSchema,
  affiliationDateSchema,
  affiliationEvidenceSchema,
  affiliationPeriodSchema,
  assessAffiliationEvidence,
  classifyAffiliationPeriod,
  parseAffiliationCatalog,
  personOrganizationAffiliationSchema,
  type AffiliationCatalog,
} from '../src/affiliations.js';

function catalog(): AffiliationCatalog {
  return {
    entities: [
      { id: 'person-a', type: 'person' },
      { id: 'person-b', type: 'person' },
      { id: 'company-a', type: 'company' },
      { id: 'institution-a', type: 'institution' },
    ],
    relations: [
      {
        id: 'relation-a',
        source_id: 'person-a',
        target_id: 'company-a',
        relation_type: 'works_at',
        valid_from: '2020-01-01',
        valid_to: '2022-06-30',
      },
    ],
    affiliations: [
      {
        relation_id: 'relation-a',
        person_id: 'person-a',
        organization_id: 'company-a',
        relation_type: 'works_at',
        role_title: ' Researcher ',
        date_basis: ' Original employment announcement; dates reviewed separately.\n',
        verification_status: 'verified',
      },
    ],
    public_source_evidence: [
      { id: 'evidence-a', verification_status: 'verified' },
      { id: 'evidence-b', verification_status: 'verified' },
    ],
    affiliation_evidence: [
      {
        relation_id: 'relation-a',
        evidence_id: 'evidence-a',
        claim: ' The source names this person as a researcher.\n',
        relation: 'supports',
        verification_status: 'verified',
      },
    ],
  };
}

describe('strict affiliation catalog', () => {
  it('retains literal text, stable identifiers and date ownership without defaults or mutation', () => {
    const input = catalog();
    const before = structuredClone(input);
    const parsed = parseAffiliationCatalog(input);
    expect(parsed).toEqual(before);
    expect(input).toEqual(before);
    expect(parsed).not.toBe(input);
    expect(parsed.affiliations[0]!).not.toHaveProperty('valid_from');
    expect(parsed.affiliations[0]!).not.toHaveProperty('published');
    expect(parsed.affiliations[0]!).not.toHaveProperty('current_employer');
    parsed.affiliations[0]!.role_title = 'changed only in returned catalog';
    expect(input).toEqual(before);
  });

  it('allows pending affiliations without evidence for later review', () => {
    const input = catalog();
    input.affiliations[0]!.verification_status = 'pending';
    input.affiliation_evidence = [];
    input.public_source_evidence = [];
    expect(parseAffiliationCatalog(input)).toEqual(input);
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('pending');
  });

  it('allows institutions, overlapping roles, rehire and distinct people without identity inference', () => {
    const input = catalog();
    // person-a and person-b could share a display name; only the supplied IDs identify them.
    for (const [id, person, organization, type, from, to] of [
      ['relation-b', 'person-a', 'institution-a', 'leads', '2022-07-01', null],
      ['relation-c', 'person-a', 'company-a', 'advises', '2021-01-01', '2023-01-01'],
      ['relation-d', 'person-a', 'company-a', 'works_at', '2024-01-01', null],
      ['relation-e', 'person-b', 'company-a', 'works_at', null, null],
    ] as const) {
      input.relations.push({
        id,
        source_id: person,
        target_id: organization,
        relation_type: type,
        valid_from: from,
        valid_to: to,
      });
      input.affiliations.push({
        ...input.affiliations[0]!,
        relation_id: id,
        person_id: person,
        organization_id: organization,
        relation_type: type,
        role_title: 'Role title explicitly supplied by the editor',
        verification_status: 'pending',
      });
    }
    input.affiliation_evidence.push({
      ...input.affiliation_evidence[0]!,
      evidence_id: 'evidence-b',
    });
    expect(parseAffiliationCatalog(input)).toEqual(input);
    expect(() => classifyAffiliationPeriod(input.relations[0]!, '2026-09-13')).toThrow();
    // Project dates explicitly: strict period parsing never drops other relation fields.
    expect(
      classifyAffiliationPeriod(
        { valid_from: input.relations[0]!.valid_from, valid_to: input.relations[0]!.valid_to },
        '2026-09-13',
      ),
    ).toBe('outside');
    expect(
      classifyAffiliationPeriod({ valid_from: '2022-07-01', valid_to: null }, '2026-09-13'),
    ).toBe('unknown');
    expect(input.entities).toHaveLength(4);
    expect(input.affiliations.map((row) => row.person_id)).toContain('person-b');
  });

  it.each(['founded', 'invests_in'])('does not invent an affiliation from %s', (relationType) => {
    const input = catalog();
    input.relations[0]!.relation_type = relationType;
    input.affiliations = [];
    input.affiliation_evidence = [];
    expect(parseAffiliationCatalog(input).affiliations).toEqual([]);
    expect(() => assessAffiliationEvidence(input, 'relation-a')).toThrow('Unknown affiliation');
    expect(
      personOrganizationAffiliationSchema.safeParse({
        ...catalog().affiliations[0]!,
        relation_type: relationType,
      }).success,
    ).toBe(false);
  });

  it.each([
    'entities',
    'relations',
    'affiliations',
    'public_source_evidence',
    'affiliation_evidence',
  ] as const)('rejects duplicate identifiers or edges in %s', (field) => {
    const input = catalog();
    const values: unknown[] = input[field];
    values.push(structuredClone(values[0]!));
    expect(affiliationCatalogSchema.safeParse(input).success).toBe(false);
  });

  it('rejects contradictory duplicate edge keys instead of selecting the last claim', () => {
    const input = catalog();
    input.affiliation_evidence.push({ ...input.affiliation_evidence[0]!, relation: 'contradicts' });
    expect(() => parseAffiliationCatalog(input)).toThrow('Duplicate identifier');
  });

  it.each([
    'entities',
    'relations',
    'affiliations',
    'public_source_evidence',
    'affiliation_evidence',
  ] as const)('rejects unknown fields on %s projections', (field) => {
    const input = catalog();
    Object.assign(input[field][0]!, { unknown_field: 'must not silently disappear' });
    expect(affiliationCatalogSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing collections and unknown root fields', () => {
    expect(affiliationCatalogSchema.safeParse({ ...catalog(), auto_publish: true }).success).toBe(
      false,
    );
    expect(affiliationCatalogSchema.safeParse({}).success).toBe(false);
  });

  it.each<[string, (value: AffiliationCatalog) => unknown]>([
    [
      'unknown relation source',
      (value: AffiliationCatalog) => (value.relations[0]!.source_id = 'missing'),
    ],
    [
      'unknown relation target',
      (value: AffiliationCatalog) => (value.relations[0]!.target_id = 'missing'),
    ],
    [
      'unknown affiliation relation',
      (value: AffiliationCatalog) => (value.affiliations[0]!.relation_id = 'missing'),
    ],
    [
      'unknown person',
      (value: AffiliationCatalog) => (value.affiliations[0]!.person_id = 'missing'),
    ],
    [
      'unknown organization',
      (value: AffiliationCatalog) => (value.affiliations[0]!.organization_id = 'missing'),
    ],
    [
      'company impersonates person',
      (value: AffiliationCatalog) => (value.entities[0]!.type = 'company'),
    ],
    [
      'person impersonates company',
      (value: AffiliationCatalog) => (value.entities[2]!.type = 'person'),
    ],
    ['non-organization entity', (value: AffiliationCatalog) => (value.entities[2]!.type = 'model')],
    [
      'wrong person identity',
      (value: AffiliationCatalog) => (value.affiliations[0]!.person_id = 'person-b'),
    ],
    [
      'wrong organization identity',
      (value: AffiliationCatalog) => (value.affiliations[0]!.organization_id = 'institution-a'),
    ],
    [
      'wrong relation type',
      (value: AffiliationCatalog) => (value.affiliations[0]!.relation_type = 'leads'),
    ],
    [
      'reversed edge',
      (value: AffiliationCatalog) => {
        value.relations[0]!.source_id = 'company-a';
        value.relations[0]!.target_id = 'person-a';
      },
    ],
    [
      'unknown link affiliation',
      (value: AffiliationCatalog) => (value.affiliation_evidence[0]!.relation_id = 'missing'),
    ],
    [
      'unknown link source evidence',
      (value: AffiliationCatalog) => (value.affiliation_evidence[0]!.evidence_id = 'missing'),
    ],
  ])('rejects %s', (_label, mutate) => {
    const input = catalog();
    mutate(input);
    expect(affiliationCatalogSchema.safeParse(input).success).toBe(false);
  });

  it.each(['', ' ', '\t\n'])(
    'rejects blank required text %j without trimming valid text',
    (text) => {
      for (const field of [
        'relation_id',
        'person_id',
        'organization_id',
        'role_title',
        'date_basis',
      ]) {
        expect(
          personOrganizationAffiliationSchema.safeParse({
            ...catalog().affiliations[0]!,
            [field]: text,
          }).success,
        ).toBe(false);
      }
      expect(
        affiliationEvidenceSchema.safeParse({ ...catalog().affiliation_evidence[0]!, claim: text })
          .success,
      ).toBe(false);
    },
  );

  it('rejects timestamps and date duplication in affiliation rows', () => {
    const input = catalog();
    input.relations[0]!.valid_from = '2020-01-01T00:00:00Z';
    expect(affiliationCatalogSchema.safeParse(input).success).toBe(false);
    expect(
      personOrganizationAffiliationSchema.safeParse({
        ...catalog().affiliations[0]!,
        valid_from: '2020-01-01',
      }).success,
    ).toBe(false);
  });
});

describe('affiliation calendar periods', () => {
  it.each(['0001-01-01', '9999-12-31', '2000-02-29', '2024-02-29', '1900-02-28'])(
    'accepts valid calendar date %s',
    (date) => expect(affiliationDateSchema.parse(date)).toBe(date),
  );

  it.each([
    '0000-01-01',
    '10000-01-01',
    '-0001-01-01',
    '2023-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-01-32',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
    '2026-01-01+02:00',
    ' 2026-01-01',
    '2026-01-01\n',
    'infinity',
    '',
  ])('rejects invalid or non-calendar date %j', (date) => {
    expect(affiliationDateSchema.safeParse(date).success).toBe(false);
  });

  it.each([
    ['2024-02-29', '2024-03-01', '2024-02-28', 'outside'],
    ['2024-02-29', '2024-03-01', '2024-02-29', 'within'],
    ['2024-02-29', '2024-03-01', '2024-03-01', 'within'],
    ['2024-02-29', '2024-03-01', '2024-03-02', 'outside'],
    ['2024-02-29', '2024-02-29', '2024-02-29', 'within'],
    ['2020-01-01', '2022-12-31', '2021-08-01', 'within'],
    ['2024-02-29', null, '2024-02-28', 'outside'],
    ['2024-02-29', null, '2024-02-29', 'within'],
    ['2024-02-29', null, '2024-03-01', 'unknown'],
    [null, '2024-02-29', '2024-02-28', 'unknown'],
    [null, '2024-02-29', '2024-02-29', 'within'],
    [null, '2024-02-29', '2024-03-01', 'outside'],
    [null, null, '2024-02-29', 'unknown'],
    ['0001-01-01', '9999-12-31', '2026-09-13', 'within'],
  ] as const)('classifies [%s, %s] on %s as %s', (from, to, date, result) => {
    expect(classifyAffiliationPeriod({ valid_from: from, valid_to: to }, date)).toBe(result);
  });

  it('requires an explicit date and rejects reversed or malformed intervals', () => {
    const reversed = { valid_from: '2026-01-02', valid_to: '2026-01-01' };
    expect(affiliationPeriodSchema.safeParse(reversed).success).toBe(false);
    expect(() => classifyAffiliationPeriod(reversed, '2026-01-01')).toThrow();
    expect(() => classifyAffiliationPeriod({ valid_from: null, valid_to: null }, '')).toThrow();
    expect(() =>
      classifyAffiliationPeriod({ valid_from: null, valid_to: null }, '2026-01-01T00:00:00Z'),
    ).toThrow();
    const input = catalog();
    Object.assign(input.relations[0]!, reversed);
    expect(() => parseAffiliationCatalog(input)).toThrow('valid_to precedes valid_from');
  });
});

describe('conservative affiliation evidence assessment', () => {
  it('supports only recorded verified affiliation, supporting edge and source evidence', () => {
    expect(assessAffiliationEvidence(catalog(), 'relation-a')).toBe('supported');
  });

  it.each(['pending', 'rejected'] as const)('a %s support edge cannot support', (status) => {
    const input = catalog();
    input.affiliation_evidence[0]!.verification_status = status;
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('pending');
  });

  it.each(['pending', 'rejected'] as const)('a %s source record cannot support', (status) => {
    const input = catalog();
    input.public_source_evidence[0]!.verification_status = status;
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('pending');
  });

  it('does not promote pending affiliation or context-only evidence', () => {
    const input = catalog();
    input.affiliations[0]!.verification_status = 'pending';
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('pending');
    input.affiliations[0]!.verification_status = 'verified';
    input.affiliation_evidence[0]!.relation = 'context';
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('pending');
    input.affiliation_evidence = [];
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('pending');
  });

  it.each([
    ['pending', 'pending'],
    ['pending', 'verified'],
    ['verified', 'pending'],
    ['verified', 'verified'],
  ] as const)(
    'unresolved contradiction (%s edge, %s source) blocks verified support',
    (edge, source) => {
      const input = catalog();
      input.public_source_evidence[1]!.verification_status = source;
      input.affiliation_evidence.push({
        ...input.affiliation_evidence[0]!,
        evidence_id: 'evidence-b',
        relation: 'contradicts',
        verification_status: edge,
      });
      expect(assessAffiliationEvidence(input, 'relation-a')).toBe('conflicted');
      input.affiliations[0]!.verification_status = 'pending';
      expect(assessAffiliationEvidence(input, 'relation-a')).toBe('conflicted');
      input.affiliations[0]!.verification_status = 'rejected';
      expect(assessAffiliationEvidence(input, 'relation-a')).toBe('rejected');
    },
  );

  it.each(['edge', 'source'] as const)(
    'an explicitly rejected contradiction %s does not block',
    (target) => {
      const input = catalog();
      input.affiliation_evidence.push({
        ...input.affiliation_evidence[0]!,
        evidence_id: 'evidence-b',
        relation: 'contradicts',
        verification_status: target === 'edge' ? 'rejected' : 'verified',
      });
      if (target === 'source') input.public_source_evidence[1]!.verification_status = 'rejected';
      expect(assessAffiliationEvidence(input, 'relation-a')).toBe('supported');
    },
  );

  it('does not borrow supporting evidence from another affiliation', () => {
    const input = catalog();
    input.relations.push({ ...input.relations[0]!, id: 'relation-b' });
    input.affiliations.push({ ...input.affiliations[0]!, relation_id: 'relation-b' });
    expect(assessAffiliationEvidence(input, 'relation-b')).toBe('pending');
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('supported');
  });

  it('rechecks catalog integrity, leaves inputs unchanged and does not treat time as evidence', () => {
    const input = catalog();
    const before = structuredClone(input);
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('supported');
    expect(input).toEqual(before);
    expect(() => assessAffiliationEvidence(input, 'missing')).toThrow('Unknown affiliation');
    input.affiliation_evidence = [];
    expect(
      classifyAffiliationPeriod({ valid_from: '2020-01-01', valid_to: '2022-06-30' }, '2021-01-01'),
    ).toBe('within');
    expect(assessAffiliationEvidence(input, 'relation-a')).toBe('pending');
    input.affiliations[0]!.person_id = 'company-a';
    expect(() => assessAffiliationEvidence(input, 'relation-a')).toThrow();
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supportsOrganizationType,
  mentionsOrganization,
} from '../lib/organization-type-evidence.ts';

for (const [name, type, quote] of [
  ['Morgan Stanley', 'company', 'Morgan Stanley is a leading global financial services firm.'],
  ['Evercore', 'company', 'Evercore, a leading independent investment bank.'],
  ['OpenAI', 'company', 'OpenAI is an artificial intelligence company.'],
  ['Lab', 'institution', 'Lab is an independent research institute.'],
  ['大学甲', 'institution', '大学甲是一所公立大学。'],
  ['公司甲', 'company', '公司甲是一家全球领先的金融服务公司。'],
  ['Company Inc.', 'company', 'Company Inc. operates as a financial services company.'],
])
  test(`explicit natural organization relation: ${quote}`, () =>
    assert.equal(supportsOrganizationType(quote, name, type), true));

for (const quote of [
  'OtherLab is a company.',
  'Lab works with another company.',
  'Lab works with Foo. Foo is a company.',
  'Lab is not a company.',
  'Lab is a university.',
  'Lab might be a company.',
  'If Lab is a company, check its status.',
  'Lab was formerly a company.',
  'Lab is a client of a leading financial services firm.',
  'Lab is a research partner of the company.',
  'Assuming Lab is a company',
  'Suppose Lab is a company',
  'The claim that Lab is a company was denied',
  '假设 Lab 是公司',
  'Lab 是公司这一说法被否认。',
  'Lab is a company would be an incorrect assumption.',
  'Lab is a company?',
  'Lab 是公司吗？',
  'Someone says Lab is a company.',
  'Suppose:\nLab is a company.',
  'Lab is a company was rejected as an assertion.',
  'Lab is a company, but that claim was rejected.',
  'Lab is a company, although this is merely hypothetical.',
  'Lab is a company, according to an unconfirmed rumor.',
  'Lab, a company, but only hypothetically.',
  'Lab is a company. That claim was rejected.',
])
  test(`does not infer company type: ${quote}`, () =>
    assert.equal(supportsOrganizationType(quote, 'Lab', 'company'), false));

test('manual source name matching supports Chinese context without Latin substrings', () => {
  assert.equal(mentionsOrganization('OpenAI是一家公司。', 'OpenAI'), true);
  assert.equal(mentionsOrganization('该公司甲是一家公司。', '公司甲'), true);
  assert.equal(mentionsOrganization('OtherLab is here.', 'Lab'), false);
});

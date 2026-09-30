import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExcludedPublicPerson,
  PERSON_RESOURCE_POLICY_TEXT,
} from '@hzense/ingestion/person-resource-policy';

test('known national leader identities are excluded in stable-ID and name-only records', () => {
  for (const id of [
    'person-xi-jinping',
    'person-li-qiang',
    'person-donald-trump',
    'person-anthony-albanese',
  ])
    assert.equal(isExcludedPublicPerson({ id, name: 'Historical display name' }), true, id);
  for (const name of [
    '习近平',
    '習近平',
    'Ｘｉ Ｊｉｎｐｉｎｇ',
    '李强',
    'Li Qiang',
    '特朗普',
    '唐納德·川普',
    'DONALD J. TRUMP',
    'Donald John Trump',
    'Anthony Albanese',
    '安东尼·阿尔巴尼斯',
    '阿爾巴尼斯',
    'President Donald Trump',
    'Donald Trump (US President)',
    'Donald Trump，美国总统',
    '美国总统特朗普',
    '国家主席习近平',
    '李强（国务院总理）',
    'Anthony Albanese, Prime Minister of Australia',
    '习近平（会议主持者）',
    'Donald J. Trump (speaker)',
    '李强 / 国务院',
  ]) {
    assert.equal(isExcludedPublicPerson(name), true, name);
    assert.equal(isExcludedPublicPerson({ name }), true, name);
  }
});

test('explicit national head roles exclude a new identity without inferring from organization', () => {
  for (const role of [
    '国家元首',
    '政府首脑',
    '国家主席',
    '国务院总理',
    '美国总统',
    '澳大利亚总理',
    '日本首相',
    'Head of State',
    'Head of Government',
    'Prime Minister of Australia',
    'President of the United States',
    'French President',
    '总统',
    '总理',
    '首相',
    '印度尼西亚总统',
    'President of Indonesia',
    'Indonesian President',
    '英国国王',
    'King of the United Kingdom',
    '日本天皇',
  ]) {
    assert.equal(isExcludedPublicPerson({ name: 'Example Name', role }), true, role);
    assert.equal(isExcludedPublicPerson({ name: 'Example Name', event_role: role }), true, role);
  }
  assert.equal(isExcludedPublicPerson('Example Name（美国总统）'), true);
});

test('ministers, lawmakers, regional heads, corporate presidents and advisers remain eligible', () => {
  for (const person of [
    { id: 'person-scott-bessent', name: 'Scott Bessent', role: '美国财政部长' },
    { id: 'person-ted-lieu', name: 'Ted Lieu', role: '美国国会议员' },
    { id: 'person-michael-kratsios', name: 'Michael Kratsios', role: '美国总统科技顾问' },
    { id: 'person-revanth-reddy', name: 'Revanth Reddy', role: 'Chief Minister of Telangana' },
    { name: 'Example', role: '总统顾问' },
    { name: 'Example', role: 'Advisor to the President of the United States' },
    { name: 'Example', role: 'Prime Minister adviser' },
    { name: 'Example', role: 'Deputy Prime Minister' },
    { name: 'Example', role: '美国副总统' },
    { name: 'Example', role: '联邦部长' },
    { name: 'Example', role: 'Company President' },
    { name: 'Example', role: 'President of Microsoft' },
    { name: 'Example', role: 'University President' },
    { name: 'Example', role: '主席' },
    { name: 'Example', role: 'CEO' },
    { name: 'Example', role: '研究作者' },
    { name: 'Donald Trumpet', role: 'researcher' },
    { name: 'Donald Trumpet (speaker)', role: 'researcher' },
    { name: 'Donald Trump announced a policy', role: 'reporter' },
    { name: 'Example', role: '采访国家主席的记者' },
    { name: 'Example', organization: '国务院' },
    { name: 'Example', role: 'President of France Telecom' },
    { name: 'Example', role: 'CEO与美国总统会谈' },
    { name: 'Example', role: '公司总裁' },
  ])
    assert.equal(isExcludedPublicPerson(person), false, JSON.stringify(person));
  for (const value of [null, undefined, 12, {}, []])
    assert.equal(isExcludedPublicPerson(value), false);
  assert.match(PERSON_RESOURCE_POLICY_TEXT, /国家元首或政府首脑/);
  assert.match(PERSON_RESOURCE_POLICY_TEXT, /保留信号事实、来源和相关组织/);
});

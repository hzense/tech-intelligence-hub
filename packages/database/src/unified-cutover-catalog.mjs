import { canonicalPublicationControlCheck as canonical } from './signal-publication-control-catalog.mjs';
export const unifiedCutoverColumns = {
  unified_signal_cutover: {
    singleton: ['boolean', true],
    ready: ['boolean', true],
    plan_hash: ['text', false],
  },
};
export const unifiedCutoverChecks = {
  unified_signal_cutover: [
    [canonical('CHECK (singleton)')],
    [
      canonical(
        'CHECK (((((NOT ready) AND (plan_hash IS NULL)) OR (ready AND ((plan_hash COLLATE "C") ~ \'^[a-f0-9]{64}$\'::text))) IS TRUE))',
      ),
    ],
  ],
};
export const unifiedCutoverFunctionHashes = {
  hzense_write_unified_editorial:
    'd4e579356bc049c84d762b29e0d312026b1ec061971c76aecf133a4cdf4df3f4',
  hzense_require_unified_editorial:
    '3de02de840b3b1557caf53214a4d5516aa1c99022da570309a06037cb10ffb55',
};
export const unifiedCutoverRoutines = {
  hzense_unified_canonical: {
    arguments: 'value jsonb',
    result: 'text',
    language: 'sql',
    definer: false,
    strict: true,
    volatility: 'i',
    grantees: [],
    hash: '8c3a511a1d4c7ed9851e2fd5c4aea460613f9d6632cc297c3e959607f5d99722',
  },
};
export const unifiedCutoverTriggers = [
  {
    table_name: 'editorial_signal_revisions',
    name: 'editorial_unified_write_trg',
    trigger_type: 5,
    routine_name: 'hzense_write_unified_editorial',
  },
  {
    table_name: 'editorial_signal_revisions',
    name: 'editorial_unified_required_trg',
    trigger_type: 5,
    routine_name: 'hzense_require_unified_editorial',
    constraint_trigger: true,
    deferrable: true,
    initially_deferred: true,
  },
];
export const unifiedCutoverViews = {
  unified_public_signals: {
    columns: [
      ['signal_id', 'text'],
      ['version', 'integer'],
      ['origin', 'text'],
      ['publication_basis', 'text'],
      ['content', 'jsonb'],
      ['recorded_at', 'timestamp with time zone'],
    ],
    hashes: new Set(['5f37773c769611acc619e2e41c4d64c51b552fbdd26951cc131a192cd7684905']),
  },
  unified_public_status: {
    columns: [['ready', 'boolean']],
    hashes: new Set(['cee6b9226eac1704daa2a9ea7cc3fdef0e2d5f142d214951698773bbcb16b979']),
  },
};

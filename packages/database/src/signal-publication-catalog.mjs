// Independent migration 0008 contract. This private storage is not a production
// publication authorization or eligibility gate. Never infer expectations from DDL.
export const signalPublicationColumns = {
  signal_publication_outbox: {
    event_id: ['uuid', true],
    request_key: ['text', true],
    request_fingerprint: ['text', true],
    signal_id: ['text', true],
    expected_revision: ['integer', true],
    publication_revision: ['integer', true],
    content_version: ['integer', true],
    status: ['text', true],
    reason_code: ['text', true],
    occurred_at: ['timestamp with time zone', true],
  },
  signal_publication_state: {
    signal_id: ['text', true],
    publication_revision: ['integer', true],
    content_version: ['integer', true],
    status: ['text', true],
    event_id: ['uuid', true],
    occurred_at: ['timestamp with time zone', true],
  },
};
export const signalPublicationPrimaryKeys = [
  'signal_publication_outbox|event_id',
  'signal_publication_state|signal_id',
];
export const signalPublicationForeignKeys = [
  'signal_publication_outbox|signal_id,content_version|signal_versions|signal_id,version|a|a|false',
  'signal_publication_outbox|signal_id|signal_event_identities|signal_id|a|a|false',
  'signal_publication_state|signal_id,publication_revision,content_version,status,event_id,occurred_at|signal_publication_outbox|signal_id,publication_revision,content_version,status,event_id,occurred_at|a|a|false',
];
const statusCheck = ["status=anyarray['published','withdrawn']", "statusin'published','withdrawn'"];
const timestampChecks = [
  ['isfiniteoccurred_at'],
  [
    "extractyearfromoccurred_atattimezone'UTC'>=1andextractyearfromoccurred_atattimezone'UTC'<=9999",
    "extractyearfromoccurred_atattimezone'UTC'between1and9999",
  ],
  ["date_trunc'milliseconds',occurred_at=occurred_at"],
];
export const signalPublicationChecks = {
  signal_publication_outbox: [
    ['request_keycollate"C"~\'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$\''],
    ['lengthrequest_key>=1andlengthrequest_key<=200', 'lengthrequest_keybetween1and200'],
    ['request_fingerprintcollate"C"~\'^[a-f0-9]{64}$\''],
    ["signal_id~'[^[:space:]]'"],
    ['expected_revision>=0'],
    ['publication_revision>0'],
    ['publication_revision::bigint=expected_revision::bigint+1'],
    ['content_version>0'],
    statusCheck,
    [
      "status||':'||reason_code=anyarray['published:initial_publication','published:content_correction','published:republication','withdrawn:factual_error','withdrawn:privacy','withdrawn:evidence_revoked','withdrawn:operator_request']",
      "status||':'||reason_codein'published:initial_publication','published:content_correction','published:republication','withdrawn:factual_error','withdrawn:privacy','withdrawn:evidence_revoked','withdrawn:operator_request'",
    ],
    ...timestampChecks,
  ],
  signal_publication_state: [
    ["signal_id~'[^[:space:]]'"],
    ['publication_revision>0'],
    ['content_version>0'],
    statusCheck,
    ...timestampChecks,
  ],
};
export const signalPublicationUniqueIndexes = [
  'signal_publication_outbox|request_key',
  'signal_publication_outbox|signal_id,publication_revision',
  'signal_publication_outbox|signal_id,publication_revision,content_version,status,event_id,occurred_at',
];
export const signalPublicationFunctionHashes = Object.freeze({
  hzense_guard_publication_receipt:
    '6d5e4c135f14bbc64cba0c6b5e4d5abe03cf675ab9ed7e648023e1c98b313898',
  hzense_check_publication_pair: '1a3b3009c8e53dc564ede76a4eb0151e35fc1604a7ed68891dfca9c45fd6eaaa',
});
export const signalPublicationTriggers = Object.freeze(
  [
    {
      table_name: 'signal_publication_outbox',
      name: 'signal_publication_outbox_append_only_trg',
      trigger_type: 27,
      routine_name: 'hzense_guard_publication_receipt',
    },
    {
      table_name: 'signal_publication_outbox',
      name: 'signal_publication_outbox_no_truncate_trg',
      trigger_type: 34,
      routine_name: 'hzense_guard_publication_receipt',
    },
    {
      table_name: 'signal_publication_state',
      name: 'signal_publication_state_no_truncate_trg',
      trigger_type: 34,
      routine_name: 'hzense_guard_publication_receipt',
    },
    {
      table_name: 'signal_publication_outbox',
      name: 'signal_publication_outbox_pair_trg',
      trigger_type: 5,
      routine_name: 'hzense_check_publication_pair',
      constraint_trigger: true,
      deferrable: true,
      initially_deferred: true,
    },
    {
      table_name: 'signal_publication_state',
      name: 'signal_publication_state_pair_trg',
      trigger_type: 29,
      routine_name: 'hzense_check_publication_pair',
      constraint_trigger: true,
      deferrable: true,
      initially_deferred: true,
    },
  ].map(Object.freeze),
);

// Exact, independent catalog contract for migration 0006. This does not infer
// correctness or publication eligibility from the currently installed schema.
export const eventIdentityColumns = {
  signal_event_identities: {
    signal_id: ['text', true],
    event_key: ['text', true],
    basis_version: ['integer', true],
    basis_evidence_id: ['text', true],
    identity_basis: ['text', true],
  },
};

export const eventIdentityPrimaryKeys = ['signal_event_identities|signal_id'];
export const eventIdentityForeignKeys = [
  'signal_event_identities|signal_id,basis_version,basis_evidence_id|signal_version_evidence|signal_id,version,evidence_id|a|a|false',
];
export const eventIdentityChecks = {
  signal_event_identities: [
    ["signal_id~'[^[:space:]]'"],
    ['event_keycollate"C"~\'^[a-z0-9]+(-[a-z0-9]+)*$\''],
    ['lengthevent_key>=1andlengthevent_key<=200', 'lengthevent_keybetween1and200'],
    ['basis_version>0'],
    ["basis_evidence_id~'[^[:space:]]'"],
    ["identity_basis~'[^[:space:]]'"],
  ],
};
export const eventIdentityUniqueIndexes = ['signal_event_identities|event_key'];

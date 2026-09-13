-- Private canonical event identity reservation; no automatic legacy backfill.
-- Evidence must already be attached to the exact Signal/version being used.
-- This is not publication eligibility or database-enforced immutability.

CREATE TABLE signal_event_identities (
  signal_id text PRIMARY KEY,
  event_key text NOT NULL,
  basis_version integer NOT NULL,
  basis_evidence_id text NOT NULL,
  identity_basis text NOT NULL,
  CONSTRAINT signal_event_identities_evidence_fk
    FOREIGN KEY (signal_id, basis_version, basis_evidence_id)
    REFERENCES signal_version_evidence(signal_id, version, evidence_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_event_identities_signal_id_ck CHECK (signal_id ~ '[^[:space:]]'),
  CONSTRAINT signal_event_identities_event_key_ck
    CHECK (event_key COLLATE "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT signal_event_identities_event_key_length_ck CHECK (length(event_key) BETWEEN 1 AND 200),
  CONSTRAINT signal_event_identities_basis_version_ck CHECK (basis_version > 0),
  CONSTRAINT signal_event_identities_basis_evidence_id_ck CHECK (basis_evidence_id ~ '[^[:space:]]'),
  CONSTRAINT signal_event_identities_identity_basis_ck CHECK (identity_basis ~ '[^[:space:]]')
);
CREATE UNIQUE INDEX signal_event_identities_event_key_uq ON signal_event_identities(event_key);

-- V2-1b adds private, evidence-backed person-to-organization affiliations.
-- relations remains the sole owner of identity and nullable date bounds.
-- Bounds are inclusive; NULL means unknown, never unbounded/current employment.
-- Existing invalid dates abort this migration. No historical data is repaired.

ALTER TABLE relations
  ADD CONSTRAINT relations_valid_from_ck CHECK (
    valid_from IS NULL OR (isfinite(valid_from) AND valid_from >= DATE '0001-01-01' AND valid_from <= DATE '9999-12-31')
  ),
  ADD CONSTRAINT relations_valid_to_ck CHECK (
    valid_to IS NULL OR (isfinite(valid_to) AND valid_to >= DATE '0001-01-01' AND valid_to <= DATE '9999-12-31')
  ),
  ADD CONSTRAINT relations_valid_interval_ck CHECK (
    valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to
  );
CREATE UNIQUE INDEX relations_identity_uq ON relations(id, source_id, target_id, relation_type);

CREATE TABLE person_organization_affiliations (
  relation_id text PRIMARY KEY,
  person_id text NOT NULL,
  organization_id text NOT NULL,
  relation_type text NOT NULL,
  role_title text NOT NULL,
  date_basis text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending',
  CONSTRAINT person_organization_affiliations_identity_fk
    FOREIGN KEY (relation_id, person_id, organization_id, relation_type)
    REFERENCES relations(id, source_id, target_id, relation_type) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT person_organization_affiliations_person_fk FOREIGN KEY (person_id)
    REFERENCES person_profiles(entity_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT person_organization_affiliations_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organization_profiles(entity_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT person_organization_affiliations_relation_type_ck
    CHECK (relation_type IN ('works_at', 'leads', 'advises')),
  CONSTRAINT person_organization_affiliations_role_title_ck CHECK (role_title ~ '[^[:space:]]'),
  CONSTRAINT person_organization_affiliations_date_basis_ck CHECK (date_basis ~ '[^[:space:]]'),
  CONSTRAINT person_organization_affiliations_verification_status_ck
    CHECK (verification_status IN ('pending', 'verified', 'rejected'))
);
CREATE INDEX person_organization_affiliations_person_idx ON person_organization_affiliations(person_id);
CREATE INDEX person_organization_affiliations_organization_idx ON person_organization_affiliations(organization_id);

CREATE TABLE affiliation_evidence (
  relation_id text NOT NULL,
  evidence_id text NOT NULL,
  claim text NOT NULL,
  relation text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending',
  CONSTRAINT affiliation_evidence_pkey PRIMARY KEY (relation_id, evidence_id),
  CONSTRAINT affiliation_evidence_affiliation_fk FOREIGN KEY (relation_id)
    REFERENCES person_organization_affiliations(relation_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT affiliation_evidence_evidence_fk FOREIGN KEY (evidence_id)
    REFERENCES public_source_evidence(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT affiliation_evidence_claim_ck CHECK (claim ~ '[^[:space:]]'),
  CONSTRAINT affiliation_evidence_relation_ck CHECK (relation IN ('supports', 'contradicts', 'context')),
  CONSTRAINT affiliation_evidence_verification_status_ck
    CHECK (verification_status IN ('pending', 'verified', 'rejected'))
);
CREATE INDEX affiliation_evidence_evidence_idx ON affiliation_evidence(evidence_id);

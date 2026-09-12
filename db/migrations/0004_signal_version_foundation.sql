-- V2-1a adds private Signal 3.0.0 snapshots and evidence relationships.
-- Publication eligibility, publication transactions and database-enforced
-- snapshot immutability are NOT implemented by this foundation migration.
-- No privileges are granted: "public" describes evidence sources, not access.

CREATE UNIQUE INDEX entities_id_type_uq ON entities(id, type);

CREATE TABLE person_profiles (
  entity_id text PRIMARY KEY,
  entity_type entity_type NOT NULL DEFAULT 'person',
  CONSTRAINT person_profiles_entity_type_ck CHECK (entity_type = 'person'),
  CONSTRAINT person_profiles_entity_fk FOREIGN KEY (entity_id, entity_type)
    REFERENCES entities(id, type) ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE organization_profiles (
  entity_id text PRIMARY KEY,
  entity_type entity_type NOT NULL,
  CONSTRAINT organization_profiles_entity_type_ck
    CHECK (entity_type IN ('company', 'institution')),
  CONSTRAINT organization_profiles_entity_fk FOREIGN KEY (entity_id, entity_type)
    REFERENCES entities(id, type) ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE public_source_evidence (
  id text PRIMARY KEY,
  source_id text NOT NULL,
  source_url text NOT NULL,
  locator text NOT NULL,
  excerpt text NOT NULL,
  content_hash text NOT NULL,
  captured_at timestamptz NOT NULL,
  source_published_at timestamptz,
  verification_status text NOT NULL DEFAULT 'pending',
  CONSTRAINT public_source_evidence_source_fk FOREIGN KEY (source_id)
    REFERENCES sources(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT public_source_evidence_id_ck CHECK (id ~ '[^[:space:]]'),
  CONSTRAINT public_source_evidence_source_url_ck
    CHECK (source_url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT public_source_evidence_locator_ck CHECK (locator ~ '[^[:space:]]'),
  CONSTRAINT public_source_evidence_excerpt_ck CHECK (excerpt ~ '[^[:space:]]'),
  CONSTRAINT public_source_evidence_content_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT public_source_evidence_captured_at_ck CHECK (isfinite(captured_at)),
  CONSTRAINT public_source_evidence_source_published_at_ck
    CHECK (source_published_at IS NULL OR isfinite(source_published_at)),
  CONSTRAINT public_source_evidence_verification_status_ck
    CHECK (verification_status IN ('pending', 'verified', 'rejected'))
);
CREATE INDEX public_source_evidence_source_idx ON public_source_evidence(source_id);

CREATE TABLE signal_versions (
  signal_id text NOT NULL,
  version integer NOT NULL,
  schema_version text NOT NULL DEFAULT '3.0.0',
  title text NOT NULL,
  type signal_type NOT NULL,
  occurred_at timestamptz NOT NULL,
  date_precision text NOT NULL,
  date_basis text NOT NULL,
  captured_at timestamptz NOT NULL,
  summary text NOT NULL,
  analysis text,
  importance integer NOT NULL,
  strength integer NOT NULL,
  confidence double precision NOT NULL,
  novelty double precision NOT NULL,
  revision_reason text NOT NULL,
  origin text NOT NULL,
  legacy_status signal_status,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_versions_pkey PRIMARY KEY (signal_id, version),
  CONSTRAINT signal_versions_signal_fk FOREIGN KEY (signal_id)
    REFERENCES signals(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_versions_version_ck CHECK (version > 0),
  CONSTRAINT signal_versions_schema_version_ck CHECK (schema_version = '3.0.0'),
  CONSTRAINT signal_versions_title_ck CHECK (title ~ '[^[:space:]]'),
  CONSTRAINT signal_versions_occurred_at_ck CHECK (isfinite(occurred_at)),
  CONSTRAINT signal_versions_date_precision_ck CHECK (date_precision IN ('day', 'instant')),
  CONSTRAINT signal_versions_day_precision_ck
    CHECK (date_precision <> 'day' OR date_trunc('day', occurred_at AT TIME ZONE 'UTC') = occurred_at AT TIME ZONE 'UTC'),
  CONSTRAINT signal_versions_date_basis_ck CHECK (date_basis ~ '[^[:space:]]'),
  CONSTRAINT signal_versions_captured_at_ck CHECK (isfinite(captured_at)),
  CONSTRAINT signal_versions_summary_ck CHECK (summary ~ '[^[:space:]]'),
  CONSTRAINT signal_versions_analysis_ck CHECK (analysis IS NULL OR analysis ~ '[^[:space:]]'),
  CONSTRAINT signal_versions_importance_ck CHECK (importance BETWEEN 1 AND 5),
  CONSTRAINT signal_versions_strength_ck CHECK (strength BETWEEN 1 AND 5),
  CONSTRAINT signal_versions_confidence_ck CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT signal_versions_novelty_ck CHECK (novelty BETWEEN 0 AND 1),
  CONSTRAINT signal_versions_revision_reason_ck CHECK (revision_reason ~ '[^[:space:]]'),
  CONSTRAINT signal_versions_origin_ck CHECK (origin IN ('legacy_seed', 'pipeline', 'manual')),
  CONSTRAINT signal_versions_legacy_status_ck
    CHECK ((origin = 'legacy_seed') = (legacy_status IS NOT NULL)),
  CONSTRAINT signal_versions_content_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT signal_versions_created_at_ck CHECK (isfinite(created_at))
);
CREATE INDEX signal_versions_occurred_idx ON signal_versions(occurred_at);

CREATE TABLE signal_version_evidence (
  signal_id text NOT NULL,
  version integer NOT NULL,
  evidence_id text NOT NULL,
  claim text NOT NULL,
  relation text NOT NULL,
  CONSTRAINT signal_version_evidence_pkey PRIMARY KEY (signal_id, version, evidence_id),
  CONSTRAINT signal_version_evidence_version_fk FOREIGN KEY (signal_id, version)
    REFERENCES signal_versions(signal_id, version) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_version_evidence_evidence_fk FOREIGN KEY (evidence_id)
    REFERENCES public_source_evidence(id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_version_evidence_claim_ck CHECK (claim ~ '[^[:space:]]'),
  CONSTRAINT signal_version_evidence_relation_ck
    CHECK (relation IN ('supports', 'contradicts', 'context'))
);
CREATE INDEX signal_version_evidence_evidence_idx ON signal_version_evidence(evidence_id);

CREATE TABLE signal_version_people (
  signal_id text NOT NULL,
  version integer NOT NULL,
  person_id text NOT NULL,
  evidence_id text NOT NULL,
  event_role text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending',
  CONSTRAINT signal_version_people_pkey PRIMARY KEY (signal_id, version, person_id, evidence_id),
  CONSTRAINT signal_version_people_person_fk FOREIGN KEY (person_id)
    REFERENCES person_profiles(entity_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_version_people_evidence_fk FOREIGN KEY (signal_id, version, evidence_id)
    REFERENCES signal_version_evidence(signal_id, version, evidence_id)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_version_people_event_role_ck CHECK (event_role ~ '[^[:space:]]'),
  CONSTRAINT signal_version_people_verification_status_ck
    CHECK (verification_status IN ('pending', 'verified', 'rejected'))
);
CREATE INDEX signal_version_people_person_idx ON signal_version_people(person_id);

CREATE TABLE signal_version_organizations (
  signal_id text NOT NULL,
  version integer NOT NULL,
  organization_id text NOT NULL,
  evidence_id text NOT NULL,
  event_role text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending',
  CONSTRAINT signal_version_organizations_pkey
    PRIMARY KEY (signal_id, version, organization_id, evidence_id),
  CONSTRAINT signal_version_organizations_organization_fk FOREIGN KEY (organization_id)
    REFERENCES organization_profiles(entity_id) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_version_organizations_evidence_fk FOREIGN KEY (signal_id, version, evidence_id)
    REFERENCES signal_version_evidence(signal_id, version, evidence_id)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_version_organizations_event_role_ck
    CHECK (event_role IN ('subject', 'participant', 'background')),
  CONSTRAINT signal_version_organizations_verification_status_ck
    CHECK (verification_status IN ('pending', 'verified', 'rejected'))
);
CREATE INDEX signal_version_organizations_organization_idx
  ON signal_version_organizations(organization_id);

CREATE TABLE signal_version_topics (
  signal_id text NOT NULL,
  version integer NOT NULL,
  topic_id text NOT NULL,
  CONSTRAINT signal_version_topics_pkey PRIMARY KEY (signal_id, version, topic_id),
  CONSTRAINT signal_version_topics_version_fk FOREIGN KEY (signal_id, version)
    REFERENCES signal_versions(signal_id, version) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT signal_version_topics_topic_fk FOREIGN KEY (topic_id)
    REFERENCES topics(id) ON UPDATE NO ACTION ON DELETE NO ACTION
);
CREATE INDEX signal_version_topics_topic_idx ON signal_version_topics(topic_id);

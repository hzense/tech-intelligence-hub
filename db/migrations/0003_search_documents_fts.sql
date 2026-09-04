-- FTS-1 persists the canonical public Search Document projection.
--
-- The legacy table has no trustworthy values for summary, href or keywords.
-- Refuse an implicit lossy backfill: the reviewed sync command must populate
-- this derived table from the canonical content and seed catalogs after the
-- migration succeeds.
DO $hzense_search_documents_empty$
BEGIN
  IF EXISTS (SELECT 1 FROM search_documents LIMIT 1) THEN
    RAISE EXCEPTION
      '0003_search_documents_fts.sql requires an empty derived search_documents table; export and clear legacy rows before retrying';
  END IF;
END
$hzense_search_documents_empty$;

ALTER TABLE search_documents
  ADD COLUMN summary text NOT NULL,
  ADD COLUMN href text NOT NULL,
  ADD COLUMN keywords text NOT NULL,
  ADD COLUMN normalized_title text NOT NULL,
  ADD COLUMN normalized_summary text NOT NULL,
  ADD COLUMN normalized_keywords text NOT NULL,
  ADD COLUMN normalized_body text NOT NULL,
  ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('pg_catalog.simple'::regconfig, normalized_title), 'A') ||
    setweight(to_tsvector('pg_catalog.simple'::regconfig, normalized_summary), 'B') ||
    setweight(to_tsvector('pg_catalog.simple'::regconfig, normalized_keywords), 'C') ||
    setweight(to_tsvector('pg_catalog.simple'::regconfig, normalized_body), 'D')
  ) STORED NOT NULL;

ALTER TABLE search_documents
  ADD CONSTRAINT search_documents_source_type_ck
    CHECK (source_type IN ('daily', 'weekly', 'insight', 'topic', 'signal', 'resource')),
  ADD CONSTRAINT search_documents_title_ck CHECK (length(btrim(title)) > 0),
  ADD CONSTRAINT search_documents_summary_ck CHECK (length(btrim(summary)) > 0),
  ADD CONSTRAINT search_documents_href_ck CHECK (href ~ '^/'),
  ADD CONSTRAINT search_documents_importance_ck CHECK (importance BETWEEN 1 AND 5),
  ADD CONSTRAINT search_documents_topics_array_ck CHECK (jsonb_typeof(topics) = 'array'),
  ADD CONSTRAINT search_documents_entities_array_ck CHECK (jsonb_typeof(entities) = 'array'),
  ADD CONSTRAINT search_documents_normalized_title_ck
    CHECK (length(normalized_title) > 0 AND normalized_title = btrim(normalized_title)),
  ADD CONSTRAINT search_documents_normalized_summary_ck
    CHECK (length(normalized_summary) > 0 AND normalized_summary = btrim(normalized_summary)),
  ADD CONSTRAINT search_documents_normalized_keywords_ck
    CHECK (normalized_keywords = btrim(normalized_keywords)),
  ADD CONSTRAINT search_documents_normalized_body_ck
    CHECK (normalized_body = btrim(normalized_body));

CREATE UNIQUE INDEX search_documents_source_identity_uq
  ON search_documents(source_type, source_id);
CREATE INDEX search_documents_date_idx
  ON search_documents(document_date);
CREATE INDEX search_documents_fts_idx
  ON search_documents USING gin(search_vector);

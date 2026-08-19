CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE entity_type AS ENUM ('person','company','institution','technology','product','model','dataset','standard_protocol','paper','event');
CREATE TYPE signal_type AS ENUM ('research','product','funding','acquisition','hiring','policy','technology','market','people','open_source','security','patent','partnership','regulation','supply_chain');
CREATE TYPE signal_status AS ENUM ('inbox','reviewed','accepted','rejected','archived');
CREATE TYPE source_type AS ENUM ('website','rss','paper','company_blog','research_lab','news_media','newsletter','github','social','regulator','patent_database');
CREATE TYPE topic_status AS ENUM ('watching','active','strategic','archived');
CREATE TYPE trend AS ENUM ('rapid_growth','growth','stable','decline','rapid_decline');
CREATE TYPE maturity AS ENUM ('research','early','emerging','growth','mature');
CREATE TYPE strategic_value AS ENUM ('low','medium','high','critical');

CREATE TABLE topics (id text PRIMARY KEY, title text NOT NULL, parent_id text, status topic_status NOT NULL DEFAULT 'watching', metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE entities (id text PRIMARY KEY, type entity_type NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'active', aliases text[] NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX entities_type_idx ON entities(type); CREATE INDEX entities_name_idx ON entities(name);
CREATE TABLE sources (id text PRIMARY KEY, name text NOT NULL, type source_type NOT NULL, url text, trust_score integer NOT NULL CHECK (trust_score BETWEEN 0 AND 100), active boolean NOT NULL DEFAULT true);
CREATE TABLE signals (id text PRIMARY KEY, title text NOT NULL, type signal_type NOT NULL, status signal_status NOT NULL DEFAULT 'inbox', occurred_at timestamptz NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(), source_id text NOT NULL REFERENCES sources(id), summary text NOT NULL, importance integer NOT NULL CHECK (importance BETWEEN 1 AND 5), strength integer NOT NULL CHECK (strength BETWEEN 1 AND 5), confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1), novelty double precision NOT NULL CHECK (novelty BETWEEN 0 AND 1), metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX signals_occurred_idx ON signals(occurred_at); CREATE INDEX signals_status_idx ON signals(status);
CREATE TABLE entity_topics (entity_id text NOT NULL REFERENCES entities(id) ON DELETE CASCADE, topic_id text NOT NULL REFERENCES topics(id) ON DELETE CASCADE, PRIMARY KEY(entity_id,topic_id));
CREATE TABLE signal_topics (signal_id text NOT NULL REFERENCES signals(id) ON DELETE CASCADE, topic_id text NOT NULL REFERENCES topics(id) ON DELETE CASCADE, PRIMARY KEY(signal_id,topic_id));
CREATE TABLE signal_entities (signal_id text NOT NULL REFERENCES signals(id) ON DELETE CASCADE, entity_id text NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY(signal_id,entity_id));
CREATE TABLE relations (id text PRIMARY KEY, source_id text NOT NULL REFERENCES entities(id), relation_type text NOT NULL, target_id text NOT NULL REFERENCES entities(id), confidence double precision NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1), valid_from date, valid_to date, source_refs text[] NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX relations_source_idx ON relations(source_id); CREATE INDEX relations_target_idx ON relations(target_id);
CREATE TABLE radar_snapshots (id text PRIMARY KEY, topic_id text NOT NULL REFERENCES topics(id), snapshot_date date NOT NULL, attention integer NOT NULL CHECK (attention BETWEEN 0 AND 100), trend trend NOT NULL, maturity maturity NOT NULL, strategic_value strategic_value NOT NULL, confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1), UNIQUE(topic_id,snapshot_date));
CREATE TABLE content_registry (id text PRIMARY KEY, content_type text NOT NULL, path text NOT NULL UNIQUE, status text NOT NULL, published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE search_documents (id text PRIMARY KEY, source_id text NOT NULL, source_type text NOT NULL, title text NOT NULL, body text NOT NULL, importance integer NOT NULL DEFAULT 1, document_date date, topics jsonb NOT NULL DEFAULT '[]'::jsonb, entities jsonb NOT NULL DEFAULT '[]'::jsonb, embedding vector(1536));
CREATE INDEX search_source_idx ON search_documents(source_id);

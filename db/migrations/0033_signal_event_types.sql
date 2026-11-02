-- Event-only classification adds concrete event categories without rewriting
-- existing signals, sealed snapshots, migration history or privileges.
-- Retired domain/attribute values remain readable in historical records.
-- PostgreSQL makes the new enum values usable only after this migration commits.
ALTER TYPE public.signal_type ADD VALUE 'disclosure';
ALTER TYPE public.signal_type ADD VALUE 'operations';
ALTER TYPE public.signal_type ADD VALUE 'incident';

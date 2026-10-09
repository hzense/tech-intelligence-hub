-- Forward-only retirement of four unused projections. The runner executes this
-- whole file and its ledger entry in one transaction. Never delete data to make
-- this migration pass; a nonempty or drifted target needs a separate review.
LOCK TABLE public.content_registry, public.entity_topics,
  public.radar_snapshot_signals, public.radar_snapshots IN ACCESS EXCLUSIVE MODE;

DO $retire$
DECLARE
  target_name text;
  contains_rows boolean;
BEGIN
  FOREACH target_name IN ARRAY ARRAY[
    'content_registry', 'entity_topics', 'radar_snapshot_signals', 'radar_snapshots'
  ] LOOP
    -- Refuse RLS-hidden rows, foreign/partitioned/unlogged tables, ownership
    -- drift and unreviewed local policies/triggers/rules before inspecting data.
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = target_name
        AND c.relkind = 'r' AND c.relpersistence = 'p'
        AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
        AND pg_catalog.pg_get_userbyid(c.relowner) = current_user
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = c.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                        WHERE tgrelid = c.oid AND NOT tgisinternal)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite WHERE ev_class = c.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits
                        WHERE inhrelid = c.oid OR inhparent = c.oid)
    ) THEN
      RAISE EXCEPTION 'unused-table-retirement-unsafe-table: %', target_name;
    END IF;
    EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I)', target_name)
      INTO contains_rows;
    IF contains_rows THEN
      RAISE EXCEPTION 'unused-table-retirement-nonempty: %', target_name;
    END IF;
  END LOOP;
END
$retire$;

-- RESTRICT blocks unreviewed external FK/view dependencies. Drop the reviewed
-- child first; any later failure rolls back every DROP and the ledger entry.
DROP TABLE public.radar_snapshot_signals RESTRICT;
DROP TABLE public.radar_snapshots RESTRICT;
DROP TABLE public.entity_topics RESTRICT;
DROP TABLE public.content_registry RESTRICT;

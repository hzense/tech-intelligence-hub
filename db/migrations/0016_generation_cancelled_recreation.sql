-- Preserve cancelled history and UUID replay. Only never-claimed cancellations
-- release the semantic identity; zero charges alone do not prove no AI call.
DROP INDEX public.signal_generation_source_profile_idx;
CREATE UNIQUE INDEX signal_generation_source_profile_idx ON public.signal_generation_runs
  (owner_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version)
  WHERE NOT (status = 'cancelled' AND lease_token IS NULL AND lease_until IS NULL AND budget_day IS NULL AND reserved_microusd = 0 AND charged_microusd = 0);

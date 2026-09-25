export const editorialVectorQuery = `SELECT p.proname AS name,
  ARRAY(SELECT n.nspname||'.'||t.typname FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(oid,pos)
    JOIN pg_type t ON t.oid=a.oid JOIN pg_namespace n ON n.oid=t.typnamespace ORDER BY a.pos) AS args,
  rn.nspname||'.'||rt.typname AS result,l.lanname AS language,p.probin AS library,p.prosrc AS source,
  p.prokind AS kind,p.provolatile AS volatility,p.proisstrict AS strict,p.proretset AS returns_set,p.proparallel AS parallel,
  p.prosecdef AS security_definer,p.proconfig AS configuration,p.proleakproof AS leakproof,
  p.prosupport=0 AS no_support_hook,p.provariadic=0 AS no_variadic_type,p.proargdefaults IS NULL AS no_defaults,
  p.proallargtypes IS NULL AS no_out_args,p.prosqlbody IS NULL AS no_sql_body,
  COALESCE(cardinality(p.protrftypes),0)=0 AS no_transform_types,
  ((p.proowner=e.extowner AND e.extowner=10) OR
    (pg_get_userbyid(p.proowner)='cloud_admin' AND pg_get_userbyid(e.extowner)='neondb_owner')) AS owner_safe,
  CASE WHEN ag.aggfnoid IS NULL THEN NULL ELSE
    (to_jsonb(ag)-ARRAY['aggfnoid','aggtransfn','aggfinalfn','aggcombinefn','aggserialfn','aggdeserialfn','aggmtransfn','aggminvtransfn','aggmfinalfn','aggtranstype','aggmtranstype','aggsortop'])
    ||jsonb_build_object(
      'trans_type',tn.nspname||'.'||tt.typname,'moving_type',mn.nspname||'.'||mt.typname,'no_sort_operator',ag.aggsortop=0,
      'support_functions',(SELECT jsonb_object_agg(s.slot,
        sn.nspname||'.'||sp.proname||'('||array_to_string(ARRAY(
          SELECT an.nspname||'.'||at.typname FROM unnest(sp.proargtypes::oid[]) WITH ORDINALITY args(oid,pos)
          JOIN pg_type at ON at.oid=args.oid JOIN pg_namespace an ON an.oid=at.typnamespace ORDER BY args.pos
        ),',')||')')
        FROM (VALUES ('trans',ag.aggtransfn),('final',ag.aggfinalfn),('combine',ag.aggcombinefn),
          ('serial',ag.aggserialfn),('deserial',ag.aggdeserialfn),('moving_trans',ag.aggmtransfn),
          ('moving_inverse',ag.aggminvtransfn),('moving_final',ag.aggmfinalfn)) s(slot,oid)
        LEFT JOIN pg_proc sp ON sp.oid=s.oid LEFT JOIN pg_namespace sn ON sn.oid=sp.pronamespace)
    ) END AS aggregate
  FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang JOIN pg_type rt ON rt.oid=p.prorettype
  JOIN pg_namespace rn ON rn.oid=rt.typnamespace
  JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
  JOIN pg_extension e ON e.oid=d.refobjid
  LEFT JOIN pg_aggregate ag ON ag.aggfnoid=p.oid
  LEFT JOIN pg_type tt ON tt.oid=ag.aggtranstype LEFT JOIN pg_namespace tn ON tn.oid=tt.typnamespace
  LEFT JOIN pg_type mt ON mt.oid=ag.aggmtranstype LEFT JOIN pg_namespace mn ON mn.oid=mt.typnamespace
  WHERE e.extname='vector'`;

export function canonicalVectorManifest(rows) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return rows
    .map((row) => JSON.stringify(canonical(row)))
    .sort()
    .join('\n');
}

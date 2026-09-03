const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
];
const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'];

// These are reviewed fingerprints of Neon's provider-owned PostgreSQL 18
// reserved databases. The inventory query below binds each digest to object
// identity, ownership, extension dependency, execution mode, effective Runtime
// privileges, grant options and direct Runtime ACLs. A provider upgrade must be
// reviewed and deliberately re-pinned; matching only an object count is never
// sufficient.
const neonReservedProviderInventoryContracts = new Map([
  [
    'postgres',
    new Map([
      [
        'access_method_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'access',
        {
          rowCount: 409,
          fingerprint: 'd4948e90513977f99858f0b79213a73cef5f0598aa050beff457d4285aeecf8e',
        },
      ],
      [
        'cast_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'cluster_acl',
        {
          rowCount: 2,
          fingerprint: 'c48a047466094cdd6bfa63f77266b1b8f624a0ad504afc6f2845a1d62c164d27',
        },
      ],
      [
        'collation',
        {
          rowCount: 1,
          fingerprint: 'f771a0e2041e68b74a33b558b9309ff1c0d12c303c777e64776ed58d90db8dc1',
        },
      ],
      [
        'column',
        {
          rowCount: 88,
          fingerprint: 'e0ae0459cb58e864c69403679a975022c1516282be5606eca6b5e569a9921bac',
        },
      ],
      [
        'extension',
        {
          rowCount: 3,
          fingerprint: 'ef00010ad1bc1a3ed5a7fa92f89d9440f087fa835db83fb7358609895e38956d',
        },
      ],
      [
        'event_trigger_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'conversion_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'inheritance',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'index',
        {
          rowCount: 4,
          fingerprint: 'bfcad804bf1f28525d07069a598b6f67a6f6e53a8632d3bb6854bc2572232ac4',
        },
      ],
      [
        'language_path',
        {
          rowCount: 1,
          fingerprint: 'a6b7605342b9eee5d820cf4ee6b7851fa61da279b7de62044a16586cadb1b3b2',
        },
      ],
      [
        'operator_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'opclass_path',
        {
          rowCount: 3,
          fingerprint: 'b85a941022cd28c87400667036eb9c0fcfb41724b733562bf9284325de547557',
        },
      ],
      [
        'relation',
        {
          rowCount: 11,
          fingerprint: '46d2eb1662f0bcf522af4924ac0a39ebb0627f594102dbb196ffc8d6d8fd71b2',
        },
      ],
      [
        'routine',
        {
          rowCount: 32,
          fingerprint: 'e8196ad70dd9e1a92487b5f000228055f27e806fd181ecf113158ce9ba63c8d3',
        },
      ],
      [
        'runtime_ownership',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'schema',
        {
          rowCount: 3,
          fingerprint: 'b2e869dfd831d2dc0fdde3e5d794d8075c5537a06375bf207d377cce0465f27b',
        },
      ],
      [
        'sequence',
        {
          rowCount: 1,
          fingerprint: 'b6faf55448ebcc9ec6fad504174863ce84876c9ac44628f95ddbc828ee717a4e',
        },
      ],
      [
        'system_acl',
        {
          rowCount: 290,
          fingerprint: '1dbfec7d500d12305971a3f96b66aedfed49ac5e8970f71f20b4e94e687787b0',
        },
      ],
      [
        'system_schema_access',
        {
          rowCount: 3,
          fingerprint: '3030c68ce68894ce1039d337c43df0cc348a162d57e843fa7dbd6679eefb6ac1',
        },
      ],
      [
        'type',
        {
          rowCount: 22,
          fingerprint: 'a24ad3b2cc81a9b4fce6ee6ddc0229d18170553d6e84db206eb504ce43f99f73',
        },
      ],
      [
        'text_search_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
    ]),
  ],
  [
    'template1',
    new Map([
      [
        'access',
        {
          rowCount: 298,
          fingerprint: 'e9fee8a89c81258c4af59ba9290c3da752d50924a35900b09eb5ab28a090de59',
        },
      ],
      [
        'access_method_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'cast_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'cluster_acl',
        {
          rowCount: 2,
          fingerprint: 'c48a047466094cdd6bfa63f77266b1b8f624a0ad504afc6f2845a1d62c164d27',
        },
      ],
      [
        'collation',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'column',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'conversion_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'event_trigger_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'extension',
        {
          rowCount: 1,
          fingerprint: '9f6cdae8e6afd79b270395fe92c29025d132abe418bc129bc3e5b15901a08028',
        },
      ],
      [
        'index',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'inheritance',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'language_path',
        {
          rowCount: 1,
          fingerprint: 'a6b7605342b9eee5d820cf4ee6b7851fa61da279b7de62044a16586cadb1b3b2',
        },
      ],
      [
        'opclass_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'operator_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'relation',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'routine',
        {
          rowCount: 3,
          fingerprint: '99474588efacae6202672d9dc1eda67e67944e123110d078a6aaf254f6a5a90e',
        },
      ],
      [
        'runtime_ownership',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'schema',
        {
          rowCount: 1,
          fingerprint: '09728fda86962e16d49ecfb057c93d75ce0529678bbb68a0642ee3dd0aa016e9',
        },
      ],
      [
        'sequence',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'system_acl',
        {
          rowCount: 289,
          fingerprint: '07b165bf8182f1c3e3bccc3572eb4b9b5f11f969df4c75c30ca5ba0d5ebf1721',
        },
      ],
      [
        'system_schema_access',
        {
          rowCount: 3,
          fingerprint: '3030c68ce68894ce1039d337c43df0cc348a162d57e843fa7dbd6679eefb6ac1',
        },
      ],
      [
        'text_search_path',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
      [
        'type',
        {
          rowCount: 0,
          fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ],
    ]),
  ],
]);

function requireExactProviderInventory(rows, expectedDatabase, profile) {
  const expectedContract = neonReservedProviderInventoryContracts.get(expectedDatabase);
  if (profile !== 'production' || !expectedContract) {
    if (rows.length !== 0) {
      throw new Error('Neon provider object exception escaped its production reserved scope');
    }
    return false;
  }

  const actual = new Map(
    rows.map((row) => [row.object_name, { rowCount: row.row_count, fingerprint: row.fingerprint }]),
  );
  if (
    rows.length !== expectedContract.size ||
    actual.size !== expectedContract.size ||
    [...expectedContract].some(
      ([category, contract]) =>
        actual.get(category)?.rowCount !== contract.rowCount ||
        actual.get(category)?.fingerprint !== contract.fingerprint,
    )
  ) {
    throw new Error(`Neon reserved ${expectedDatabase} provider object contract changed`);
  }
  return true;
}

function summarizedViolationTypes(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.object_type, (counts.get(row.object_type) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type}(${count})`)
    .join(', ');
}

export async function inspectNeonReservedProviderObjects(client, { expectedDatabase, profile }) {
  const result = await client.query(
    `WITH runtime_role AS (
       SELECT oid FROM pg_roles WHERE rolname = session_user
     ),
     non_system_namespaces AS (
       SELECT oid
       FROM pg_namespace
       WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND nspname !~ '^pg_temp_[0-9]+$'
         AND nspname !~ '^pg_toast_temp_[0-9]+$'
     ),
     permanent_namespaces AS (
       SELECT oid
       FROM pg_namespace
       WHERE nspname !~ '^pg_temp_[0-9]+$'
         AND nspname !~ '^pg_toast_temp_[0-9]+$'
     ),
     candidate_relations AS (
       SELECT DISTINCT relation_info.oid
       FROM pg_class AS relation_info
       JOIN pg_namespace AS candidate_namespace
         ON candidate_namespace.oid = relation_info.relnamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_class'::regclass
        AND extension_dependency.objid = relation_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       WHERE candidate_namespace.oid IN (SELECT oid FROM permanent_namespaces)
         AND (
           relation_info.relnamespace IN (SELECT oid FROM non_system_namespaces)
           OR relation_info.oid >= 16384
           OR extension_dependency.refobjid IS NOT NULL
         )
     ),
     candidate_routines AS (
       SELECT DISTINCT routine_info.oid
       FROM pg_proc AS routine_info
       JOIN pg_namespace AS candidate_namespace
         ON candidate_namespace.oid = routine_info.pronamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_proc'::regclass
        AND extension_dependency.objid = routine_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       WHERE candidate_namespace.oid IN (SELECT oid FROM permanent_namespaces)
         AND (
           routine_info.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR routine_info.oid >= 16384
           OR extension_dependency.refobjid IS NOT NULL
         )
     ),
     candidate_types AS (
       SELECT DISTINCT type_info.oid
       FROM pg_type AS type_info
       JOIN pg_namespace AS candidate_namespace
         ON candidate_namespace.oid = type_info.typnamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_type'::regclass
        AND extension_dependency.objid = type_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       WHERE candidate_namespace.oid IN (SELECT oid FROM permanent_namespaces)
         AND (
           type_info.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR type_info.oid >= 16384
           OR extension_dependency.refobjid IS NOT NULL
         )
     ),
     provider_referenced_collations AS (
       SELECT DISTINCT column_info.attcollation AS oid
       FROM pg_attribute AS column_info
       JOIN pg_class AS relation_info
         ON relation_info.oid = column_info.attrelid
       WHERE relation_info.oid IN (SELECT oid FROM candidate_relations)
         AND column_info.attcollation <> 0
         AND column_info.attnum > 0
         AND NOT column_info.attisdropped
       UNION
       SELECT DISTINCT type_info.typcollation
       FROM pg_type AS type_info
       WHERE type_info.oid IN (SELECT oid FROM candidate_types)
         AND type_info.typcollation <> 0
       UNION
       SELECT DISTINCT index_collation.collation_oid
       FROM pg_index AS index_info
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_info.indexrelid
       CROSS JOIN LATERAL unnest(index_info.indcollation::oid[])
         AS index_collation(collation_oid)
       WHERE index_relation.oid IN (SELECT oid FROM candidate_relations)
         AND index_collation.collation_oid <> 0
       UNION
       SELECT DISTINCT range_info.rngcollation
       FROM pg_range AS range_info
       JOIN pg_type AS range_type
         ON range_type.oid = range_info.rngtypid
       WHERE range_type.oid IN (SELECT oid FROM candidate_types)
         AND range_info.rngcollation <> 0
     ),
     provider_index_opclasses AS (
       SELECT DISTINCT index_opclass.opclass_oid AS oid
       FROM pg_index AS index_info
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_info.indexrelid
       CROSS JOIN LATERAL unnest(index_info.indclass::oid[])
         AS index_opclass(opclass_oid)
       WHERE index_relation.oid IN (SELECT oid FROM candidate_relations)
     ),
     selected_opclasses AS (
       SELECT DISTINCT opclass_info.oid
       FROM pg_opclass AS opclass_info
       JOIN pg_opfamily AS family_info
         ON family_info.oid = opclass_info.opcfamily
       JOIN pg_type AS input_type
         ON input_type.oid = opclass_info.opcintype
       LEFT JOIN pg_type AS storage_type
         ON storage_type.oid = opclass_info.opckeytype
       WHERE opclass_info.opcnamespace IN (SELECT oid FROM permanent_namespaces)
         AND family_info.opfnamespace IN (SELECT oid FROM permanent_namespaces)
         AND input_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           storage_type.oid IS NULL
           OR storage_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
         )
         AND (
           opclass_info.oid IN (SELECT oid FROM provider_index_opclasses)
           OR opclass_info.oid >= 16384
           OR family_info.oid >= 16384
           OR opclass_info.opcnamespace IN (SELECT oid FROM non_system_namespaces)
           OR family_info.opfnamespace IN (SELECT oid FROM non_system_namespaces)
           OR input_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR storage_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR EXISTS (
            SELECT 1
            FROM pg_amop AS operator_map
            JOIN pg_operator AS operator_info
              ON operator_info.oid = operator_map.amopopr
            JOIN pg_type AS left_type
              ON left_type.oid = operator_map.amoplefttype
            JOIN pg_type AS right_type
              ON right_type.oid = operator_map.amoprighttype
            WHERE operator_map.amopfamily = family_info.oid
              AND operator_info.oprnamespace IN (SELECT oid FROM permanent_namespaces)
              AND left_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
              AND right_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
              AND (
                operator_map.oid >= 16384
                OR operator_info.oprnamespace IN (SELECT oid FROM non_system_namespaces)
                OR left_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
                OR right_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
              )
           )
           OR EXISTS (
            SELECT 1
            FROM pg_amproc AS support_map
            JOIN pg_proc AS support_routine
              ON support_routine.oid = support_map.amproc
            JOIN pg_type AS left_type
              ON left_type.oid = support_map.amproclefttype
            JOIN pg_type AS right_type
              ON right_type.oid = support_map.amprocrighttype
            WHERE support_map.amprocfamily = family_info.oid
              AND support_routine.pronamespace IN (SELECT oid FROM permanent_namespaces)
              AND left_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
              AND right_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
              AND (
                support_map.oid >= 16384
                OR support_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
                OR left_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
                OR right_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
              )
           )
         )
     ),
     inventory_categories(category) AS (
       VALUES ('access_method_path'),
              ('cast_path'),
              ('cluster_acl'),
              ('column'),
              ('collation'),
              ('conversion_path'),
              ('event_trigger_path'),
              ('extension'),
              ('inheritance'),
              ('index'),
              ('language_path'),
              ('opclass_path'),
              ('operator_path'),
              ('relation'),
              ('routine'),
              ('runtime_ownership'),
              ('schema'),
              ('sequence'),
              ('system_acl'),
              ('system_schema_access'),
              ('text_search_path'),
              ('type')
     ),
     inventory(category, item) AS (
       SELECT 'extension',
              jsonb_build_array(
                extension_info.extname,
                extension_info.extversion,
                namespace_info.nspname,
                pg_get_userbyid(extension_info.extowner),
                extension_info.extrelocatable,
                extension_info.extconfig,
                extension_info.extcondition
              )::text
       FROM pg_extension AS extension_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = extension_info.extnamespace
       UNION ALL
       SELECT 'cluster_acl',
              jsonb_build_array(
                'tablespace',
                tablespace_info.spcname,
                pg_get_userbyid(tablespace_info.spcowner),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(tablespace_info.spcacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                has_tablespace_privilege(current_user, tablespace_info.oid, 'CREATE'),
                has_tablespace_privilege(
                  current_user,
                  tablespace_info.oid,
                  'CREATE WITH GRANT OPTION'
                ),
                EXISTS (
                  SELECT 1
                  FROM aclexplode(tablespace_info.spcacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                )
              )::text
       FROM pg_tablespace AS tablespace_info
       UNION ALL
       SELECT 'cluster_acl',
              jsonb_build_array(
                'parameter',
                parameter_acl.parname,
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(parameter_acl.paracl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                has_parameter_privilege(current_user, parameter_acl.parname, 'SET'),
                has_parameter_privilege(
                  current_user,
                  parameter_acl.parname,
                  'SET WITH GRANT OPTION'
                ),
                has_parameter_privilege(current_user, parameter_acl.parname, 'ALTER SYSTEM'),
                has_parameter_privilege(
                  current_user,
                  parameter_acl.parname,
                  'ALTER SYSTEM WITH GRANT OPTION'
                ),
                EXISTS (
                  SELECT 1
                  FROM aclexplode(parameter_acl.paracl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                )
              )::text
       FROM pg_parameter_acl AS parameter_acl
       UNION ALL
       SELECT 'system_schema_access',
              jsonb_build_array(
                namespace_info.nspname,
                pg_get_userbyid(namespace_info.nspowner),
                namespace_info.nspacl IS NULL,
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(namespace_info.nspacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                has_schema_privilege(current_user, namespace_info.oid, 'USAGE'),
                has_schema_privilege(
                  current_user,
                  namespace_info.oid,
                  'USAGE WITH GRANT OPTION'
                ),
                has_schema_privilege(current_user, namespace_info.oid, 'CREATE'),
                has_schema_privilege(
                  current_user,
                  namespace_info.oid,
                  'CREATE WITH GRANT OPTION'
                ),
                EXISTS (
                  SELECT 1
                  FROM aclexplode(namespace_info.nspacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                )
              )::text
       FROM pg_namespace AS namespace_info
       WHERE namespace_info.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'schema',
                namespace_info.nspname
              )::text
       FROM pg_namespace AS namespace_info
       WHERE namespace_info.nspowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'relation',
                namespace_info.nspname,
                relation_info.relname,
                relation_info.relkind
              )::text
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = relation_info.relnamespace
       WHERE relation_info.relowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'routine',
                namespace_info.nspname,
                routine_info.proname,
                pg_get_function_identity_arguments(routine_info.oid)
              )::text
       FROM pg_proc AS routine_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = routine_info.pronamespace
       WHERE routine_info.proowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'type',
                namespace_info.nspname,
                type_info.typname,
                type_info.typtype
              )::text
       FROM pg_type AS type_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = type_info.typnamespace
       WHERE type_info.typowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'operator',
                namespace_info.nspname,
                operator_info.oprname,
                operator_info.oprleft,
                operator_info.oprright
              )::text
       FROM pg_operator AS operator_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = operator_info.oprnamespace
       WHERE operator_info.oprowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'operator_class',
                namespace_info.nspname,
                opclass_info.opcname,
                access_method.amname
              )::text
       FROM pg_opclass AS opclass_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = opclass_info.opcnamespace
       JOIN pg_am AS access_method
         ON access_method.oid = opclass_info.opcmethod
       WHERE opclass_info.opcowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'operator_family',
                namespace_info.nspname,
                family_info.opfname,
                access_method.amname
              )::text
       FROM pg_opfamily AS family_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = family_info.opfnamespace
       JOIN pg_am AS access_method
         ON access_method.oid = family_info.opfmethod
       WHERE family_info.opfowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'collation',
                namespace_info.nspname,
                collation_info.collname
              )::text
       FROM pg_collation AS collation_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = collation_info.collnamespace
       WHERE collation_info.collowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'conversion',
                namespace_info.nspname,
                conversion_info.conname
              )::text
       FROM pg_conversion AS conversion_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = conversion_info.connamespace
       WHERE conversion_info.conowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'language',
                language_info.lanname
              )::text
       FROM pg_language AS language_info
       WHERE language_info.lanowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'text_search_configuration',
                namespace_info.nspname,
                config_info.cfgname
              )::text
       FROM pg_ts_config AS config_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = config_info.cfgnamespace
       WHERE config_info.cfgowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'text_search_dictionary',
                namespace_info.nspname,
                dictionary_info.dictname
              )::text
       FROM pg_ts_dict AS dictionary_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = dictionary_info.dictnamespace
       WHERE dictionary_info.dictowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'event_trigger',
                event_trigger.evtname
              )::text
       FROM pg_event_trigger AS event_trigger
       WHERE event_trigger.evtowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'extension',
                extension_info.extname
              )::text
       FROM pg_extension AS extension_info
       WHERE extension_info.extowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'foreign_data_wrapper',
                wrapper_info.fdwname
              )::text
       FROM pg_foreign_data_wrapper AS wrapper_info
       WHERE wrapper_info.fdwowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'foreign_server',
                server_info.srvname
              )::text
       FROM pg_foreign_server AS server_info
       WHERE server_info.srvowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'large_object',
                large_object_info.oid
              )::text
       FROM pg_largeobject_metadata AS large_object_info
       WHERE large_object_info.lomowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'statistics',
                namespace_info.nspname,
                statistics_info.stxname
              )::text
       FROM pg_statistic_ext AS statistics_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = statistics_info.stxnamespace
       WHERE statistics_info.stxowner = (SELECT oid FROM runtime_role)
         AND namespace_info.oid IN (SELECT oid FROM permanent_namespaces)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'publication',
                publication_info.pubname
              )::text
       FROM pg_publication AS publication_info
       WHERE publication_info.pubowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'subscription',
                subscription_info.subname
              )::text
       FROM pg_subscription AS subscription_info
       WHERE subscription_info.subowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'tablespace',
                tablespace_info.spcname
              )::text
       FROM pg_tablespace AS tablespace_info
       WHERE tablespace_info.spcowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'database',
                database_info.datname,
                database_info.datistemplate,
                database_info.datallowconn
              )::text
       FROM pg_database AS database_info
       WHERE database_info.datdba = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'runtime_ownership',
              jsonb_build_array(
                'default_acl',
                namespace_info.nspname,
                default_acl.defaclobjtype
              )::text
       FROM pg_default_acl AS default_acl
       LEFT JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = default_acl.defaclnamespace
       WHERE default_acl.defaclrole = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'system_acl',
              jsonb_build_array(
                'relation',
                namespace_info.nspname,
                relation_info.relname,
                relation_info.relkind,
                pg_get_userbyid(relation_info.relowner),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(relation_info.relacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                ARRAY(
                  SELECT jsonb_build_array(
                    privilege_info.privilege,
                    has_table_privilege(
                      current_user,
                      relation_info.oid,
                      privilege_info.privilege
                    ),
                    has_table_privilege(
                      current_user,
                      relation_info.oid,
                      privilege_info.privilege || ' WITH GRANT OPTION'
                    )
                  )
                  FROM unnest($1::text[]) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  ORDER BY privilege_info.position
                )
              )::text
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = relation_info.relnamespace
       WHERE namespace_info.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND (
           relation_info.relacl IS NOT NULL
           OR relation_info.relowner = (SELECT oid FROM runtime_role)
         )
       UNION ALL
       SELECT 'system_acl',
              jsonb_build_array(
                'sequence',
                namespace_info.nspname,
                sequence_info.relname,
                pg_get_userbyid(sequence_info.relowner),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(sequence_info.relacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                ARRAY(
                  SELECT jsonb_build_array(
                    privilege_info.privilege,
                    has_sequence_privilege(
                      current_user,
                      sequence_info.oid,
                      privilege_info.privilege
                    ),
                    has_sequence_privilege(
                      current_user,
                      sequence_info.oid,
                      privilege_info.privilege || ' WITH GRANT OPTION'
                    )
                  )
                  FROM unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  ORDER BY privilege_info.position
                )
              )::text
       FROM pg_class AS sequence_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = sequence_info.relnamespace
       WHERE namespace_info.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND sequence_info.relkind = 'S'
         AND (
           sequence_info.relacl IS NOT NULL
           OR sequence_info.relowner = (SELECT oid FROM runtime_role)
         )
       UNION ALL
       SELECT 'system_acl',
              jsonb_build_array(
                'column',
                namespace_info.nspname,
                relation_info.relname,
                column_info.attname,
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(column_info.attacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                ARRAY(
                  SELECT jsonb_build_array(
                    privilege_info.privilege,
                    has_column_privilege(
                      current_user,
                      relation_info.oid,
                      column_info.attnum,
                      privilege_info.privilege
                    ),
                    has_column_privilege(
                      current_user,
                      relation_info.oid,
                      column_info.attnum,
                      privilege_info.privilege || ' WITH GRANT OPTION'
                    )
                  )
                  FROM unnest($2::text[]) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  ORDER BY privilege_info.position
                )
              )::text
       FROM pg_attribute AS column_info
       JOIN pg_class AS relation_info
         ON relation_info.oid = column_info.attrelid
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = relation_info.relnamespace
       WHERE namespace_info.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND column_info.attnum > 0
         AND NOT column_info.attisdropped
         AND column_info.attacl IS NOT NULL
       UNION ALL
       SELECT 'system_acl',
              jsonb_build_array(
                'routine',
                namespace_info.nspname,
                routine_info.proname,
                pg_get_function_identity_arguments(routine_info.oid),
                pg_get_userbyid(routine_info.proowner),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(routine_info.proacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                has_function_privilege(current_user, routine_info.oid, 'EXECUTE'),
                has_function_privilege(
                  current_user,
                  routine_info.oid,
                  'EXECUTE WITH GRANT OPTION'
                )
              )::text
       FROM pg_proc AS routine_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = routine_info.pronamespace
       WHERE namespace_info.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND (
           routine_info.proacl IS NOT NULL
           OR routine_info.proowner = (SELECT oid FROM runtime_role)
         )
       UNION ALL
       SELECT 'system_acl',
              jsonb_build_array(
                'type',
                namespace_info.nspname,
                type_info.typname,
                type_info.typtype,
                pg_get_userbyid(type_info.typowner),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(type_info.typacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                has_type_privilege(current_user, type_info.oid, 'USAGE'),
                has_type_privilege(
                  current_user,
                  type_info.oid,
                  'USAGE WITH GRANT OPTION'
                )
              )::text
       FROM pg_type AS type_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = type_info.typnamespace
       WHERE namespace_info.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND (
           type_info.typacl IS NOT NULL
           OR type_info.typowner = (SELECT oid FROM runtime_role)
         )
       UNION ALL
       SELECT 'system_acl',
              jsonb_build_array(
                'language',
                language_info.lanname,
                pg_get_userbyid(language_info.lanowner),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        CASE
                          WHEN acl_info.grantee = 0 THEN 'PUBLIC'
                          ELSE pg_get_userbyid(acl_info.grantee)
                        END,
                        pg_get_userbyid(acl_info.grantor),
                        acl_info.privilege_type,
                        acl_info.is_grantable
                      )
                      ORDER BY acl_info.grantee, acl_info.grantor,
                               acl_info.privilege_type, acl_info.is_grantable
                    )
                    FROM aclexplode(language_info.lanacl) AS acl_info
                  ),
                  '[]'::jsonb
                ),
                has_language_privilege(current_user, language_info.oid, 'USAGE'),
                has_language_privilege(
                  current_user,
                  language_info.oid,
                  'USAGE WITH GRANT OPTION'
                )
              )::text
       FROM pg_language AS language_info
       WHERE language_info.lanacl IS NOT NULL
          OR language_info.lanowner = (SELECT oid FROM runtime_role)
       UNION ALL
       SELECT 'access_method_path',
              jsonb_build_array(
                access_method.amname,
                access_method.amtype,
                handler_namespace.nspname,
                handler_routine.proname,
                pg_get_function_identity_arguments(handler_routine.oid),
                pg_get_userbyid(handler_routine.proowner),
                language_info.lanname,
                handler_routine.prosecdef,
                handler_routine.proleakproof,
                handler_routine.provolatile,
                handler_routine.proparallel,
                access_method_extension.extname,
                access_method_extension.extversion,
                access_method_extension_namespace.nspname,
                pg_get_userbyid(access_method_extension.extowner),
                handler_extension.extname,
                handler_extension.extversion,
                handler_extension_namespace.nspname,
                pg_get_userbyid(handler_extension.extowner)
              )::text
       FROM pg_am AS access_method
       JOIN pg_proc AS handler_routine
         ON handler_routine.oid = access_method.amhandler
       JOIN pg_namespace AS handler_namespace
         ON handler_namespace.oid = handler_routine.pronamespace
       JOIN pg_language AS language_info
         ON language_info.oid = handler_routine.prolang
       LEFT JOIN pg_depend AS access_method_extension_dependency
         ON access_method_extension_dependency.classid = 'pg_am'::regclass
        AND access_method_extension_dependency.objid = access_method.oid
        AND access_method_extension_dependency.objsubid = 0
        AND access_method_extension_dependency.refclassid = 'pg_extension'::regclass
        AND access_method_extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS access_method_extension
         ON access_method_extension.oid = access_method_extension_dependency.refobjid
       LEFT JOIN pg_namespace AS access_method_extension_namespace
         ON access_method_extension_namespace.oid = access_method_extension.extnamespace
       LEFT JOIN pg_depend AS handler_extension_dependency
         ON handler_extension_dependency.classid = 'pg_proc'::regclass
        AND handler_extension_dependency.objid = handler_routine.oid
        AND handler_extension_dependency.objsubid = 0
        AND handler_extension_dependency.refclassid = 'pg_extension'::regclass
        AND handler_extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS handler_extension
         ON handler_extension.oid = handler_extension_dependency.refobjid
       LEFT JOIN pg_namespace AS handler_extension_namespace
         ON handler_extension_namespace.oid = handler_extension.extnamespace
       WHERE access_method.oid >= 16384
          OR handler_routine.oid IN (SELECT oid FROM candidate_routines)
          OR access_method_extension.oid IS NOT NULL
       UNION ALL
       SELECT 'event_trigger_path',
              jsonb_build_array(
                event_trigger.evtname,
                event_trigger.evtevent,
                event_trigger.evtenabled,
                event_trigger.evttags,
                pg_get_userbyid(event_trigger.evtowner),
                routine_namespace.nspname,
                routine_info.proname,
                pg_get_function_identity_arguments(routine_info.oid),
                pg_get_userbyid(routine_info.proowner),
                language_info.lanname,
                routine_info.prosecdef,
                routine_info.proleakproof,
                routine_info.provolatile,
                encode(
                  sha256(convert_to(pg_get_functiondef(routine_info.oid), 'UTF8')),
                  'hex'
                ),
                event_trigger_extension.extname,
                event_trigger_extension.extversion,
                event_trigger_extension_namespace.nspname,
                pg_get_userbyid(event_trigger_extension.extowner)
              )::text
       FROM pg_event_trigger AS event_trigger
       JOIN pg_proc AS routine_info
         ON routine_info.oid = event_trigger.evtfoid
       JOIN pg_namespace AS routine_namespace
         ON routine_namespace.oid = routine_info.pronamespace
       JOIN pg_language AS language_info
         ON language_info.oid = routine_info.prolang
       LEFT JOIN pg_depend AS event_trigger_extension_dependency
         ON event_trigger_extension_dependency.classid = 'pg_event_trigger'::regclass
        AND event_trigger_extension_dependency.objid = event_trigger.oid
        AND event_trigger_extension_dependency.objsubid = 0
        AND event_trigger_extension_dependency.refclassid = 'pg_extension'::regclass
        AND event_trigger_extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS event_trigger_extension
         ON event_trigger_extension.oid = event_trigger_extension_dependency.refobjid
       LEFT JOIN pg_namespace AS event_trigger_extension_namespace
         ON event_trigger_extension_namespace.oid = event_trigger_extension.extnamespace
       UNION ALL
       SELECT 'language_path',
              jsonb_build_array(
                'language',
                language_info.lanname,
                pg_get_userbyid(language_info.lanowner),
                language_info.lanispl,
                language_info.lanpltrusted,
                CASE
                  WHEN language_info.lanplcallfoid = 0 THEN NULL
                  ELSE language_info.lanplcallfoid::regprocedure::text
                END,
                CASE
                  WHEN language_info.laninline = 0 THEN NULL
                  ELSE language_info.laninline::regprocedure::text
                END,
                CASE
                  WHEN language_info.lanvalidator = 0 THEN NULL
                  ELSE language_info.lanvalidator::regprocedure::text
                END,
                language_info.lanacl IS NULL,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(language_info.lanacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                ),
                has_language_privilege(current_user, language_info.oid, 'USAGE'),
                has_language_privilege(
                  current_user,
                  language_info.oid,
                  'USAGE WITH GRANT OPTION'
                ),
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_language AS language_info
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_language'::regclass
        AND extension_dependency.objid = language_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE language_info.oid >= 16384
          OR extension_info.oid IS NOT NULL
       UNION ALL
       SELECT 'language_path',
              jsonb_build_array(
                'transform',
                type_namespace.nspname,
                format_type(type_info.oid, NULL),
                language_info.lanname,
                CASE
                  WHEN from_sql_routine.oid IS NULL THEN NULL
                  ELSE from_sql_routine.oid::regprocedure::text
                END,
                CASE
                  WHEN to_sql_routine.oid IS NULL THEN NULL
                  ELSE to_sql_routine.oid::regprocedure::text
                END,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_transform AS transform_info
       JOIN pg_type AS type_info
         ON type_info.oid = transform_info.trftype
       JOIN pg_namespace AS type_namespace
         ON type_namespace.oid = type_info.typnamespace
       JOIN pg_language AS language_info
         ON language_info.oid = transform_info.trflang
       LEFT JOIN pg_proc AS from_sql_routine
         ON from_sql_routine.oid = transform_info.trffromsql
       LEFT JOIN pg_proc AS to_sql_routine
         ON to_sql_routine.oid = transform_info.trftosql
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_transform'::regclass
        AND extension_dependency.objid = transform_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE type_info.typnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           from_sql_routine.oid IS NULL
           OR from_sql_routine.pronamespace IN (SELECT oid FROM permanent_namespaces)
         )
         AND (
           to_sql_routine.oid IS NULL
           OR to_sql_routine.pronamespace IN (SELECT oid FROM permanent_namespaces)
         )
         AND (
           transform_info.oid >= 16384
           OR type_info.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR from_sql_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR to_sql_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR language_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'schema',
              jsonb_build_array(
                namespace_info.nspname,
                pg_get_userbyid(namespace_info.nspowner),
                namespace_info.nspacl IS NULL,
                has_schema_privilege(current_user, namespace_info.oid, 'USAGE'),
                has_schema_privilege(
                  current_user,
                  namespace_info.oid,
                  'USAGE WITH GRANT OPTION'
                ),
                has_schema_privilege(current_user, namespace_info.oid, 'CREATE'),
                has_schema_privilege(
                  current_user,
                  namespace_info.oid,
                  'CREATE WITH GRANT OPTION'
                ),
                EXISTS (
                  SELECT 1
                  FROM aclexplode(namespace_info.nspacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                )
              )::text
       FROM pg_namespace AS namespace_info
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
       UNION ALL
       SELECT 'collation',
              jsonb_build_array(
                namespace_info.nspname,
                collation_info.collname,
                pg_get_userbyid(collation_info.collowner),
                collation_info.collprovider,
                collation_info.collisdeterministic,
                collation_info.collencoding,
                collation_info.collcollate,
                collation_info.collctype,
                collation_info.colllocale,
                collation_info.collicurules,
                collation_info.collversion,
                pg_collation_actual_version(collation_info.oid),
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_collation AS collation_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = collation_info.collnamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_collation'::regclass
        AND extension_dependency.objid = collation_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE collation_info.collnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           collation_info.collnamespace IN (SELECT oid FROM non_system_namespaces)
           OR collation_info.oid IN (SELECT oid FROM provider_referenced_collations)
           OR collation_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'relation',
              jsonb_build_array(
                namespace_info.nspname,
                relation_info.relname,
                relation_info.relkind,
                relation_info.relpersistence,
                access_method.amname,
                tablespace_info.spcname,
                pg_get_userbyid(relation_info.relowner),
                relation_info.relrowsecurity,
                relation_info.relforcerowsecurity,
                relation_info.relispopulated,
                relation_info.relreplident,
                relation_info.relispartition,
                ARRAY(
                  SELECT option_info.option
                  FROM unnest(COALESCE(relation_info.reloptions, ARRAY[]::text[]))
                    AS option_info(option)
                  ORDER BY option_info.option
                ),
                CASE
                  WHEN relation_info.relpartbound IS NOT NULL
                  THEN pg_get_expr(relation_info.relpartbound, relation_info.oid, true)
                  ELSE NULL
                END,
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        policy_info.polname,
                        policy_info.polcmd,
                        policy_info.polpermissive,
                        ARRAY(
                          SELECT CASE
                            WHEN role_info.role_oid = 0 THEN 'PUBLIC'
                            ELSE pg_get_userbyid(role_info.role_oid)
                          END
                          FROM unnest(policy_info.polroles) AS role_info(role_oid)
                          ORDER BY 1
                        ),
                        pg_get_expr(policy_info.polqual, policy_info.polrelid, true),
                        pg_get_expr(policy_info.polwithcheck, policy_info.polrelid, true)
                      )
                      ORDER BY policy_info.polname, policy_info.polcmd, policy_info.polpermissive
                    )
                    FROM pg_policy AS policy_info
                    WHERE policy_info.polrelid = relation_info.oid
                  ),
                  '[]'::jsonb
                ),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        trigger_info.tgname,
                        trigger_info.tgenabled,
                        trigger_info.tgisinternal,
                        pg_get_triggerdef(trigger_info.oid, true)
                      )
                      ORDER BY trigger_info.tgname, trigger_info.tgenabled,
                               trigger_info.tgisinternal, pg_get_triggerdef(trigger_info.oid, true)
                    )
                    FROM pg_trigger AS trigger_info
                    WHERE trigger_info.tgrelid = relation_info.oid
                  ),
                  '[]'::jsonb
                ),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        rewrite_info.rulename,
                        rewrite_info.ev_type,
                        rewrite_info.ev_enabled,
                        rewrite_info.is_instead,
                        pg_get_ruledef(rewrite_info.oid, true)
                      )
                      ORDER BY rewrite_info.rulename, rewrite_info.ev_type,
                               rewrite_info.ev_enabled, rewrite_info.is_instead,
                               pg_get_ruledef(rewrite_info.oid, true)
                    )
                    FROM pg_rewrite AS rewrite_info
                    WHERE rewrite_info.ev_class = relation_info.oid
                  ),
                  '[]'::jsonb
                ),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        constraint_info.conname,
                        constraint_info.contype,
                        constraint_info.condeferrable,
                        constraint_info.condeferred,
                        constraint_info.convalidated,
                        constraint_info.connoinherit,
                        pg_get_constraintdef(constraint_info.oid, true)
                      )
                      ORDER BY constraint_info.conname, constraint_info.contype,
                               pg_get_constraintdef(constraint_info.oid, true)
                    )
                    FROM pg_constraint AS constraint_info
                    WHERE constraint_info.conrelid = relation_info.oid
                  ),
                  '[]'::jsonb
                ),
                (
                  SELECT count(*)::integer
                  FROM pg_policy AS policy_info
                  WHERE policy_info.polrelid = relation_info.oid
                ),
                (
                  SELECT count(*)::integer
                  FROM pg_trigger AS trigger_info
                  WHERE trigger_info.tgrelid = relation_info.oid
                    AND NOT trigger_info.tgisinternal
                ),
                (
                  SELECT count(*)::integer
                  FROM pg_rewrite AS rewrite_info
                  WHERE rewrite_info.ev_class = relation_info.oid
                ),
                CASE
                  WHEN relation_info.relkind IN ('v', 'm')
                  THEN encode(
                    sha256(convert_to(pg_get_viewdef(relation_info.oid, true), 'UTF8')),
                    'hex'
                  )
                  ELSE NULL
                END,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner),
                has_schema_privilege(current_user, namespace_info.oid, 'USAGE'),
                relation_info.relacl IS NULL,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(relation_info.relacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                ),
                ARRAY(
                  SELECT privilege_info.privilege
                  FROM unnest($1::text[]) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  WHERE has_table_privilege(
                    current_user,
                    relation_info.oid,
                    privilege_info.privilege
                  )
                  ORDER BY privilege_info.position
                ),
                ARRAY(
                  SELECT privilege_info.privilege
                  FROM unnest($1::text[]) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  WHERE has_table_privilege(
                    current_user,
                    relation_info.oid,
                    privilege_info.privilege || ' WITH GRANT OPTION'
                  )
                  ORDER BY privilege_info.position
                )
              )::text
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = relation_info.relnamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_class'::regclass
        AND extension_dependency.objid = relation_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       LEFT JOIN pg_am AS access_method
         ON access_method.oid = relation_info.relam
       LEFT JOIN pg_tablespace AS tablespace_info
         ON tablespace_info.oid = relation_info.reltablespace
       WHERE relation_info.oid IN (SELECT oid FROM candidate_relations)
         AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
       UNION ALL
       SELECT 'column',
              jsonb_build_array(
                namespace_info.nspname,
                relation_info.relname,
                column_info.attnum,
                column_info.attname,
                format_type(column_info.atttypid, column_info.atttypmod),
                type_namespace.nspname,
                type_info.typname,
                collation_namespace.nspname,
                collation_info.collname,
                column_info.attnotnull,
                column_info.atthasdef,
                CASE
                  WHEN default_info.oid IS NOT NULL
                  THEN pg_get_expr(default_info.adbin, default_info.adrelid, true)
                  ELSE NULL
                END,
                column_info.attgenerated,
                column_info.attidentity,
                column_info.attndims,
                column_info.attstorage,
                column_info.attcompression,
                column_info.attislocal,
                column_info.attinhcount,
                ARRAY(
                  SELECT option_info.option
                  FROM unnest(COALESCE(column_info.attoptions, ARRAY[]::text[]))
                    AS option_info(option)
                  ORDER BY option_info.option
                ),
                ARRAY(
                  SELECT option_info.option
                  FROM unnest(COALESCE(column_info.attfdwoptions, ARRAY[]::text[]))
                    AS option_info(option)
                  ORDER BY option_info.option
                ),
                column_info.attacl IS NULL,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(column_info.attacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                ),
                ARRAY(
                  SELECT privilege_info.privilege
                  FROM unnest($2::text[]) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  WHERE has_column_privilege(
                    current_user,
                    relation_info.oid,
                    column_info.attnum,
                    privilege_info.privilege
                  )
                  ORDER BY privilege_info.position
                ),
                ARRAY(
                  SELECT privilege_info.privilege
                  FROM unnest($2::text[]) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  WHERE has_column_privilege(
                    current_user,
                    relation_info.oid,
                    column_info.attnum,
                    privilege_info.privilege || ' WITH GRANT OPTION'
                  )
                  ORDER BY privilege_info.position
                )
              )::text
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = relation_info.relnamespace
       JOIN pg_attribute AS column_info
         ON column_info.attrelid = relation_info.oid
       JOIN pg_type AS type_info
         ON type_info.oid = column_info.atttypid
       JOIN pg_namespace AS type_namespace
         ON type_namespace.oid = type_info.typnamespace
       LEFT JOIN pg_collation AS collation_info
         ON collation_info.oid = column_info.attcollation
       LEFT JOIN pg_namespace AS collation_namespace
         ON collation_namespace.oid = collation_info.collnamespace
       LEFT JOIN pg_attrdef AS default_info
         ON default_info.adrelid = column_info.attrelid
        AND default_info.adnum = column_info.attnum
       WHERE relation_info.oid IN (SELECT oid FROM candidate_relations)
         AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')
         AND column_info.attnum > 0
         AND NOT column_info.attisdropped
       UNION ALL
       SELECT 'index',
              jsonb_build_array(
                namespace_info.nspname,
                index_relation.relname,
                parent_namespace.nspname,
                parent_relation.relname,
                index_relation.relkind,
                index_relation.relpersistence,
                pg_get_userbyid(index_relation.relowner),
                access_method.amname,
                tablespace_info.spcname,
                ARRAY(
                  SELECT option_info.option
                  FROM unnest(COALESCE(index_relation.reloptions, ARRAY[]::text[]))
                    AS option_info(option)
                  ORDER BY option_info.option
                ),
                index_info.indisunique,
                index_info.indnullsnotdistinct,
                index_info.indisprimary,
                index_info.indisexclusion,
                index_info.indimmediate,
                index_info.indisclustered,
                index_info.indisvalid,
                index_info.indcheckxmin,
                index_info.indisready,
                index_info.indislive,
                index_info.indisreplident,
                index_info.indnatts,
                index_info.indnkeyatts,
                index_info.indkey::text,
                index_info.indoption::text,
                ARRAY(
                  SELECT format('%I.%I', opclass_namespace.nspname, opclass_info.opcname)
                  FROM unnest(index_info.indclass::oid[]) WITH ORDINALITY
                    AS index_opclass(opclass_oid, position)
                  JOIN pg_opclass AS opclass_info
                    ON opclass_info.oid = index_opclass.opclass_oid
                  JOIN pg_namespace AS opclass_namespace
                    ON opclass_namespace.oid = opclass_info.opcnamespace
                  ORDER BY index_opclass.position
                ),
                ARRAY(
                  SELECT CASE
                    WHEN index_collation.collation_oid = 0 THEN NULL
                    ELSE format(
                      '%I.%I',
                      collation_namespace.nspname,
                      collation_info.collname
                    )
                  END
                  FROM unnest(index_info.indcollation::oid[]) WITH ORDINALITY
                    AS index_collation(collation_oid, position)
                  LEFT JOIN pg_collation AS collation_info
                    ON collation_info.oid = index_collation.collation_oid
                  LEFT JOIN pg_namespace AS collation_namespace
                    ON collation_namespace.oid = collation_info.collnamespace
                  ORDER BY index_collation.position
                ),
                pg_get_indexdef(index_relation.oid, 0, true),
                CASE
                  WHEN index_info.indexprs IS NULL THEN NULL
                  ELSE pg_get_expr(index_info.indexprs, index_info.indrelid, true)
                END,
                CASE
                  WHEN index_info.indpred IS NULL THEN NULL
                  ELSE pg_get_expr(index_info.indpred, index_info.indrelid, true)
                END,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner),
                has_schema_privilege(current_user, namespace_info.oid, 'USAGE'),
                index_relation.relacl IS NULL,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(index_relation.relacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                )
              )::text
       FROM pg_class AS index_relation
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = index_relation.relnamespace
       JOIN pg_index AS index_info
         ON index_info.indexrelid = index_relation.oid
       JOIN pg_class AS parent_relation
         ON parent_relation.oid = index_info.indrelid
       JOIN pg_namespace AS parent_namespace
         ON parent_namespace.oid = parent_relation.relnamespace
       LEFT JOIN pg_am AS access_method
         ON access_method.oid = index_relation.relam
       LEFT JOIN pg_tablespace AS tablespace_info
         ON tablespace_info.oid = index_relation.reltablespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_class'::regclass
        AND extension_dependency.objid = index_relation.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE index_relation.oid IN (SELECT oid FROM candidate_relations)
         AND index_relation.relkind IN ('i', 'I')
       UNION ALL
       SELECT 'sequence',
              jsonb_build_array(
                namespace_info.nspname,
                sequence_info.relname,
                sequence_info.relpersistence,
                pg_get_userbyid(sequence_info.relowner),
                format_type(sequence_data.seqtypid, NULL),
                sequence_data.seqstart,
                sequence_data.seqincrement,
                sequence_data.seqmax,
                sequence_data.seqmin,
                sequence_data.seqcache,
                sequence_data.seqcycle,
                ARRAY(
                  SELECT option_info.option
                  FROM unnest(COALESCE(sequence_info.reloptions, ARRAY[]::text[]))
                    AS option_info(option)
                  ORDER BY option_info.option
                ),
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner),
                has_schema_privilege(current_user, namespace_info.oid, 'USAGE'),
                sequence_info.relacl IS NULL,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(sequence_info.relacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                ),
                ARRAY(
                  SELECT privilege_info.privilege
                  FROM unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  WHERE has_sequence_privilege(
                    current_user,
                    sequence_info.oid,
                    privilege_info.privilege
                  )
                  ORDER BY privilege_info.position
                ),
                ARRAY(
                  SELECT privilege_info.privilege
                  FROM unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) WITH ORDINALITY
                    AS privilege_info(privilege, position)
                  WHERE has_sequence_privilege(
                    current_user,
                    sequence_info.oid,
                    privilege_info.privilege || ' WITH GRANT OPTION'
                  )
                  ORDER BY privilege_info.position
                )
              )::text
       FROM pg_class AS sequence_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = sequence_info.relnamespace
       JOIN pg_sequence AS sequence_data
         ON sequence_data.seqrelid = sequence_info.oid
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_class'::regclass
        AND extension_dependency.objid = sequence_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE sequence_info.oid IN (SELECT oid FROM candidate_relations)
         AND sequence_info.relkind = 'S'
       UNION ALL
       SELECT 'routine',
              jsonb_build_array(
                namespace_info.nspname,
                routine_info.proname,
                pg_get_function_identity_arguments(routine_info.oid),
                pg_get_function_result(routine_info.oid),
                routine_info.prokind,
                pg_get_userbyid(routine_info.proowner),
                routine_info.prosecdef,
                routine_info.provolatile,
                routine_info.proparallel,
                routine_info.proleakproof,
                routine_info.proisstrict,
                CASE
                  WHEN routine_info.prosupport = 0 THEN NULL
                  ELSE routine_info.prosupport::regprocedure::text
                END,
                CASE
                  WHEN routine_info.provariadic = 0 THEN NULL
                  ELSE format_type(routine_info.provariadic, NULL)
                END,
                routine_info.procost,
                routine_info.prorows,
                language_info.lanname,
                routine_info.proconfig,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner),
                has_schema_privilege(current_user, namespace_info.oid, 'USAGE'),
                routine_info.proacl IS NULL,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(routine_info.proacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                ),
                has_function_privilege(current_user, routine_info.oid, 'EXECUTE'),
                has_function_privilege(
                  current_user,
                  routine_info.oid,
                  'EXECUTE WITH GRANT OPTION'
                ),
                CASE
                  WHEN routine_info.prokind = 'a'
                  THEN jsonb_build_array(
                    aggregate_info.aggkind,
                    aggregate_info.aggnumdirectargs,
                    aggregate_info.aggtransfn::regprocedure::text,
                    CASE
                      WHEN aggregate_info.aggfinalfn = 0 THEN NULL
                      ELSE aggregate_info.aggfinalfn::regprocedure::text
                    END,
                    CASE
                      WHEN aggregate_info.aggcombinefn = 0 THEN NULL
                      ELSE aggregate_info.aggcombinefn::regprocedure::text
                    END,
                    CASE
                      WHEN aggregate_info.aggserialfn = 0 THEN NULL
                      ELSE aggregate_info.aggserialfn::regprocedure::text
                    END,
                    CASE
                      WHEN aggregate_info.aggdeserialfn = 0 THEN NULL
                      ELSE aggregate_info.aggdeserialfn::regprocedure::text
                    END,
                    CASE
                      WHEN aggregate_info.aggmtransfn = 0 THEN NULL
                      ELSE aggregate_info.aggmtransfn::regprocedure::text
                    END,
                    CASE
                      WHEN aggregate_info.aggminvtransfn = 0 THEN NULL
                      ELSE aggregate_info.aggminvtransfn::regprocedure::text
                    END,
                    CASE
                      WHEN aggregate_info.aggmfinalfn = 0 THEN NULL
                      ELSE aggregate_info.aggmfinalfn::regprocedure::text
                    END,
                    aggregate_info.aggfinalextra,
                    aggregate_info.aggmfinalextra,
                    aggregate_info.aggfinalmodify,
                    aggregate_info.aggmfinalmodify,
                    CASE
                      WHEN aggregate_info.aggsortop = 0 THEN NULL
                      ELSE aggregate_info.aggsortop::regoperator::text
                    END,
                    format_type(aggregate_info.aggtranstype, NULL),
                    aggregate_info.aggtransspace,
                    CASE
                      WHEN aggregate_info.aggmtranstype = 0 THEN NULL
                      ELSE format_type(aggregate_info.aggmtranstype, NULL)
                    END,
                    aggregate_info.aggmtransspace,
                    aggregate_info.agginitval,
                    aggregate_info.aggminitval
                  )
                  ELSE NULL
                END,
                CASE
                  WHEN routine_info.prokind = 'a' THEN NULL
                  ELSE encode(
                    sha256(convert_to(pg_get_functiondef(routine_info.oid), 'UTF8')),
                    'hex'
                  )
                END
              )::text
       FROM pg_proc AS routine_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = routine_info.pronamespace
       JOIN pg_language AS language_info
         ON language_info.oid = routine_info.prolang
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_proc'::regclass
        AND extension_dependency.objid = routine_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       LEFT JOIN pg_aggregate AS aggregate_info
         ON aggregate_info.aggfnoid = routine_info.oid
       WHERE routine_info.oid IN (SELECT oid FROM candidate_routines)
       UNION ALL
       SELECT 'conversion_path',
              jsonb_build_array(
                namespace_info.nspname,
                conversion_info.conname,
                pg_get_userbyid(conversion_info.conowner),
                pg_encoding_to_char(conversion_info.conforencoding),
                pg_encoding_to_char(conversion_info.contoencoding),
                conversion_info.condefault,
                routine_namespace.nspname,
                routine_info.proname,
                pg_get_function_identity_arguments(routine_info.oid),
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_conversion AS conversion_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = conversion_info.connamespace
       JOIN pg_proc AS routine_info
         ON routine_info.oid = conversion_info.conproc
       JOIN pg_namespace AS routine_namespace
         ON routine_namespace.oid = routine_info.pronamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_conversion'::regclass
        AND extension_dependency.objid = conversion_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE conversion_info.connamespace IN (SELECT oid FROM permanent_namespaces)
         AND routine_info.pronamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           conversion_info.connamespace IN (SELECT oid FROM non_system_namespaces)
           OR routine_info.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR conversion_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'type',
              jsonb_build_array(
                namespace_info.nspname,
                type_info.typname,
                type_info.typtype,
                type_info.typcategory,
                type_info.typispreferred,
                type_info.typisdefined,
                pg_get_userbyid(type_info.typowner),
                type_info.typlen,
                type_info.typbyval,
                type_info.typalign,
                type_info.typstorage,
                type_info.typdelim,
                type_info.typnotnull,
                type_info.typtypmod,
                type_info.typndims,
                CASE
                  WHEN type_info.typinput = 0 THEN NULL
                  ELSE type_info.typinput::regprocedure::text
                END,
                CASE
                  WHEN type_info.typoutput = 0 THEN NULL
                  ELSE type_info.typoutput::regprocedure::text
                END,
                CASE
                  WHEN type_info.typreceive = 0 THEN NULL
                  ELSE type_info.typreceive::regprocedure::text
                END,
                CASE
                  WHEN type_info.typsend = 0 THEN NULL
                  ELSE type_info.typsend::regprocedure::text
                END,
                CASE
                  WHEN type_info.typmodin = 0 THEN NULL
                  ELSE type_info.typmodin::regprocedure::text
                END,
                CASE
                  WHEN type_info.typmodout = 0 THEN NULL
                  ELSE type_info.typmodout::regprocedure::text
                END,
                CASE
                  WHEN type_info.typanalyze = 0 THEN NULL
                  ELSE type_info.typanalyze::regprocedure::text
                END,
                CASE
                  WHEN type_info.typsubscript = 0 THEN NULL
                  ELSE type_info.typsubscript::regprocedure::text
                END,
                CASE
                  WHEN type_info.typbasetype = 0 THEN NULL
                  ELSE format_type(type_info.typbasetype, NULL)
                END,
                CASE
                  WHEN type_info.typelem = 0 THEN NULL
                  ELSE format_type(type_info.typelem, NULL)
                END,
                CASE
                  WHEN type_info.typarray = 0 THEN NULL
                  ELSE format_type(type_info.typarray, NULL)
                END,
                type_relation_namespace.nspname,
                type_relation.relname,
                collation_namespace.nspname,
                collation_info.collname,
                COALESCE(
                  pg_get_expr(type_info.typdefaultbin, 0, true),
                  type_info.typdefault
                ),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        enum_info.enumlabel,
                        enum_info.enumsortorder
                      )
                      ORDER BY enum_info.enumsortorder, enum_info.enumlabel
                    )
                    FROM pg_enum AS enum_info
                    WHERE enum_info.enumtypid = type_info.oid
                  ),
                  '[]'::jsonb
                ),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        constraint_info.conname,
                        constraint_info.contype,
                        constraint_info.condeferrable,
                        constraint_info.condeferred,
                        constraint_info.convalidated,
                        pg_get_constraintdef(constraint_info.oid, true)
                      )
                      ORDER BY constraint_info.conname, constraint_info.contype,
                               pg_get_constraintdef(constraint_info.oid, true)
                    )
                    FROM pg_constraint AS constraint_info
                    WHERE constraint_info.contypid = type_info.oid
                  ),
                  '[]'::jsonb
                ),
                CASE
                  WHEN range_info.rngsubtype IS NULL THEN NULL
                  ELSE format_type(range_info.rngsubtype, NULL)
                END,
                CASE
                  WHEN range_info.rngmultitypid IS NULL THEN NULL
                  ELSE format_type(range_info.rngmultitypid, NULL)
                END,
                range_collation_namespace.nspname,
                range_collation.collname,
                range_opclass_namespace.nspname,
                range_opclass.opcname,
                CASE
                  WHEN range_info.rngcanonical = 0 THEN NULL
                  ELSE range_info.rngcanonical::regprocedure::text
                END,
                CASE
                  WHEN range_info.rngsubdiff = 0 THEN NULL
                  ELSE range_info.rngsubdiff::regprocedure::text
                END,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner),
                has_schema_privilege(current_user, namespace_info.oid, 'USAGE'),
                type_info.typacl IS NULL,
                EXISTS (
                  SELECT 1
                  FROM aclexplode(type_info.typacl) AS acl_info
                  WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
                ),
                has_type_privilege(current_user, type_info.oid, 'USAGE'),
                has_type_privilege(
                  current_user,
                  type_info.oid,
                  'USAGE WITH GRANT OPTION'
                )
              )::text
       FROM pg_type AS type_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = type_info.typnamespace
       LEFT JOIN pg_class AS type_relation
         ON type_relation.oid = type_info.typrelid
       LEFT JOIN pg_namespace AS type_relation_namespace
         ON type_relation_namespace.oid = type_relation.relnamespace
       LEFT JOIN pg_collation AS collation_info
         ON collation_info.oid = type_info.typcollation
       LEFT JOIN pg_namespace AS collation_namespace
         ON collation_namespace.oid = collation_info.collnamespace
       LEFT JOIN pg_range AS range_info
         ON type_info.oid = range_info.rngtypid
         OR type_info.oid = range_info.rngmultitypid
       LEFT JOIN pg_collation AS range_collation
         ON range_collation.oid = range_info.rngcollation
       LEFT JOIN pg_namespace AS range_collation_namespace
         ON range_collation_namespace.oid = range_collation.collnamespace
       LEFT JOIN pg_opclass AS range_opclass
         ON range_opclass.oid = range_info.rngsubopc
       LEFT JOIN pg_namespace AS range_opclass_namespace
         ON range_opclass_namespace.oid = range_opclass.opcnamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_type'::regclass
        AND extension_dependency.objid = type_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE type_info.oid IN (SELECT oid FROM candidate_types)
         AND type_info.typtype IN ('b', 'c', 'd', 'e', 'r', 'm', 'p')
       UNION ALL
       SELECT 'opclass_path',
              jsonb_build_array(
                opclass_namespace.nspname,
                opclass_info.opcname,
                pg_get_userbyid(opclass_info.opcowner),
                access_method.amname,
                access_method.amtype,
                access_method.amhandler::regprocedure::text,
                opclass_info.opcdefault,
                family_namespace.nspname,
                family_info.opfname,
                pg_get_userbyid(family_info.opfowner),
                input_type_namespace.nspname,
                input_type.typname,
                format_type(input_type.oid, NULL),
                storage_type_namespace.nspname,
                storage_type.typname,
                CASE
                  WHEN storage_type.oid IS NULL THEN NULL
                  ELSE format_type(storage_type.oid, NULL)
                END,
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      operator_map_item.item
                      ORDER BY operator_map_item.item::text COLLATE "C"
                    )
                    FROM (
                      SELECT jsonb_build_array(
                        operator_map.amopstrategy,
                        operator_map.amoppurpose,
                        map_method.amname,
                        left_type_namespace.nspname,
                        format_type(left_type.oid, NULL),
                        right_type_namespace.nspname,
                        format_type(right_type.oid, NULL),
                        operator_namespace.nspname,
                        operator_info.oprname,
                        operator_routine_namespace.nspname,
                        operator_routine.proname,
                        pg_get_function_identity_arguments(operator_routine.oid),
                        sort_family_namespace.nspname,
                        sort_family.opfname
                      ) AS item
                      FROM pg_amop AS operator_map
                      JOIN pg_am AS map_method
                        ON map_method.oid = operator_map.amopmethod
                      JOIN pg_type AS left_type
                        ON left_type.oid = operator_map.amoplefttype
                      JOIN pg_namespace AS left_type_namespace
                        ON left_type_namespace.oid = left_type.typnamespace
                      JOIN pg_type AS right_type
                        ON right_type.oid = operator_map.amoprighttype
                      JOIN pg_namespace AS right_type_namespace
                        ON right_type_namespace.oid = right_type.typnamespace
                      JOIN pg_operator AS operator_info
                        ON operator_info.oid = operator_map.amopopr
                      JOIN pg_namespace AS operator_namespace
                        ON operator_namespace.oid = operator_info.oprnamespace
                      JOIN pg_proc AS operator_routine
                        ON operator_routine.oid = operator_info.oprcode
                      JOIN pg_namespace AS operator_routine_namespace
                        ON operator_routine_namespace.oid = operator_routine.pronamespace
                      LEFT JOIN pg_opfamily AS sort_family
                        ON sort_family.oid = operator_map.amopsortfamily
                      LEFT JOIN pg_namespace AS sort_family_namespace
                        ON sort_family_namespace.oid = sort_family.opfnamespace
                      WHERE operator_map.amopfamily = family_info.oid
                        AND operator_namespace.oid IN (SELECT oid FROM permanent_namespaces)
                        AND operator_routine_namespace.oid IN (
                          SELECT oid FROM permanent_namespaces
                        )
                        AND left_type_namespace.oid IN (SELECT oid FROM permanent_namespaces)
                        AND right_type_namespace.oid IN (SELECT oid FROM permanent_namespaces)
                        AND (
                          sort_family_namespace.oid IS NULL
                          OR sort_family_namespace.oid IN (SELECT oid FROM permanent_namespaces)
                        )
                    ) AS operator_map_item
                  ),
                  '[]'::jsonb
                ),
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      support_map_item.item
                      ORDER BY support_map_item.item::text COLLATE "C"
                    )
                    FROM (
                      SELECT jsonb_build_array(
                        support_map.amprocnum,
                        left_type_namespace.nspname,
                        format_type(left_type.oid, NULL),
                        right_type_namespace.nspname,
                        format_type(right_type.oid, NULL),
                        support_namespace.nspname,
                        support_routine.proname,
                        pg_get_function_identity_arguments(support_routine.oid)
                      ) AS item
                      FROM pg_amproc AS support_map
                      JOIN pg_type AS left_type
                        ON left_type.oid = support_map.amproclefttype
                      JOIN pg_namespace AS left_type_namespace
                        ON left_type_namespace.oid = left_type.typnamespace
                      JOIN pg_type AS right_type
                        ON right_type.oid = support_map.amprocrighttype
                      JOIN pg_namespace AS right_type_namespace
                        ON right_type_namespace.oid = right_type.typnamespace
                      JOIN pg_proc AS support_routine
                        ON support_routine.oid = support_map.amproc
                      JOIN pg_namespace AS support_namespace
                        ON support_namespace.oid = support_routine.pronamespace
                      WHERE support_map.amprocfamily = family_info.oid
                        AND support_namespace.oid IN (SELECT oid FROM permanent_namespaces)
                        AND left_type_namespace.oid IN (SELECT oid FROM permanent_namespaces)
                        AND right_type_namespace.oid IN (SELECT oid FROM permanent_namespaces)
                    ) AS support_map_item
                  ),
                  '[]'::jsonb
                ),
                opclass_extension.extname,
                opclass_extension.extversion,
                opclass_extension_namespace.nspname,
                pg_get_userbyid(opclass_extension.extowner),
                family_extension.extname,
                family_extension.extversion,
                family_extension_namespace.nspname,
                pg_get_userbyid(family_extension.extowner)
              )::text
       FROM selected_opclasses AS selected_opclass
       JOIN pg_opclass AS opclass_info
         ON opclass_info.oid = selected_opclass.oid
       JOIN pg_namespace AS opclass_namespace
         ON opclass_namespace.oid = opclass_info.opcnamespace
       JOIN pg_am AS access_method
         ON access_method.oid = opclass_info.opcmethod
       JOIN pg_opfamily AS family_info
         ON family_info.oid = opclass_info.opcfamily
       JOIN pg_namespace AS family_namespace
         ON family_namespace.oid = family_info.opfnamespace
       JOIN pg_type AS input_type
         ON input_type.oid = opclass_info.opcintype
       JOIN pg_namespace AS input_type_namespace
         ON input_type_namespace.oid = input_type.typnamespace
       LEFT JOIN pg_type AS storage_type
         ON storage_type.oid = opclass_info.opckeytype
       LEFT JOIN pg_namespace AS storage_type_namespace
         ON storage_type_namespace.oid = storage_type.typnamespace
       LEFT JOIN pg_depend AS opclass_extension_dependency
         ON opclass_extension_dependency.classid = 'pg_opclass'::regclass
        AND opclass_extension_dependency.objid = opclass_info.oid
        AND opclass_extension_dependency.objsubid = 0
        AND opclass_extension_dependency.refclassid = 'pg_extension'::regclass
        AND opclass_extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS opclass_extension
         ON opclass_extension.oid = opclass_extension_dependency.refobjid
       LEFT JOIN pg_namespace AS opclass_extension_namespace
         ON opclass_extension_namespace.oid = opclass_extension.extnamespace
       LEFT JOIN pg_depend AS family_extension_dependency
         ON family_extension_dependency.classid = 'pg_opfamily'::regclass
        AND family_extension_dependency.objid = family_info.oid
        AND family_extension_dependency.objsubid = 0
        AND family_extension_dependency.refclassid = 'pg_extension'::regclass
        AND family_extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS family_extension
         ON family_extension.oid = family_extension_dependency.refobjid
       LEFT JOIN pg_namespace AS family_extension_namespace
         ON family_extension_namespace.oid = family_extension.extnamespace
       UNION ALL
       SELECT 'operator_path',
              jsonb_build_array(
                operator_namespace.nspname,
                operator_info.oprname,
                operator_info.oprkind,
                operator_info.oprcanmerge,
                operator_info.oprcanhash,
                pg_get_userbyid(operator_info.oprowner),
                CASE
                  WHEN operator_info.oprleft = 0 THEN NULL
                  ELSE format_type(operator_info.oprleft, NULL)
                END,
                left_type_namespace.nspname,
                CASE
                  WHEN operator_info.oprright = 0 THEN NULL
                  ELSE format_type(operator_info.oprright, NULL)
                END,
                right_type_namespace.nspname,
                CASE
                  WHEN operator_info.oprresult = 0 THEN NULL
                  ELSE format_type(operator_info.oprresult, NULL)
                END,
                result_type_namespace.nspname,
                routine_namespace.nspname,
                routine_info.proname,
                CASE
                  WHEN routine_info.oid IS NULL THEN NULL
                  ELSE pg_get_function_identity_arguments(routine_info.oid)
                END,
                CASE
                  WHEN operator_info.oprcom = 0 THEN NULL
                  ELSE operator_info.oprcom::regoperator::text
                END,
                CASE
                  WHEN operator_info.oprnegate = 0 THEN NULL
                  ELSE operator_info.oprnegate::regoperator::text
                END,
                CASE
                  WHEN operator_info.oprrest = 0 THEN NULL
                  ELSE operator_info.oprrest::regprocedure::text
                END,
                restriction_namespace.nspname,
                CASE
                  WHEN operator_info.oprjoin = 0 THEN NULL
                  ELSE operator_info.oprjoin::regprocedure::text
                END,
                join_namespace.nspname,
                commutator_namespace.nspname,
                negator_namespace.nspname,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_operator AS operator_info
       JOIN pg_namespace AS operator_namespace
         ON operator_namespace.oid = operator_info.oprnamespace
       LEFT JOIN pg_type AS left_type
         ON left_type.oid = operator_info.oprleft
       LEFT JOIN pg_namespace AS left_type_namespace
         ON left_type_namespace.oid = left_type.typnamespace
       LEFT JOIN pg_type AS right_type
         ON right_type.oid = operator_info.oprright
       LEFT JOIN pg_namespace AS right_type_namespace
         ON right_type_namespace.oid = right_type.typnamespace
       LEFT JOIN pg_type AS result_type
         ON result_type.oid = operator_info.oprresult
       LEFT JOIN pg_namespace AS result_type_namespace
         ON result_type_namespace.oid = result_type.typnamespace
       LEFT JOIN pg_proc AS routine_info
         ON routine_info.oid = operator_info.oprcode
       LEFT JOIN pg_namespace AS routine_namespace
         ON routine_namespace.oid = routine_info.pronamespace
       LEFT JOIN pg_proc AS restriction_routine
         ON restriction_routine.oid = operator_info.oprrest
       LEFT JOIN pg_namespace AS restriction_namespace
         ON restriction_namespace.oid = restriction_routine.pronamespace
       LEFT JOIN pg_proc AS join_routine
         ON join_routine.oid = operator_info.oprjoin
       LEFT JOIN pg_namespace AS join_namespace
         ON join_namespace.oid = join_routine.pronamespace
       LEFT JOIN pg_operator AS commutator_operator
         ON commutator_operator.oid = operator_info.oprcom
       LEFT JOIN pg_namespace AS commutator_namespace
         ON commutator_namespace.oid = commutator_operator.oprnamespace
       LEFT JOIN pg_operator AS negator_operator
         ON negator_operator.oid = operator_info.oprnegate
       LEFT JOIN pg_namespace AS negator_namespace
         ON negator_namespace.oid = negator_operator.oprnamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_operator'::regclass
        AND extension_dependency.objid = operator_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE operator_info.oprnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           operator_info.oprnamespace IN (SELECT oid FROM non_system_namespaces)
           OR routine_info.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR left_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR right_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR result_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR restriction_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR join_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR commutator_operator.oprnamespace IN (SELECT oid FROM non_system_namespaces)
           OR negator_operator.oprnamespace IN (SELECT oid FROM non_system_namespaces)
           OR operator_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'cast_path',
              jsonb_build_array(
                source_namespace.nspname,
                source_type.typname,
                format_type(source_type.oid, NULL),
                target_namespace.nspname,
                target_type.typname,
                format_type(target_type.oid, NULL),
                cast_info.castcontext,
                cast_info.castmethod,
                routine_namespace.nspname,
                routine_info.proname,
                CASE
                  WHEN routine_info.oid IS NULL THEN NULL
                  ELSE pg_get_function_identity_arguments(routine_info.oid)
                END,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_cast AS cast_info
       JOIN pg_type AS source_type
         ON source_type.oid = cast_info.castsource
       JOIN pg_namespace AS source_namespace
         ON source_namespace.oid = source_type.typnamespace
       JOIN pg_type AS target_type
         ON target_type.oid = cast_info.casttarget
       JOIN pg_namespace AS target_namespace
         ON target_namespace.oid = target_type.typnamespace
       LEFT JOIN pg_proc AS routine_info
         ON routine_info.oid = cast_info.castfunc
       LEFT JOIN pg_namespace AS routine_namespace
         ON routine_namespace.oid = routine_info.pronamespace
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_cast'::regclass
        AND extension_dependency.objid = cast_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE source_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
         AND target_type.typnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           routine_info.oid IS NULL
           OR routine_info.pronamespace IN (SELECT oid FROM permanent_namespaces)
         )
         AND (
           source_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR target_type.typnamespace IN (SELECT oid FROM non_system_namespaces)
           OR routine_info.pronamespace IN (SELECT oid FROM non_system_namespaces)
           -- PostgreSQL reserves OIDs below FirstNormalObjectId (16384) for
           -- initdb objects; normal user/provider cast rows must never be hidden
           -- merely because both endpoint Types live in pg_catalog.
           OR cast_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'text_search_path',
              jsonb_build_array(
                'parser',
                namespace_info.nspname,
                parser_info.prsname,
                start_routine.oid::regprocedure::text,
                token_routine.oid::regprocedure::text,
                end_routine.oid::regprocedure::text,
                headline_routine.oid::regprocedure::text,
                lextype_routine.oid::regprocedure::text,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_ts_parser AS parser_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = parser_info.prsnamespace
       JOIN pg_proc AS start_routine
         ON start_routine.oid = parser_info.prsstart
       JOIN pg_proc AS token_routine
         ON token_routine.oid = parser_info.prstoken
       JOIN pg_proc AS end_routine
         ON end_routine.oid = parser_info.prsend
       LEFT JOIN pg_proc AS headline_routine
         ON headline_routine.oid = parser_info.prsheadline
       JOIN pg_proc AS lextype_routine
         ON lextype_routine.oid = parser_info.prslextype
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_ts_parser'::regclass
        AND extension_dependency.objid = parser_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE parser_info.prsnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           parser_info.prsnamespace IN (SELECT oid FROM non_system_namespaces)
           OR start_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR token_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR end_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR headline_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR lextype_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR parser_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'text_search_path',
              jsonb_build_array(
                'template',
                namespace_info.nspname,
                template_info.tmplname,
                CASE
                  WHEN init_routine.oid IS NULL THEN NULL
                  ELSE init_routine.oid::regprocedure::text
                END,
                lexize_routine.oid::regprocedure::text,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_ts_template AS template_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = template_info.tmplnamespace
       LEFT JOIN pg_proc AS init_routine
         ON init_routine.oid = template_info.tmplinit
       JOIN pg_proc AS lexize_routine
         ON lexize_routine.oid = template_info.tmpllexize
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_ts_template'::regclass
        AND extension_dependency.objid = template_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE template_info.tmplnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           template_info.tmplnamespace IN (SELECT oid FROM non_system_namespaces)
           OR init_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR lexize_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR template_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'text_search_path',
              jsonb_build_array(
                'dictionary',
                namespace_info.nspname,
                dictionary_info.dictname,
                pg_get_userbyid(dictionary_info.dictowner),
                template_namespace.nspname,
                template_info.tmplname,
                dictionary_info.dictinitoption,
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_ts_dict AS dictionary_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = dictionary_info.dictnamespace
       JOIN pg_ts_template AS template_info
         ON template_info.oid = dictionary_info.dicttemplate
       JOIN pg_namespace AS template_namespace
         ON template_namespace.oid = template_info.tmplnamespace
       LEFT JOIN pg_proc AS init_routine
         ON init_routine.oid = template_info.tmplinit
       JOIN pg_proc AS lexize_routine
         ON lexize_routine.oid = template_info.tmpllexize
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_ts_dict'::regclass
        AND extension_dependency.objid = dictionary_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE dictionary_info.dictnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           dictionary_info.dictnamespace IN (SELECT oid FROM non_system_namespaces)
           OR template_info.tmplnamespace IN (SELECT oid FROM non_system_namespaces)
           OR init_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR lexize_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR dictionary_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'text_search_path',
              jsonb_build_array(
                'configuration',
                namespace_info.nspname,
                config_info.cfgname,
                pg_get_userbyid(config_info.cfgowner),
                parser_namespace.nspname,
                parser_info.prsname,
                COALESCE(
                  (
                    SELECT jsonb_agg(
                      jsonb_build_array(
                        mapping_info.maptokentype,
                        mapping_info.mapseqno,
                        dictionary_namespace.nspname,
                        dictionary_info.dictname,
                        template_namespace.nspname,
                        template_info.tmplname
                      )
                      ORDER BY mapping_info.maptokentype, mapping_info.mapseqno,
                               dictionary_namespace.nspname COLLATE "C",
                               dictionary_info.dictname COLLATE "C"
                    )
                    FROM pg_ts_config_map AS mapping_info
                    JOIN pg_ts_dict AS dictionary_info
                      ON dictionary_info.oid = mapping_info.mapdict
                    JOIN pg_namespace AS dictionary_namespace
                      ON dictionary_namespace.oid = dictionary_info.dictnamespace
                    JOIN pg_ts_template AS template_info
                      ON template_info.oid = dictionary_info.dicttemplate
                    JOIN pg_namespace AS template_namespace
                      ON template_namespace.oid = template_info.tmplnamespace
                    WHERE mapping_info.mapcfg = config_info.oid
                  ),
                  '[]'::jsonb
                ),
                extension_info.extname,
                extension_info.extversion,
                extension_namespace.nspname,
                pg_get_userbyid(extension_info.extowner)
              )::text
       FROM pg_ts_config AS config_info
       JOIN pg_namespace AS namespace_info
         ON namespace_info.oid = config_info.cfgnamespace
       JOIN pg_ts_parser AS parser_info
         ON parser_info.oid = config_info.cfgparser
       JOIN pg_namespace AS parser_namespace
         ON parser_namespace.oid = parser_info.prsnamespace
       JOIN pg_proc AS start_routine
         ON start_routine.oid = parser_info.prsstart
       JOIN pg_proc AS token_routine
         ON token_routine.oid = parser_info.prstoken
       JOIN pg_proc AS end_routine
         ON end_routine.oid = parser_info.prsend
       LEFT JOIN pg_proc AS headline_routine
         ON headline_routine.oid = parser_info.prsheadline
       JOIN pg_proc AS lextype_routine
         ON lextype_routine.oid = parser_info.prslextype
       LEFT JOIN pg_depend AS extension_dependency
         ON extension_dependency.classid = 'pg_ts_config'::regclass
        AND extension_dependency.objid = config_info.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
       LEFT JOIN pg_extension AS extension_info
         ON extension_info.oid = extension_dependency.refobjid
       LEFT JOIN pg_namespace AS extension_namespace
         ON extension_namespace.oid = extension_info.extnamespace
       WHERE config_info.cfgnamespace IN (SELECT oid FROM permanent_namespaces)
         AND (
           config_info.cfgnamespace IN (SELECT oid FROM non_system_namespaces)
           OR parser_info.prsnamespace IN (SELECT oid FROM non_system_namespaces)
           OR start_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR token_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR end_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR headline_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR lextype_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
           OR EXISTS (
            SELECT 1
            FROM pg_ts_config_map AS mapping_info
            JOIN pg_ts_dict AS dictionary_info
              ON dictionary_info.oid = mapping_info.mapdict
            JOIN pg_ts_template AS template_info
              ON template_info.oid = dictionary_info.dicttemplate
            LEFT JOIN pg_proc AS init_routine
              ON init_routine.oid = template_info.tmplinit
            JOIN pg_proc AS lexize_routine
              ON lexize_routine.oid = template_info.tmpllexize
            WHERE mapping_info.mapcfg = config_info.oid
              AND (
                dictionary_info.dictnamespace IN (SELECT oid FROM non_system_namespaces)
                OR template_info.tmplnamespace IN (SELECT oid FROM non_system_namespaces)
                OR init_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
                OR lexize_routine.pronamespace IN (SELECT oid FROM non_system_namespaces)
              )
           )
           OR config_info.oid >= 16384
           OR extension_info.oid IS NOT NULL
         )
       UNION ALL
       SELECT 'inheritance',
              jsonb_build_array(
                child_namespace.nspname,
                child_relation.relname,
                parent_namespace.nspname,
                parent_relation.relname,
                inheritance_info.inhseqno
              )::text
       FROM pg_inherits AS inheritance_info
       JOIN pg_class AS child_relation
         ON child_relation.oid = inheritance_info.inhrelid
       JOIN pg_namespace AS child_namespace
         ON child_namespace.oid = child_relation.relnamespace
       JOIN pg_class AS parent_relation
         ON parent_relation.oid = inheritance_info.inhparent
       JOIN pg_namespace AS parent_namespace
         ON parent_namespace.oid = parent_relation.relnamespace
       WHERE child_namespace.oid IN (SELECT oid FROM permanent_namespaces)
         AND parent_namespace.oid IN (SELECT oid FROM permanent_namespaces)
         AND (
           child_relation.oid IN (SELECT oid FROM candidate_relations)
           OR parent_relation.oid IN (SELECT oid FROM candidate_relations)
         )
     ),
     provider_inventory_base AS (
       SELECT 'provider_contract'::text AS object_type,
              category_info.category::text AS object_name,
              count(inventory_info.item)::integer AS row_count,
              encode(
                sha256(
                  convert_to(
                    COALESCE(
                      string_agg(
                        inventory_info.item,
                        E'\\n'
                        ORDER BY inventory_info.item COLLATE "C"
                      ),
                      ''
                    ),
                    'UTF8'
                  )
                ),
                'hex'
              ) AS fingerprint
       FROM inventory_categories AS category_info
       LEFT JOIN inventory AS inventory_info
         ON inventory_info.category = category_info.category
       WHERE current_database() IN ('postgres', 'template1')
       GROUP BY category_info.category
     ),
     violations AS (
       SELECT 'schema'::text AS object_type,
              namespace_info.nspname::text AS object_name
       FROM pg_namespace AS namespace_info
       WHERE namespace_info.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND namespace_info.nspname !~ '^pg_temp_[0-9]+$'
         AND namespace_info.nspname !~ '^pg_toast_temp_[0-9]+$'
         AND (
           pg_get_userbyid(namespace_info.nspowner) = session_user
           OR has_schema_privilege(current_user, namespace_info.oid, 'CREATE')
           OR has_schema_privilege(current_user, namespace_info.oid, 'CREATE WITH GRANT OPTION')
           OR has_schema_privilege(current_user, namespace_info.oid, 'USAGE WITH GRANT OPTION')
           OR (
             namespace_info.nspname <> 'public'
             AND has_schema_privilege(current_user, namespace_info.oid, 'USAGE')
           )
         )
       UNION ALL
       SELECT DISTINCT 'relation',
              format('%I.%I', namespace_info.nspname, relation_info.relname)
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
       CROSS JOIN unnest($1::text[]) AS privilege_info(privilege)
       WHERE relation_info.oid IN (SELECT oid FROM candidate_relations)
         AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND (
           pg_get_userbyid(relation_info.relowner) = session_user
           OR has_table_privilege(current_user, relation_info.oid, privilege_info.privilege)
           OR has_table_privilege(
             current_user,
             relation_info.oid,
             privilege_info.privilege || ' WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'column',
              format(
                '%I.%I.%I',
                namespace_info.nspname,
                relation_info.relname,
                column_info.attname
              )
       FROM pg_class AS relation_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = relation_info.relnamespace
       JOIN pg_attribute AS column_info ON column_info.attrelid = relation_info.oid
       CROSS JOIN unnest($2::text[]) AS privilege_info(privilege)
       WHERE relation_info.oid IN (SELECT oid FROM candidate_relations)
         AND relation_info.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND column_info.attnum > 0
         AND NOT column_info.attisdropped
         AND (
           has_column_privilege(
             current_user,
             relation_info.oid,
             column_info.attnum,
             privilege_info.privilege
           )
           OR has_column_privilege(
             current_user,
             relation_info.oid,
             column_info.attnum,
             privilege_info.privilege || ' WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'sequence',
              format('%I.%I', namespace_info.nspname, sequence_info.relname)
       FROM pg_class AS sequence_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = sequence_info.relnamespace
       CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS privilege_info(privilege)
       WHERE sequence_info.oid IN (SELECT oid FROM candidate_relations)
         AND sequence_info.relkind = 'S'
         AND (
           pg_get_userbyid(sequence_info.relowner) = session_user
           OR has_sequence_privilege(current_user, sequence_info.oid, privilege_info.privilege)
           OR has_sequence_privilege(
             current_user,
             sequence_info.oid,
             privilege_info.privilege || ' WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'routine',
              format(
                '%I.%I(%s)',
                namespace_info.nspname,
                routine_info.proname,
                pg_get_function_identity_arguments(routine_info.oid)
              )
       FROM pg_proc AS routine_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = routine_info.pronamespace
       WHERE routine_info.oid IN (SELECT oid FROM candidate_routines)
         AND (
           pg_get_userbyid(routine_info.proowner) = session_user
           OR has_function_privilege(current_user, routine_info.oid, 'EXECUTE')
           OR has_function_privilege(
             current_user,
             routine_info.oid,
             'EXECUTE WITH GRANT OPTION'
           )
         )
       UNION ALL
       SELECT DISTINCT 'type',
              format('%I.%I', namespace_info.nspname, type_info.typname)
       FROM pg_type AS type_info
       JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
       WHERE type_info.oid IN (SELECT oid FROM candidate_types)
         AND type_info.typtype IN ('b', 'c', 'd', 'e', 'r', 'm', 'p')
         AND (
           pg_get_userbyid(type_info.typowner) = session_user
           OR has_type_privilege(current_user, type_info.oid, 'USAGE')
           OR has_type_privilege(current_user, type_info.oid, 'USAGE WITH GRANT OPTION')
         )
       UNION ALL
       SELECT inventory_info.category,
              encode(
                sha256(convert_to(inventory_info.item, 'UTF8')),
                'hex'
              )
       FROM inventory AS inventory_info
       WHERE inventory_info.category IN (
         'access_method_path',
         'cast_path',
         'cluster_acl',
         'collation',
         'conversion_path',
         'event_trigger_path',
         'inheritance',
         'language_path',
         'opclass_path',
         'operator_path',
         'runtime_ownership',
         'system_acl',
         'system_schema_access',
         'text_search_path'
       )
       UNION ALL
       SELECT 'large_object', large_object_info.oid::text
       FROM pg_largeobject_metadata AS large_object_info
       WHERE has_largeobject_privilege(current_user, large_object_info.oid, 'SELECT')
          OR has_largeobject_privilege(current_user, large_object_info.oid, 'UPDATE')
       UNION ALL
       SELECT 'foreign_data_wrapper', wrapper_info.fdwname::text
       FROM pg_foreign_data_wrapper AS wrapper_info
       WHERE pg_get_userbyid(wrapper_info.fdwowner) = session_user
          OR has_foreign_data_wrapper_privilege(current_user, wrapper_info.oid, 'USAGE')
          OR has_foreign_data_wrapper_privilege(
            current_user,
            wrapper_info.oid,
            'USAGE WITH GRANT OPTION'
          )
       UNION ALL
       SELECT 'foreign_server', server_info.srvname::text
       FROM pg_foreign_server AS server_info
       WHERE pg_get_userbyid(server_info.srvowner) = session_user
          OR has_server_privilege(current_user, server_info.oid, 'USAGE')
          OR has_server_privilege(
            current_user,
            server_info.oid,
            'USAGE WITH GRANT OPTION'
          )
       UNION ALL
       SELECT 'extension', extension_info.extname::text
       FROM pg_extension AS extension_info
       WHERE pg_get_userbyid(extension_info.extowner) = session_user
       UNION ALL
       SELECT 'default_acl',
              format('%I:%s', owner_info.rolname, default_acl.defaclobjtype)
       FROM pg_default_acl AS default_acl
       JOIN pg_roles AS owner_info ON owner_info.oid = default_acl.defaclrole
       CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) AS acl_info
       WHERE acl_info.grantee = (SELECT oid FROM runtime_role)
     ),
     provider_inventory AS (
       SELECT object_type, object_name, row_count, fingerprint
       FROM provider_inventory_base
       UNION ALL
       SELECT 'provider_contract'::text,
              'access'::text,
              count(*)::integer,
              encode(
                sha256(
                  convert_to(
                    COALESCE(
                      string_agg(
                        jsonb_build_array(object_type, object_name)::text,
                        E'\\n'
                        ORDER BY object_type COLLATE "C", object_name COLLATE "C"
                      ),
                      ''
                    ),
                    'UTF8'
                  )
                ),
                'hex'
              )
       FROM violations
       WHERE current_database() IN ('postgres', 'template1')
       HAVING current_database() IN ('postgres', 'template1')
     )
     SELECT object_type, object_name, row_count, fingerprint
     FROM provider_inventory
     UNION ALL
     SELECT object_type, object_name, NULL::integer, NULL::text
     FROM violations
     WHERE current_database() NOT IN ('postgres', 'template1')
     ORDER BY object_type, object_name`,
    [tablePrivileges, columnPrivileges],
  );

  const providerRows = result.rows.filter((row) => row.object_type === 'provider_contract');
  const violations = result.rows.filter((row) => row.object_type !== 'provider_contract');
  requireExactProviderInventory(providerRows, expectedDatabase, profile);
  if (violations.length !== 0) {
    throw new Error(
      `Runtime reader has disallowed non-system object access in Neon reserved database ${expectedDatabase}: ${summarizedViolationTypes(violations)}`,
    );
  }
}

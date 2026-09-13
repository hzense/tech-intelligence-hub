import { createHash } from 'node:crypto';
import {
  currentPublicSignalColumns,
  currentPublicSignalViewHashes,
} from './current-publication-catalog.mjs';

// Catalog recognition is deliberately separate from permission to read the view.
// Legacy Runtime and Topic sync must recognize the schema but retain their old ACLs.
export function isExactCurrentPublicSignalRelation(relation, expectedOwner) {
  return (
    relation.name === 'current_public_signals' &&
    relation.relkind === 'v' &&
    relation.relpersistence === 'p' &&
    relation.owner === expectedOwner &&
    relation.relrowsecurity === false &&
    relation.relforcerowsecurity === false &&
    relation.policy_count === 0 &&
    relation.user_trigger_count === 0 &&
    relation.rewrite_rule_count === 1
  );
}

export async function collectCurrentPublicSignalViewProblems(client, expectedOwner) {
  const result = await client.query(`/* hzense:current-publication:views */
    SELECT c.relname AS name,pg_get_userbyid(c.relowner) AS owner,c.reloptions AS options,
      pg_get_viewdef(c.oid,true) AS definition,
      (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum)
        FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname`);
  if (result.rows.length !== 1 || result.rows[0]?.name !== 'current_public_signals')
    return ['current public Signal view set mismatch'];
  const view = result.rows[0];
  if (
    view.owner !== expectedOwner ||
    JSON.stringify(view.options) !== JSON.stringify(['security_barrier=true']) ||
    JSON.stringify(view.columns) !== JSON.stringify(currentPublicSignalColumns) ||
    typeof view.definition !== 'string' ||
    !currentPublicSignalViewHashes.has(
      createHash('sha256').update(view.definition.trim()).digest('hex'),
    )
  ) {
    return ['current public Signal view contract mismatch'];
  }
  return [];
}

import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

// Reuse the provisioning script's exact post-GRANT assertions, not a second
// role-name-only contract. Call only inside the verifier's READ ONLY transaction.
// The grant phase, role creation and COMMIT are deliberately excluded.
export async function verifyOptionalSignalAdminReaderContract(client) {
  const result = await client.query(`/* schema:optional-signal-reader */
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='public' AND p.proname='hzense_public_signal_is_current'
        AND r.rolname='hzense_signal_admin_reader'
    ) AS present`);
  if (result.rows[0]?.present === false) return;
  if (result.rows[0]?.present !== true)
    throw new Error('Cannot inspect optional Signal reader grant');
  const script = await readFile(
    new URL('../../../db/roles/configure_signal_admin_reader.sql', import.meta.url),
    'utf8',
  );
  const blocks = [
    ...script.matchAll(/DO \$signal_admin_reader_verify\$[\s\S]*?\$signal_admin_reader_verify\$;/g),
  ];
  if (blocks.length !== 1)
    throw new Error('Signal reader verification block is missing or ambiguous');
  await client.query(blocks[0][0]);
}

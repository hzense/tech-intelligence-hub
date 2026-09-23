import {
  candidateEnrichmentRoleCheckSQL,
  generationRoleCheckSQL,
  legacyGenerationRoleCheckSQL,
} from './signal-generation-role-check.mjs';
export {
  candidateEnrichmentRoleColumns,
  signalGenerationRoleColumns,
} from './signal-generation-role-columns.mjs';

const deny = () => {
  throw new Error('generation_role_invalid');
};
async function checkContract(client) {
  if ((await client.query(candidateEnrichmentRoleCheckSQL)).rows[0]?.safe === true) return;
  if ((await client.query(generationRoleCheckSQL)).rows[0]?.safe !== true) deny();
}
export async function assertGenerationRole(client) {
  const identity = (
    await client.query(
      "SELECT current_user='hzense_generation_admin' AND session_user=current_user AS safe",
    )
  ).rows[0];
  if (identity?.safe !== true) deny();
  await checkContract(client);
}
export async function assertGenerationRoleProvisioned(client) {
  const identity = (
    await client.query(`SELECT current_user=session_user AND current_user=pg_catalog.pg_get_userbyid(datdba) AS safe
    FROM pg_catalog.pg_database WHERE datname=current_database()`)
  ).rows[0];
  if (identity?.safe !== true) deny();
  await checkContract(client);
}

export async function assertCandidateEnrichmentRole(client) {
  const identity = (
    await client.query(
      "SELECT current_user='hzense_generation_admin' AND session_user=current_user AS safe",
    )
  ).rows[0];
  if (identity?.safe !== true) deny();
  if ((await client.query(candidateEnrichmentRoleCheckSQL)).rows[0]?.safe !== true) deny();
}

// Return schema capability only after validating one of two exact ACL matrices.
// No partially upgraded / overprivileged role is accepted.
export async function assertGenerationHistoryRole(client) {
  if (
    (
      await client.query(
        "SELECT current_user='hzense_generation_admin' AND session_user=current_user AS safe",
      )
    ).rows[0]?.safe !== true
  )
    deny();
  if ((await client.query(candidateEnrichmentRoleCheckSQL)).rows[0]?.safe === true) return;
  if ((await client.query(generationRoleCheckSQL)).rows[0]?.safe === true) return;
  if ((await client.query(legacyGenerationRoleCheckSQL)).rows[0]?.safe !== true) deny();
}

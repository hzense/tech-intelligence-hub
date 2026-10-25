/** Shared generation/enrichment budget policy. Keep the original reservation as
 * evidence, but settled tasks consume their recorded cost. Unknown or in-flight
 * calls still hold the larger amount because they may incur a provider charge. */
export function generationBudgetSql(alias = '') {
  if (!['', 'r', 'e'].includes(alias)) throw new Error('invalid_budget_alias');
  const prefix = alias ? `${alias}.` : '';
  return `CASE WHEN ${prefix}status IN ('completed','failed') THEN ${prefix}charged_microusd ELSE greatest(${prefix}reserved_microusd,${prefix}charged_microusd) END`;
}

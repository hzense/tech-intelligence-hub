export type MaterialRegistrationClient = {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};
export type MaterialRegistrationResult = {
  entityIds: string[];
  evidenceIds: string[];
  topicIds: string[];
};
/** Requires the caller's transaction, serialization locks, role validation and signed admission. */
export function registerMaterialPlan(input: {
  client: MaterialRegistrationClient;
  plan: unknown;
}): Promise<MaterialRegistrationResult>;
/** Requires an independent verifier transaction and the verified signed plan. */
export function verifyRegisteredMaterialPlan(input: {
  client: MaterialRegistrationClient;
  plan: unknown;
}): Promise<MaterialRegistrationResult>;

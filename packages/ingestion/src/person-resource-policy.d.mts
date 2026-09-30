export const PERSON_RESOURCE_POLICY_TEXT: string;
export function isExcludedPublicPerson(
  person:
    | { id?: string | null; name?: string | null; role?: string | null; event_role?: string | null }
    | string,
): boolean;

/** Shared browser/server predicate. A leading alias marker is part of the ID. */
export function isValidAiModelId(value) {
  return (
    typeof value === 'string' &&
    value.length <= 200 &&
    value.match(/^~?[A-Za-z0-9][A-Za-z0-9._:/-]*$/)?.[0] === value
  );
}

const backupIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/;
const placeholderTokenPattern =
  /(?:^|[._:/-])(?:none|null|todo|pending|placeholder|example|changeme)(?:$|[._:/-])/i;

export function requireProtectedBackupIdentifier(value, { environmentName, purpose }) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${environmentName} is required`);
  }

  const identifier = value.trim();
  if (!backupIdentifierPattern.test(identifier) || placeholderTokenPattern.test(identifier)) {
    throw new Error(`${environmentName} must identify ${purpose}`);
  }

  return identifier;
}

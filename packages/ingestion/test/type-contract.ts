import { IMPORT_LIMITS, validateImportManifest } from '@hzense/ingestion';
import type {
  ImportCapabilities,
  ImportErrorCode,
  ImportManifest,
  ImportManifestValidation,
} from '@hzense/ingestion';

const capabilities = { parsers: ['pdf', 'text'], ocr: false, urlFetch: true } as const;
const configured: ImportCapabilities = capabilities;
const manifest: ImportManifest = {
  files: [{ clientItemId: 'client-1', name: 'report.pdf', size: 200, requiresOcr: true }],
  urlLines: 'https://example.org/report',
};
const result: ImportManifestValidation = validateImportManifest(manifest, {
  capabilities: configured,
});
const stage: 'preflight' = result.stage;
const classification: 'private' = result.classification;
const verificationRequired: true = result.requiresContentVerification;
const errors: ImportErrorCode[] = result.batchErrors;
const fileStatus: 'valid' | 'invalid' | undefined = result.files[0]?.status;
const urlStatus: 'valid' | 'invalid' | 'duplicate' | undefined = result.urls[0]?.status;
const bytes: number | null = result.totals.totalDeclaredBytes;
void [stage, classification, verificationRequired, errors, fileStatus, urlStatus, bytes];

// @ts-expect-error Limits cannot be changed by a consumer.
IMPORT_LIMITS.maxFiles = 999;
// @ts-expect-error Unimplemented parsers cannot be enabled accidentally.
validateImportManifest(manifest, { capabilities: { parsers: ['doc'] } });
// @ts-expect-error Capabilities require explicit booleans.
validateImportManifest(manifest, { capabilities: { ocr: 'enabled' } });
// @ts-expect-error Preflight never returns an accepted/uploaded identity.
void result.batchId;
// @ts-expect-error Preflight is not receipt confirmation.
void result.accepted;

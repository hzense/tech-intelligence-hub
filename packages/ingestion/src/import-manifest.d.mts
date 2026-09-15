export type ImportParserFormat = 'pdf' | 'docx' | 'markdown' | 'text' | 'html' | 'csv' | 'xlsx';
export type ImportFileFormat = ImportParserFormat | 'png' | 'jpeg';
export interface ImportCapabilities {
  parsers?: readonly ImportParserFormat[];
  ocr?: boolean;
  urlFetch?: boolean;
}
export interface ImportFileDeclaration {
  clientItemId: string;
  name: string;
  size: number;
  mime?: string;
  pageCount?: number;
  requiresOcr?: boolean;
}
export interface ImportManifest {
  files?: ImportFileDeclaration[];
  urlLines?: string;
}
export type ImportErrorCode =
  | 'invalid_manifest'
  | 'manifest_too_large'
  | 'invalid_capabilities'
  | 'empty_batch'
  | 'invalid_file_descriptor'
  | 'invalid_client_item_id'
  | 'duplicate_client_item_id'
  | 'invalid_file_name'
  | 'unsupported_format'
  | 'conversion_required'
  | 'invalid_file_size'
  | 'file_too_large'
  | 'invalid_mime'
  | 'mime_mismatch'
  | 'invalid_page_count'
  | 'document_page_limit'
  | 'invalid_ocr_declaration'
  | 'capability_unavailable'
  | 'file_count_exceeded'
  | 'link_count_exceeded'
  | 'batch_bytes_exceeded'
  | 'url_too_long'
  | 'blocked_url_target'
  | 'invalid_url';
export interface ImportFileCheck {
  inputIndex: number;
  /** Echo of a valid caller-provided marker; never a generated or persisted identity. */
  clientItemId: string | null;
  /** Private declaration, not a public title or an object-storage key. */
  name: string | null;
  size: number | null;
  mime: string | null;
  format: ImportFileFormat | null;
  pageCount: number | null;
  requiresOcr: boolean;
  status: 'valid' | 'invalid';
  errors: ImportErrorCode[];
}
export interface ImportUrlCheck {
  lineNumber: number;
  /** Private input. May contain rejected credentials; never log or publish. */
  originalUrl: string;
  /** Syntax normalization only, not proof of a safe DNS or fetched resource. */
  canonicalUrl: string | null;
  duplicateOfLine: number | null;
  status: 'valid' | 'invalid' | 'duplicate';
  errors: ImportErrorCode[];
}
export interface ImportManifestValidation {
  stage: 'preflight';
  classification: 'private';
  /** Declarations passed; does not mean received, accepted, uploaded, parsed or published. */
  valid: boolean;
  files: ImportFileCheck[];
  urls: ImportUrlCheck[];
  batchErrors: ImportErrorCode[];
  totals: { files: number; links: number; uniqueLinks: number; totalDeclaredBytes: number | null };
  requiresContentVerification: true;
}
export const IMPORT_LIMITS: Readonly<{
  maxFileBytes: number;
  maxFiles: number;
  maxLinks: number;
  maxBatchBytes: number;
  maxDocumentPages: number;
}>;
export function validateImportManifest(
  input: unknown,
  options?: { capabilities?: ImportCapabilities },
): ImportManifestValidation;

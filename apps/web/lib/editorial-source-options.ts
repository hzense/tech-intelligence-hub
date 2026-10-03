import { validateImportManifest } from '../../../packages/ingestion/src/import-manifest.mjs';

type SourceRun = {
  owner_id: string;
  batch_id: string;
  item_id: string;
  source_fence: number;
  source_hash: string;
};
type SourceReceipt = {
  batchId: string;
  itemId: string;
  fence: number;
  contentHash: string;
  sourceUrl: string;
};
type ReadSupplement = (owner: string, batchId: string, itemId: string) => Promise<SourceReceipt>;

// Storage/share links can grant access even without a query-string signature.
// Keep them private; the editor may only offer ordinary article URLs for consent.
const privateSourceHosts = [
  'vercel-storage.com',
  'amazonaws.com',
  'amazonaws.com.cn',
  'storage.googleapis.com',
  'storage.cloud.google.com',
  'blob.core.windows.net',
  'dfs.core.windows.net',
  'r2.cloudflarestorage.com',
  'supabase.co',
  'supabase.in',
  'digitaloceanspaces.com',
  'backblazeb2.com',
  'dropbox.com',
  'dropboxusercontent.com',
  'drive.google.com',
  'docs.google.com',
  'onedrive.live.com',
  '1drv.ms',
  'sharepoint.com',
];
const publicArticleParameters = new Set([
  'id',
  'p',
  'article',
  'article_id',
  'page',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
]);

/** This is a display-option filter, never public-access or publication authorization. */
export function editorialSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim() || value.includes('#')) return null;
  const checked = validateImportManifest(
    { urlLines: value },
    { capabilities: { urlFetch: true, parsers: ['html'] } },
  );
  if (!checked.valid || checked.urls.length !== 1) return null;
  const canonical = checked.urls[0]?.canonicalUrl;
  if (!canonical) return null;
  const url = new URL(canonical);
  // Only recognized article/attribution parameters are displayable. Unknown
  // query keys may contain credentials or capability tokens. Keep the original
  // query intact: deleting parameters would change the imported source's identity.
  for (const key of url.searchParams.keys())
    if (!publicArticleParameters.has(key.toLowerCase())) return null;
  if (privateSourceHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)))
    return null;
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (
    /(?:^|\/)(?:admin|private|internal|uploads?|signed|auth|login|signin|account|session|token)(?:[/.;=]|$)/i.test(
      path,
    ) ||
    /(?:^|[/;])(?:access[_-]?token|api[_-]?key|signature|sig|jwt|secret)[=/:_-]/i.test(path)
  )
    return null;
  return canonical;
}

/**
 * The supplied reader must perform the owner-scoped, active URL-import read
 * (readMaterialSupplement). Match its exact immutable generation source before
 * offering a link. No source text, file/blob metadata or model-created URL escapes.
 */
export async function readEditorialSourceOptions(
  owner: string,
  run: SourceRun,
  readSupplement: ReadSupplement,
): Promise<string[]> {
  if (
    !owner ||
    run.owner_id !== owner ||
    !Number.isSafeInteger(run.source_fence) ||
    run.source_fence < 1 ||
    !/^[a-f0-9]{64}$/.test(run.source_hash)
  )
    return [];
  try {
    const source = await readSupplement(owner, run.batch_id, run.item_id);
    if (
      source.batchId !== run.batch_id ||
      source.itemId !== run.item_id ||
      source.fence !== run.source_fence ||
      source.contentHash !== run.source_hash
    )
      return [];
    const url = editorialSourceUrl(source.sourceUrl);
    return url ? [url] : [];
  } catch {
    // Missing, private-file, deleted, cancelled and unavailable imports stay
    // private. Ancillary source reads must not hide a saved editorial revision.
    return [];
  }
}

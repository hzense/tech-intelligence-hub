// Explicit public allowlist, not SELECT * or a private evidence/material query.
const columns = `signal_id, version, publication_revision, title, type, occurred_at,
  captured_at, summary, analysis, importance, strength, confidence, novelty,
  topics, people, organizations, sources`;

export const publicSignalListQuery = `SELECT ${columns}
FROM public.current_public_signals
ORDER BY occurred_at DESC, importance DESC, signal_id COLLATE "C"
LIMIT $1::integer`;

export const publicSignalByIdQuery = `SELECT ${columns}
FROM public.current_public_signals WHERE signal_id=$1::text LIMIT 1`;

// Literal substring matching; wildcard/quote characters remain bound data.
// This query never consults the legacy search_documents projection.
export const publicSignalSearchQuery = `SELECT ${columns}
FROM public.current_public_signals
WHERE NOT EXISTS (
  SELECT 1 FROM unnest($1::text[]) AS term
  WHERE strpos(lower(normalize(concat_ws(' ', title, summary, analysis,
    topics::text, people::text, organizations::text, sources::text), NFKC)), term)=0
)
ORDER BY occurred_at DESC, importance DESC, signal_id COLLATE "C"
LIMIT $2::integer`;

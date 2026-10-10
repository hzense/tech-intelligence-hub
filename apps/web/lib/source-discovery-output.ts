export const discoveryArticleLimit = 8;

/** Provider schema and local decoding share the same output contract. */
export const discoveryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['articles'],
  properties: {
    articles: {
      type: 'array',
      maxItems: discoveryArticleLimit,
      description: 'Recent original sources from the search citations; return [] if none qualify.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'title', 'publishedAt'],
        properties: {
          url: { type: 'string', description: 'Original public URL present in search citations.' },
          title: { type: 'string', description: 'Original source title.', maxLength: 300 },
          publishedAt: {
            type: 'string',
            description:
              'Source publication date verified from search, YYYY-MM-DD, inside the requested window. Omit sources without a verified date.',
          },
        },
      },
    },
  },
};

export type DiscoveryOutputFormat = 'json' | 'json_fence' | 'invalid' | 'non_text';
export type DiscoveryOutputIssue =
  'content_not_text' | 'invalid_json' | 'invalid_root' | 'invalid_articles' | 'too_many_articles';
type DecodedOutput = {
  format: DiscoveryOutputFormat;
} & ({ articles: unknown[]; issue: null } | { articles: null; issue: DiscoveryOutputIssue });

/** Remove only a whole-message code fence. Never extract JSON from prose, repair
 * broken JSON, invent missing fields, or retain the answer in diagnostic receipts. */
export function decodeDiscoveryOutput(content: unknown): DecodedOutput {
  if (typeof content !== 'string')
    return { format: 'non_text', articles: null, issue: 'content_not_text' };
  const text = content.trim();
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  let output: unknown;
  try {
    output = JSON.parse(fence ? fence[1]! : text);
  } catch {
    return { format: 'invalid', articles: null, issue: 'invalid_json' };
  }
  const format = fence ? 'json_fence' : 'json';
  if (
    !output ||
    typeof output !== 'object' ||
    Array.isArray(output) ||
    Object.keys(output).length !== 1 ||
    !Object.hasOwn(output, 'articles')
  )
    return { format, articles: null, issue: 'invalid_root' };
  const articles = (output as { articles: unknown }).articles;
  if (!Array.isArray(articles)) return { format, articles: null, issue: 'invalid_articles' };
  if (articles.length > discoveryArticleLimit)
    return { format, articles: null, issue: 'too_many_articles' };
  return { format, articles, issue: null };
}

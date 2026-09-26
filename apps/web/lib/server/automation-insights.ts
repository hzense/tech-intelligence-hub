import 'server-only';
import { insightReaderPool } from './automation-store-access';
export interface PublishedTopicInsight {
  id: string;
  result: unknown;
  published_at: string;
}
export async function getPublishedTopicInsights(): Promise<PublishedTopicInsight[]> {
  if (process.env.HZENSE_TOPIC_INSIGHTS_ENABLED !== '1') return [];
  let client;
  try {
    client = await insightReaderPool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL statement_timeout='5s'");
    const rows = (
      await client.query(
        'SELECT id,result,published_at FROM public.published_topic_insights ORDER BY published_at DESC,id LIMIT 100',
      )
    ).rows;
    await client.query('COMMIT');
    return rows.map((row) => ({ ...row, published_at: new Date(row.published_at).toISOString() }));
  } catch {
    await client?.query('ROLLBACK').catch(() => undefined);
    // An enabled reader failure is an outage, not evidence that no reports
    // exist. Do not silently render an apparently empty public catalog.
    throw new Error('published_insights_unavailable');
  } finally {
    client?.release();
  }
}
export async function getPublishedTopicInsight(id: string) {
  return (await getPublishedTopicInsights()).find((row) => row.id === id) ?? null;
}

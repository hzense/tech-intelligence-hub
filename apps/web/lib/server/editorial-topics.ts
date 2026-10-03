import 'server-only';
import { getTopicTitleMap } from '../content-runtime';
import { editorialPool, editorialPublicationEnabled } from './editorial-database';

/** Shared live catalog for generation snapshots and the publication editor. */
export async function editorialTopicOptions(): Promise<Array<{ id: string; title: string }>> {
  if (!editorialPublicationEnabled())
    return [...(await getTopicTitleMap())].map(([id, title]) => ({ id, title }));
  const client = await editorialPool.connect();
  let queryComplete = false;
  try {
    const rows = (
      await client.query<{ id: string; title: string }>(
        "SELECT id,title FROM public.topics WHERE runtime_enabled IS TRUE AND status<>'archived' ORDER BY title,id LIMIT 1001",
      )
    ).rows;
    queryComplete = true;
    if (rows.length > 1000) throw new Error('editorial_catalog_unavailable');
    return rows;
  } finally {
    client.release(!queryComplete);
  }
}

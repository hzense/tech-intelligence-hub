/** A rejected start may already have scheduled work. The store only fails a
 * still-pending row, fencing later claims without overwriting a running result. */
export function createMaterialEnrichmentDispatcher<T extends { id: string; status: string }>(deps: {
  create(owner: string, input: unknown): Promise<T>;
  queue(owner: string, id: string): Promise<T>;
  start(owner: string, id: string): Promise<unknown>;
  failQueued(owner: string, id: string): Promise<unknown>;
}) {
  return async (owner: string, input: unknown) => {
    const created = await deps.create(owner, input);
    const queued = await deps.queue(owner, created.id);
    if (queued.status === 'pending') {
      try {
        await deps.start(owner, queued.id);
      } catch (error) {
        await deps.failQueued(owner, queued.id);
        throw error;
      }
    }
    return queued;
  };
}

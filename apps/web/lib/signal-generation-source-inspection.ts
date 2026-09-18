import { aiUuid } from '../../../packages/database/src/ai-config-contract.mjs';
import { inspectGenerationSource } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { GenerationError, type GenerationDependencies } from './signal-generation-core.ts';

export function createGenerationSourceInspector(read: GenerationDependencies['source']) {
  return async (owner: string, input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new GenerationError('invalid_request');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).sort().join(',') !== 'action,batchId,itemId' ||
      body.action !== 'inspect_source'
    )
      throw new GenerationError('invalid_request');
    const batchId = aiUuid(body.batchId),
      itemId = aiUuid(body.itemId);
    const { fence, output } = await read(owner, batchId, itemId);
    return { batchId, itemId, fence, ...inspectGenerationSource(output) };
  };
}

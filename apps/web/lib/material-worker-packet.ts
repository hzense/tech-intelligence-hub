import { Buffer } from 'node:buffer';

/** Shared by the server and worker transport, including catalogs and approval. */
export const MATERIAL_WORKER_PACKET_LIMIT_BYTES = 2 * 1024 * 1024;

export function boundMaterialWorkerPacket<T>(packet: T, reserveBytes = 0): T {
  if (
    Buffer.byteLength(JSON.stringify(packet), 'utf8') + reserveBytes >
    MATERIAL_WORKER_PACKET_LIMIT_BYTES
  )
    throw Object.assign(new Error('material_worker_packet_too_large'), {
      code: 'material_worker_packet_too_large',
    });
  return packet;
}

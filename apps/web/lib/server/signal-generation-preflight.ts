import 'server-only';
import { TLSSocket } from 'node:tls';
import pg from 'pg';
import { createGenerationPreflight } from '../signal-generation-preflight';

/** Fresh authenticated client, never the mutable generation pool or store. */
export const generationPreflight = createGenerationPreflight({
  environment: () => process.env,
  createClient: ({ connectionString }) => {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 3500,
      query_timeout: 3500,
      enableChannelBinding: true,
      application_name: 'hzense-generation-preflight',
    });
    // Idle socket failures must not become unhandled errors or expose driver details.
    // Subsequent query/rollback failures are reported only via the fixed safe DTO.
    client.on('error', () => {});
    return {
      connect: async () => {
        await client.connect();
      },
      verifiedTls: () => {
        const stream = client.connection.stream;
        // pg_stat_ssl describes a server-side hop, not our TLS link to a Neon pooler.
        return (
          stream instanceof TLSSocket && stream.encrypted === true && stream.authorized === true
        );
      },
      query: (text, values) => client.query(text, values),
      end: () => client.end(),
    };
  },
});

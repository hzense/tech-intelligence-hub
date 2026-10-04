import 'server-only';
import pg from 'pg';
import { assertCandidateReviewRole } from '../../../../packages/database/src/candidate-review-role.mjs';
import {
  readReviewDatabaseConfiguration,
  ReviewConfigurationError,
} from '../candidate-review-config';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
export const candidateReviewPool = {
  async connect() {
    const connectionString = readReviewDatabaseConfiguration(process.env);
    if (poolUrl && connectionString !== poolUrl) throw new ReviewConfigurationError();
    if (!pool) {
      poolUrl = connectionString;
      pool = new pg.Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 3500,
        query_timeout: 15000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-candidate-review',
      });
      pool.on('error', () => console.error('candidate_review_pool_unavailable'));
    }
    const client = await pool.connect();
    try {
      await assertCandidateReviewRole(client);
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};

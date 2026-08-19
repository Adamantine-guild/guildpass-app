import { getPool } from "../lib/db";

const POSTGRES_TEST_LOCK_ID = 1_735_092_784;

/**
 * Serialize test files that mutate the shared integration database.
 *
 * Node 18.17 predates the CLI's --test-concurrency option, so database suites
 * coordinate through a dedicated session-level PostgreSQL advisory lock
 * instead of relying on a newer runtime flag.
 */
export async function acquirePostgresTestLock(): Promise<() => Promise<void>> {
  const client = await getPool().connect();
  await client.query("SELECT pg_advisory_lock($1)", [POSTGRES_TEST_LOCK_ID]);

  return async () => {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [
        POSTGRES_TEST_LOCK_ID,
      ]);
    } finally {
      client.release();
    }
  };
}

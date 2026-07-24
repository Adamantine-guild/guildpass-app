/**
 * Shared PostgreSQL connection pool for the dashboard.
 *
 * Creates a singleton `pg.Pool` lazily on first use from DATABASE_URL.
 * All durable repository adapters share this pool so connection overhead
 * is amortised across the entire process.
 *
 * Server-side only — never import this from client components.
 */

import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Returns the shared connection pool, creating it on first call.
 * Throws if DATABASE_URL is not set.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not configured. Set it in your .env.local or environment " +
      "when running with DASHBOARD_STORAGE_MODE=durable."
    );
  }

  pool = new Pool({
    connectionString,
    // Sensible defaults; override via standard PG* env vars if needed.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Log pool errors (connection drops, etc.) instead of crashing.
  pool.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err.message);
  });

  return pool;
}

/**
 * Execute a parameterised query against the shared pool.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, values);
}

/**
 * Run `fn` inside a database transaction. Automatically commits on success
 * and rolls back on error. The `client` passed to `fn` must be used for
 * all queries within the transaction scope.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the pool. Call on process exit if desired.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Reset the pool reference (for testing only).
 */
export function _resetPool(): void {
  pool = null;
}

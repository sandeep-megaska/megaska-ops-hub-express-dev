import pg from "pg";
import { env } from "./env.ts";

// One pool per server instance. On Vercel, point DATABASE_URL at Supabase's
// transaction pooler (port 6543): each function instance holds very few
// connections, and the pooler multiplexes them onto Postgres.
const globalForPool = globalThis as unknown as { __storefrontPool?: pg.Pool };

// Return NUMERIC as string (exact money), BIGINT as string (Shopify IDs).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

export function getPool(): pg.Pool {
  if (!globalForPool.__storefrontPool) {
    const connectionString = env.databaseUrl();
    const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
    globalForPool.__storefrontPool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalForPool.__storefrontPool;
}

export type Queryable = Pick<pg.PoolClient, "query">;

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await globalForPool.__storefrontPool?.end();
  globalForPool.__storefrontPool = undefined;
}

import { attachDatabasePool } from "@neon/functions";
import pg from "pg";

// One pool per isolate, reused across requests (see neon-functions guidance).
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Dates shifted by timezone.
pg.types.setTypeParser(1082, (v) => v);
// bigint ids and counts as numbers (they stay well under 2^53 here).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

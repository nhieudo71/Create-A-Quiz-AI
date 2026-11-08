import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { DatabaseSchema } from './types';
import { env } from '../../config/env.config';
import { PGliteDialect } from './pglite.dialect';

export const isEmbedded = env.DB_MODE === 'embedded';

let pool: Pool | null = null;
let pglite: PGlite | null = null;

if (isEmbedded) {
  pglite = new PGlite(env.DB_DATA_DIR);
} else {
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });
}

export const db = new Kysely<DatabaseSchema>({
  dialect: isEmbedded
    ? new PGliteDialect(pglite!)
    : new PostgresDialect({ pool: pool! })
});

export async function closeDatabase(): Promise<void> {
  await db.destroy();
  pool = null;
  pglite = null;
}

/** Kiểm tra kết nối DB thật (dùng cho /health) */
export async function pingDatabase(): Promise<void> {
  await sql`select 1`.execute(db);
}

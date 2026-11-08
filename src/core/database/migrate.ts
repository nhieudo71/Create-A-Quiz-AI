import fs from 'fs';
import path from 'path';
import { sql } from 'kysely';
import { db } from './db';

const SCHEMA_CANDIDATES = [
  process.env.APP_SCHEMA_PATH,
  path.join(process.cwd(), 'docs', 'DATABASE_SCHEMA.sql'),
  path.join(process.cwd(), '..', 'docs', 'DATABASE_SCHEMA.sql'),
  path.join(__dirname, '..', '..', '..', 'docs', 'DATABASE_SCHEMA.sql')
].filter((p): p is string => Boolean(p));

function readSchemaSql(): string {
  for (const candidate of SCHEMA_CANDIDATES) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
  }
  throw new Error('Không tìm thấy docs/DATABASE_SCHEMA.sql để khởi tạo cơ sở dữ liệu.');
}

/**
 * Khởi tạo schema. Script dùng CREATE TABLE IF NOT EXISTS nên chạy lại nhiều lần vẫn an toàn.
 * Với Docker/Postgres, script này cũng được nạp tự động qua docker-entrypoint-initdb.d.
 */
export async function runMigrations(): Promise<void> {
  const schemaSql = readSchemaSql();
  const statements = schemaSql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.split('\n').every((line) => line.trim().startsWith('--')));

  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
}

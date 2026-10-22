import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");
export const SHIM_PATH = path.resolve(__dirname, "../../tests/db/supabase_shim.sql");

export interface MigrateOptions {
  /** Apply the TEST-ONLY Supabase shim first. Never use against a real Supabase project. */
  shim?: boolean;
  /** Only apply migration files whose name sorts <= this value (tests: reproduce an earlier state). */
  upTo?: string;
  log?: (msg: string) => void;
}

/**
 * Minimal forward-only migration runner for LOCAL / TEST Postgres.
 * For a real Supabase project use the Supabase CLI (`supabase db push`) or the SQL editor.
 * Each migration runs in its own transaction and is recorded with a checksum.
 */
export async function applyMigrations(client: Client, opts: MigrateOptions = {}): Promise<string[]> {
  const log = opts.log ?? (() => {});
  if (opts.shim) {
    await client.query(await readFile(SHIM_PATH, "utf8"));
    log("applied test-only supabase shim");
  }
  await client.query(`
    create schema if not exists emerg_meta;
    create table if not exists emerg_meta.applied_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql") && (!opts.upTo || f <= opts.upTo)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>(
      "select checksum from emerg_meta.applied_migrations where name = $1",
      [file],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.checksum !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied (checksum mismatch).`);
      }
      continue;
    }
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into emerg_meta.applied_migrations (name, checksum) values ($1, $2)", [
        file,
        checksum,
      ]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
    applied.push(file);
    log(`applied ${file}`);
  }
  return applied;
}

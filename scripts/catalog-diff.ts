/**
 * Rehearsal tool: builds LOCAL databases at two migration states, optionally applies a revert script to the second,
 * and diffs their catalogs (schemas, columns, constraints, indexes, policies, functions, triggers, grants, enums, RLS flags).
 *   npx tsx scripts/catalog-diff.ts <upToBaseline> [revert.sql]
 * Local PostgreSQL only (see README). Never point this at a real Supabase project.
 */
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { ADMIN_URL } from "../tests/db/helpers";
import { applyMigrations } from "./lib/migrate";

const QUERIES: Record<string, string> = {
  schemas: `select nspname k from pg_namespace where nspname not like 'pg_%' and nspname not in ('information_schema','emerg_meta','auth','extensions','public') order by 1`,
  columns: `select table_schema||'.'||table_name||'.'||column_name||' '||udt_name||' null='||is_nullable||' default='||coalesce(column_default,'') k from information_schema.columns where table_schema in ('public','private') order by 1`,
  rls: `select n.nspname||'.'||c.relname||' rls='||c.relrowsecurity||' force='||c.relforcerowsecurity k from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' order by 1`,
  constraints: `select conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid)||' validated='||convalidated k from pg_constraint where connamespace in ('public'::regnamespace) order by 1`,
  indexes: `select indexdef k from pg_indexes where schemaname in ('public','private') order by 1`,
  policies: `select tablename||' | '||policyname||' | '||cmd||' | '||roles::text||' | '||coalesce(qual,'')||' | '||coalesce(with_check,'') k from pg_policies where schemaname='public' order by 1`,
  functions: `select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') secdef='||p.prosecdef||' cfg='||coalesce(p.proconfig::text,'')||' acl='||coalesce((select string_agg(distinct (a.grantee::regrole::text)||':'||a.privilege_type, ',' order by (a.grantee::regrole::text)||':'||a.privilege_type) from aclexplode(p.proacl) a),'default')||E'\\n'||pg_get_functiondef(p.oid) k from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1`,
  triggers: `select c.relname||' '||pg_get_triggerdef(t.oid) k from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','private') order by 1`,
  tablegrants: `select c.oid::regclass||' '||a.grantee::regrole||':'||a.privilege_type k from pg_class c, aclexplode(c.relacl) a where c.relnamespace in ('public'::regnamespace) and c.relkind in ('r','v') and a.grantee::regrole::text <> 'postgres' order by 1`,
  columngrants: `select c.oid::regclass||'.'||att.attname||' '||a.grantee::regrole||':'||a.privilege_type k from pg_class c join pg_attribute att on att.attrelid=c.oid, aclexplode(att.attacl) a where c.relnamespace in ('public'::regnamespace) and a.grantee::regrole::text <> 'postgres' order by 1`,
  enums: `select t.typname||': '||string_agg(e.enumlabel, ',' order by e.enumsortorder) k from pg_type t join pg_enum e on e.enumtypid=t.oid group by t.typname order by 1`,
  schemagrants: `select nspname||' '||a.grantee::regrole||':'||a.privilege_type k from pg_namespace n, aclexplode(n.nspacl) a where nspname in ('private') and a.grantee::regrole::text <> 'postgres' order by 1`,
};

async function db(name: string, upTo: string | undefined) {
  const root = new Client({ connectionString: ADMIN_URL }); await root.connect();
  await root.query(`drop database if exists ${name} with (force)`); await root.query(`create database ${name}`); await root.end();
  const u = new URL(ADMIN_URL); u.pathname = `/${name}`;
  const c = new Client({ connectionString: u.toString() }); await c.connect();
  await applyMigrations(c, { shim: true, upTo });
  return c;
}
async function dump(c: Client) {
  const out: Record<string, string[]> = {};
  for (const [k, q] of Object.entries(QUERIES)) out[k] = (await c.query<{ k: string }>(q)).rows.map((r) => r.k);
  return out;
}

async function main() {
  const [upTo, revert] = process.argv.slice(2);
  const base = await db("rev_base", upTo), full = await db("rev_full", undefined);
  if (revert) {
    try { await full.query("begin"); await full.query(await readFile(revert, "utf8")); await full.query("commit"); }
    catch (e) { await full.query("rollback"); console.error("REVERT FAILED:", (e as Error).message); process.exit(2); }
  }
  const a = await dump(base), b = await dump(full);
  let diffs = 0;
  for (const k of Object.keys(QUERIES)) {
    const sa = new Set(a[k]), sb = new Set(b[k]);
    for (const x of a[k]!) if (!sb.has(x)) { diffs++; console.log(`[${k}] MISSING after revert:\n  ${x.replace(/\n/g, "\n  ")}`); }
    for (const x of b[k]!) if (!sa.has(x)) { diffs++; console.log(`[${k}] EXTRA after revert:\n  ${x.replace(/\n/g, "\n  ")}`); }
  }
  console.log(diffs === 0 ? "\nIDENTICAL catalogs" : `\n${diffs} differences`);
  await base.end(); await full.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

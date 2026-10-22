/* Usage: DATABASE_URL=postgres://... npm run db:migrate [-- --shim]
 * Local/test Postgres only. Use the Supabase CLI for real Supabase projects. */
import { Client } from "pg";
import { applyMigrations } from "./lib/migrate";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (local Postgres only).");
    process.exit(1);
  }
  const shim = process.argv.includes("--shim");
  if (/supabase\.(co|com)/.test(url) && shim) {
    console.error("Refusing to apply the test shim to a Supabase host.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await applyMigrations(client, { shim, log: (m) => console.log(m) });
    console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : "Up to date.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// Applies supabase/migrations/*.sql (once each, tracked) and optionally the demo seed.
// Usage: node scripts/db.mjs migrate | seed | setup
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is missing from .env.local");
  process.exit(1);
}

const command = process.argv[2] ?? "setup";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });

async function migrate() {
  await client.query(`create schema if not exists private;
    create table if not exists private.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(root, "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await client.query("select name from private.schema_migrations");
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    process.stdout.write(`→ ${file} … `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into private.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log("ok");
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      throw err;
    }
  }
}

async function seed() {
  process.stdout.write("→ seed.sql … ");
  await client.query(await readFile(path.join(root, "supabase", "seed.sql"), "utf8"));
  console.log("ok");
}

try {
  await client.connect();
  if (command === "migrate" || command === "setup") await migrate();
  if (command === "seed" || command === "setup") await seed();
} catch (err) {
  // Some pg errors (e.g. aggregate connection errors) have an empty message; fall back to the object.
  const text = err.message || err.code || String(err);
  console.error(`\n${text}${err.detail ? `\n${err.detail}` : ""}${err.where ? `\n${err.where}` : ""}`);
  if (!err.message) console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}

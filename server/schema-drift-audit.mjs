#!/usr/bin/env node
import pg from "pg";
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.log("[schema-drift-audit] SKIP: DATABASE_URL not set.");
  process.exit(0);
}

process.env.NODE_ENV = "test";
const { ensureSchema } = await import("./index.js");
await ensureSchema();

const pool = new Pool({ connectionString: DATABASE_URL });

function fail(msg) {
  console.error(`[schema-drift-audit] FAIL: ${msg}`);
  process.exitCode = 1;
}

async function expectColumn(table, column) {
  const { rows } = await pool.query(
    `SELECT is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  if (!rows.length) return fail(`${table}.${column} missing`);
  const r = rows[0];
  if (r.is_nullable !== "NO") fail(`${table}.${column} must be NOT NULL`);
  if (!String(r.column_default || "").toLowerCase().includes("now()")) {
    fail(`${table}.${column} must default to NOW()`);
  }
}

async function expectIndex(indexName) {
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1 LIMIT 1`,
    [indexName]
  );
  if (!rows.length) fail(`index ${indexName} missing`);
}

async function expectConstraint(name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`,
    [name]
  );
  if (!rows.length) fail(`constraint ${name} missing`);
}

const timestampTables = [
  "motions",
  "statements",
  "regulations",
  "questiontime_questions",
  "press_items",
  "polling_entries",
];

for (const table of timestampTables) {
  await expectColumn(table, "created_at");
  await expectColumn(table, "updated_at");
}

await expectIndex("press_items_reference_code_uniq");
await expectIndex("press_items_kind_prefix_serial_uniq");
await expectConstraint("press_items_reference_required_check");
await expectConstraint("press_items_author_required_check");

await pool.end();
if (process.exitCode && process.exitCode !== 0) process.exit(process.exitCode);
console.log("[schema-drift-audit] OK");

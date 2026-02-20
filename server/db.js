import pg from "pg";

const { Pool } = pg;

// Render/Neon: use DATABASE_URL from environment variables
if (!process.env.DATABASE_URL) {
  console.warn("[db] DATABASE_URL is not set yet.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined
});

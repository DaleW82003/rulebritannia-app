import pg from "pg";

const { Pool } = pg;

// Render/Neon: use DATABASE_URL from environment variables
if (!process.env.DATABASE_URL) {
  console.warn("[db] DATABASE_URL is not set yet.");
}

// Strip `sslmode` from the connection string and configure SSL explicitly to
// avoid pg's SECURITY WARNING: "The SSL modes 'prefer', 'require', and
// 'verify-ca' are treated as aliases for 'verify-full'."
function buildPoolConfig(rawUrl) {
  if (!rawUrl) return {};
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { connectionString: rawUrl };
  }
  const sslMode = url.searchParams.get("sslmode");
  // Enable SSL when the URL carries an explicit sslmode param, or when the
  // host is Neon (which requires SSL but omits the param in some conn strings).
  const needsSsl = Boolean(sslMode) || url.hostname.includes("neon.tech");
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  };
}

export const pool = new Pool(buildPoolConfig(process.env.DATABASE_URL));

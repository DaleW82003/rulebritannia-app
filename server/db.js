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

export const pool = new Pool({
  ...buildPoolConfig(process.env.DATABASE_URL),
  // Limit concurrent connections to avoid exhausting Render/Neon's connection cap.
  max: 10,
  // Ask Node to keep TCP connections alive through network idling.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Release idle clients quickly so they don't hold slots unnecessarily.
  idleTimeoutMillis: 30_000,
  // Fail fast when the database is unreachable rather than queuing indefinitely.
  connectionTimeoutMillis: 5_000,
});

// Avoid crashing the Node process when an idle pooled client is dropped by the
// network/database provider. `pg` emits this on the Pool instance; without a
// listener it becomes an unhandled `error` event and terminates the process.
pool.on("error", (err, client) => {
  const pid = client?.processID ?? "unknown";
  const host = client?.host ?? "unknown";
  console.error(`[db] pooled client error (pid=${pid}, host=${host})`, err);
});

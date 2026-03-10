const missing = [];

if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
if (process.env.NODE_ENV !== "test") missing.push("NODE_ENV=test");

if (missing.length) {
  console.error("\n[preflight] Integration test preflight failed.");
  console.error(`[preflight] Missing required environment: ${missing.join(", ")}`);
  console.error("[preflight] Example:");
  console.error("  DATABASE_URL=postgres://user:pass@host/db?sslmode=require NODE_ENV=test npm run test:integration:all\n");
  process.exit(1);
}

console.log("[preflight] DATABASE_URL and NODE_ENV=test detected.");

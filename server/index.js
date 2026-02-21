import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { pool } from "./db.js";

const app = express();
app.set("trust proxy", 1);

/**
 * -----------------------------
 * 1) Basic middleware
 * -----------------------------
 */
app.use(express.json({ limit: "2mb" }));

/**
 * -----------------------------
 * 2) CORS (allow your UI domains)
 * -----------------------------
 * Add any other front-end URLs here if needed.
 */
const ALLOWED_ORIGINS = new Set([
  "https://rulebritannia.org",
  "https://www.rulebritannia.org",
  "https://hoppscotch.io",
  // If your UI is also on a Render URL, add it here too, e.g.
  // "https://rulebritannia-app.onrender.com"
]);

app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allow.has(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    }
  })
);

app.use(cookieParser());

const PgStore = pgSession(session);

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "session"
    }),
    name: "rb.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: true
    }
  })
);

/**
 * -----------------------------
 * 3) Health + sanity endpoints
 * -----------------------------
 * Render / browsers can hit these to confirm server is alive.
 */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, time: result.rows[0].now });
  } catch (err) {
    console.error("[db-test]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * -----------------------------
 * 4) DB schema bootstrap
 * -----------------------------
 */
async function ensureSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.query(sql);
}

/**
 * -----------------------------
 * 5) API: read state
 * -----------------------------
 * GET /api/state -> { data, updatedAt }
 */
app.get("/api/state", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT data, updated_at FROM app_state WHERE id = $1",
      ["main"]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "No state yet" });
    }

    res.json({
      ok: true,
      data: rows[0].data,
      updatedAt: rows[0].updated_at,
    });
  } catch (err) {
    console.error("[GET /api/state]", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * -----------------------------
 * 6) API: write state (protected)
 * -----------------------------
 * POST /api/state
 * Headers: x-admin-token: <ADMIN_TOKEN>
 * Body: { data: <object> }
 */
app.post("/api/state", async (req, res) => {
  try {
    const expected = process.env.ADMIN_TOKEN || "";
    if (!expected) {
      return res
        .status(500)
        .json({ ok: false, error: "ADMIN_TOKEN is not set on the server" });
    }

    const provided = req.header("x-admin-token") || "";
    if (provided !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const data = req.body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({
        ok: false,
        error: "Body must be JSON: { data: <object> }",
      });
    }

    await pool.query(
      `
      INSERT INTO app_state (id, data)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data,
          updated_at = NOW()
      `,
      ["main", JSON.stringify(data)]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/state]", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * -----------------------------
 * 7) Start server after schema ready
 * -----------------------------
 */
const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] listening on :${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[server] schema init failed", err);
    process.exit(1);
  });

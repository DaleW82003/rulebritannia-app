import express from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";

const app = express();

// Render sits behind a proxy; needed for secure cookies
app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));

/**
 * CORS
 * - credentials:true is REQUIRED for cookies
 * - origin must include your FRONTEND origin (not hoppscotch, unless you're using it)
 */
const allow = new Set([
  "https://rulebritannia.org",
  "https://www.rulebritannia.org",
  "https://hoppscotch.io",
  "https://rulebritannia-app.onrender.com",
  // add your frontend render URL if you have one:
  // "https://your-frontend.onrender.com",
]);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // server-to-server/curl
      if (allow.has(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    },
    credentials: true,
  })
);

/**
 * Sessions (DB-backed)
 */
const PgStore = pgSession(session);

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: true,
    }),
    name: "rb.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "none", // cross-site cookie
      secure: true, // must be true on https
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

/**
 * Boot-time schema
 */
async function ensureSchema() {
  // Legacy single-row state (kept for migration)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Immutable versioned snapshots
  await pool.query(`
    CREATE TABLE IF NOT EXISTS state_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      label TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL
    );
  `);

  // Single-row pointer to the active snapshot
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state_current (
      id TEXT PRIMARY KEY,
      snapshot_id UUID REFERENCES state_snapshots(id)
    );
  `);

  // Migrate legacy app_state row into state_snapshots / app_state_current (once)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM app_state_current WHERE id = 'main')
        AND EXISTS (SELECT 1 FROM app_state WHERE id = 'main') THEN
        WITH migrated AS (
          INSERT INTO state_snapshots (label, data, created_at)
          SELECT 'migrated', data, updated_at FROM app_state WHERE id = 'main'
          RETURNING id
        )
        INSERT INTO app_state_current (id, snapshot_id)
        SELECT 'main', id FROM migrated;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // sessions table is handled by connect-pg-simple when createTableIfMissing:true

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         BIGSERIAL PRIMARY KEY,
      actor_id   TEXT NOT NULL,
      action     TEXT NOT NULL,
      target     TEXT NOT NULL DEFAULT '',
      details    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_log_actor_idx  ON audit_log (actor_id);
    CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action);
    CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
  `);

  // Seed defaults (INSERT … ON CONFLICT DO NOTHING keeps existing values)
  await pool.query(`
    INSERT INTO app_config (key, value) VALUES
      ('discourse_base_url', 'https://forum.rulebritannia.org'),
      ('ui_base_url',        'https://rulebritannia.org'),
      ('sim_start_date',     '1997-08-01'),
      ('clock_rate',         '2')
    ON CONFLICT (key) DO NOTHING;
  `);
}

/**
 * Health + DB test
 */
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * TEMP: hash helper (remove later)
 */
app.get("/dev/hash/:pw", async (req, res) => {
  const hash = await bcrypt.hash(req.params.pw, 10);
  res.json({ hash });
});

/**
 * AUTH
 * POST /auth/login
 * GET  /auth/me
 * POST /auth/logout
 */

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Missing email or password" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { rows } = await pool.query(
      "SELECT id, username, email, password_hash, roles FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, error: "Invalid email or password" });
    }

    const user = rows[0];

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid email or password" });
    }

    // Save to session
    req.session.userId = user.id;
    req.session.roles = user.roles;

    // IMPORTANT: force-save session before replying
    req.session.save((err) => {
      if (err) {
        console.error("session save failed:", err);
        return res.status(500).json({ ok: false, error: "Session save failed" });
      }

      return res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          roles: user.roles,
        },
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/auth/me", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ ok: false });
    }

    const { rows } = await pool.query(
      "SELECT id, username, email, roles, created_at FROM users WHERE id = $1",
      [req.session.userId]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false });
    }

    return res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("rb.sid", {
      sameSite: "none",
      secure: true,
    });
    res.json({ ok: true });
  });
});

/**
 * STATE
 */
app.get("/api/state", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    const { rows } = await pool.query(
      `SELECT s.data, s.created_at AS updated_at
       FROM app_state_current c
       JOIN state_snapshots s ON s.id = c.snapshot_id
       WHERE c.id = 'main'`
    );
    if (!rows.length) return res.status(404).json({ error: "No state yet" });
    res.json({ data: rows[0].data, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/state", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }

    const data = req.body?.data;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Body must be { data: <object> }" });
    }

    const label = req.body?.label || "autosave";

    const { rows } = await pool.query(
      `INSERT INTO state_snapshots (created_by, label, data)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [req.session.userId, label, JSON.stringify(data)]
    );
    const snapshotId = rows[0].id;

    await pool.query(
      `INSERT INTO app_state_current (id, snapshot_id)
       VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id`,
      [snapshotId]
    );

    res.json({ ok: true, snapshotId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * SNAPSHOTS
 * GET  /api/snapshots                — admin: list all snapshots
 * POST /api/snapshots                — admin: create named snapshot { label, data }
 * POST /api/snapshots/:id/restore    — admin: set current pointer to snapshot (O(1))
 */
app.get("/api/snapshots", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }

    const { rows: current } = await pool.query(
      "SELECT snapshot_id FROM app_state_current WHERE id = 'main'"
    );
    const currentId = current[0]?.snapshot_id ?? null;

    const { rows } = await pool.query(
      `SELECT id, created_at, created_by, label
       FROM state_snapshots
       ORDER BY created_at DESC`
    );
    res.json({ snapshots: rows, currentId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/snapshots", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }

    const { label, data } = req.body || {};
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ error: "Body must include a non-empty label" });
    }
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Body must include a data object" });
    }

    const { rows } = await pool.query(
      `INSERT INTO state_snapshots (created_by, label, data)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, created_at, label`,
      [req.session.userId, label.trim(), JSON.stringify(data)]
    );

    await pool.query(
      `INSERT INTO app_state_current (id, snapshot_id)
       VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id`,
      [rows[0].id]
    );

    res.json({ ok: true, snapshot: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/snapshots/:id/restore", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }

    const snapshotId = req.params.id;

    const { rows } = await pool.query(
      "SELECT id FROM state_snapshots WHERE id = $1",
      [snapshotId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Snapshot not found" });
    }

    await pool.query(
      `INSERT INTO app_state_current (id, snapshot_id)
       VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id`,
      [snapshotId]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * CONFIG
 * GET /api/config   — public, returns all key/value pairs
 * PUT /api/config   — admin only, accepts { key: value, … }
 */
app.get("/api/config", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT key, value FROM app_config");
    const config = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({ config });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/config", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }

    const updates = req.body;
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return res.status(400).json({ error: "Body must be a key/value object" });
    }

    const ALLOWED_KEYS = new Set(["discourse_base_url", "ui_base_url", "sim_start_date", "clock_rate"]);
    const entries = Object.entries(updates).filter(([k]) => ALLOWED_KEYS.has(k));
    if (!entries.length) {
      return res.status(400).json({ error: "No valid config keys provided" });
    }

    const keys = entries.map(([k]) => k);
    const values = entries.map(([, v]) => String(v));
    await pool.query(
      `INSERT INTO app_config (key, value)
       SELECT unnest($1::text[]), unnest($2::text[])
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()`,
      [keys, values]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * AUDIT LOG
 * POST /api/audit-log  — authenticated: record an admin/mod action
 * GET  /api/audit-log  — admin only: list entries with optional filters
 */

const auditWriteLimit = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const auditReadLimit  = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

app.post("/api/audit-log", auditWriteLimit, async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    const { action, target = "", details = {} } = req.body || {};
    if (!action || typeof action !== "string" || !action.trim()) {
      return res.status(400).json({ error: "Body must include a non-empty action" });
    }
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, target, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [req.session.userId, action.trim(), String(target), JSON.stringify(details)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/audit-log", auditReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }

    const { action, target, actor, limit = "50", offset = "0" } = req.query;
    const conditions = [];
    const params = [];

    if (action) {
      params.push(action);
      conditions.push(`action = $${params.length}`);
    }
    if (target) {
      params.push(`%${target}%`);
      conditions.push(`target ILIKE $${params.length}`);
    }
    if (actor) {
      params.push(actor);
      conditions.push(`actor_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    params.push(lim, off);
    const { rows } = await pool.query(
      `SELECT id, actor_id, action, target, details, created_at
       FROM audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_log ${where}`,
      params.slice(0, params.length - 2)
    );

    res.json({ entries: rows, total: parseInt(countRows[0].total, 10) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
  })
  .catch((e) => {
    console.error("[server] schema init failed", e);
    process.exit(1);
  });

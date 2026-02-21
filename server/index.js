import express from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { pool } from "./db.js";
import { createTopic, createPost } from "./discourse.js";

/**
 * Discourse credential encryption (AES-256-GCM).
 * Key derived from SESSION_SECRET so no extra env var is required,
 * but can be overridden with DISCOURSE_ENCRYPTION_KEY (64-char hex = 32 bytes).
 */
let _discourseKey = null;
function getDiscourseKey() {
  if (_discourseKey) return _discourseKey;
  if (process.env.DISCOURSE_ENCRYPTION_KEY) {
    _discourseKey = Buffer.from(process.env.DISCOURSE_ENCRYPTION_KEY, "hex");
    if (_discourseKey.length !== 32) throw new Error("DISCOURSE_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  } else {
    _discourseKey = scryptSync(
      process.env.SESSION_SECRET || "dev-secret-change-me",
      "rb-discourse-v1",
      32
    );
  }
  return _discourseKey;
}

function discourseEncrypt(plaintext) {
  if (!plaintext) return "";
  const key = getDiscourseKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function discourseDecrypt(stored) {
  if (!stored) return "";
  try {
    const parts = stored.split(":");
    if (parts.length !== 3) return "";
    const [ivHex, tagHex, ciphertextHex] = parts;
    const key = getDiscourseKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
  } catch {
    return "";
  }
}

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bills (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS motions (
      id          TEXT PRIMARY KEY,
      motion_type TEXT NOT NULL DEFAULT 'house',
      data        JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS statements (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS regulations (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS questiontime_questions (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Seed defaults (INSERT … ON CONFLICT DO NOTHING keeps existing values)
  await pool.query(`
    INSERT INTO app_config (key, value) VALUES
      ('discourse_base_url',      'https://forum.rulebritannia.org'),
      ('discourse_api_key',       ''),
      ('discourse_api_username',  ''),
      ('ui_base_url',             'https://rulebritannia.org'),
      ('sim_start_date',          '1997-08-01'),
      ('clock_rate',              '2')
    ON CONFLICT (key) DO NOTHING;
  `);
}

/**
 * Middleware helpers
 */
function requireAuth(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not logged in" });
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not logged in" });
    return false;
  }
  if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
    res.status(403).json({ error: "Forbidden: admin role required" });
    return false;
  }
  return true;
}

/**
 * Sync the five key object tables from a full game-state snapshot.
 * Called whenever POST /api/state saves a new snapshot, keeping the
 * tables as a derived cache.  Uses batched upserts inside a transaction.
 */
async function syncObjectTables(data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // helper: bulk-upsert an array of {id, data} rows into a simple table
    async function upsertRows(table, rows) {
      if (!rows.length) return;
      // Build VALUES ($1,$2), ($3,$4), …
      const placeholders = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}::jsonb)`).join(", ");
      const params = rows.flatMap((r) => [r.id, JSON.stringify(r.data)]);
      await client.query(
        `INSERT INTO ${table} (id, data)
         VALUES ${placeholders}
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        params
      );
    }

    // bills — stored in orderPaperCommons array
    await upsertRows(
      "bills",
      (Array.isArray(data.orderPaperCommons) ? data.orderPaperCommons : [])
        .filter((b) => b.id)
        .map((b) => ({ id: b.id, data: b }))
    );

    // motions — house and edm sub-arrays; include motion_type column
    const allMotions = [
      ...(Array.isArray(data.motions?.house) ? data.motions.house : []).map((m) => ({ ...m, _type: "house" })),
      ...(Array.isArray(data.motions?.edm)   ? data.motions.edm   : []).map((m) => ({ ...m, _type: "edm" })),
    ].filter((m) => m.id);
    if (allMotions.length) {
      const placeholders = allMotions.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb)`).join(", ");
      const params = allMotions.flatMap(({ _type, ...m }) => [m.id, _type, JSON.stringify(m)]);
      await client.query(
        `INSERT INTO motions (id, motion_type, data)
         VALUES ${placeholders}
         ON CONFLICT (id) DO UPDATE SET motion_type = EXCLUDED.motion_type, data = EXCLUDED.data, updated_at = NOW()`,
        params
      );
    }

    // statements — items array
    await upsertRows(
      "statements",
      (Array.isArray(data.statements?.items) ? data.statements.items : [])
        .filter((s) => s.id)
        .map((s) => ({ id: s.id, data: s }))
    );

    // regulations — items array
    await upsertRows(
      "regulations",
      (Array.isArray(data.regulations?.items) ? data.regulations.items : [])
        .filter((r) => r.id)
        .map((r) => ({ id: r.id, data: r }))
    );

    // questiontime_questions — questions array
    await upsertRows(
      "questiontime_questions",
      (Array.isArray(data.questionTime?.questions) ? data.questionTime.questions : [])
        .filter((q) => q.id)
        .map((q) => ({ id: q.id, data: q }))
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

    // Keep the object tables in sync with the new state
    try { await syncObjectTables(data); } catch (syncErr) { console.error("[syncObjectTables]", syncErr); }

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
    // Never expose encrypted discourse credentials through the public config endpoint
    const SENSITIVE = new Set(["discourse_api_key", "discourse_api_username"]);
    const config = Object.fromEntries(rows.filter((r) => !SENSITIVE.has(r.key)).map((r) => [r.key, r.value]));
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
 * DISCOURSE INTEGRATION
 * GET  /api/discourse/config  — admin: read base URL + whether credentials are set (never raw values)
 * PUT  /api/discourse/config  — admin: save base URL, API key, and API username (key+username stored encrypted)
 * POST /api/discourse/test    — admin: validate credentials by calling Discourse /site.json
 */

const discourseReadLimit  = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });
const discourseWriteLimit = rateLimit({ windowMs: 60_000, max: 10,  standardHeaders: true, legacyHeaders: false });

app.get("/api/discourse/config", discourseReadLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'discourse_api_key', 'discourse_api_username')"
    );
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      base_url:         cfg.discourse_base_url || "",
      has_api_key:      Boolean(cfg.discourse_api_key),
      has_api_username: Boolean(cfg.discourse_api_username),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/discourse/config", discourseWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { base_url, api_key, api_username } = req.body || {};

    const entries = [];
    if (base_url !== undefined) {
      entries.push(["discourse_base_url", String(base_url).trim()]);
    }
    if (api_key !== undefined && api_key !== "") {
      entries.push(["discourse_api_key", discourseEncrypt(String(api_key))]);
    }
    if (api_username !== undefined && api_username !== "") {
      entries.push(["discourse_api_username", discourseEncrypt(String(api_username))]);
    }

    if (!entries.length) {
      return res.status(400).json({ error: "No valid fields provided" });
    }

    const keys   = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);
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

app.post("/api/discourse/test", discourseWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { rows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'discourse_api_key', 'discourse_api_username')"
    );
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    const baseUrl     = (cfg.discourse_base_url || "").trim().replace(/\/$/, "");
    const apiKey      = cfg.discourse_api_key     ? discourseDecrypt(cfg.discourse_api_key)     : "";
    const apiUsername = cfg.discourse_api_username ? discourseDecrypt(cfg.discourse_api_username) : "";

    if (!baseUrl)     return res.status(400).json({ ok: false, error: "Discourse base URL not configured" });
    if (!apiKey)      return res.status(400).json({ ok: false, error: "Discourse API key not configured" });
    if (!apiUsername) return res.status(400).json({ ok: false, error: "Discourse API username not configured" });

    const discourseRes = await fetch(`${baseUrl}/site.json`, {
      headers: {
        "Api-Key":      apiKey,
        "Api-Username": apiUsername,
        "Content-Type": "application/json",
      },
    });

    if (discourseRes.ok) {
      const body = await discourseRes.json().catch((parseErr) => {
        console.warn("[discourse/test] JSON parse error:", parseErr.message);
        return {};
      });
      return res.json({ ok: true, discourse_title: body.site_settings?.title ?? null });
    }

    return res.json({ ok: false, status: discourseRes.status, error: `Discourse returned HTTP ${discourseRes.status}` });
  } catch (e) {
    console.error("[discourse/test]", e);
    const msg = e.code === "ECONNREFUSED" || e.code === "ENOTFOUND"
      ? `Could not connect to Discourse server: ${e.message}`
      : e.message;
    res.status(500).json({ ok: false, error: msg });
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

/**
 * BILLS  (orderPaperCommons items)
 * GET    /api/bills          — authenticated: list all bills
 * GET    /api/bills/:id      — authenticated: get one bill
 * POST   /api/bills          — admin: create a bill
 * PUT    /api/bills/:id      — admin: update a bill
 * DELETE /api/bills/:id      — admin: delete a bill
 */

const crudReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const crudWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/bills", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, updated_at FROM bills ORDER BY updated_at DESC");
    res.json({ bills: rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/bills/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, updated_at FROM bills WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Bill not found" });
    res.json({ bill: { ...rows[0].data, _updatedAt: rows[0].updated_at } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/bills", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const bill = req.body;
    if (!bill || typeof bill !== "object" || !bill.id) {
      return res.status(400).json({ error: "Body must be a bill object with an id" });
    }
    const { rows } = await pool.query(
      `INSERT INTO bills (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [bill.id, JSON.stringify(bill)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/bills/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const bill = req.body;
    if (!bill || typeof bill !== "object") {
      return res.status(400).json({ error: "Body must be a bill object" });
    }
    const { rows } = await pool.query(
      `UPDATE bills SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at`,
      [JSON.stringify({ ...bill, id: req.params.id }), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Bill not found" });
    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/bills/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM bills WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Bill not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * MOTIONS
 * GET    /api/motions          — authenticated: list all motions (optional ?type=house|edm)
 * GET    /api/motions/:id      — authenticated: get one motion
 * POST   /api/motions          — admin: create a motion
 * PUT    /api/motions/:id      — admin: update a motion
 * DELETE /api/motions/:id      — admin: delete a motion
 */
app.get("/api/motions", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { type } = req.query;
    let query = "SELECT id, motion_type, data, updated_at FROM motions";
    const params = [];
    if (type === "house" || type === "edm") {
      query += " WHERE motion_type = $1";
      params.push(type);
    }
    query += " ORDER BY updated_at DESC";
    const { rows } = await pool.query(query, params);
    res.json({ motions: rows.map((r) => ({ ...r.data, _motionType: r.motion_type, _updatedAt: r.updated_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/motions/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, motion_type, data, updated_at FROM motions WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Motion not found" });
    res.json({ motion: { ...rows[0].data, _motionType: rows[0].motion_type, _updatedAt: rows[0].updated_at } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/motions", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { motion_type = "house", ...motion } = req.body || {};
    if (!motion.id) {
      return res.status(400).json({ error: "Body must be a motion object with an id" });
    }
    if (motion_type !== "house" && motion_type !== "edm") {
      return res.status(400).json({ error: "motion_type must be 'house' or 'edm'" });
    }
    const { rows } = await pool.query(
      `INSERT INTO motions (id, motion_type, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET motion_type = EXCLUDED.motion_type, data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [motion.id, motion_type, JSON.stringify(motion)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/motions/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { motion_type, ...motion } = req.body || {};
    const typeClause = (motion_type === "house" || motion_type === "edm") ? ", motion_type = $3" : "";
    const params = [
      JSON.stringify({ ...motion, id: req.params.id }),
      req.params.id,
    ];
    if (typeClause) params.push(motion_type);
    const { rows } = await pool.query(
      `UPDATE motions SET data = $1::jsonb, updated_at = NOW()${typeClause} WHERE id = $2 RETURNING id, updated_at`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: "Motion not found" });
    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/motions/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM motions WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Motion not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * STATEMENTS
 * GET    /api/statements          — authenticated: list all statements
 * GET    /api/statements/:id      — authenticated: get one statement
 * POST   /api/statements          — admin: create a statement
 * PUT    /api/statements/:id      — admin: update a statement
 * DELETE /api/statements/:id      — admin: delete a statement
 */
app.get("/api/statements", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, updated_at FROM statements ORDER BY updated_at DESC");
    res.json({ statements: rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/statements/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, data, updated_at FROM statements WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Statement not found" });
    res.json({ statement: { ...rows[0].data, _updatedAt: rows[0].updated_at } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/statements", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const stmt = req.body;
    if (!stmt || typeof stmt !== "object" || !stmt.id) {
      return res.status(400).json({ error: "Body must be a statement object with an id" });
    }
    const { rows } = await pool.query(
      `INSERT INTO statements (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [stmt.id, JSON.stringify(stmt)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/statements/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const stmt = req.body;
    if (!stmt || typeof stmt !== "object") {
      return res.status(400).json({ error: "Body must be a statement object" });
    }
    const { rows } = await pool.query(
      `UPDATE statements SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at`,
      [JSON.stringify({ ...stmt, id: req.params.id }), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Statement not found" });
    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/statements/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM statements WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Statement not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * REGULATIONS
 * GET    /api/regulations          — authenticated: list all regulations
 * GET    /api/regulations/:id      — authenticated: get one regulation
 * POST   /api/regulations          — admin: create a regulation
 * PUT    /api/regulations/:id      — admin: update a regulation
 * DELETE /api/regulations/:id      — admin: delete a regulation
 */
app.get("/api/regulations", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, updated_at FROM regulations ORDER BY updated_at DESC");
    res.json({ regulations: rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/regulations/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, data, updated_at FROM regulations WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Regulation not found" });
    res.json({ regulation: { ...rows[0].data, _updatedAt: rows[0].updated_at } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/regulations", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const reg = req.body;
    if (!reg || typeof reg !== "object" || !reg.id) {
      return res.status(400).json({ error: "Body must be a regulation object with an id" });
    }
    const { rows } = await pool.query(
      `INSERT INTO regulations (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [reg.id, JSON.stringify(reg)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/regulations/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const reg = req.body;
    if (!reg || typeof reg !== "object") {
      return res.status(400).json({ error: "Body must be a regulation object" });
    }
    const { rows } = await pool.query(
      `UPDATE regulations SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at`,
      [JSON.stringify({ ...reg, id: req.params.id }), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Regulation not found" });
    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/regulations/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM regulations WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Regulation not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * QUESTION TIME QUESTIONS
 * GET    /api/questiontime-questions          — authenticated: list all questions
 * GET    /api/questiontime-questions/:id      — authenticated: get one question
 * POST   /api/questiontime-questions          — admin: create a question
 * PUT    /api/questiontime-questions/:id      — admin: update a question
 * DELETE /api/questiontime-questions/:id      — admin: delete a question
 */
app.get("/api/questiontime-questions", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, data, updated_at FROM questiontime_questions ORDER BY updated_at DESC"
    );
    res.json({ questions: rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/questiontime-questions/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, data, updated_at FROM questiontime_questions WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Question not found" });
    res.json({ question: { ...rows[0].data, _updatedAt: rows[0].updated_at } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/questiontime-questions", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const q = req.body;
    if (!q || typeof q !== "object" || !q.id) {
      return res.status(400).json({ error: "Body must be a question object with an id" });
    }
    const { rows } = await pool.query(
      `INSERT INTO questiontime_questions (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [q.id, JSON.stringify(q)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/questiontime-questions/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const q = req.body;
    if (!q || typeof q !== "object") {
      return res.status(400).json({ error: "Body must be a question object" });
    }
    const { rows } = await pool.query(
      `UPDATE questiontime_questions SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at`,
      [JSON.stringify({ ...q, id: req.params.id }), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Question not found" });
    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/questiontime-questions/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM questiontime_questions WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Question not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DEBATES (Discourse integration)
 * POST /api/debates/create — any authenticated user
 *
 * Body: { entityType, entityId, title, raw, categoryId?, tags? }
 *   entityType: "bill" | "motion" | "statement" | "regulation" | "question"
 *   entityId:   the id of the entity to attach the topic link to
 *   title:      Discourse topic title
 *   raw:        Discourse topic body (Markdown)
 *   categoryId: (optional) Discourse category ID
 *   tags:       (optional) array of tag strings
 *
 * Returns: { ok: true, topicId, topicUrl }
 * Also patches the entity's JSONB data with discourseTopicId + discourseTopicUrl.
 * Idempotent: if the entity already has a discourseTopicId, returns the existing URL.
 */

const DEBATE_ENTITY_TABLES = {
  bill:       "bills",
  motion:     "motions",
  statement:  "statements",
  regulation: "regulations",
  question:   "questiontime_questions",
};

app.post("/api/debates/create", discourseWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { entityType, entityId, title, raw, categoryId, tags } = req.body || {};

    if (!entityType || !entityId || !title || !raw) {
      return res.status(400).json({ error: "Body must include entityType, entityId, title, and raw" });
    }
    if (!DEBATE_ENTITY_TABLES[entityType]) {
      return res.status(400).json({
        error: `entityType must be one of: ${Object.keys(DEBATE_ENTITY_TABLES).join(", ")}`,
      });
    }

    // `table` is derived from DEBATE_ENTITY_TABLES — a static whitelist of known-safe names —
    // so interpolating it here is not a SQL injection risk.
    const table = DEBATE_ENTITY_TABLES[entityType];

    // Idempotency: return existing topic if one was already created for this entity.
    const { rows: existing } = await pool.query(
      `SELECT data->>'discourseTopicId' AS topic_id, data->>'discourseTopicUrl' AS topic_url FROM ${table} WHERE id = $1`,
      [String(entityId)]
    );
    if (existing.length && existing[0].topic_id) {
      const existingUrl = existing[0].topic_url || `https://forum.rulebritannia.org/t/${existing[0].topic_id}`;
      return res.json({ ok: true, topicId: Number(existing[0].topic_id), topicUrl: existingUrl, existing: true });
    }

    // Load and decrypt Discourse credentials
    const { rows: cfgRows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'discourse_api_key', 'discourse_api_username')"
    );
    const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));

    const baseUrl     = (cfg.discourse_base_url || "").trim().replace(/\/$/, "");
    const apiKey      = cfg.discourse_api_key      ? discourseDecrypt(cfg.discourse_api_key)      : "";
    const apiUsername = cfg.discourse_api_username ? discourseDecrypt(cfg.discourse_api_username) : "";

    if (!baseUrl)     return res.status(400).json({ ok: false, error: "Discourse base URL not configured" });
    if (!apiKey)      return res.status(400).json({ ok: false, error: "Discourse API key not configured" });
    if (!apiUsername) return res.status(400).json({ ok: false, error: "Discourse API username not configured" });

    // Create topic on Discourse
    const { topicId, topicSlug } = await createTopic({
      baseUrl, apiKey, apiUsername,
      title: String(title),
      raw:   String(raw),
      categoryId,
      tags: Array.isArray(tags) ? tags : undefined,
    });

    const topicUrl = topicSlug
      ? `${baseUrl}/t/${topicSlug}/${topicId}`
      : `${baseUrl}/t/${topicId}`;

    // Patch the entity row: merge discourseTopicId and discourseTopicUrl into JSONB data.
    await pool.query(
      `UPDATE ${table}
          SET data       = data || $1::jsonb,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify({ discourseTopicId: topicId, discourseTopicUrl: topicUrl }), String(entityId)]
    );

    res.json({ ok: true, topicId, topicUrl });
  } catch (e) {
    console.error("[debates/create]", e);
    res.status(500).json({ error: e.message || "Server error" });
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

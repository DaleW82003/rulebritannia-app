import express from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { pool } from "./db.js";
import { createTopic, createPost, createTopicWithRetry, getGroupMembers, addGroupMembers, removeGroupMembers, buildSsoPayload, verifySsoPayload } from "./discourse.js";
import { ALL_VALID_ROLES, computeDiscourseGroups, PERMISSION_MAP, DISCOURSE_GROUP_MAP } from "./roles.js";

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
 * - origin is restricted to the production frontend origins only
 */
const allow = new Set([
  "https://rulebritannia.org",
  "https://www.rulebritannia.org",
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

// CSRF token validation for all state-changing requests
app.use(verifyCsrfToken);

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
    CREATE TABLE IF NOT EXISTS user_roles (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      assigned_by TEXT,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, role)
    );
    CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles (user_id);
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sim_clock (
      id                TEXT PRIMARY KEY,
      sim_current_month INTEGER NOT NULL DEFAULT 8,
      sim_current_year  INTEGER NOT NULL DEFAULT 1997,
      real_last_tick    TIMESTAMPTZ,
      rate              INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Seed defaults (INSERT … ON CONFLICT DO NOTHING keeps existing values)
  await pool.query(`
    INSERT INTO app_config (key, value) VALUES
      ('discourse_base_url',      'https://forum.rulebritannia.org'),
      ('discourse_api_key',       ''),
      ('discourse_api_username',  ''),
      ('discourse_sso_secret',    ''),
      ('ui_base_url',             'https://rulebritannia.org'),
      ('sim_start_date',          '1997-08-01'),
      ('clock_rate',              '2')
    ON CONFLICT (key) DO NOTHING;
  `);

  await pool.query(`
    INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
    VALUES ('main', 8, 1997, 1)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Characters table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
      name          TEXT NOT NULL,
      party         TEXT NOT NULL DEFAULT '',
      constituency  TEXT NOT NULL DEFAULT '',
      roles         JSONB NOT NULL DEFAULT '[]'::jsonb,
      offices       JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS characters_user_idx ON characters (user_id);
    CREATE INDEX IF NOT EXISTS characters_name_idx ON characters (name);
  `);

  // Offices table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS offices (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'parliamentary'
    );
  `);

  // Office assignments table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS office_assignments (
      id           BIGSERIAL PRIMARY KEY,
      office_id    TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (office_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS office_assignments_office_idx     ON office_assignments (office_id);
    CREATE INDEX IF NOT EXISTS office_assignments_character_idx  ON office_assignments (character_id);
  `);

  // Divisions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS divisions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'open',
      closes_at   TIMESTAMPTZ,
      created_by  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS divisions_entity_idx  ON divisions (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS divisions_status_idx  ON divisions (status);
  `);

  // Division votes table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_votes (
      id           BIGSERIAL PRIMARY KEY,
      division_id  UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      vote         TEXT NOT NULL,
      weight       INTEGER NOT NULL DEFAULT 1,
      voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (division_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS division_votes_division_idx ON division_votes (division_id);
  `);

  // Structured Question Time tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qt_questions (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      office_id              TEXT NOT NULL,
      asked_by_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      asked_by_name          TEXT NOT NULL DEFAULT '',
      asked_by_role          TEXT NOT NULL DEFAULT 'backbencher',
      text                   TEXT NOT NULL,
      status                 TEXT NOT NULL DEFAULT 'open',
      asked_at_sim           TEXT NOT NULL DEFAULT '',
      due_at_sim             TEXT NOT NULL DEFAULT '',
      speaker_demand_at      TIMESTAMPTZ,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS qt_questions_office_idx  ON qt_questions (office_id);
    CREATE INDEX IF NOT EXISTS qt_questions_status_idx  ON qt_questions (status);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qt_answers (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id               UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
      answered_by_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      answered_by_name          TEXT NOT NULL DEFAULT '',
      text                      TEXT NOT NULL,
      answered_at_sim           TEXT NOT NULL DEFAULT '',
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qt_followups (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id            UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
      asked_by_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      asked_by_name          TEXT NOT NULL DEFAULT '',
      asked_by_role          TEXT NOT NULL DEFAULT 'backbencher',
      text                   TEXT NOT NULL,
      answer                 TEXT NOT NULL DEFAULT '',
      answered_by_name       TEXT NOT NULL DEFAULT '',
      asked_at_sim           TEXT NOT NULL DEFAULT '',
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS qt_followups_question_idx ON qt_followups (question_id);
  `);

  // Simulation state table (authoritative sim clock + pause flag)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sim_state (
      id           TEXT PRIMARY KEY DEFAULT 'main',
      year         INTEGER NOT NULL DEFAULT 1997,
      month        INTEGER NOT NULL DEFAULT 8,
      is_paused    BOOLEAN NOT NULL DEFAULT false,
      last_tick_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    INSERT INTO sim_state (id, year, month)
    VALUES ('main', 1997, 8)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Extend audit_log with structured columns (safe on existing DBs via ADD COLUMN IF NOT EXISTS)
  await pool.query(`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS entity_id   TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS before_json JSONB,
      ADD COLUMN IF NOT EXISTS after_json  JSONB;
  `);
}

/**
 * CSRF helpers
 *
 * A per-session token is generated on login and must be echoed back in the
 * X-CSRF-Token request header on every state-changing request (POST / PUT /
 * DELETE / PATCH).  GET, HEAD, and OPTIONS are considered safe and are not
 * checked.  The login endpoint is also exempt because the session (and token)
 * does not exist yet at that point.
 */
function generateCsrfToken() {
  return randomBytes(32).toString("hex");
}

// Paths that are explicitly exempt from CSRF validation because no session
// (and therefore no token) exists when they are called.
const CSRF_EXEMPT_PATHS = new Set(["/auth/login"]);

function verifyCsrfToken(req, res, next) {
  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
  if (safeMethods.has(req.method)) return next();

  // Explicit exemptions only — do not skip silently for other unauthenticated paths.
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

  const sessionToken = req.session?.csrfToken;
  const requestToken = req.headers["x-csrf-token"];
  if (
    !sessionToken ||
    !requestToken ||
    sessionToken.length !== requestToken.length ||
    !timingSafeEqual(Buffer.from(sessionToken), Buffer.from(requestToken))
  ) {
    return res.status(403).json({ error: "CSRF token missing or invalid" });
  }
  next();
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
 * Health
 */
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Permission map
 * GET /api/permissions — public (no auth required)
 *
 * Returns the full PERMISSION_MAP so the frontend can drive UI visibility
 * without hard-coding role lists in page code.
 *
 * Also accepts an optional ?roles=admin,mod query param to filter to only
 * the actions the caller is permitted to perform.
 */
app.get("/api/permissions", (req, res) => {
  const filterRoles = req.query?.roles
    ? String(req.query.roles).split(",").map((r) => r.trim()).filter(Boolean)
    : null;

  if (filterRoles) {
    // Return only actions where the user's roles satisfy at least one required role
    const allowed = {};
    for (const [action, required] of Object.entries(PERMISSION_MAP)) {
      if (required.length === 0 || required.some((r) => filterRoles.includes(r))) {
        allowed[action] = required;
      }
    }
    return res.json({ permissions: allowed });
  }

  res.json({ permissions: PERMISSION_MAP });
});

/**
 * CSRF token endpoint
 * GET /csrf-token — authenticated: returns (or creates) the CSRF token for the current session
 */
app.get("/csrf-token", (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.json({ csrfToken: req.session.csrfToken });
});

/**
 * AUTH
 * POST /auth/login
 * GET  /auth/me
 * POST /auth/logout
 */

const authLimit = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post("/auth/login", authLimit, async (req, res) => {
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
    req.session.csrfToken = generateCsrfToken();

    // IMPORTANT: force-save session before replying
    req.session.save((err) => {
      if (err) {
        console.error("session save failed:", err);
        return res.status(500).json({ ok: false, error: "Session save failed" });
      }

      // Record login in audit log for admin users (fire-and-forget)
      if (Array.isArray(user.roles) && user.roles.includes("admin")) {
        pool.query(
          `INSERT INTO audit_log (actor_id, action, target, details) VALUES ($1, $2, $3, $4::jsonb)`,
          [user.id, "admin-login", user.email, JSON.stringify({})]
        ).catch((e) => console.error("audit-log login insert failed:", e));
      }

      return res.json({
        ok: true,
        csrfToken: req.session.csrfToken,
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

app.get("/auth/me", authLimit, async (req, res) => {
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

    // Lazily generate a CSRF token for sessions that pre-date this feature
    if (!req.session.csrfToken) {
      req.session.csrfToken = generateCsrfToken();
    }

    return res.json({ ok: true, csrfToken: req.session.csrfToken, user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/auth/logout", authLimit, (req, res) => {
  const logoutUserId = req.session?.userId;
  const logoutRoles  = req.session?.roles;

  // Record logout in audit log for admin users (fire-and-forget)
  if (logoutUserId && Array.isArray(logoutRoles) && logoutRoles.includes("admin")) {
    pool.query(
      `INSERT INTO audit_log (actor_id, action, target, details) VALUES ($1, $2, $3, $4::jsonb)`,
      [logoutUserId, "admin-logout", "", JSON.stringify({})]
    ).catch((e) => console.error("audit-log logout insert failed:", e));
  }

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
    const SENSITIVE = new Set(["discourse_api_key", "discourse_api_username", "discourse_sso_secret"]);
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
      "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'discourse_api_key', 'discourse_api_username', 'discourse_sso_secret')"
    );
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      base_url:         cfg.discourse_base_url || "",
      has_api_key:      Boolean(cfg.discourse_api_key),
      has_api_username: Boolean(cfg.discourse_api_username),
      has_sso_secret:   Boolean(cfg.discourse_sso_secret),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/discourse/config", discourseWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { base_url, api_key, api_username, sso_secret } = req.body || {};

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
    if (sso_secret !== undefined && sso_secret !== "") {
      if (String(sso_secret).length < 32) {
        return res.status(400).json({ error: "SSO secret must be at least 32 characters" });
      }
      entries.push(["discourse_sso_secret", discourseEncrypt(String(sso_secret))]);
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
 * DISCOURSECONNECT SSO
 *
 * Disabled unless the DISCOURSE_SSO_ENABLED=true environment variable is set.
 *
 * GET /api/discourse/sso           — Entry point; redirects browser to Discourse
 *                                    with a signed nonce. Must be called by the
 *                                    browser (not fetch) so the cookie is present.
 * GET /api/discourse/sso/callback  — Discourse redirects back here with the
 *                                    signed user payload. Verifies signature,
 *                                    finds or creates the local user, starts a
 *                                    session, then redirects to the UI.
 *
 * GET /api/admin/sso-readiness     — Admin: check whether all SSO prerequisites
 *                                    are satisfied. Returns green/red check list.
 *
 * Ref: https://meta.discourse.org/t/discourseconnect-official-single-sign-on-for-discourse/13045
 */

const ssoEnabled = process.env.DISCOURSE_SSO_ENABLED === "true";
const ssoRateLimit = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

/** Load and decrypt the SSO secret from app_config, or return null. */
async function getSsoSecret() {
  const { rows } = await pool.query(
    "SELECT value FROM app_config WHERE key = 'discourse_sso_secret'"
  );
  const raw = rows[0]?.value || "";
  return raw ? discourseDecrypt(raw) : null;
}

app.get("/api/discourse/sso", ssoRateLimit, async (req, res) => {
  if (!ssoEnabled) {
    return res.status(404).json({ error: "DiscourseConnect SSO is not enabled on this server" });
  }

  try {
    const ssoSecret = await getSsoSecret();
    if (!ssoSecret) {
      return res.status(503).json({ error: "SSO secret not configured. Set it in the Discourse Integration admin panel." });
    }

    const { rows: cfgRows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'ui_base_url')"
    );
    const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
    const baseUrl  = (cfg.discourse_base_url || "").trim().replace(/\/$/, "");
    const uiBase   = (cfg.ui_base_url        || "").trim().replace(/\/$/, "");

    if (!baseUrl) {
      return res.status(503).json({ error: "Discourse base URL not configured" });
    }

    // Generate a nonce, store in session so we can verify on callback
    const nonce = randomBytes(16).toString("hex");
    req.session.ssoNonce = nonce;

    const returnUrl = `${uiBase || ""}/api/discourse/sso/callback`;
    const { sso, sig } = buildSsoPayload({ ssoSecret, returnUrl, nonce });

    const redirectUrl = `${baseUrl}/session/sso_provider?sso=${encodeURIComponent(sso)}&sig=${encodeURIComponent(sig)}`;
    res.redirect(302, redirectUrl);
  } catch (e) {
    console.error("[discourse/sso]", e.message);
    res.status(500).json({ error: "SSO initiation failed. Check server logs." });
  }
});

app.get("/api/discourse/sso/callback", ssoRateLimit, async (req, res) => {
  if (!ssoEnabled) {
    return res.status(404).json({ error: "DiscourseConnect SSO is not enabled on this server" });
  }

  try {
    const { sso, sig } = req.query;
    if (!sso || !sig) {
      return res.status(400).json({ error: "Missing sso or sig query parameters" });
    }

    const ssoSecret = await getSsoSecret();
    if (!ssoSecret) {
      return res.status(503).json({ error: "SSO secret not configured" });
    }

    const expectedNonce = req.session.ssoNonce;
    if (!expectedNonce) {
      return res.status(400).json({ error: "No SSO nonce in session. Please restart the login flow." });
    }

    // Validate signature and extract user info
    const user = verifySsoPayload({ ssoSecret, sso, sig, expectedNonce });

    // Clear the nonce (one-time use)
    delete req.session.ssoNonce;

    if (!user.email) {
      return res.status(400).json({ error: "Discourse did not return an email address" });
    }

    // Look up or create the local user account by email
    const { rows: existingRows } = await pool.query(
      "SELECT id, username, roles FROM users WHERE email = $1",
      [user.email.toLowerCase()]
    );

    let localUser;
    if (existingRows.length) {
      localUser = existingRows[0];
    } else {
      // Auto-provision: create account with a random unusable password
      const id = randomBytes(12).toString("hex");
      const unusableHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
      const { rows: newRows } = await pool.query(
        `INSERT INTO users (id, username, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, roles`,
        [id, user.username || user.email, user.email.toLowerCase(), unusableHash]
      );
      localUser = newRows[0];
    }

    // Load canonical roles from user_roles table
    const { rows: roleRows } = await pool.query(
      "SELECT role FROM user_roles WHERE user_id = $1",
      [localUser.id]
    );
    const roles = roleRows.map((r) => r.role);

    // Regenerate session to prevent fixation
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

    req.session.userId    = localUser.id;
    req.session.roles     = roles;
    req.session.csrfToken = generateCsrfToken();

    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    // Redirect back to the UI
    const { rows: uiCfgRows } = await pool.query(
      "SELECT value FROM app_config WHERE key = 'ui_base_url'"
    );
    const uiBase = (uiCfgRows[0]?.value || "").trim().replace(/\/$/, "");
    res.redirect(302, uiBase ? `${uiBase}/` : "/");
  } catch (e) {
    console.error("[discourse/sso/callback]", e.message);
    // Don't expose internal error detail to the browser
    res.status(400).json({ error: "SSO login failed. Please try again." });
  }
});

// ── SSO Readiness check ───────────────────────────────────────────────────────

app.get("/api/admin/sso-readiness", discourseReadLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { rows } = await pool.query("SELECT key, value FROM app_config");
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    const baseUrl    = (cfg.discourse_base_url || "").trim();
    const apiKey     = cfg.discourse_api_key     || "";
    const apiUser    = cfg.discourse_api_username || "";
    const ssoSecretE = cfg.discourse_sso_secret   || "";
    const uiBase     = (cfg.ui_base_url || "").trim();

    // Attempt a live Discourse ping if credentials are present
    let discourseLive = false;
    let discourseLiveError = null;
    if (baseUrl && apiKey && apiUser) {
      try {
        const cleanBase  = baseUrl.replace(/\/$/, "");
        const decryptedKey  = discourseDecrypt(apiKey);
        const decryptedUser = discourseDecrypt(apiUser);
        const ping = await fetch(`${cleanBase}/site.json`, {
          headers: { "Api-Key": decryptedKey, "Api-Username": decryptedUser },
          signal: AbortSignal.timeout(5000),
        });
        discourseLive = ping.ok;
        if (!ping.ok) discourseLiveError = `HTTP ${ping.status}`;
      } catch (pingErr) {
        discourseLiveError = pingErr.message;
      }
    }

    const checks = [
      {
        id:      "env_flag",
        label:   "DISCOURSE_SSO_ENABLED env var",
        ok:      ssoEnabled,
        detail:  ssoEnabled ? "Set to 'true'" : "Not set — SSO endpoints are disabled (set DISCOURSE_SSO_ENABLED=true to enable)",
      },
      {
        id:      "base_url",
        label:   "Discourse base URL configured",
        ok:      Boolean(baseUrl),
        detail:  baseUrl || "Not set",
      },
      {
        id:      "api_credentials",
        label:   "Discourse API key + username configured",
        ok:      Boolean(apiKey && apiUser),
        detail:  (apiKey && apiUser) ? "Both set" : "One or both missing",
      },
      {
        id:      "sso_secret",
        label:   "DiscourseConnect SSO secret configured",
        ok:      Boolean(ssoSecretE),
        detail:  ssoSecretE ? "Set (stored encrypted)" : "Not set — paste the secret from Discourse › Settings › Login › sso secret",
      },
      {
        id:      "discourse_reachable",
        label:   "Discourse API reachable",
        ok:      discourseLive,
        detail:  discourseLive ? "Connected successfully" : (discourseLiveError || "Credentials not configured — cannot test"),
      },
      {
        id:      "ui_base_url",
        label:   "UI base URL configured (for SSO return URL)",
        ok:      Boolean(uiBase),
        detail:  uiBase || "Not set",
      },
      {
        id:      "session_secret",
        label:   "SESSION_SECRET env var is non-default",
        ok:      Boolean(process.env.SESSION_SECRET) && process.env.SESSION_SECRET !== "dev-secret-change-me",
        detail:  (process.env.SESSION_SECRET && process.env.SESSION_SECRET !== "dev-secret-change-me")
                   ? "Set to a custom value"
                   : "Using default 'dev-secret-change-me' — change this before enabling SSO",
      },
    ];

    const allOk = checks.every((c) => c.ok);
    res.json({ allOk, checks });
  } catch (e) {
    console.error("[sso-readiness]", e);
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
 * CLOCK
 * GET  /api/clock       — public: read current sim date
 * POST /api/clock/tick  — admin: advance clock by rate months
 * POST /api/clock/set   — admin: set sim_current_month, sim_current_year, and/or rate
 */

const clockReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const clockWriteLimit = rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true, legacyHeaders: false });

app.get("/api/clock", clockReadLimit, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT sim_current_month, sim_current_year, real_last_tick, rate FROM sim_clock WHERE id = 'main'"
    );
    if (!rows.length) {
      return res.json({ sim_current_month: 8, sim_current_year: 1997, real_last_tick: null, rate: 1 });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/clock/tick", clockWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(
      `INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
       VALUES ('main', 8, 1997, 1)
       ON CONFLICT (id) DO UPDATE SET
         sim_current_year  = sim_clock.sim_current_year + FLOOR((sim_clock.sim_current_month - 1 + sim_clock.rate) / 12),
         sim_current_month = MOD(sim_clock.sim_current_month - 1 + sim_clock.rate, 12) + 1,
         real_last_tick    = NOW()
       RETURNING sim_current_month, sim_current_year, real_last_tick, rate`
    );
    res.json({ ok: true, clock: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/clock/set", clockWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { sim_current_month, sim_current_year, rate } = req.body || {};
    const month = parseInt(sim_current_month, 10);
    const year  = parseInt(sim_current_year, 10);

    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "sim_current_month must be 1–12" });
    }
    if (!Number.isFinite(year)) {
      return res.status(400).json({ error: "sim_current_year must be a number" });
    }

    let rateVal = null;
    if (rate !== undefined) {
      rateVal = parseInt(rate, 10);
      if (!Number.isFinite(rateVal) || rateVal < 1) {
        return res.status(400).json({ error: "rate must be a positive integer" });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
       VALUES ('main', $1, $2, COALESCE($3, 1))
       ON CONFLICT (id) DO UPDATE SET
         sim_current_month = $1,
         sim_current_year  = $2,
         rate              = COALESCE($3, sim_clock.rate),
         real_last_tick    = NOW()
       RETURNING sim_current_month, sim_current_year, real_last_tick, rate`,
      [month, year, rateVal]
    );
    res.json({ ok: true, clock: rows[0] });
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
      `SELECT data->>'discourseTopicId'  AS topic_id,
              data->>'discourseTopicUrl' AS topic_url
         FROM ${table} WHERE id = $1`,
      [String(entityId)]
    );
    if (existing.length && existing[0].topic_id) {
      const existingUrl = existing[0].topic_url || `https://forum.rulebritannia.org/t/${existing[0].topic_id}`;
      return res.json({ ok: true, topicId: Number(existing[0].topic_id), topicUrl: existingUrl, existing: true });
    }

    // Recovery: entity row exists with a stale placeholder URL but no topic ID yet.
    // This can happen if the process died between topic creation and the DB patch.
    // We proceed to create (or re-create) the topic below; the idempotency check
    // above already handled the case where a topic ID was persisted.

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

    // Create topic on Discourse with automatic retry on transient errors
    const { topicId, topicSlug } = await createTopicWithRetry(
      {
        baseUrl, apiKey, apiUsername,
        title: String(title),
        raw:   String(raw),
        categoryId,
        tags: Array.isArray(tags) ? tags : undefined,
      },
      3,   // up to 3 attempts
      500  // 500 ms base delay (doubles each retry)
    );

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
    // Log structured info server-side. Truncate the raw error message to avoid
    // accidentally persisting long Discourse response bodies (which may contain
    // HTML or credential hints) in log aggregators.
    const safeMsg = String(e.message || e).slice(0, 200);
    console.error("[debates/create] entityType=%s entityId=%s error=%s",
      req.body?.entityType, req.body?.entityId, safeMsg);
    res.status(500).json({ error: "Failed to create debate topic. Please try again later." });
  }
});

/**
 * ROLES SERVICE
 *
 * GET  /api/me/roles             — authenticated: return current user's canonical roles
 * POST /api/users/:id/roles      — admin: replace a user's canonical roles
 * GET  /api/admin/discourse-sync-preview — admin: preview Discourse group membership
 */

const rolesReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const rolesWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/me/roles", rolesReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT role, assigned_by, assigned_at FROM user_roles WHERE user_id = $1 ORDER BY assigned_at",
      [req.session.userId]
    );
    const roles = rows.map((r) => r.role);
    const discourseGroups = computeDiscourseGroups(roles);
    res.json({ roles, discourseGroups, assignments: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/users/:id/roles", rolesWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const targetUserId = req.params.id;
    const { roles } = req.body || {};

    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "Body must be { roles: string[] }" });
    }

    // Validate each role against the canonical allow-list
    const invalid = roles.filter((r) => !ALL_VALID_ROLES.includes(r));
    if (invalid.length) {
      return res.status(400).json({
        error: `Invalid role(s): ${invalid.join(", ")}`,
        validRoles: ALL_VALID_ROLES,
      });
    }

    // Confirm the target user exists
    const { rows: userRows } = await pool.query("SELECT id FROM users WHERE id = $1", [targetUserId]);
    if (!userRows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    // Replace roles in a transaction: delete existing, insert new
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_roles WHERE user_id = $1", [targetUserId]);
      if (roles.length) {
        const placeholders = roles.map((_, i) => `($1, $${i + 2}, $${roles.length + 2})`).join(", ");
        const params = [targetUserId, ...roles, req.session.userId];
        await client.query(
          `INSERT INTO user_roles (user_id, role, assigned_by) VALUES ${placeholders}`,
          params
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const discourseGroups = computeDiscourseGroups(roles);
    res.json({ ok: true, userId: targetUserId, roles, discourseGroups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/admin/discourse-sync-preview", rolesReadLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    // Fetch all users with their roles in one query
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.email,
             COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
       GROUP BY u.id, u.username, u.email
       ORDER BY u.username
    `);

    const preview = rows.map((r) => ({
      userId:          r.id,
      username:        r.username,
      email:           r.email,
      roles:           r.roles,
      discourseGroups: computeDiscourseGroups(r.roles),
    }));

    res.json({ preview });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/discourse-sync-groups — admin: sync every user's Discourse
 * group membership to match their canonical roles.
 *
 * Algorithm:
 *   1. Load all users + roles from the DB.
 *   2. Build a desired-membership map: group → Set of discourse usernames.
 *      (We use the game username as the Discourse username; if you need email
 *      lookup, that can be added later.)
 *   3. For each group in DISCOURSE_GROUP_MAP:
 *      a. Fetch current members from Discourse.
 *      b. Add users who should be in the group but aren't.
 *      c. Remove users who are in the group but shouldn't be.
 *   4. Return a per-group change log.
 *
 * Returns:
 *   { ok: true, groups: [ { group, added: [], removed: [], skipped: string|null }, … ] }
 *
 * "skipped" is set when the Discourse API call fails for a group (other groups
 * still proceed — a single group error doesn't abort the whole sync).
 */

/** Maximum characters of a Discourse error message to retain in sync results. */
const SYNC_ERROR_MAX_LENGTH = 200;

const discourseSyncLimit = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

app.post("/api/admin/discourse-sync-groups", discourseSyncLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    // Load credentials
    const { rows: cfgRows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'discourse_api_key', 'discourse_api_username')"
    );
    const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));

    const baseUrl     = (cfg.discourse_base_url || "").trim().replace(/\/$/, "");
    const apiKey      = cfg.discourse_api_key      ? discourseDecrypt(cfg.discourse_api_key)      : "";
    const apiUsername = cfg.discourse_api_username ? discourseDecrypt(cfg.discourse_api_username) : "";

    if (!baseUrl || !apiKey || !apiUsername) {
      return res.status(400).json({ ok: false, error: "Discourse credentials not fully configured" });
    }

    // Load all users with their roles
    const { rows: users } = await pool.query(`
      SELECT u.id, u.username,
             COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
       GROUP BY u.id, u.username
    `);

    // Build desired membership: group → Set of usernames
    const desiredByGroup = new Map();
    const uniqueGroups = new Set(Object.values(DISCOURSE_GROUP_MAP));
    for (const grp of uniqueGroups) desiredByGroup.set(grp, new Set());

    for (const user of users) {
      const groups = computeDiscourseGroups(user.roles || []);
      for (const grp of groups) {
        if (!desiredByGroup.has(grp)) desiredByGroup.set(grp, new Set());
        desiredByGroup.get(grp).add(user.username);
      }
    }

    // Sync each group
    const groupResults = [];
    for (const [group, desiredSet] of desiredByGroup) {
      try {
        const currentMembers = await getGroupMembers({ baseUrl, apiKey, apiUsername, groupName: group });
        const currentSet = new Set(currentMembers.map((m) => m.username));

        const toAdd    = [...desiredSet].filter((u) => !currentSet.has(u));
        const toRemove = [...currentSet].filter((u) => !desiredSet.has(u));

        if (toAdd.length)    await addGroupMembers(   { baseUrl, apiKey, apiUsername, groupName: group, usernames: toAdd    });
        if (toRemove.length) await removeGroupMembers({ baseUrl, apiKey, apiUsername, groupName: group, usernames: toRemove });

        groupResults.push({ group, added: toAdd, removed: toRemove, skipped: null });
      } catch (grpErr) {
        const safeMsg = String(grpErr.message || grpErr).slice(0, SYNC_ERROR_MAX_LENGTH);
        console.error("[discourse-sync-groups] group=%s error=%s", group, safeMsg);
        groupResults.push({ group, added: [], removed: [], skipped: safeMsg });
      }
    }

    const totalAdded   = groupResults.reduce((n, g) => n + g.added.length,   0);
    const totalRemoved = groupResults.reduce((n, g) => n + g.removed.length, 0);
    const totalSkipped = groupResults.filter((g) => g.skipped).length;

    console.log("[discourse-sync-groups] added=%d removed=%d groupErrors=%d", totalAdded, totalRemoved, totalSkipped);

    res.json({ ok: true, groups: groupResults, totalAdded, totalRemoved, totalSkipped });
  } catch (e) {
    console.error("[discourse-sync-groups]", e.message);
    res.status(500).json({ ok: false, error: "Discourse group sync failed. Check server logs." });
  }
});

/**
 * BOOTSTRAP
 * GET /api/bootstrap
 *
 * Single round-trip that returns everything the UI needs on first load:
 *   - clock (always)
 *   - config (always, sensitive keys stripped)
 *   - user + csrfToken (when a valid session cookie is present, else null)
 *   - state { data, updatedAt } (when logged in and state exists, else null)
 *
 * The four DB queries run in parallel via Promise.all so the response time is
 * bounded by the slowest individual query, not their sum.
 */
const bootstrapLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

app.get("/api/bootstrap", bootstrapLimit, async (req, res) => {
  try {
    const SENSITIVE = new Set(["discourse_api_key", "discourse_api_username"]);
    const isLoggedIn = Boolean(req.session?.userId);

    // Always fetch: clock + config.  Conditionally fetch: user row + state.
    const [clockRows, configRows, userRows, stateRows] = await Promise.all([
      pool.query(
        "SELECT sim_current_month, sim_current_year, real_last_tick, rate FROM sim_clock WHERE id = 'main'"
      ).then((r) => r.rows),

      pool.query("SELECT key, value FROM app_config").then((r) => r.rows),

      isLoggedIn
        ? pool.query(
            "SELECT id, username, email, roles, created_at FROM users WHERE id = $1",
            [req.session.userId]
          ).then((r) => r.rows)
        : Promise.resolve([]),

      isLoggedIn
        ? pool.query(
            `SELECT s.data, s.created_at AS updated_at
               FROM app_state_current c
               JOIN state_snapshots s ON s.id = c.snapshot_id
              WHERE c.id = 'main'`
          ).then((r) => r.rows)
        : Promise.resolve([]),
    ]);

    // Clock — fall back to defaults if the table row doesn't exist yet.
    const clock = clockRows[0] ?? { sim_current_month: 8, sim_current_year: 1997, real_last_tick: null, rate: 1 };

    // Config — strip sensitive keys.
    const config = Object.fromEntries(
      configRows.filter((r) => !SENSITIVE.has(r.key)).map((r) => [r.key, r.value])
    );

    // User — absent or session stale.
    if (isLoggedIn && !userRows.length) {
      // Session references a deleted user; destroy it silently.
      req.session.destroy(() => {});
      return res.json({ clock, config, user: null, csrfToken: null, state: null });
    }

    if (!isLoggedIn) {
      return res.json({ clock, config, user: null, csrfToken: null, state: null });
    }

    // Lazily generate CSRF token for sessions that pre-date the feature.
    if (!req.session.csrfToken) {
      req.session.csrfToken = generateCsrfToken();
    }

    const user = userRows[0];
    const state = stateRows[0] ? { data: stateRows[0].data, updatedAt: stateRows[0].updated_at } : null;

    res.json({ clock, config, user, csrfToken: req.session.csrfToken, state });
  } catch (e) {
    console.error("[bootstrap]", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * ADMIN MAINTENANCE TOOLS
 *
 * All endpoints require the admin role.
 *
 * POST /api/admin/clear-cache          — truncate the 5 object-cache tables
 * POST /api/admin/rebuild-cache        — re-sync object tables from the current snapshot
 * POST /api/admin/rotate-sessions      — regenerate the caller's own session ID + new CSRF token
 * POST /api/admin/force-logout-all     — delete every session except the caller's
 * GET  /api/admin/export-snapshot      — download the current snapshot as a JSON file attachment
 * POST /api/admin/import-snapshot      — accept { label, data } body, save as new snapshot + set current
 */
const maintLimit = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// Clear object-cache tables
app.post("/api/admin/clear-cache", maintLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    await pool.query("BEGIN");
    try {
      await pool.query(
        "TRUNCATE bills, motions, statements, regulations, questiontime_questions"
      );
      await pool.query("COMMIT");
    } catch (truncErr) {
      await pool.query("ROLLBACK");
      throw truncErr;
    }
    console.log(`[admin] clear-cache by user ${req.session.userId}`);
    res.json({ ok: true, message: "Object cache tables cleared." });
  } catch (e) {
    console.error("[admin/clear-cache]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Rebuild object-cache tables from the current snapshot
app.post("/api/admin/rebuild-cache", maintLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(
      `SELECT s.data
         FROM app_state_current c
         JOIN state_snapshots s ON s.id = c.snapshot_id
        WHERE c.id = 'main'`
    );
    if (!rows.length) {
      return res.status(404).json({ error: "No active snapshot to rebuild from." });
    }
    await syncObjectTables(rows[0].data);
    console.log(`[admin] rebuild-cache by user ${req.session.userId}`);
    res.json({ ok: true, message: "Object cache rebuilt from current snapshot." });
  } catch (e) {
    console.error("[admin/rebuild-cache]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Rotate caller's session ID (invalidates old session cookie, issues new one + new CSRF token)
app.post("/api/admin/rotate-sessions", maintLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { userId, roles } = req.session;
    req.session.regenerate((err) => {
      if (err) {
        console.error("[admin/rotate-sessions] regenerate error:", err);
        return res.status(500).json({ error: "Session regeneration failed." });
      }
      req.session.userId = userId;
      req.session.roles  = roles;
      req.session.csrfToken = generateCsrfToken();
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("[admin/rotate-sessions] save error:", saveErr);
          return res.status(500).json({ error: "Session save failed." });
        }
        console.log(`[admin] rotate-sessions for user ${userId}`);
        res.json({ ok: true, csrfToken: req.session.csrfToken, message: "Session rotated. Update your CSRF token." });
      });
    });
  } catch (e) {
    console.error("[admin/rotate-sessions]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Force-logout all users by deleting every session except the caller's
app.post("/api/admin/force-logout-all", maintLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const callerSid = req.sessionID;
    const { rowCount } = await pool.query(
      "DELETE FROM sessions WHERE sid <> $1",
      [callerSid]
    );
    console.log(`[admin] force-logout-all by user ${req.session.userId}: ${rowCount} sessions deleted`);
    res.json({ ok: true, sessionsDeleted: rowCount, message: `${rowCount} session(s) terminated.` });
  } catch (e) {
    console.error("[admin/force-logout-all]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Export the current snapshot as a downloadable JSON file
app.get("/api/admin/export-snapshot", maintLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(
      `SELECT s.id, s.label, s.created_at, s.created_by, s.data
         FROM app_state_current c
         JOIN state_snapshots s ON s.id = c.snapshot_id
        WHERE c.id = 'main'`
    );
    if (!rows.length) {
      return res.status(404).json({ error: "No active snapshot to export." });
    }
    const snap = rows[0];
    const filename = `rb-snapshot-${snap.id.slice(0, 8)}-${snap.created_at.toISOString().slice(0, 10)}.json`;
    const payload = {
      exportedAt: new Date().toISOString(),
      snapshotId: snap.id,
      label:      snap.label,
      createdAt:  snap.created_at,
      createdBy:  snap.created_by,
      data:       snap.data,
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error("[admin/export-snapshot]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Import a snapshot from a JSON body: { label, data }
// Saves as a new snapshot and sets it as the active current state.
app.post("/api/admin/import-snapshot", maintLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { label, data } = req.body || {};
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ error: "Body must include a non-empty label." });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ error: "Body must include a data object." });
    }

    const { rows } = await pool.query(
      `INSERT INTO state_snapshots (created_by, label, data)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, created_at, label`,
      [req.session.userId, label.trim(), JSON.stringify(data)]
    );
    const snap = rows[0];

    await pool.query(
      `INSERT INTO app_state_current (id, snapshot_id)
       VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id`,
      [snap.id]
    );

    let cacheWarning = null;
    try {
      await syncObjectTables(data);
    } catch (syncErr) {
      console.error("[admin/import-snapshot syncObjectTables]", syncErr);
      cacheWarning = "Snapshot saved and set as current, but cache rebuild failed. Run 'Rebuild Cache' manually.";
    }

    console.log(`[admin] import-snapshot by user ${req.session.userId}: ${snap.id} (${label})`);
    res.status(201).json({
      ok: true,
      snapshotId: snap.id,
      createdAt: snap.created_at,
      label: snap.label,
      ...(cacheWarning ? { warning: cacheWarning } : {}),
    });
  } catch (e) {
    console.error("[admin/import-snapshot]", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * Fire-and-forget: write an enhanced audit log entry.
 */
async function writeAuditLog(userId, action, entityType, entityId, beforeJson, afterJson, target) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, target, entity_type, entity_id, before_json, after_json, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, '{}'::jsonb)`,
      [
        userId,
        action,
        target || entityId || "",
        entityType || "",
        entityId || "",
        beforeJson ? JSON.stringify(beforeJson) : null,
        afterJson  ? JSON.stringify(afterJson)  : null,
      ]
    );
  } catch (e) {
    console.error("[writeAuditLog]", e.message);
  }
}

/**
 * CHARACTERS
 * GET   /api/characters          — authenticated: list all characters
 * GET   /api/characters/:id      — authenticated: get one character
 * POST  /api/characters          — admin: create a character
 * PATCH /api/characters/:id      — admin: update a character
 */

app.get("/api/characters", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT id, user_id, name, party, constituency, roles, offices, is_active, created_at
         FROM characters
        ORDER BY name ASC`
    );
    res.json({ characters: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/characters/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT id, user_id, name, party, constituency, roles, offices, is_active, created_at
         FROM characters WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Character not found" });
    res.json({ character: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/characters", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { name, party = "", constituency = "", roles = [], offices = [], is_active = true, user_id } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO characters (user_id, name, party, constituency, roles, offices, is_active)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       RETURNING id, user_id, name, party, constituency, roles, offices, is_active, created_at`,
      [user_id || null, name.trim(), String(party), String(constituency), JSON.stringify(roles), JSON.stringify(offices), Boolean(is_active)]
    );
    const character = rows[0];
    await writeAuditLog(req.session.userId, "character-create", "character", String(character.id), null, character);
    res.status(201).json({ ok: true, character });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/characters/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows: existing } = await pool.query(
      "SELECT * FROM characters WHERE id = $1",
      [req.params.id]
    );
    if (!existing.length) return res.status(404).json({ error: "Character not found" });
    const prev = existing[0];

    const updates = req.body || {};
    const fields = [];
    const params = [];
    const allowed = ["user_id", "name", "party", "constituency", "roles", "offices", "is_active"];
    for (const key of allowed) {
      if (key in updates) {
        params.push(
          key === "roles" || key === "offices" ? JSON.stringify(updates[key]) :
          key === "is_active" ? Boolean(updates[key]) :
          updates[key]
        );
        fields.push(
          key === "roles" || key === "offices"
            ? `${key} = $${params.length}::jsonb`
            : `${key} = $${params.length}`
        );
      }
    }
    if (!fields.length) return res.status(400).json({ error: "No valid fields to update" });

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE characters SET ${fields.join(", ")} WHERE id = $${params.length}
       RETURNING id, user_id, name, party, constituency, roles, offices, is_active, created_at`,
      params
    );
    const character = rows[0];
    await writeAuditLog(req.session.userId, "character-update", "character", String(character.id), prev, character);
    res.json({ ok: true, character });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * OFFICES & ASSIGNMENTS
 * GET  /api/offices                 — authenticated: list offices (with current assignment)
 * POST /api/offices                 — admin: create office
 * POST /api/offices/:id/assign      — admin: assign character to office
 */

app.get("/api/offices", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT o.id, o.name, o.type,
              oa.character_id, c.name AS holder_name, oa.assigned_at
         FROM offices o
         LEFT JOIN office_assignments oa ON oa.office_id = o.id
         LEFT JOIN characters c ON c.id = oa.character_id
        ORDER BY o.type, o.name`
    );
    res.json({ offices: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/offices", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { id, name, type = "parliamentary" } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: "id and name are required" });
    const VALID_TYPES = ["cabinet", "shadow", "parliamentary", "other"];
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO offices (id, name, type) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type
       RETURNING id, name, type`,
      [String(id), String(name), type]
    );
    await writeAuditLog(req.session.userId, "office-create", "office", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, office: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/offices/:id/assign", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const officeId = req.params.id;
    const { character_id } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });

    const { rows: officeRows } = await pool.query("SELECT id FROM offices WHERE id = $1", [officeId]);
    if (!officeRows.length) return res.status(404).json({ error: "Office not found" });

    const { rows: charRows } = await pool.query("SELECT id, name FROM characters WHERE id = $1", [character_id]);
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Remove any existing assignment for this office
      await client.query("DELETE FROM office_assignments WHERE office_id = $1", [officeId]);
      // Insert new assignment
      const { rows } = await client.query(
        `INSERT INTO office_assignments (office_id, character_id) VALUES ($1, $2)
         RETURNING office_id, character_id, assigned_at`,
        [officeId, character_id]
      );
      await client.query("COMMIT");
      await writeAuditLog(req.session.userId, "office-assign", "office", officeId, null, { office_id: officeId, character_id, character_name: charRows[0].name });
      res.json({ ok: true, assignment: rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DIVISIONS ENGINE
 * POST /api/divisions/create     — admin: open a new division
 * POST /api/divisions/:id/vote   — authenticated: cast a vote
 * POST /api/divisions/:id/close  — admin: close division and tally
 * GET  /api/divisions            — authenticated: list all divisions
 * GET  /api/divisions/:id        — authenticated: get division + votes
 */

app.get("/api/divisions", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { status } = req.query;
    const params = [];
    let where = "";
    if (status === "open" || status === "closed") {
      params.push(status);
      where = "WHERE d.status = $1";
    }
    const { rows } = await pool.query(
      `SELECT d.id, d.entity_type, d.entity_id, d.title, d.status, d.closes_at, d.created_at,
              COUNT(dv.id)::int AS vote_count
         FROM divisions d
         LEFT JOIN division_votes dv ON dv.division_id = d.id
         ${where}
        GROUP BY d.id
        ORDER BY d.created_at DESC`,
      params
    );
    res.json({ divisions: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/divisions/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: divRows } = await pool.query(
      "SELECT * FROM divisions WHERE id = $1",
      [req.params.id]
    );
    if (!divRows.length) return res.status(404).json({ error: "Division not found" });
    const { rows: voteRows } = await pool.query(
      `SELECT dv.vote, dv.weight, dv.voted_at, c.name AS character_name
         FROM division_votes dv
         LEFT JOIN characters c ON c.id = dv.character_id
        WHERE dv.division_id = $1`,
      [req.params.id]
    );
    // Tally
    const tally = { aye: 0, no: 0, abstain: 0 };
    for (const v of voteRows) tally[v.vote] = (tally[v.vote] || 0) + (v.weight || 1);
    res.json({ division: divRows[0], votes: voteRows, tally });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/divisions/create", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { entity_type, entity_id, title = "", closes_at } = req.body || {};
    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: "entity_type and entity_id are required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO divisions (entity_type, entity_id, title, status, closes_at, created_by)
       VALUES ($1, $2, $3, 'open', $4, $5)
       RETURNING *`,
      [String(entity_type), String(entity_id), String(title), closes_at || null, req.session.userId]
    );
    await writeAuditLog(req.session.userId, "division-create", "division", String(rows[0].id), null, rows[0]);
    res.status(201).json({ ok: true, division: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/divisions/:id/vote", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const divisionId = req.params.id;
    const { character_id, vote, weight = 1 } = req.body || {};

    if (!character_id || !vote) {
      return res.status(400).json({ error: "character_id and vote are required" });
    }
    const VALID_VOTES = ["aye", "no", "abstain"];
    if (!VALID_VOTES.includes(vote)) {
      return res.status(400).json({ error: "vote must be aye, no, or abstain" });
    }

    const { rows: divRows } = await pool.query(
      "SELECT status FROM divisions WHERE id = $1",
      [divisionId]
    );
    if (!divRows.length) return res.status(404).json({ error: "Division not found" });
    if (divRows[0].status !== "open") {
      return res.status(409).json({ error: "Division is closed" });
    }

    const { rows: charRows } = await pool.query("SELECT id FROM characters WHERE id = $1", [character_id]);
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });

    const { rows } = await pool.query(
      `INSERT INTO division_votes (division_id, character_id, vote, weight)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (division_id, character_id) DO UPDATE SET vote = EXCLUDED.vote, weight = EXCLUDED.weight, voted_at = NOW()
       RETURNING *`,
      [divisionId, character_id, vote, Math.max(1, parseInt(weight, 10) || 1)]
    );
    res.json({ ok: true, vote: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/divisions/:id/close", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const divisionId = req.params.id;

    const { rows: divRows } = await pool.query("SELECT * FROM divisions WHERE id = $1", [divisionId]);
    if (!divRows.length) return res.status(404).json({ error: "Division not found" });
    if (divRows[0].status === "closed") {
      return res.status(409).json({ error: "Division already closed" });
    }

    const { rows: voteRows } = await pool.query(
      "SELECT vote, weight FROM division_votes WHERE division_id = $1",
      [divisionId]
    );
    const tally = { aye: 0, no: 0, abstain: 0 };
    for (const v of voteRows) tally[v.vote] = (tally[v.vote] || 0) + (v.weight || 1);

    await pool.query(
      "UPDATE divisions SET status = 'closed' WHERE id = $1",
      [divisionId]
    );

    await writeAuditLog(req.session.userId, "division-close", "division", divisionId, divRows[0], { ...divRows[0], status: "closed", tally });
    res.json({ ok: true, tally });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * QUESTION TIME (structured DB-backed)
 * GET  /api/qt/questions              — authenticated: list questions (optional ?office_id=&status=)
 * GET  /api/qt/questions/:id          — authenticated: get question with answers + followups
 * POST /api/qt/questions              — authenticated: submit a question
 * POST /api/qt/questions/:id/answer   — authenticated (office holder/admin/mod): post answer
 * POST /api/qt/questions/:id/followup — authenticated: post follow-up
 * POST /api/qt/questions/:id/archive  — admin/mod/speaker: archive question
 */

app.get("/api/qt/questions", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { office_id, status } = req.query;
    const conditions = [];
    const params = [];
    if (office_id) {
      params.push(office_id);
      conditions.push(`q.office_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`q.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT q.id, q.office_id, q.asked_by_name, q.asked_by_role, q.text, q.status,
              q.asked_at_sim, q.due_at_sim, q.speaker_demand_at, q.created_at, q.updated_at,
              c.name AS character_name,
              (SELECT text FROM qt_answers WHERE question_id = q.id LIMIT 1) AS answer_text
         FROM qt_questions q
         LEFT JOIN characters c ON c.id = q.asked_by_character_id
         ${where}
        ORDER BY q.created_at DESC`,
      params
    );
    res.json({ questions: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/qt/questions/:id", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: qRows } = await pool.query(
      `SELECT q.*, c.name AS character_name
         FROM qt_questions q
         LEFT JOIN characters c ON c.id = q.asked_by_character_id
        WHERE q.id = $1`,
      [req.params.id]
    );
    if (!qRows.length) return res.status(404).json({ error: "Question not found" });
    const { rows: answers } = await pool.query(
      "SELECT * FROM qt_answers WHERE question_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );
    const { rows: followups } = await pool.query(
      "SELECT * FROM qt_followups WHERE question_id = $1 ORDER BY created_at ASC",
      [req.params.id]
    );
    res.json({ question: qRows[0], answers, followups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { office_id, asked_by_character_id, asked_by_name, asked_by_role = "backbencher", text, asked_at_sim = "", due_at_sim = "" } = req.body || {};
    if (!office_id || !text || !text.trim()) {
      return res.status(400).json({ error: "office_id and text are required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO qt_questions (office_id, asked_by_character_id, asked_by_name, asked_by_role, text, asked_at_sim, due_at_sim)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [String(office_id), asked_by_character_id || null, String(asked_by_name || ""), String(asked_by_role), String(text).trim(), String(asked_at_sim), String(due_at_sim)]
    );
    res.status(201).json({ ok: true, question: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions/:id/answer", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { answered_by_character_id, answered_by_name = "", text, answered_at_sim = "" } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

    const { rows: qRows } = await pool.query("SELECT * FROM qt_questions WHERE id = $1", [req.params.id]);
    if (!qRows.length) return res.status(404).json({ error: "Question not found" });
    if (qRows[0].status === "archived") return res.status(409).json({ error: "Question is archived" });
    if (qRows[0].status === "answered") return res.status(409).json({ error: "Already answered" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: aRows } = await client.query(
        `INSERT INTO qt_answers (question_id, answered_by_character_id, answered_by_name, text, answered_at_sim)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [req.params.id, answered_by_character_id || null, String(answered_by_name), String(text).trim(), String(answered_at_sim)]
      );
      await client.query(
        "UPDATE qt_questions SET status = 'answered', updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );
      await client.query("COMMIT");
      res.json({ ok: true, answer: aRows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions/:id/followup", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { asked_by_character_id, asked_by_name = "", asked_by_role = "backbencher", text, asked_at_sim = "" } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

    const { rows: qRows } = await pool.query("SELECT status FROM qt_questions WHERE id = $1", [req.params.id]);
    if (!qRows.length) return res.status(404).json({ error: "Question not found" });
    if (qRows[0].status === "archived") return res.status(409).json({ error: "Question is archived" });

    const { rows } = await pool.query(
      `INSERT INTO qt_followups (question_id, asked_by_character_id, asked_by_name, asked_by_role, text, asked_at_sim)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.id, asked_by_character_id || null, String(asked_by_name), String(asked_by_role), String(text).trim(), String(asked_at_sim)]
    );
    res.status(201).json({ ok: true, followup: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions/:id/followup/:fid/answer", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { text = "", answered_by_name = "" } = req.body || {};
    if (!text.trim()) return res.status(400).json({ error: "text is required" });
    const { rows } = await pool.query(
      `UPDATE qt_followups SET answer = $1, answered_by_name = $2 WHERE id = $3 AND question_id = $4
       RETURNING *`,
      [text.trim(), String(answered_by_name), req.params.fid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Follow-up not found" });
    res.json({ ok: true, followup: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions/:id/archive", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    // Require admin or mod role
    const roles = req.session.roles || [];
    if (!roles.includes("admin") && !roles.includes("mod") && !roles.includes("speaker")) {
      return res.status(403).json({ error: "Forbidden: admin, mod, or speaker role required" });
    }
    const { rows } = await pool.query(
      `UPDATE qt_questions SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Question not found" });
    await writeAuditLog(req.session.userId, "qt-question-archive", "qt_question", req.params.id, null, { id: req.params.id, status: "archived" });
    res.json({ ok: true, question: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions/:id/speaker-demand", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const roles = req.session.roles || [];
    if (!roles.includes("admin") && !roles.includes("mod") && !roles.includes("speaker")) {
      return res.status(403).json({ error: "Forbidden: admin, mod, or speaker role required" });
    }
    const { rows } = await pool.query(
      `UPDATE qt_questions SET speaker_demand_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'open' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Question not found or already answered/archived" });
    res.json({ ok: true, question: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * SIMULATION STATE
 * GET  /api/sim          — public: get simulation state
 * POST /api/sim/tick     — admin: advance clock by 1 month
 * POST /api/sim/set      — admin: set year, month, is_paused
 */

const simReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const simWriteLimit = rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true, legacyHeaders: false });

app.get("/api/sim", simReadLimit, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT year, month, is_paused, last_tick_at FROM sim_state WHERE id = 'main'"
    );
    if (!rows.length) return res.json({ year: 1997, month: 8, is_paused: false, last_tick_at: null });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/sim/tick", simWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(
      `INSERT INTO sim_state (id, year, month)
       VALUES ('main', 1997, 8)
       ON CONFLICT (id) DO UPDATE SET
         year         = sim_state.year + FLOOR((sim_state.month) / 12),
         month        = MOD(sim_state.month, 12) + 1,
         last_tick_at = NOW()
       RETURNING year, month, is_paused, last_tick_at`
    );
    // Also sync the legacy sim_clock so existing endpoints stay consistent
    await pool.query(
      `INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
       VALUES ('main', $1, $2, 1)
       ON CONFLICT (id) DO UPDATE SET sim_current_month = $1, sim_current_year = $2, real_last_tick = NOW()`,
      [rows[0].month, rows[0].year]
    );
    await writeAuditLog(req.session.userId, "sim-tick", "sim_state", "main", null, rows[0]);
    res.json({ ok: true, sim: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/sim/set", simWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { year, month, is_paused } = req.body || {};
    const yr = parseInt(year, 10);
    const mo = parseInt(month, 10);
    if (!Number.isFinite(mo) || mo < 1 || mo > 12) {
      return res.status(400).json({ error: "month must be 1–12" });
    }
    if (!Number.isFinite(yr)) {
      return res.status(400).json({ error: "year must be a number" });
    }
    const paused = is_paused !== undefined ? Boolean(is_paused) : undefined;
    const { rows } = await pool.query(
      `INSERT INTO sim_state (id, year, month, is_paused)
       VALUES ('main', $1, $2, COALESCE($3, false))
       ON CONFLICT (id) DO UPDATE SET
         year      = $1,
         month     = $2,
         is_paused = COALESCE($3, sim_state.is_paused),
         last_tick_at = NOW()
       RETURNING year, month, is_paused, last_tick_at`,
      [yr, mo, paused !== undefined ? paused : null]
    );
    // Keep legacy sim_clock in sync
    await pool.query(
      `INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
       VALUES ('main', $1, $2, 1)
       ON CONFLICT (id) DO UPDATE SET sim_current_month = $1, sim_current_year = $2, real_last_tick = NOW()`,
      [mo, yr]
    );
    await writeAuditLog(req.session.userId, "sim-set", "sim_state", "main", null, rows[0]);
    res.json({ ok: true, sim: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * BILL STAGE TRANSITION (with auto-Discourse topic on Second Reading)
 * POST /api/bills/:id/stage  — admin: advance bill to a named stage
 *
 * Body: { stage: "Second Reading" | "Committee Stage" | … }
 * If transitioning to "Second Reading" and no discourse topic exists, auto-creates one.
 */

app.post("/api/bills/:id/stage", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { stage } = req.body || {};
    if (!stage || typeof stage !== "string" || !stage.trim()) {
      return res.status(400).json({ error: "stage is required" });
    }

    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });

    const billData = billRows[0].data;
    const prevStage = billData.stage || "";
    billData.stage = stage.trim();

    await pool.query(
      "UPDATE bills SET data = $1::jsonb, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(billData), req.params.id]
    );

    await writeAuditLog(req.session.userId, "bill-stage-change", "bill", req.params.id,
      { stage: prevStage }, { stage: billData.stage });

    // Auto-create Discourse topic when entering Second Reading
    let discourseTopicId = billData.discourseTopicId || null;
    let discourseTopicUrl = billData.discourseTopicUrl || null;

    if (stage.trim() === "Second Reading" && !discourseTopicId) {
      try {
        const { rows: cfgRows } = await pool.query(
          "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'discourse_api_key', 'discourse_api_username')"
        );
        const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
        const baseUrl     = (cfg.discourse_base_url || "").trim().replace(/\/$/, "");
        const apiKey      = cfg.discourse_api_key      ? discourseDecrypt(cfg.discourse_api_key)      : "";
        const apiUsername = cfg.discourse_api_username ? discourseDecrypt(cfg.discourse_api_username) : "";

        if (baseUrl && apiKey && apiUsername) {
          const title = `Second Reading Debate: ${String(billData.title || billData.id)}`;
          const raw   = `This topic is for the Second Reading debate of **${String(billData.title || billData.id)}**.\n\n${String(billData.summary || billData.purpose || "")}`;
          const { topicId, topicSlug } = await createTopicWithRetry(
            { baseUrl, apiKey, apiUsername, title, raw }, 3, 500
          );
          discourseTopicUrl = topicSlug ? `${baseUrl}/t/${topicSlug}/${topicId}` : `${baseUrl}/t/${topicId}`;
          discourseTopicId  = topicId;
          billData.discourseTopicId  = topicId;
          billData.discourseTopicUrl = discourseTopicUrl;
          await pool.query(
            "UPDATE bills SET data = $1::jsonb, updated_at = NOW() WHERE id = $2",
            [JSON.stringify(billData), req.params.id]
          );
        }
      } catch (discErr) {
        console.error("[bill-stage] Discourse auto-create failed:", discErr.message);
      }
    }

    res.json({ ok: true, stage: billData.stage, discourseTopicId, discourseTopicUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * ADMIN DASHBOARD SUMMARY
 * GET /api/admin/dashboard  — admin: summary data for the admin dashboard
 */

app.get("/api/admin/dashboard", crudReadLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const [qtRows, divRows, billRows, auditRows] = await Promise.all([
      pool.query(
        `SELECT id, office_id, asked_by_name, text, status, created_at
           FROM qt_questions
          WHERE status = 'open'
          ORDER BY created_at DESC
          LIMIT 20`
      ).then((r) => r.rows),

      pool.query(
        `SELECT id, entity_type, entity_id, title, status, closes_at, created_at
           FROM divisions
          WHERE status = 'open'
          ORDER BY created_at DESC`
      ).then((r) => r.rows),

      pool.query(
        `SELECT id, data->>'title' AS title, data->>'stage' AS stage,
                data->>'discourseTopicId'  AS discourse_topic_id,
                data->>'discourseTopicUrl' AS discourse_topic_url,
                updated_at
           FROM bills
          WHERE (data->>'discourseTopicId') IS NULL
          ORDER BY updated_at DESC
          LIMIT 20`
      ).then((r) => r.rows),

      pool.query(
        `SELECT id, actor_id, action, target, entity_type, entity_id, created_at
           FROM audit_log
          ORDER BY created_at DESC
          LIMIT 20`
      ).then((r) => r.rows),
    ]);

    res.json({
      pendingQtQuestions: qtRows,
      openDivisions:      divRows,
      billsMissingDebate: billRows,
      recentAuditLog:     auditRows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DISCOURSE SYNC — re-sync bills missing a Discourse topic link
 * POST /api/admin/sync-discourse-bills  — admin
 */

app.post("/api/admin/sync-discourse-bills", discourseSyncLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { rows: cfgRows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url', 'discourse_api_key', 'discourse_api_username')"
    );
    const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
    const baseUrl     = (cfg.discourse_base_url || "").trim().replace(/\/$/, "");
    const apiKey      = cfg.discourse_api_key      ? discourseDecrypt(cfg.discourse_api_key)      : "";
    const apiUsername = cfg.discourse_api_username ? discourseDecrypt(cfg.discourse_api_username) : "";

    if (!baseUrl || !apiKey || !apiUsername) {
      return res.status(400).json({ ok: false, error: "Discourse credentials not fully configured" });
    }

    const { rows: bills } = await pool.query(
      `SELECT id, data FROM bills WHERE (data->>'discourseTopicId') IS NULL AND data->>'stage' = 'Second Reading'`
    );

    const results = [];
    for (const bill of bills) {
      try {
        const billData = bill.data;
        const title = `Second Reading Debate: ${String(billData.title || bill.id)}`;
        const raw   = `This topic is for the Second Reading debate of **${String(billData.title || bill.id)}**.\n\n${String(billData.summary || billData.purpose || "")}`;
        const { topicId, topicSlug } = await createTopicWithRetry(
          { baseUrl, apiKey, apiUsername, title, raw }, 2, 1000
        );
        const topicUrl = topicSlug ? `${baseUrl}/t/${topicSlug}/${topicId}` : `${baseUrl}/t/${topicId}`;
        billData.discourseTopicId  = topicId;
        billData.discourseTopicUrl = topicUrl;
        await pool.query(
          "UPDATE bills SET data = $1::jsonb, updated_at = NOW() WHERE id = $2",
          [JSON.stringify(billData), bill.id]
        );
        results.push({ id: bill.id, ok: true, topicId, topicUrl });
      } catch (billErr) {
        results.push({ id: bill.id, ok: false, error: String(billErr.message).slice(0, 200) });
      }
    }

    await writeAuditLog(req.session.userId, "sync-discourse-bills", "bills", "", null, { synced: results.length });
    res.json({ ok: true, results, total: bills.length });
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

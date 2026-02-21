import express from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
      "SELECT data, updated_at FROM app_state WHERE id = $1",
      ["main"]
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

const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
  })
  .catch((e) => {
    console.error("[server] schema init failed", e);
    process.exit(1);
  });

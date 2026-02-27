import express from "express";
import cors from "cors";
import session from "express-session";
import pgSession from "connect-pg-simple";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import sgMail from "@sendgrid/mail";
import { pool } from "./db.js";
import { createTopic, createPost, createTopicWithRetry, getGroupMembers, addGroupMembers, removeGroupMembers, buildSsoPayload, verifySsoPayload } from "./discourse.js";
import {
  createTopic as dcCreateTopic,
  createPost as dcCreatePost,
  withRetry as dcWithRetry,
} from "./discourseClient.js";
import { ALL_VALID_ROLES, computeDiscourseGroups, PERMISSION_MAP, DISCOURSE_GROUP_MAP } from "./roles.js";

const __serverDir = dirname(fileURLToPath(import.meta.url));

// ── Turnstile config ──────────────────────────────────────────────────────────
const TURNSTILE_ENABLED    = process.env.TURNSTILE_ENABLED === "true";
const TURNSTILE_SITE_KEY   = process.env.TURNSTILE_SITE_KEY  || "";
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || "";

async function verifyTurnstileToken(token, remoteip) {
  if (!TURNSTILE_ENABLED) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({
      secret:   TURNSTILE_SECRET_KEY,
      response: token,
    });
    if (remoteip) body.set("remoteip", remoteip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
    });
    const json = await r.json();
    return json.success === true;
  } catch (e) {
    console.error("[turnstile]", e);
    return false;
  }
}

// ── Email (SendGrid) config ───────────────────────────────────────────────────
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const SENDGRID_FROM    = process.env.SENDGRID_FROM    || "support@rulebritannia.org";
const APP_BASE_URL     = process.env.APP_BASE_URL     || "https://www.rulebritannia.org";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

async function sendVerificationEmail(email, token) {
  if (!SENDGRID_API_KEY) {
    console.warn("[email] SENDGRID_API_KEY not configured; skipping verification email to", email);
    return;
  }
  const verifyUrl = `${APP_BASE_URL}/verify-email.html?token=${encodeURIComponent(token)}`;
  await sgMail.send({
    from:    { name: "Rule Britannia", email: SENDGRID_FROM },
    to:      email,
    subject: "Verify your Rule Britannia email address",
    text: [
      "Thank you for applying to join Rule Britannia.",
      "",
      "Please verify your email address by visiting the link below:",
      verifyUrl,
      "",
      "This link expires in 24 hours and can only be used once.",
      "",
      "If you did not register, you can safely ignore this email.",
      "",
      "— The Rule Britannia Team",
      "  support@rulebritannia.org",
    ].join("\n"),
    html: `
      <p>Thank you for applying to join <strong>Rule Britannia</strong>.</p>
      <p>Please verify your email address by clicking the button below:</p>
      <p style="margin:24px 0;">
        <a href="${verifyUrl}" style="background:#001e5a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Verify Email Address
        </a>
      </p>
      <p style="font-size:13px;color:#666;">Or copy and paste this URL into your browser:<br>
        <a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="font-size:13px;color:#666;">This link expires in 24 hours and can only be used once.</p>
      <p style="font-size:13px;color:#666;">If you did not register, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="font-size:12px;color:#999;">
        The Rule Britannia Team &mdash;
        <a href="mailto:support@rulebritannia.org">support@rulebritannia.org</a>
      </p>
    `,
  });
}

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
  "https://rulebritannia-app.onrender.com",
  "https://rulebritannia-app-backend.onrender.com",
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

// lgtm[js/missing-token-validation] - CSRF protection is applied immediately
// after session setup via the verifyCsrfToken middleware (app.use(verifyCsrfToken)
// below). That middleware validates a per-session synchronizer token (generated
// with crypto.randomBytes(32), stored server-side, compared with timingSafeEqual)
// on every state-changing request. CodeQL does not recognise this custom
// implementation as CSRF protection; the alert is a false positive.
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
      sameSite: "none", // cross-site cookie (frontend on separate origin)
      secure: true, // must be true on https
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// CSRF token validation for all state-changing requests (POST / PUT / DELETE /
// PATCH). GET, HEAD, OPTIONS are safe methods and pass through. The /auth/login
// path is explicitly exempt because no session (and therefore no token) exists
// at that point. See verifyCsrfToken() below for the full implementation.
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
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Add email_verified columns to users if they don't exist yet (idempotent migration)
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN   NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
  `);

  // Backfill: users that existed before email verification was introduced are already
  // trusted (manually approved by an admin), so mark them as verified immediately.
  // Scoped to users with NO entry in pending_registrations so that newly approved
  // users who have not yet clicked their verification link are not auto-verified on
  // every server restart.
  await pool.query(`
    UPDATE users SET email_verified = TRUE, email_verified_at = NOW()
     WHERE email_verified = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM pending_registrations WHERE email = users.email
       );
  `);

  // Migration: if the users table still has a TEXT primary key (legacy install), migrate to UUID PK.
  // This also migrates the FK columns in user_roles, characters, and pending_character_applications.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'users' AND column_name = 'id' AND data_type = 'text'
      ) THEN
        -- Invalidate all existing sessions; user IDs are being reassigned to new UUIDs,
        -- so any stored session userId values will no longer match a valid users.id.
        -- All users will need to log in again after this one-time migration.
        DELETE FROM sessions;

        -- Step 1: Add new UUID columns
        ALTER TABLE users ADD COLUMN IF NOT EXISTS new_uuid_id UUID DEFAULT gen_random_uuid();

        -- Only add intermediate columns if the FK tables exist
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
          ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS new_uuid_user_id UUID;
          UPDATE user_roles ur SET new_uuid_user_id = u.new_uuid_id FROM users u WHERE ur.user_id = u.id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'characters') THEN
          ALTER TABLE characters ADD COLUMN IF NOT EXISTS new_uuid_user_id UUID;
          UPDATE characters c SET new_uuid_user_id = u.new_uuid_id FROM users u WHERE c.user_id = u.id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_character_applications') THEN
          ALTER TABLE pending_character_applications ADD COLUMN IF NOT EXISTS new_uuid_user_id UUID;
          UPDATE pending_character_applications pca SET new_uuid_user_id = u.new_uuid_id FROM users u WHERE pca.applicant_user_id = u.id;
        END IF;

        -- Step 2: Drop FK constraints on dependent tables
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
          ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
          ALTER TABLE user_roles DROP COLUMN IF EXISTS user_id;
          ALTER TABLE user_roles RENAME COLUMN new_uuid_user_id TO user_id;
          ALTER TABLE user_roles ALTER COLUMN user_id SET NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'characters') THEN
          ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_user_id_fkey;
          ALTER TABLE characters DROP COLUMN IF EXISTS user_id;
          ALTER TABLE characters RENAME COLUMN new_uuid_user_id TO user_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_character_applications') THEN
          ALTER TABLE pending_character_applications DROP CONSTRAINT IF EXISTS pending_character_applications_applicant_user_id_fkey;
          ALTER TABLE pending_character_applications DROP COLUMN IF EXISTS applicant_user_id;
          ALTER TABLE pending_character_applications RENAME COLUMN new_uuid_user_id TO applicant_user_id;
          ALTER TABLE pending_character_applications ALTER COLUMN applicant_user_id SET NOT NULL;
        END IF;

        -- Step 3: Swap users PK from TEXT to UUID
        ALTER TABLE users DROP CONSTRAINT users_pkey;
        ALTER TABLE users DROP COLUMN id;
        ALTER TABLE users RENAME COLUMN new_uuid_id TO id;
        ALTER TABLE users ADD PRIMARY KEY (id);

        -- Step 4: Re-add FK constraints and unique indexes on dependent tables
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
          ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_role_key'
          ) THEN
            ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
          END IF;
          CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles (user_id);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'characters') THEN
          ALTER TABLE characters ADD CONSTRAINT characters_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
          CREATE INDEX IF NOT EXISTS characters_user_idx ON characters (user_id);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pending_character_applications') THEN
          ALTER TABLE pending_character_applications ADD CONSTRAINT pending_character_applications_applicant_user_id_fkey
            FOREIGN KEY (applicant_user_id) REFERENCES users(id) ON DELETE CASCADE;
          CREATE INDEX IF NOT EXISTS pca_user_idx ON pending_character_applications (applicant_user_id);
        END IF;
      END IF;
    END $$;
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
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
      id                  TEXT PRIMARY KEY,
      data                JSONB NOT NULL,
      discourse_topic_id  TEXT,
      discourse_topic_url TEXT,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS bills_updated_idx ON bills (updated_at DESC)`);
  // Add columns to existing bills table if missing (migration)
  await pool.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT`);
  await pool.query(`ALTER TABLE bills ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT`);

  // Bill amendments — server-authoritative tracking of amendments per bill
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_amendments (
      id                  TEXT NOT NULL,
      bill_id             TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      article_number      INT,
      amendment_type      TEXT NOT NULL DEFAULT 'replace'
                          CHECK (amendment_type IN ('replace','insert','delete')),
      title               TEXT NOT NULL,
      text                TEXT NOT NULL DEFAULT '',
      proposed_by_id      UUID REFERENCES characters(id) ON DELETE SET NULL,
      proposed_by_name    TEXT,
      proposed_by_party   TEXT,
      status              TEXT NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed','accepted','refused','in-division','withdrawn')),
      division_id         UUID REFERENCES divisions(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bill_id, id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_amendment_supporters (
      bill_id       TEXT NOT NULL,
      amendment_id  TEXT NOT NULL,
      character_id  UUID REFERENCES characters(id) ON DELETE CASCADE,
      party         TEXT NOT NULL,
      added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bill_id, amendment_id, party),
      FOREIGN KEY (bill_id, amendment_id) REFERENCES bill_amendments(bill_id, id) ON DELETE CASCADE
    )
  `);

  // Bill stage reports — report submissions for the Report Stage
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_stage_reports (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bill_id         TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      submitted_by_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      content         TEXT,
      attachment_url  TEXT,
      sim_month       INT,
      sim_year        INT
    )
  `);

  // Bill opposition quota — tracks how many opposition bills submitted per character per sim year
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_opposition_quota (
      character_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      sim_year      INT NOT NULL,
      bill_type     TEXT NOT NULL CHECK (bill_type IN ('opposition','pmb_leader_3rd')),
      count         INT NOT NULL DEFAULT 0,
      PRIMARY KEY (character_id, sim_year, bill_type)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS motions (
      id                  TEXT PRIMARY KEY,
      motion_type         TEXT NOT NULL DEFAULT 'house',
      data                JSONB NOT NULL,
      discourse_topic_id  TEXT,
      discourse_topic_url TEXT,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE motions ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT`);
  await pool.query(`ALTER TABLE motions ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS motions_updated_idx ON motions (updated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS motions_type_idx    ON motions (motion_type)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS statements (
      id                  TEXT PRIMARY KEY,
      data                JSONB NOT NULL,
      discourse_topic_id  TEXT,
      discourse_topic_url TEXT,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE statements ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT`);
  await pool.query(`ALTER TABLE statements ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS statements_updated_idx ON statements (updated_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS regulations (
      id                  TEXT PRIMARY KEY,
      data                JSONB NOT NULL,
      discourse_topic_id  TEXT,
      discourse_topic_url TEXT,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE regulations ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT`);
  await pool.query(`ALTER TABLE regulations ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS regulations_updated_idx ON regulations (updated_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS questiontime_questions (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS qt_questions_updated_idx ON questiontime_questions (updated_at DESC)`);

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

  // ── Characters ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
      name          TEXT NOT NULL,
      party         TEXT NOT NULL DEFAULT '',
      constituency  TEXT NOT NULL DEFAULT '',
      roles         JSONB NOT NULL DEFAULT '[]'::jsonb,
      offices       JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS characters_user_idx ON characters (user_id);
    CREATE INDEX IF NOT EXISTS characters_active_idx ON characters (is_active);
  `);

  // ── Offices & Assignments ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS offices (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'parliamentary'
                 CHECK (type IN ('cabinet','shadow','parliamentary','other')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS office_assignments (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      office_id    UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (office_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS office_assign_office_idx ON office_assignments (office_id);
    CREATE INDEX IF NOT EXISTS office_assign_char_idx   ON office_assignments (character_id);
  `);

  // ── Divisions (generic voting engine) ────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS divisions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','closed')),
      closes_at   TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS divisions_entity_idx ON divisions (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS divisions_status_idx ON divisions (status);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_votes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      division_id  UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      vote         TEXT NOT NULL CHECK (vote IN ('aye','no','abstain')),
      weight       INTEGER NOT NULL DEFAULT 1,
      effective_weight INTEGER NOT NULL DEFAULT 1,
      delegation_source_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (division_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS division_votes_div_idx ON division_votes (division_id);
  `);

  await pool.query(`ALTER TABLE division_votes ADD COLUMN IF NOT EXISTS effective_weight INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE division_votes ADD COLUMN IF NOT EXISTS delegation_source_character_id UUID REFERENCES characters(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE divisions ADD COLUMN IF NOT EXISTS immutable_result JSONB;`);

  // ── Question Time (structured tables) ────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qt_questions (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      office_id             TEXT NOT NULL,
      asked_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      question_text         TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open','answered','archived')),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS qt_questions_office_idx ON qt_questions (office_id);
    CREATE INDEX IF NOT EXISTS qt_questions_status_idx ON qt_questions (status);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qt_answers (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id             UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
      answered_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      answer_text             TEXT NOT NULL,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS qt_answers_question_idx ON qt_answers (question_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qt_followups (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id           UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
      asked_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      followup_text         TEXT NOT NULL,
      answer_text           TEXT NOT NULL DEFAULT '',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS qt_followups_question_idx ON qt_followups (question_id);
  `);

  // ── Simulation State (authoritative clock) ────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sim_state (
      id           TEXT PRIMARY KEY,
      year         INTEGER NOT NULL DEFAULT 1997,
      month        INTEGER NOT NULL DEFAULT 8,
      is_paused    BOOLEAN NOT NULL DEFAULT FALSE,
      last_tick_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    INSERT INTO sim_state (id, year, month, is_paused)
    VALUES ('main', 1997, 8, FALSE)
    ON CONFLICT (id) DO NOTHING;
  `);

  // ── Press items (press releases + press conferences) ─────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS press_items (
      id                  TEXT PRIMARY KEY,
      press_type          TEXT NOT NULL DEFAULT 'release'
                          CHECK (press_type IN ('release','conference','comment','speech','letter')),
      data                JSONB NOT NULL,
      discourse_topic_id  TEXT,
      discourse_topic_url TEXT,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS press_items_type_idx   ON press_items (press_type);
    CREATE INDEX IF NOT EXISTS press_items_status_idx ON press_items ((data->>'status'));
  `);
  await pool.query(`ALTER TABLE press_items ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT`);
  await pool.query(`ALTER TABLE press_items ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT`);
  // ↑ Migration guards: press_items was created in an earlier schema version without these columns;
  //   ALTER TABLE ensures existing databases receive the new columns idempotently.

  // ── Polling entries ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS polling_entries (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS polling_entries_status_idx ON polling_entries ((data->>'status'));
  `);

  // ── Pending Registrations ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email           TEXT NOT NULL UNIQUE,
      username        TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL DEFAULT '',
      password_hash   TEXT NOT NULL,
      age_attested    BOOLEAN NOT NULL DEFAULT FALSE,
      consent_version INTEGER NOT NULL DEFAULT 1,
      consent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewed_by     TEXT,
      reviewed_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pending_reg_status_idx ON pending_registrations (status);
    CREATE INDEX IF NOT EXISTS pending_reg_email_idx  ON pending_registrations (email);
  `);

  // Idempotent migrations for pending_registrations
  await pool.query(`
    ALTER TABLE pending_registrations
      ADD COLUMN IF NOT EXISTS marketing_opt_in              BOOLEAN   NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS marketing_opt_in_at           TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS email_verified                BOOLEAN   NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS email_verified_at             TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS email_verification_token      TEXT,
      ADD COLUMN IF NOT EXISTS email_verification_token_exp  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS verification_resent_at        TIMESTAMPTZ;
  `);

  // ── Character profile columns (idempotent migrations) ─────────────────────
  await pool.query(`
    ALTER TABLE characters
      ADD COLUMN IF NOT EXISTS date_of_birth             TEXT,
      ADD COLUMN IF NOT EXISTS education                 TEXT,
      ADD COLUMN IF NOT EXISTS career_background         TEXT,
      ADD COLUMN IF NOT EXISTS family                    TEXT,
      ADD COLUMN IF NOT EXISTS year_first_elected        TEXT,
      ADD COLUMN IF NOT EXISTS personal_background       TEXT,
      ADD COLUMN IF NOT EXISTS bio                       TEXT,
      ADD COLUMN IF NOT EXISTS financial_background_level INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS avatar                    TEXT,
      ADD COLUMN IF NOT EXISTS avatar_attribution        TEXT,
      ADD COLUMN IF NOT EXISTS twitter_handle            TEXT,
      ADD COLUMN IF NOT EXISTS home                      JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS rentals                   JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  // ── Pending Character Applications ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_character_applications (
      id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      applicant_user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      applicant_username         TEXT NOT NULL,
      submitted_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status                     TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','approved','rejected')),
      reviewed_by                TEXT,
      reviewed_at                TIMESTAMPTZ,
      name                       TEXT NOT NULL,
      party                      TEXT NOT NULL DEFAULT '',
      constituency               TEXT NOT NULL DEFAULT '',
      date_of_birth              TEXT,
      education                  TEXT,
      career_background          TEXT,
      family                     TEXT,
      year_first_elected         TEXT,
      personal_background        TEXT,
      bio                        TEXT,
      financial_background_level INTEGER NOT NULL DEFAULT 1,
      avatar                     TEXT,
      twitter_handle             TEXT,
      home                       JSONB NOT NULL DEFAULT '{}'::jsonb,
      rentals                    JSONB NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS pca_user_idx   ON pending_character_applications (applicant_user_id);
    CREATE INDEX IF NOT EXISTS pca_status_idx ON pending_character_applications (status);
    ALTER TABLE pending_character_applications ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE pending_character_applications ADD COLUMN IF NOT EXISTS avatar_attribution TEXT;
  `);
  // Migration: add application_id FK on characters (links character back to its originating application)
  await pool.query(`
    ALTER TABLE characters ADD COLUMN IF NOT EXISTS application_id UUID
      REFERENCES pending_character_applications(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS characters_application_idx ON characters (application_id);
  `);

  // Migration: ensure created_at exists on characters (may be absent if table predates this column)
  await pool.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  // Migration: add active_character_id to users (DB-canonical pointer to the user's active character)
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS active_character_id UUID
        REFERENCES characters(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS users_active_character_idx ON users (active_character_id);
  `);

  // Migration: partial unique index enforcing one active character per user.
  // First, resolve any existing duplicates by keeping only the newest active character per user.
  await pool.query(`
    DO $$
    BEGIN
      -- Deactivate extra active characters (keep only the newest per user)
      UPDATE characters SET is_active = FALSE
       WHERE id IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
             FROM characters
            WHERE is_active = TRUE AND user_id IS NOT NULL
         ) ranked
          WHERE rn > 1
       );
      -- Now safe to create the partial unique index
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE tablename = 'characters' AND indexname = 'characters_one_active_per_user_idx'
      ) THEN
        CREATE UNIQUE INDEX characters_one_active_per_user_idx
          ON characters (user_id) WHERE is_active = TRUE;
      END IF;
    END $$;
  `);

  // ── Pending Bio Changes ────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_bio_changes (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id     UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
      reviewed_by      TEXT,
      reviewed_at      TIMESTAMPTZ,
      proposed_bio     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pbc_char_idx   ON pending_bio_changes (character_id);
    CREATE INDEX IF NOT EXISTS pbc_status_idx ON pending_bio_changes (status);
  `);

  // ── Pending Avatar Changes ─────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_avatar_changes (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id     UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
      reviewed_by      TEXT,
      reviewed_at      TIMESTAMPTZ,
      proposed_avatar  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pac_char_idx   ON pending_avatar_changes (character_id);
    CREATE INDEX IF NOT EXISTS pac_status_idx ON pending_avatar_changes (status);
  `);
  await pool.query(`ALTER TABLE pending_avatar_changes ADD COLUMN IF NOT EXISTS proposed_avatar_attribution TEXT`);

  // ── Affiliations — proper relational tables ───────────────────────────────
  // (Supersedes any prior pending_affiliations / approved_affiliations JSONB columns
  //  — those are kept for schema backward-compat but not used by the new workflow.)
  await pool.query(`
    ALTER TABLE characters
      ADD COLUMN IF NOT EXISTS pending_affiliations  JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS approved_affiliations JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  // affiliations_catalog: master list of all available affiliations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliations_catalog (
      id       TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name     TEXT NOT NULL,
      active   BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);

  // Add monthly_fee to affiliations_catalog (per-affiliation membership fee in £/month)
  // Must run before the seed upsert so the column exists when rows are inserted.
  await pool.query(`
    ALTER TABLE affiliations_catalog ADD COLUMN IF NOT EXISTS monthly_fee INTEGER NOT NULL DEFAULT 10;
  `);

  // Seed/upsert the catalog (idempotent). monthly_fee is per-affiliation £/month membership fee.
  // Category defaults: Trade Unions £25, Think Tanks £50, Advocacy £15, Business £75,
  //   Professional £30, Faith £10, International £20, Party Factions £5, Pressure £10, Soft £5
  await pool.query(`
    INSERT INTO affiliations_catalog (id, category, name, monthly_fee) VALUES
      ('trade_unions_unite',       'Trade Unions (Major UK)',        'Unite the Union',                                 25),
      ('trade_unions_unison',      'Trade Unions (Major UK)',        'UNISON',                                          25),
      ('trade_unions_gmb',         'Trade Unions (Major UK)',        'GMB',                                             25),
      ('trade_unions_cwu',         'Trade Unions (Major UK)',        'CWU (Communication Workers Union)',               25),
      ('trade_unions_rmt',         'Trade Unions (Major UK)',        'RMT',                                             25),
      ('trade_unions_usdaw',       'Trade Unions (Major UK)',        'USDAW',                                           25),
      ('trade_unions_nasuwt',      'Trade Unions (Major UK)',        'NASUWT',                                          25),
      ('trade_unions_neu',         'Trade Unions (Major UK)',        'NEU (National Education Union)',                  25),
      ('trade_unions_bma',         'Trade Unions (Major UK)',        'BMA',                                             25),
      ('trade_unions_tssa',        'Trade Unions (Major UK)',        'TSSA',                                            25),
      ('think_tanks_fabian',       'Think Tanks',                   'Fabian Society',                                  50),
      ('think_tanks_iea',          'Think Tanks',                   'Institute of Economic Affairs',                   50),
      ('think_tanks_policy_exch',  'Think Tanks',                   'Policy Exchange',                                 50),
      ('think_tanks_cps',          'Think Tanks',                   'Centre for Policy Studies',                       50),
      ('think_tanks_ifg',          'Think Tanks',                   'Institute for Government',                        50),
      ('think_tanks_demos',        'Think Tanks',                   'Demos',                                           50),
      ('think_tanks_resolution',   'Think Tanks',                   'Resolution Foundation',                           50),
      ('think_tanks_asi',          'Think Tanks',                   'Adam Smith Institute',                            50),
      ('think_tanks_chatham',      'Think Tanks',                   'Chatham House',                                   50),
      ('think_tanks_ippr',         'Think Tanks',                   'IPPR',                                            50),
      ('advocacy_greenpeace',      'Advocacy / Campaign Groups',    'Greenpeace UK',                                   15),
      ('advocacy_foe',             'Advocacy / Campaign Groups',    'Friends of the Earth',                            15),
      ('advocacy_liberty',         'Advocacy / Campaign Groups',    'Liberty',                                         15),
      ('advocacy_amnesty',         'Advocacy / Campaign Groups',    'Amnesty International',                           15),
      ('advocacy_stonewall',       'Advocacy / Campaign Groups',    'Stonewall',                                       15),
      ('advocacy_countryside',     'Advocacy / Campaign Groups',    'Countryside Alliance',                            15),
      ('advocacy_taxpayers',       'Advocacy / Campaign Groups',    'TaxPayers'' Alliance',                            15),
      ('advocacy_openrights',      'Advocacy / Campaign Groups',    'Open Rights Group',                               15),
      ('advocacy_shelter',         'Advocacy / Campaign Groups',    'Shelter',                                         15),
      ('advocacy_cnd',             'Advocacy / Campaign Groups',    'Campaign for Nuclear Disarmament',                15),
      ('business_cbi',             'Business / Industry',           'CBI',                                             75),
      ('business_fsb',             'Business / Industry',           'Federation of Small Businesses',                  75),
      ('business_iod',             'Business / Industry',           'Institute of Directors',                          75),
      ('business_bcc',             'Business / Industry',           'British Chambers of Commerce',                    75),
      ('business_techuk',          'Business / Industry',           'TechUK',                                          75),
      ('business_nfu',             'Business / Industry',           'National Farmers Union',                          75),
      ('prof_law_society',         'Professional Associations',     'Law Society',                                     30),
      ('prof_bar_council',         'Professional Associations',     'Bar Council',                                     30),
      ('prof_rcn',                 'Professional Associations',     'Royal College of Nursing',                        30),
      ('prof_cipd',                'Professional Associations',     'Chartered Institute of Personnel & Development',  30),
      ('faith_coe_synod',          'Faith / Ethical',               'Church of England Synod Member',                  10),
      ('faith_catholic_social',    'Faith / Ethical',               'Catholic Social Action Network',                  10),
      ('faith_mcb',                'Faith / Ethical',               'Muslim Council of Britain',                       10),
      ('faith_jlc',                'Faith / Ethical',               'Jewish Leadership Council',                       10),
      ('intl_nato_pa',             'International',                 'NATO Parliamentary Assembly',                     20),
      ('intl_council_europe',      'International',                 'Council of Europe',                               20),
      ('intl_cpa',                 'International',                 'Commonwealth Parliamentary Association',           20),
      ('intl_wef',                 'International',                 'World Economic Forum',                            20),
      ('faction_1922',             'Party Factions (Internal Groups)', 'Conservative 1922 Committee',                  5),
      ('faction_labour_campaign',  'Party Factions (Internal Groups)', 'Labour Campaign Group',                        5),
      ('faction_labour_first',     'Party Factions (Internal Groups)', 'Labour First',                                 5),
      ('faction_blue_labour',      'Party Factions (Internal Groups)', 'Blue Labour',                                  5),
      ('faction_tory_reform',      'Party Factions (Internal Groups)', 'Tory Reform Group',                            5),
      ('faction_erg',              'Party Factions (Internal Groups)', 'European Research Group',                      5),
      ('faction_libdem_fed',       'Party Factions (Internal Groups)', 'Liberal Democrat Federalist Group',            5),
      ('pressure_migwatch',        'Pressure Groups',               'Migration Watch UK',                              10),
      ('pressure_brit_future',     'Pressure Groups',               'British Future',                                  10),
      ('pressure_ifs',             'Pressure Groups',               'Institute of Fiscal Studies',                     10),
      ('pressure_rbl',             'Pressure Groups',               'Royal British Legion',                            10),
      ('pressure_ukfinance',       'Pressure Groups',               'UK Finance',                                      10),
      ('soft_rotary',              'Soft Affiliations',             'Rotary Club',                                     5),
      ('soft_local_biz',           'Soft Affiliations',             'Local Business Network',                          5),
      ('soft_alumni',              'Soft Affiliations',             'University Alumni Association',                   5)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, monthly_fee = EXCLUDED.monthly_fee;
  `);

  // character_affiliations: per-character affiliation status
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_affiliations (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id   UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      affiliation_id TEXT NOT NULL REFERENCES affiliations_catalog(id),
      status         TEXT NOT NULL
                     CHECK (status IN ('approved','pending_add','pending_remove','rejected_add','rejected_remove')),
      requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      requested_by   UUID REFERENCES users(id),
      reviewed_at    TIMESTAMPTZ,
      reviewed_by    TEXT,
      review_note    TEXT,
      UNIQUE (character_id, affiliation_id)
    );
    CREATE INDEX IF NOT EXISTS ca_char_idx   ON character_affiliations (character_id);
    CREATE INDEX IF NOT EXISTS ca_status_idx ON character_affiliations (status);
  `);

  // Make financial_background_level nullable so unset characters show "Unknown"
  await pool.query(`
    ALTER TABLE characters
      ALTER COLUMN financial_background_level DROP NOT NULL,
      ALTER COLUMN financial_background_level SET DEFAULT NULL;
    ALTER TABLE pending_character_applications
      ALTER COLUMN financial_background_level DROP NOT NULL,
      ALTER COLUMN financial_background_level SET DEFAULT NULL;
  `);

  // ── Parties ───────────────────────────────────────────────────────────────
  // New installs: create with UUID PK + slug.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parties (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug                     TEXT UNIQUE NOT NULL,
      name                     TEXT NOT NULL,
      short_name               TEXT NOT NULL DEFAULT '',
      leader_character_id      UUID REFERENCES characters(id) ON DELETE SET NULL,
      chairman_character_id    UUID REFERENCES characters(id) ON DELETE SET NULL,
      whip_character_id        UUID REFERENCES characters(id) ON DELETE SET NULL,
      chief_whip_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      deputy_whip_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      treasury                 JSONB NOT NULL DEFAULT '{}'::jsonb,
      hq_url                   TEXT,
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Migration: if the table still has a TEXT primary key (legacy install), recreate it with UUID PK.
  // The parties table has no inbound FK references so this rename-recreate is safe.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'parties' AND column_name = 'id' AND data_type = 'text'
      ) THEN
        ALTER TABLE parties RENAME TO parties_text_backup;
        CREATE TABLE parties (
          id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug                     TEXT UNIQUE NOT NULL,
          name                     TEXT NOT NULL,
          short_name               TEXT NOT NULL DEFAULT '',
          leader_character_id      UUID REFERENCES characters(id) ON DELETE SET NULL,
          chairman_character_id    UUID REFERENCES characters(id) ON DELETE SET NULL,
          whip_character_id        UUID REFERENCES characters(id) ON DELETE SET NULL,
          chief_whip_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
          deputy_whip_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
          treasury                 JSONB NOT NULL DEFAULT '{}'::jsonb,
          hq_url                   TEXT,
          updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        INSERT INTO parties
          (slug, name, short_name, leader_character_id, chairman_character_id,
           whip_character_id, treasury, hq_url, updated_at)
        SELECT id, name, short_name, leader_character_id, chairman_character_id,
               whip_character_id, treasury, hq_url, updated_at
          FROM parties_text_backup;
        DROP TABLE parties_text_backup;
      END IF;
    END $$;
  `);

  // Idempotent migrations for existing UUID-pk parties tables.
  await pool.query(`
    ALTER TABLE parties
      ADD COLUMN IF NOT EXISTS slug                     TEXT,
      ADD COLUMN IF NOT EXISTS chief_whip_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS deputy_whip_character_id UUID REFERENCES characters(id) ON DELETE SET NULL;
  `);
  // Backfill slug = name where slug is NULL (covers any edge case before UNIQUE constraint).
  await pool.query(`UPDATE parties SET slug = name WHERE slug IS NULL`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'parties_slug_key'
      ) THEN
        ALTER TABLE parties ALTER COLUMN slug SET NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS parties_slug_key ON parties (slug);
        ALTER TABLE parties ADD CONSTRAINT parties_slug_key UNIQUE USING INDEX parties_slug_key;
      END IF;
    END $$;
  `);

  // ── Scandal system ────────────────────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_opt_in (
      character_id UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      opted_in     BOOLEAN NOT NULL DEFAULT false,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_templates (
      id                 TEXT PRIMARY KEY,
      title              TEXT NOT NULL,
      category           TEXT NOT NULL,
      severity_base      INT  NOT NULL,
      time_window_months INT  NOT NULL,
      stages             JSONB NOT NULL,
      is_enabled         BOOLEAN NOT NULL DEFAULT true
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_situations (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id       UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      template_id        TEXT NOT NULL REFERENCES scandal_templates(id),
      title_override     TEXT,
      status             TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','closed','expired')),
      created_sim_year   INT NOT NULL,
      created_sim_month  INT NOT NULL,
      expires_sim_year   INT NOT NULL,
      expires_sim_month  INT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS scandal_situations_char_idx   ON scandal_situations (character_id);
    CREATE INDEX IF NOT EXISTS scandal_situations_status_idx ON scandal_situations (status);
    CREATE INDEX IF NOT EXISTS scandal_situations_created_idx ON scandal_situations (created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandals (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id            UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      template_id             TEXT NOT NULL REFERENCES scandal_templates(id),
      title                   TEXT NOT NULL,
      category                TEXT NOT NULL,
      severity_base           INT  NOT NULL,
      severity_current        INT  NOT NULL,
      stage_key               TEXT NOT NULL,
      status                  TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','awaiting_mod','closed')),
      stage_started_sim_year  INT NOT NULL,
      stage_started_sim_month INT NOT NULL,
      stage_deadline_sim_year INT NOT NULL,
      stage_deadline_sim_month INT NOT NULL,
      time_window_months      INT NOT NULL,
      flags                   JSONB NOT NULL DEFAULT '{}'::jsonb,
      public_notes            JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by_user_id      TEXT NOT NULL,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at               TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS scandals_char_idx    ON scandals (character_id);
    CREATE INDEX IF NOT EXISTS scandals_status_idx  ON scandals (status);
    CREATE INDEX IF NOT EXISTS scandals_created_idx ON scandals (created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_player_choices (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scandal_id         UUID NOT NULL REFERENCES scandals(id) ON DELETE CASCADE,
      stage_key          TEXT NOT NULL,
      choice_id          TEXT NOT NULL,
      choice_label       TEXT NOT NULL,
      flags_patch        JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor_character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      created_sim_year   INT NOT NULL,
      created_sim_month  INT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS scandal_choices_scandal_idx ON scandal_player_choices (scandal_id);
    CREATE INDEX IF NOT EXISTS scandal_choices_actor_idx   ON scandal_player_choices (actor_character_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_mod_decisions (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scandal_id         UUID NOT NULL REFERENCES scandals(id) ON DELETE CASCADE,
      decision_type      TEXT NOT NULL,
      severity_delta     INT NOT NULL DEFAULT 0,
      next_stage_key     TEXT,
      public_statement   TEXT,
      internal_notes     TEXT NOT NULL DEFAULT '',
      decided_by_user_id TEXT NOT NULL,
      created_sim_year   INT NOT NULL,
      created_sim_month  INT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS scandal_mod_decisions_scandal_idx ON scandal_mod_decisions (scandal_id);
  `);

  // ── Extra divisions columns (idempotent) ──────────────────────────────────
  await pool.query(`
    ALTER TABLE divisions
      ADD COLUMN IF NOT EXISTS closes_at_sim   TEXT,
      ADD COLUMN IF NOT EXISTS npc_votes       JSONB NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS rebels_by_party JSONB NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS outcome         TEXT;
  `);

  // ── Division whip system tables ───────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_party_instructions (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      division_id         UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      party_slug          TEXT NOT NULL,
      position            TEXT NOT NULL CHECK (position IN ('aye','no','abstain','free')),
      whip_level          INT  NOT NULL DEFAULT 0 CHECK (whip_level IN (0,1,2,3)),
      note                TEXT,
      set_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      set_by_user_id      TEXT,
      set_at_sim          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (division_id, party_slug)
    );
    CREATE INDEX IF NOT EXISTS dpi_division_idx ON division_party_instructions (division_id);
    CREATE INDEX IF NOT EXISTS dpi_party_idx    ON division_party_instructions (party_slug);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_rebellion_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      division_id     UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      character_id    UUID REFERENCES characters(id) ON DELETE SET NULL,
      party_slug      TEXT NOT NULL,
      party_position  TEXT NOT NULL,
      mp_vote         TEXT NOT NULL,
      whip_level      INT  NOT NULL DEFAULT 0,
      recorded_at_sim TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS drl_division_idx ON division_rebellion_log (division_id);
    CREATE INDEX IF NOT EXISTS drl_char_idx     ON division_rebellion_log (character_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_rebel_requests (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      division_id             UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      character_id            UUID REFERENCES characters(id) ON DELETE SET NULL,
      party_slug              TEXT NOT NULL,
      requested_vote          TEXT NOT NULL CHECK (requested_vote IN ('aye','no','abstain')),
      message                 TEXT,
      status                  TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','granted','refused','cancelled')),
      decided_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      decided_by_user_id      TEXT,
      decided_at_sim          TEXT,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS drr_division_idx ON division_rebel_requests (division_id);
    CREATE INDEX IF NOT EXISTS drr_char_idx     ON division_rebel_requests (character_id);
  `);

  // ── Constituencies ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS constituencies (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      nation     TEXT NOT NULL,
      region     TEXT NOT NULL,
      party      TEXT NOT NULL,
      mp_type    TEXT NOT NULL DEFAULT '',
      mp_name    TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS constituencies_party_idx  ON constituencies (party);
    CREATE INDEX IF NOT EXISTS constituencies_nation_idx ON constituencies (nation);
  `);

  // ── Elections system ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS elections (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type         TEXT NOT NULL DEFAULT 'general',
      polling_day  DATE NOT NULL,
      label        TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'pending',
      created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
      finalized_by UUID REFERENCES users(id) ON DELETE SET NULL,
      finalized_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS elections_type_idx   ON elections (type);
    CREATE INDEX IF NOT EXISTS elections_status_idx ON elections (status);

    CREATE TABLE IF NOT EXISTS election_party_summary (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      election_id  UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
      party        TEXT NOT NULL,
      seats        INT  NOT NULL DEFAULT 0,
      vote_share   NUMERIC(5,2) NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (election_id, party)
    );
    CREATE INDEX IF NOT EXISTS eps_election_idx ON election_party_summary (election_id);

    CREATE TABLE IF NOT EXISTS election_constituency_changes (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
      constituency_id TEXT NOT NULL,
      party_from      TEXT NOT NULL DEFAULT '',
      party_to        TEXT NOT NULL,
      notes           TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (election_id, constituency_id)
    );
    CREATE INDEX IF NOT EXISTS ecc_election_idx ON election_constituency_changes (election_id);

    CREATE TABLE IF NOT EXISTS constituency_events (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      constituency_id TEXT NOT NULL,
      change_type     TEXT NOT NULL,
      party_from      TEXT NOT NULL DEFAULT '',
      party_to        TEXT NOT NULL DEFAULT '',
      effective_date  DATE,
      notes           TEXT NOT NULL DEFAULT '',
      election_id     UUID REFERENCES elections(id) ON DELETE SET NULL,
      actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ce_constituency_idx ON constituency_events (constituency_id);
    CREATE INDEX IF NOT EXISTS ce_election_idx     ON constituency_events (election_id);

    CREATE TABLE IF NOT EXISTS app_state_elections (
      id                      TEXT PRIMARY KEY DEFAULT 'main',
      last_general_election_id UUID REFERENCES elections(id) ON DELETE SET NULL,
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO app_state_elections (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
  `);

  // Parliament status — government formation metadata (hung parliament support)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parliament_status (
      id                         TEXT PRIMARY KEY DEFAULT 'main',
      government_type            TEXT NOT NULL DEFAULT 'Majority'
                                 CHECK (government_type IN ('Majority','Minority','Coalition','Confidence and Supply')),
      governing_parties          JSONB NOT NULL DEFAULT '[]'::jsonb,
      confidence_supply_parties  JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO parliament_status (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
  `);

  // Migration: add new columns to elections and election_party_summary.
  await pool.query(`
    ALTER TABLE elections ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE elections ADD COLUMN IF NOT EXISTS turnout_total BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE elections ADD COLUMN IF NOT EXISTS turnout_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE election_party_summary ADD COLUMN IF NOT EXISTS votes BIGINT NOT NULL DEFAULT 0;
  `);

  // Budget data table (single-row, JSONB)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budget_data (
      id               TEXT PRIMARY KEY,
      last_year        JSONB,
      current_year     JSONB,
      admin_controls   JSONB NOT NULL DEFAULT '{"debtInterestPercent":7.2,"debtInterestExpenditure":31.11,"charityReliefExpenditure":0.41,"otherExpensesExpenditure":-0.66}'::jsonb,
      archive          JSONB NOT NULL DEFAULT '[]'::jsonb,
      pending          JSONB,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO budget_data (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
  `);

  // ── Salary scales (economy system) ───────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salary_scales (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                     TEXT NOT NULL,
      effective_from_sim_index INT  NOT NULL,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS salary_scales_idx ON salary_scales (effective_from_sim_index DESC);

    CREATE TABLE IF NOT EXISTS salary_scale_roles (
      scale_id      UUID NOT NULL REFERENCES salary_scales(id) ON DELETE CASCADE,
      role_key      TEXT NOT NULL,
      annual_salary NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (scale_id, role_key)
    );

    CREATE TABLE IF NOT EXISTS character_positions (
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      position_key TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (character_id, position_key)
    );

    CREATE TABLE IF NOT EXISTS character_finance (
      character_id            UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      bank_balance            NUMERIC NOT NULL DEFAULT 0,
      annual_salary_override  NUMERIC,
      last_paid_sim_index     INT,
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS character_additional_revenue (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      label        TEXT NOT NULL,
      annual_amount NUMERIC NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS char_add_rev_idx ON character_additional_revenue (character_id);
  `);

  await seedPlayableParties();
  await seedScandalTemplates();
  await seedElection1997();
  await seedConstituencies1997();
  await seedSalaryScale1997();

  // ── Shop price index ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_price_index (
      id                     TEXT PRIMARY KEY DEFAULT 'main',
      price_index            NUMERIC NOT NULL DEFAULT 1.0,
      last_applied_sim_month INT,
      last_applied_sim_year  INT,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO shop_price_index (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
  `);

  // ── Party structure + treasury overspend ──────────────────────────────────
  await pool.query(`
    ALTER TABLE parties
      ADD COLUMN IF NOT EXISTS party_structure    JSONB   NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS treasury_overspend BOOLEAN NOT NULL DEFAULT false;
  `);

  // ── Character finance: monthly shop upkeep + overspend flag ──────────────
  await pool.query(`
    ALTER TABLE character_finance
      ADD COLUMN IF NOT EXISTS shop_monthly_upkeep NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS finance_overspend   BOOLEAN NOT NULL DEFAULT false;
  `);

  // ── New social/parliamentary entity tables ────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS red_lion_posts (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS game_events (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS online_posts (
      id          TEXT PRIMARY KEY,
      post_type   TEXT NOT NULL DEFAULT 'web',
      data        JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fundraising_items (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Character shop purchases (DB-persisted per character) ─────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_shop_purchases (
      id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id   UUID    NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      item_id        TEXT    NOT NULL,
      item_name      TEXT    NOT NULL,
      price          NUMERIC NOT NULL DEFAULT 0,
      monthly_upkeep NUMERIC NOT NULL DEFAULT 0,
      effects        JSONB   NOT NULL DEFAULT '[]',
      risk_modifier  JSONB,
      purchased_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS char_shop_purchases_char_idx ON character_shop_purchases(character_id);
  `);

  // ── Pending profile field changes (player-submitted, mod/admin approval) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_profile_changes (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id                UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      proposed_education          TEXT,
      proposed_career_background  TEXT,
      proposed_family             TEXT,
      proposed_date_of_birth      TEXT,
      proposed_financial_bg_level INTEGER,
      proposed_twitter_handle     TEXT,
      status                      TEXT NOT NULL DEFAULT 'pending',
      reviewed_by                 UUID REFERENCES users(id),
      reviewed_at                 TIMESTAMPTZ,
      submitted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pending_profile_changes_char_idx   ON pending_profile_changes(character_id);
    CREATE INDEX IF NOT EXISTS pending_profile_changes_status_idx ON pending_profile_changes(status);
  `);

  // ── Party shop purchases (DB-persisted per party) ─────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_shop_purchases (
      id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug     TEXT    NOT NULL,
      item_id        TEXT    NOT NULL,
      item_name      TEXT    NOT NULL,
      price          NUMERIC NOT NULL DEFAULT 0,
      monthly_upkeep NUMERIC NOT NULL DEFAULT 0,
      effects        JSONB   NOT NULL DEFAULT '[]',
      risk_modifier  JSONB,
      purchased_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS party_shop_purchases_slug_idx ON party_shop_purchases(party_slug);
  `);

  // ── Party drafts column (party bill drafts, admin/chairman only) ──────────
  await pool.query(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS drafts JSONB NOT NULL DEFAULT '[]'::jsonb`);

  // ── Party membership fee + members rate-limit + intake tracking ──────────
  await pool.query(`
    ALTER TABLE parties
      ADD COLUMN IF NOT EXISTS membership_fee_annual        NUMERIC NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_members_update_sim_index INT,
      ADD COLUMN IF NOT EXISTS last_membership_intake_sim_year INT;
  `);

  // ── Party donations ledger ────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_donations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug  TEXT NOT NULL,
      from_name   TEXT NOT NULL DEFAULT '',
      amount      NUMERIC NOT NULL DEFAULT 0,
      note        TEXT NOT NULL DEFAULT '',
      sim_month   INT,
      sim_year    INT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS party_donations_slug_idx ON party_donations(party_slug);
  `);

  // ── Expand press_items type constraint to include comment / speech / letter ─
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'press_items') THEN
        ALTER TABLE press_items DROP CONSTRAINT IF EXISTS press_items_press_type_check;
        ALTER TABLE press_items ADD CONSTRAINT press_items_press_type_check
          CHECK (press_type IN ('release','conference','comment','speech','letter'));
      END IF;
    END $$;
  `);

  // ── Character work plans (constituency work allocation per character) ──────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_work_plans (
      character_id          UUID         PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      hours                 JSONB        NOT NULL DEFAULT '{}',
      second_job_title_company TEXT      NOT NULL DEFAULT '',
      last_saved_sim_index  INTEGER      NOT NULL DEFAULT 0,
      updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // ── Shop revenue payouts tracking (idempotent per character + item unit) ───
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_shop_revenue_payouts (
      id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id        UUID    NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      purchase_id         UUID    NOT NULL REFERENCES character_shop_purchases(id) ON DELETE CASCADE,
      last_payout_sim_index INT   NOT NULL DEFAULT 0,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (purchase_id)
    );
    CREATE INDEX IF NOT EXISTS char_shop_rev_payouts_char_idx ON character_shop_revenue_payouts(character_id);
  `);

  // ── base_price column for inflation-adjusted revenue payouts ──────────────
  // Stores the item's 1997 base price (basePrice1997 from SHOP_ITEMS) so the
  // server can compute annual revenue as: round(base_price × currentPriceIndex × 0.20).
  // Existing records default to 0 and fall back to 20% of the stored paid price (static).
  await pool.query(`
    ALTER TABLE character_shop_purchases
      ADD COLUMN IF NOT EXISTS base_price NUMERIC NOT NULL DEFAULT 0;
  `);

  // ── Canonical office spec_id + salary positions override ──────────────────
  await pool.query(`
    ALTER TABLE offices ADD COLUMN IF NOT EXISTS spec_id TEXT UNIQUE;
    ALTER TABLE character_finance
      ADD COLUMN IF NOT EXISTS positions_override BOOLEAN NOT NULL DEFAULT false;
  `);
  await seedOfficeSpecs();
  await backfillSalaryPositions();

  // ── Finance config (admin-managed salary bands, starting balances, cost index) ─
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_config (
      id                              TEXT        PRIMARY KEY DEFAULT 'main',
      salary_bands                    JSONB       NOT NULL DEFAULT '{}'::jsonb,
      starting_balances               JSONB       NOT NULL DEFAULT '{}'::jsonb,
      finance_cost_index              NUMERIC     NOT NULL DEFAULT 1.0,
      last_salary_bands_sim_year      INTEGER,
      last_starting_balances_sim_year INTEGER,
      last_inflation_sim_year         INTEGER,
      updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by                      UUID        REFERENCES users(id)
    );
    INSERT INTO finance_config (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
  `);

  // ── Finance idempotency: track which period+character combos have had upkeep applied ─
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_applied (
      period_key   TEXT        NOT NULL,
      character_id UUID        NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (period_key, character_id)
    );
    CREATE INDEX IF NOT EXISTS finance_applied_period_idx ON finance_applied(period_key);
  `);

  // ── Group drafts (cabinet, shadow cabinet) ────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_drafts (
      group_key   TEXT        PRIMARY KEY,
      drafts      JSONB       NOT NULL DEFAULT '[]',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO group_drafts (group_key) VALUES ('cabinet')       ON CONFLICT (group_key) DO NOTHING;
    INSERT INTO group_drafts (group_key) VALUES ('shadowcabinet') ON CONFLICT (group_key) DO NOTHING;
  `);

  // ── News stories ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_stories (
      id          TEXT        PRIMARY KEY,
      headline    TEXT        NOT NULL,
      text        TEXT        NOT NULL DEFAULT '',
      category    TEXT        NOT NULL DEFAULT 'Politics',
      image_url   TEXT        NOT NULL DEFAULT '',
      is_breaking BOOLEAN     NOT NULL DEFAULT FALSE,
      flavour     BOOLEAN     NOT NULL DEFAULT FALSE,
      sim_date    TEXT        NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // ── Rules ─────────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rules_items (
      id          SERIAL      PRIMARY KEY,
      title       TEXT        NOT NULL,
      body        TEXT        NOT NULL,
      sort_order  INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Guides ────────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guides_items (
      id          SERIAL      PRIMARY KEY,
      title       TEXT        NOT NULL,
      body        TEXT        NOT NULL,
      sort_order  INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Civil Service ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cs_briefings (
      id              SERIAL      PRIMARY KEY,
      title           TEXT        NOT NULL,
      target_office   TEXT        NOT NULL DEFAULT '',
      cc_offices      JSONB       NOT NULL DEFAULT '[]',
      status          TEXT        NOT NULL DEFAULT 'open',
      current_stage_idx INTEGER,
      awaiting_next_stage BOOLEAN NOT NULL DEFAULT FALSE,
      stages          JSONB       NOT NULL DEFAULT '[]',
      audit_log       JSONB       NOT NULL DEFAULT '[]',
      created_by      TEXT        NOT NULL DEFAULT '',
      created_at_sim  TEXT        NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cs_cases (
      id              SERIAL      PRIMARY KEY,
      dept_id         TEXT        NOT NULL DEFAULT '',
      title           TEXT        NOT NULL,
      status          TEXT        NOT NULL DEFAULT 'open',
      created_by      TEXT        NOT NULL DEFAULT '',
      created_by_avatar TEXT      NOT NULL DEFAULT '',
      created_at_sim  TEXT        NOT NULL DEFAULT '',
      closed_at_sim   TEXT,
      closed_by       TEXT,
      messages        JSONB       NOT NULL DEFAULT '[]',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Bodies data ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bodies_data (
      id          TEXT        PRIMARY KEY,
      data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
      sort_order  INTEGER     NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Newspaper articles (Papers page) ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newspaper_articles (
      id          TEXT        PRIMARY KEY,
      paper_key   TEXT        NOT NULL,
      headline    TEXT        NOT NULL,
      text        TEXT        NOT NULL DEFAULT '',
      byline_name TEXT        NOT NULL DEFAULT '',
      image_url   TEXT        NOT NULL DEFAULT '',
      sim_date    TEXT        NOT NULL DEFAULT '',
      created_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_newspaper_articles_paper_key ON newspaper_articles(paper_key);
  `);
}

// ── Property / Finance model constants ────────────────────────────────────────

// Default starting bank balance by financial background level (1–10)
// Overridden at runtime by finance_config.starting_balances if set.
const STARTING_BALANCES_DEFAULT = {
  1: 1000, 2: 2500, 3: 5000, 4: 10000, 5: 25000,
  6: 50000, 7: 100000, 8: 250000, 9: 500000, 10: 1000000,
};

// Legacy alias kept for character-approval seeding path (still uses this directly)
const STARTING_BALANCES = STARTING_BALANCES_DEFAULT;

// Default MP salary bands by position key.
// Overridden at runtime by finance_config.salary_bands if set.
const SALARY_BANDS_DEFAULT = {
  prime_minister:            101749,
  leader_opposition:          63024,
  leader_third_party:         60387,
  speaker:                    60387,
  secretary_of_state:         63047,
  minister_of_state:          53800,
  shadow_secretary_of_state:  53800,
  committee_chairman:         48860,
  committee_member:           46860,
  backbencher:                43860,
};

/**
 * Read the finance_config row from DB and return it, merging in safe defaults
 * for any fields that are not yet stored.
 */
async function getFinanceConfig() {
  const { rows } = await pool.query(
    `SELECT salary_bands, starting_balances, finance_cost_index,
            last_salary_bands_sim_year, last_starting_balances_sim_year,
            last_inflation_sim_year, updated_at, updated_by
       FROM finance_config WHERE id = 'main'`
  );
  const row = rows[0] || {};
  const salaryBands        = (row.salary_bands && Object.keys(row.salary_bands).length)
    ? row.salary_bands : { ...SALARY_BANDS_DEFAULT };
  const startingBalances   = (row.starting_balances && Object.keys(row.starting_balances).length)
    ? row.starting_balances : { ...STARTING_BALANCES_DEFAULT };
  const financeCostIndex   = Number(row.finance_cost_index ?? 1.0);
  return {
    salaryBands,
    startingBalances,
    financeCostIndex,
    lastSalaryBandsSimYear:      row.last_salary_bands_sim_year      ?? null,
    lastStartingBalancesSimYear: row.last_starting_balances_sim_year ?? null,
    lastInflationSimYear:        row.last_inflation_sim_year         ?? null,
    updatedAt:                   row.updated_at                      ?? null,
    updatedBy:                   row.updated_by                      ?? null,
  };
}

// Mortgage factor applied to monthly home/rental costs when property is mortgaged,
// by financial background level (1–10). Higher level = better credit = lower factor.
const MORTGAGE_FACTORS = {
  1: 1.50, 2: 1.45, 3: 1.40, 4: 1.35, 5: 1.30,
  6: 1.25, 7: 1.20, 8: 1.15, 9: 1.10, 10: 1.05,
};

// Base monthly living cost (£) for primary home by type
const HOME_MONTHLY_COSTS = {
  "Studio Flat":              500,
  "One-Bed Flat":             700,
  "Two-Bed Flat":             900,
  "Terraced House":           1000,
  "End-Terrace":              1100,
  "Semi-Detached House":      1300,
  "Detached Suburban House":  1700,
  "Townhouse":                2000,
  "Country House":            3000,
  "Country Estate":           5000,
  "Mansion":                  8000,
};

// Base monthly income and base monthly cost for rental properties by type
const RENTAL_MONTHLY = {
  "Single Room Let":         { income: 500,  cost: 150 },
  "Studio Flat":             { income: 700,  cost: 200 },
  "One/Two-Bed Flat":        { income: 900,  cost: 250 },
  "Terraced House":          { income: 1100, cost: 300 },
  "Semi-Detached House":     { income: 1300, cost: 350 },
  "Detached House":          { income: 1600, cost: 400 },
  "High Street Retail Unit": { income: 2000, cost: 600 },
  "Office Unit":             { income: 2500, cost: 700 },
  "Warehouse":               { income: 1500, cost: 400 },
  "Holiday Let":             { income: 1800, cost: 500 },
};

// Rental status income and cost factors
const RENTAL_STATUS_FACTORS = {
  "occupied":          { incomeFactor: 1.00, costFactor: 1.00 },
  "vacant":            { incomeFactor: 0,    costFactor: 0.75 },
  "under renovation":  { incomeFactor: 0,    costFactor: 1.25 },
};

// ── Canonical enum arrays (single source of truth for UI dropdowns) ───────────
// Derived from the constant objects above; consumed by GET /api/config/enums.
const ENUM_HOME_TYPES     = Object.keys(HOME_MONTHLY_COSTS);
const ENUM_RENTAL_TYPES   = Object.keys(RENTAL_MONTHLY);
const ENUM_RENTAL_STATUSES = Object.keys(RENTAL_STATUS_FACTORS).map((s) => {
  // Capitalise first letter to match UI display format
  return s.charAt(0).toUpperCase() + s.slice(1);
});
// Split rental types into residential and commercial
const ENUM_RENTAL_TYPES_RESIDENTIAL = [
  "Single Room Let", "Studio Flat", "One/Two-Bed Flat", "Terraced House",
  "Semi-Detached House", "Detached House", "Holiday Let",
];
const ENUM_RENTAL_TYPES_COMMERCIAL = [
  "High Street Retail Unit", "Office Unit", "Warehouse",
];

const ENUM_FINANCIAL_LEVELS = [
  { level: 1,  label: "1 – Poverty" },
  { level: 2,  label: "2 – Financially Strained" },
  { level: 3,  label: "3 – Lower Working Class" },
  { level: 4,  label: "4 – Skilled Working / Lower Middle" },
  { level: 5,  label: "5 – Solid Middle Class" },
  { level: 6,  label: "6 – Upper Middle Class" },
  { level: 7,  label: "7 – Affluent Professional" },
  { level: 8,  label: "8 – High Net Worth Individual" },
  { level: 9,  label: "9 – Top 5%" },
  { level: 10, label: "10 – Top 1%" },
];

// Personal multipliers for home living costs (education)
const EDUCATION_MULTIPLIERS = {
  "No Qualifications":   0.85,
  "GCSEs":               0.90,
  "A Levels":            0.95,
  "Certificate of HE":   1.00,
  "Diploma":             1.00,
  "Bachelors Degree":    1.05,
  "Masters Degree":      1.10,
  "Doctorate":           1.15,
};
const ENUM_EDUCATION_OPTIONS = Object.keys(EDUCATION_MULTIPLIERS);

// Personal multipliers for home living costs (pre-MP career)
const CAREER_MULTIPLIERS = {
  "Manual / Skilled Trade":              0.90,
  "Public Sector Professional":          1.00,
  "Legal Profession":                    1.10,
  "Finance / Banking / Corporate":       1.15,
  "Business Owner / Entrepreneur":       1.10,
  "Political Staffer / Researcher":      0.95,
  "Trade Union / Activist":              0.90,
  "Media / Journalism / Communications": 1.00,
  "Academia / Education Leadership":     1.00,
  "Military / Police / Security":        0.95,
};
const ENUM_CAREER_OPTIONS = Object.keys(CAREER_MULTIPLIERS);

// Personal multipliers for home living costs (family status)
const FAMILY_MULTIPLIERS = {
  "Single":                         1.00,
  "Married, No Children":           1.10,
  "Married with Children":          1.30,
  "Civil Partnership":              1.05,
  "Divorced":                       1.05,
  "Divorced with Children":         1.20,
  "Widowed":                        1.00,
  "Long-Term Partner with Children": 1.25,
  "Long-Term Partner, No Children":  1.05,
};
const ENUM_FAMILY_OPTIONS = Object.keys(FAMILY_MULTIPLIERS);

/**
 * Compute property-derived finance fields for a character.
 * @param {object} character
 * @param {number} [financeCostIndex=1.0] - admin-managed cost inflation multiplier;
 *   applied to home and rental costs, NOT to rental income.
 * Returns: { homeLivingCostsMonthly, rentalIncomeMonthly, rentalCostsMonthly,
 *             propertyMonthlyUpkeep, livingCostMultiplier, mortgageFactor }
 */
function computePropertyFinance(character, financeCostIndex = 1.0) {
  const costIdx   = Number.isFinite(financeCostIndex) && financeCostIndex > 0 ? financeCostIndex : 1.0;
  const bgLevel   = Math.min(10, Math.max(1, Number(character.financial_background_level) || 5));
  const mortgageF = MORTGAGE_FACTORS[bgLevel] ?? 1.30;

  // Home living costs (multiplied by financeCostIndex)
  const home          = character.home ?? {};
  const homeBaseMonthly = HOME_MONTHLY_COSTS[home.type] ?? 0;
  const eduMult       = EDUCATION_MULTIPLIERS[character.education] ?? 1.00;
  const careerMult    = CAREER_MULTIPLIERS[character.career_background] ?? 1.00;
  const familyMult    = FAMILY_MULTIPLIERS[character.family] ?? 1.00;
  const livingMult    = eduMult * careerMult * familyMult;
  const homeMortgageF = home.mortgaged ? mortgageF : 1.0;
  const homeLivingCostsMonthly = Math.round(homeBaseMonthly * livingMult * homeMortgageF * costIdx);

  // Rental income (NOT inflation-uprated) & costs (multiplied by financeCostIndex)
  const rentals = Array.isArray(character.rentals) ? character.rentals : [];
  let rentalIncomeMonthly = 0;
  let rentalCostsMonthly  = 0;
  for (const r of rentals) {
    const rtype  = RENTAL_MONTHLY[r.type];
    if (!rtype) continue;
    const statusKey = String(r.status || "occupied").toLowerCase().trim();
    const sf = RENTAL_STATUS_FACTORS[statusKey] ?? RENTAL_STATUS_FACTORS["occupied"];
    const rMortgageF = r.mortgaged ? mortgageF : 1.0;
    rentalIncomeMonthly += Math.round(rtype.income * sf.incomeFactor);
    rentalCostsMonthly  += Math.round(rtype.cost   * sf.costFactor * rMortgageF * costIdx);
  }

  const propertyMonthlyUpkeep = homeLivingCostsMonthly + rentalCostsMonthly;

  return {
    homeLivingCostsMonthly,
    rentalIncomeMonthly,
    rentalCostsMonthly,
    propertyMonthlyUpkeep,
    livingCostMultiplier: Math.round(livingMult * 100) / 100,
    mortgageFactor:       mortgageF,
  };
}

// ── 1997 baseline salary scale (idempotent) ────────────────────────────────
// effective_from_sim_index = 1997*12 + (8-1) = 23964 + 7 = 23971 (August 1997)
const SALARY_1997_SIM_INDEX = 1997 * 12 + 7; // August 1997 = index 23971

const SALARY_1997_ROLES = {
  prime_minister:            101749,
  leader_opposition:          63024,
  leader_third_party:         60387,
  speaker:                    60387,
  secretary_of_state:         63047,
  minister_of_state:          53800,
  shadow_secretary_of_state:  53800,
  committee_chairman:         48860,
  committee_member:           46860,
  backbencher:                43860,
};

async function seedSalaryScale1997() {
  // Check if a scale for sim_index 23971 already exists
  const { rows: existing } = await pool.query(
    "SELECT id FROM salary_scales WHERE effective_from_sim_index = $1 LIMIT 1",
    [SALARY_1997_SIM_INDEX]
  );
  if (existing.length) return; // already seeded
  const { rows } = await pool.query(
    "INSERT INTO salary_scales (name, effective_from_sim_index) VALUES ($1, $2) RETURNING id",
    ["1997 Baseline", SALARY_1997_SIM_INDEX]
  );
  const scaleId = rows[0].id;
  for (const [roleKey, salary] of Object.entries(SALARY_1997_ROLES)) {
    await pool.query(
      "INSERT INTO salary_scale_roles (scale_id, role_key, annual_salary) VALUES ($1, $2, $3)",
      [scaleId, roleKey, salary]
    );
  }
  console.log("[seed] 1997 salary scale seeded, id =", scaleId);
}

// ── Canonical office specs (mirrors client-side OFFICE_SPECS / SHADOW_OFFICE_SPECS) ──
// Slug used to identify the Liberal Democrat party for leader_third_party salary position.
const LIBDEM_PARTY_SLUG = "Liberal Democrat";

const CABINET_OFFICE_SPECS = [
  { specId: "prime-minister",    title: "Prime Minister, First Lord of the Treasury, and Minister for the Civil Service" },
  { specId: "chancellor",        title: "Chancellor of the Exchequer, and Second Lord of the Treasury" },
  { specId: "home",              title: "Secretary of State for the Home Department" },
  { specId: "foreign",           title: "Secretary of State for Foreign and Commonwealth Affairs" },
  { specId: "trade",             title: "Secretary of State for Business and Trade, and President of the Board of Trade" },
  { specId: "defence",           title: "Secretary of State for Defence" },
  { specId: "welfare",           title: "Secretary of State for Work and Pensions" },
  { specId: "education",         title: "Secretary of State for Education" },
  { specId: "env-agri",          title: "Secretary of State for the Environment and Agriculture" },
  { specId: "health",            title: "Secretary of State for Health and Social Care" },
  { specId: "eti",               title: "Secretary of State for Transport and Infrastructure" },
  { specId: "culture",           title: "Secretary of State for Culture, Media and Sport" },
  { specId: "home-nations",      title: "Secretary of State for the Home Nations" },
  { specId: "leader-commons",    title: "Leader of the House of Commons" },
];
const SHADOW_OFFICE_SPECS_SERVER = [
  { specId: "leader-opposition",       title: "Leader of the Opposition" },
  { specId: "shadow-chancellor",       title: "Shadow Chancellor of the Exchequer" },
  { specId: "shadow-home",             title: "Shadow Secretary of State for the Home Department" },
  { specId: "shadow-foreign",          title: "Shadow Secretary of State for Foreign and Commonwealth Affairs" },
  { specId: "shadow-trade",            title: "Shadow Secretary of State for Business and Trade, and President of the Board of Trade" },
  { specId: "shadow-defence",          title: "Shadow Secretary of State for Defence" },
  { specId: "shadow-welfare",          title: "Shadow Secretary of State for Work and Pensions" },
  { specId: "shadow-education",        title: "Shadow Secretary of State for Education" },
  { specId: "shadow-env-agri",         title: "Shadow Secretary of State for the Environment and Agriculture" },
  { specId: "shadow-health",           title: "Shadow Secretary of State for Health and Social Care" },
  { specId: "shadow-eti",              title: "Shadow Secretary of State for Transport and Infrastructure" },
  { specId: "shadow-culture",          title: "Shadow Secretary of State for Culture, Media and Sport" },
  { specId: "shadow-home-nations",     title: "Shadow Secretary of State for the Home Nations" },
  { specId: "shadow-leader-commons",   title: "Shadow Leader of the House of Commons" },
];

/** Idempotently ensure all canonical offices exist in the DB with their spec_id. */
async function seedOfficeSpecs() {
  const cabinetValues = CABINET_OFFICE_SPECS.map((_, i) => `($${i * 2 + 1}, 'cabinet', $${i * 2 + 2})`).join(", ");
  const cabinetParams = CABINET_OFFICE_SPECS.flatMap(({ title, specId }) => [title, specId]);
  await pool.query(
    `INSERT INTO offices (name, type, spec_id) VALUES ${cabinetValues}
     ON CONFLICT (spec_id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type`,
    cabinetParams
  );

  const shadowValues = SHADOW_OFFICE_SPECS_SERVER.map((_, i) => `($${i * 2 + 1}, 'shadow', $${i * 2 + 2})`).join(", ");
  const shadowParams = SHADOW_OFFICE_SPECS_SERVER.flatMap(({ title, specId }) => [title, specId]);
  await pool.query(
    `INSERT INTO offices (name, type, spec_id) VALUES ${shadowValues}
     ON CONFLICT (spec_id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type`,
    shadowParams
  );
  console.log("[seed] office specs seeded");
}

/**
 * Seed backbencher position for all player characters that have no salary
 * positions yet. Run once on startup so new installs and existing characters
 * without positions get a baseline salary.
 */
async function backfillSalaryPositions() {
  const { rows } = await pool.query(`
    SELECT c.id FROM characters c
     WHERE c.user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM character_positions cp WHERE cp.character_id = c.id
       )
  `);
  for (const { id } of rows) {
    await pool.query(
      "INSERT INTO character_positions (character_id, position_key) VALUES ($1, 'backbencher') ON CONFLICT DO NOTHING",
      [id]
    );
  }
  if (rows.length) console.log(`[backfill] seeded backbencher for ${rows.length} character(s)`);
}

/**
 * Recompute a character's salary positions from authoritative DB sources:
 *   office_assignments → offices.spec_id / type
 *   parties.leader_character_id for Liberal Democrat leader
 * Highest-wins is handled at query time in computeCharacterAnnualSalary.
 * Skipped when positions_override flag is set on character_finance.
 */
async function recomputeSalaryPositions(characterId) {
  // Respect manual override flag
  const { rows: fin } = await pool.query(
    "SELECT positions_override FROM character_finance WHERE character_id = $1",
    [characterId]
  );
  if (fin[0]?.positions_override) return;

  const positions = new Set(["backbencher"]);

  // Positions from office assignments
  const { rows: assignments } = await pool.query(
    `SELECT o.spec_id, o.type
       FROM office_assignments oa
       JOIN offices o ON o.id = oa.office_id
      WHERE oa.character_id = $1 AND o.spec_id IS NOT NULL`,
    [characterId]
  );
  for (const { spec_id, type } of assignments) {
    if (spec_id === "prime-minister") {
      positions.add("prime_minister");
    } else if (spec_id === "leader-opposition") {
      positions.add("leader_opposition");
    } else if (type === "cabinet") {
      positions.add("secretary_of_state");
    } else if (type === "shadow") {
      positions.add("shadow_secretary_of_state");
    }
  }

  // Liberal Democrat party leader → leader_third_party
  const { rows: ldRows } = await pool.query(
    "SELECT 1 FROM parties WHERE slug = $1 AND leader_character_id = $2",
    [LIBDEM_PARTY_SLUG, characterId]
  );
  if (ldRows.length) positions.add("leader_third_party");

  // Replace all positions atomically
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM character_positions WHERE character_id = $1", [characterId]);
    for (const pos of positions) {
      await client.query(
        "INSERT INTO character_positions (character_id, position_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [characterId, pos]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── Salary computation helpers ────────────────────────────────────────────────

/**
 * Returns the active salary scale row + its roles for the given sim index.
 * "Active" = latest scale where effective_from_sim_index <= simIndex.
 */
async function resolveActiveSalaryScale(simIndex) {
  const { rows: scales } = await pool.query(
    `SELECT s.id, s.name, s.effective_from_sim_index,
            json_object_agg(r.role_key, r.annual_salary) AS roles
       FROM salary_scales s
       JOIN salary_scale_roles r ON r.scale_id = s.id
      WHERE s.effective_from_sim_index <= $1
      GROUP BY s.id, s.name, s.effective_from_sim_index
      ORDER BY s.effective_from_sim_index DESC
      LIMIT 1`,
    [simIndex]
  );
  return scales[0] ?? null;
}

/**
 * Compute a character's base annual salary using Rule 1 (highest-wins) from DB positions.
 * Returns { annualSalary, positionKeys, scaleId }.
 */
async function computeCharacterAnnualSalary(characterId, simIndex) {
  const scale = await resolveActiveSalaryScale(simIndex);
  if (!scale) return { annualSalary: 0, positionKeys: [], scaleId: null };

  const { rows: positions } = await pool.query(
    "SELECT position_key FROM character_positions WHERE character_id = $1",
    [characterId]
  );
  const positionKeys = positions.map((p) => p.position_key);

  // Rule 1: highest salary wins
  let maxSalary = 0;
  const rolesMap = scale.roles || {};
  for (const key of positionKeys) {
    const s = Number(rolesMap[key] ?? 0);
    if (s > maxSalary) maxSalary = s;
  }

  return { annualSalary: maxSalary, positionKeys, scaleId: scale.id };
}

/**
 * Resolve annual salary for a character: override takes precedence over computed.
 */
async function resolvedAnnualSalary(characterId, simIndex) {
  const { rows: fin } = await pool.query(
    "SELECT annual_salary_override FROM character_finance WHERE character_id = $1",
    [characterId]
  );
  const override = fin[0]?.annual_salary_override;
  if (override != null) return { annualSalary: Number(override), isOverride: true };
  const { annualSalary, positionKeys, scaleId } = await computeCharacterAnnualSalary(characterId, simIndex);
  return { annualSalary, positionKeys, scaleId, isOverride: false };
}

/**
 * Automatically credit salary for all player characters that have missed periods.
 * Called on every clock tick. simIndex = year*12 + (month-1).
 */
async function runSalaryCrediting(month, year) {
  const simIndex = year * 12 + (month - 1);
  try {
    // Get all characters with a user_id (player characters)
    const { rows: chars } = await pool.query(
      "SELECT id, user_id FROM characters WHERE user_id IS NOT NULL"
    );

    for (const char of chars) {
      try {
        // Ensure character_finance row exists
        await pool.query(`
          INSERT INTO character_finance (character_id, bank_balance, last_paid_sim_index)
          VALUES ($1, 0, $2)
          ON CONFLICT (character_id) DO NOTHING
        `, [char.id, simIndex]);

        const { rows: fin } = await pool.query(
          "SELECT bank_balance, last_paid_sim_index FROM character_finance WHERE character_id = $1",
          [char.id]
        );
        if (!fin.length) continue;

        const lastPaid = fin[0].last_paid_sim_index;

        // On first seen (just inserted), start payments going forward — no back-pay
        if (lastPaid === simIndex) continue;
        if (lastPaid == null) {
          await pool.query(
            "UPDATE character_finance SET last_paid_sim_index = $1, updated_at = NOW() WHERE character_id = $2",
            [simIndex, char.id]
          );
          continue;
        }

        const periodsMissed = Math.floor((simIndex - lastPaid) / 2);
        if (periodsMissed <= 0) continue;

        const { annualSalary } = await resolvedAnnualSalary(char.id, simIndex);

        // Sum additional revenue
        const { rows: rev } = await pool.query(
          "SELECT COALESCE(SUM(annual_amount), 0) AS total FROM character_additional_revenue WHERE character_id = $1",
          [char.id]
        );
        const additional = Number(rev[0]?.total ?? 0);

        const periodCredit = (annualSalary + additional) / 6;
        const totalCredit = periodsMissed * periodCredit;
        const newLastPaid = lastPaid + periodsMissed * 2;

        await pool.query(
          `UPDATE character_finance
              SET bank_balance = bank_balance + $1,
                  last_paid_sim_index = $2,
                  updated_at = NOW()
            WHERE character_id = $3`,
          [totalCredit, newLastPaid, char.id]
        );
      } catch (charErr) {
        console.error(`[salary] error crediting character ${char.id}:`, charErr.message);
      }
    }
  } catch (e) {
    console.error("[salary] runSalaryCrediting error:", e.message);
  }
}

// ── Monthly shop upkeep deduction ─────────────────────────────────────────────
// Runs on every clock tick. Deducts personal item upkeep from character bank
// balances and party structure overhead from party treasuries.
// Idempotent: uses finance_applied table to skip characters already processed
// for the given sim period (period_key = "YYYY-MM").
async function runShopUpkeep(month, year) {
  const periodKey = year && month
    ? `${String(year)}-${String(month).padStart(2, "0")}`
    : null;

  try {
    if (periodKey) {
      // Idempotent per-character: INSERT records for all characters with upkeep,
      // skipping those already applied for this period. Then UPDATE only the new ones.
      const { rows: applied } = await pool.query(`
        WITH to_apply AS (
          SELECT character_id FROM character_finance WHERE shop_monthly_upkeep > 0
        ),
        inserted AS (
          INSERT INTO finance_applied (period_key, character_id)
          SELECT $1, character_id FROM to_apply
          ON CONFLICT (period_key, character_id) DO NOTHING
          RETURNING character_id
        )
        UPDATE character_finance cf
           SET bank_balance      = bank_balance - shop_monthly_upkeep,
               finance_overspend = (bank_balance - shop_monthly_upkeep) < 0,
               updated_at        = NOW()
          FROM inserted
         WHERE cf.character_id = inserted.character_id
           AND cf.shop_monthly_upkeep > 0
        RETURNING cf.character_id
      `, [periodKey]);

      // Log skip events: characters with upkeep that were NOT in the inserted set
      const { rows: skipped } = await pool.query(`
        SELECT character_id FROM finance_applied
         WHERE period_key = $1
           AND character_id IN (
             SELECT character_id FROM character_finance WHERE shop_monthly_upkeep > 0
           )
           AND character_id != ALL($2::uuid[])
      `, [periodKey, applied.map((r) => r.character_id)]);

      if (skipped.length > 0) {
        await writeAuditLog(null, "finance.upkeep.skip", "finance_applied", periodKey, null,
          { periodKey, skippedCount: skipped.length, skippedCharacterIds: skipped.map((r) => r.character_id) });
      }
    } else {
      // No period key: fallback to legacy bulk update (no idempotency guard)
      await pool.query(`
        UPDATE character_finance
           SET bank_balance      = bank_balance - shop_monthly_upkeep,
               finance_overspend = (bank_balance - shop_monthly_upkeep) < 0,
               updated_at        = NOW()
         WHERE shop_monthly_upkeep > 0
      `);
    }
    // Party: deduct structure monthly overhead + HQ baseline + party shop purchase upkeep from each party treasury
    const { rows: parties } = await pool.query(
      `SELECT p.id, p.slug, p.treasury, p.party_structure,
              COALESCE(SUM(ps.monthly_upkeep), 0) AS shop_upkeep
         FROM parties p
         LEFT JOIN party_shop_purchases ps ON ps.party_slug = p.slug
        WHERE (p.party_structure->>'monthlyOverhead')::numeric > 0
           OR EXISTS (SELECT 1 FROM party_shop_purchases WHERE party_slug = p.slug AND monthly_upkeep > 0)
           OR p.slug IN ('Conservative','Labour','Liberal Democrat')
        GROUP BY p.id, p.slug, p.treasury, p.party_structure`
    );

    // Compute all deductions in JS then apply in a single batch UPDATE
    const toUpdate = parties
      .map((party) => {
        const overhead    = Number(party.party_structure?.monthlyOverhead || 0);
        const shopUpkeep  = Number(party.shop_upkeep || 0);
        const hqBaseline  = Number(HQ_BASELINE_UPKEEP_1997[party.slug] || 0);
        const totalDeduct = overhead + shopUpkeep + hqBaseline;
        if (totalDeduct <= 0) return null;
        const newCash   = Number(party.treasury?.cash || 0) - totalDeduct;
        const overspend = newCash < 0;
        return { id: party.id, newCash, overspend };
      })
      .filter(Boolean);

    if (toUpdate.length > 0) {
      const valuesClause = toUpdate
        .map((_, i) => `($${i * 3 + 1}::uuid, $${i * 3 + 2}::numeric, $${i * 3 + 3}::boolean)`)
        .join(", ");
      const params = toUpdate.flatMap(({ id, newCash, overspend }) => [id, newCash, overspend]);
      await pool.query(
        `UPDATE parties AS p
            SET treasury           = jsonb_set(COALESCE(treasury,'{}'), '{cash}', to_jsonb(v.new_cash)),
                treasury_overspend = v.overspend,
                updated_at         = NOW()
           FROM (VALUES ${valuesClause}) AS v(id, new_cash, overspend)
          WHERE p.id = v.id`,
        params
      );
    }
  } catch (e) {
    console.error("[runShopUpkeep] error:", e.message);
  }
}

// ── Shop revenue item payouts ──────────────────────────────────────────────────
// Runs on every clock tick. For each character shop purchase that has an
// additionalRevenue effect, pays out every 12 sim months from purchase date.
async function runRevenuePayouts(simMonth, simYear) {
  try {
    const simIndex = simYear * 12 + (simMonth - 1);

    // Fetch current price index for inflation-adjusted revenue calculation
    const { rows: piRows } = await pool.query(
      `SELECT price_index FROM shop_price_index WHERE id = 'main'`
    );
    const priceIndex = Number(piRows[0]?.price_index ?? 1);

    // Fetch all active shop purchases that have an additionalRevenue effect
    const { rows: purchases } = await pool.query(`
      SELECT p.id, p.character_id, p.effects, p.purchased_at, p.price, p.base_price,
             COALESCE(rp.last_payout_sim_index, 0) AS last_payout_sim_index
        FROM character_shop_purchases p
        LEFT JOIN character_shop_revenue_payouts rp ON rp.purchase_id = p.id
       WHERE p.effects @> '[{"type":"additionalRevenue"}]'::jsonb
    `);

    for (const p of purchases) {
      try {
        const effects = Array.isArray(p.effects) ? p.effects : [];
        const revenueEffect = effects.find((e) => e.type === "additionalRevenue");
        if (!revenueEffect) continue;

        // Annual revenue = 20% of current shop price (base_price × currentPriceIndex).
        // This inflates inline with the economy. base_price is stored at time of purchase
        // (item.basePrice1997). For legacy records where base_price = 0, fall back to
        // 20% of the stored paid price (static, no further inflation).
        const basePrice = Number(p.base_price || 0);
        const annualRevenue = basePrice > 0
          ? Math.round(basePrice * priceIndex * 0.20)
          : Math.round(Number(p.price || 0) * 0.20);

        // Sim index uses year*12 + (month-1) where month is 1-12.
        // purchasedAt.getMonth() returns 0-11, so year*12 + getMonth() matches the formula.
        // First payout fires 12 sim months after purchase (purchase month is the base).
        const purchasedAt = new Date(p.purchased_at);
        const purchaseSimIndex = purchasedAt.getFullYear() * 12 + purchasedAt.getMonth();

        const lastPaid = Number(p.last_payout_sim_index);
        // First payout base is the purchase sim index (i.e. 12 months after purchase)
        const base = lastPaid > 0 ? lastPaid : purchaseSimIndex;

        const periodsMissed = Math.floor((simIndex - base) / 12);
        if (periodsMissed <= 0) continue;

        const payout = periodsMissed * annualRevenue;
        const newLastPaid = base + periodsMissed * 12;

        // Single CTE statement replaces the previous BEGIN/UPDATE/INSERT/COMMIT sequence
        // (4 round-trips). A single statement is inherently atomic in PostgreSQL, so the
        // balance update and payout record either both succeed or both fail together.
        await pool.query(
          `WITH balance_update AS (
             UPDATE character_finance
                SET bank_balance = bank_balance + $1, updated_at = NOW()
              WHERE character_id = $2
           )
           INSERT INTO character_shop_revenue_payouts (character_id, purchase_id, last_payout_sim_index)
                VALUES ($2, $3, $4)
           ON CONFLICT (purchase_id) DO UPDATE SET last_payout_sim_index = $4, updated_at = NOW()`,
          [payout, p.character_id, p.id, newLastPaid]
        );
      } catch (purchaseErr) {
        // The CTE is atomic: if this throws, neither the balance update nor the payout
        // record was committed, so no partial state is left.
        console.error(`[revenuePayouts] purchase ${p.id}:`, purchaseErr.message);
      }
    }
  } catch (e) {
    console.error("[runRevenuePayouts] error:", e.message);
  }
}
const PLAYABLE_PARTIES = ["Conservative", "Labour", "Liberal Democrat"];

// ── Fixed HQ baseline monthly upkeep (1997 values) ────────────────────────
const HQ_BASELINE_UPKEEP_1997 = {
  Conservative:     12000,
  Labour:           15000,
  "Liberal Democrat": 8000,
};

// ── Annual membership intake (January) ───────────────────────────────────────
// Called each tick. When month === 1, credits each party treasury with
// membership_fee_annual × members (idempotent per sim year).
async function runMembershipIntake(month, year) {
  if (month !== 1) return; // only January
  try {
    const { rows: parties } = await pool.query(
      `SELECT id, slug, treasury, membership_fee_annual, last_membership_intake_sim_year
         FROM parties
        WHERE membership_fee_annual > 0
          AND (last_membership_intake_sim_year IS NULL OR last_membership_intake_sim_year < $1)`,
      [year]
    );
    for (const party of parties) {
      const fee     = Number(party.membership_fee_annual || 0);
      const members = Number(party.treasury?.members || 0);
      const credit  = Math.round(fee * members);
      if (credit <= 0) continue;
      await pool.query(
        `UPDATE parties
            SET treasury = jsonb_set(COALESCE(treasury,'{}'), '{cash}',
                             to_jsonb((COALESCE((treasury->>'cash')::numeric, 0) + $1))),
                last_membership_intake_sim_year = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [credit, year, party.id]
      );
      await pool.query(
        `INSERT INTO party_donations (party_slug, from_name, amount, note, sim_month, sim_year)
         VALUES ($1, 'Membership Intake', $2, $3, 1, $4)`,
        [party.slug, credit, `Annual membership fee intake: ${members.toLocaleString("en-GB")} members × £${fee.toLocaleString("en-GB")}`, year]
      );
      console.log(`[intake] ${party.slug}: credited £${credit} (${members} × £${fee}) for ${year}`);
    }
  } catch (e) {
    console.error("[runMembershipIntake] error:", e.message);
  }
}

// Server-side party name normaliser — mirrors scripts/convert-1997-csv.js.
// Handles ASCII variants, Latin-1 mojibake and legacy CSV typos.
const SERVER_PARTY_MAP = {
  "Sinn Fein":    "Sinn Féin",
  "Sinn F\xe9in": "Sinn Féin",   // Latin-1 byte
  "Sinn F?in":    "Sinn Féin",   // question-mark mojibake
  "UK Unionist":  "Independents",
  "Independent":  "Independents",
};
function normaliseParty(raw) {
  const trimmed = (raw || "").trim();
  return SERVER_PARTY_MAP[trimmed] ?? trimmed;
}

// All 15 canonical parties (3 playable + 12 NPC).
const ALL_CANONICAL_PARTIES = [
  { slug: "Conservative",     name: "Conservative",     short_name: "CON", playable: true  },
  { slug: "Labour",           name: "Labour",           short_name: "LAB", playable: true  },
  { slug: "Liberal Democrat", name: "Liberal Democrat", short_name: "LDM", playable: true  },
  { slug: "SNP",              name: "SNP",              short_name: "SNP", playable: false },
  { slug: "Plaid Cymru",      name: "Plaid Cymru",      short_name: "PC",  playable: false },
  { slug: "Green",            name: "Green",            short_name: "GRN", playable: false },
  { slug: "UKIP",             name: "UKIP",             short_name: "UKP", playable: false },
  { slug: "DUP",              name: "DUP",              short_name: "DUP", playable: false },
  { slug: "Sinn Féin",        name: "Sinn Féin",        short_name: "SF",  playable: false },
  { slug: "SDLP",             name: "SDLP",             short_name: "SDL", playable: false },
  { slug: "Alliance",         name: "Alliance",         short_name: "ALL", playable: false },
  { slug: "TUP",              name: "TUP",              short_name: "TUP", playable: false },
  { slug: "UUP",              name: "UUP",              short_name: "UUP", playable: false },
  { slug: "Independents",     name: "Independents",     short_name: "IND", playable: false },
  { slug: "Speaker",          name: "Speaker",          short_name: "SPK", playable: false },
];

/**
 * Idempotent upsert of all canonical parties.
 */
async function seedPlayableParties() {
  // Add playable column if not present (migration safety).
  await pool.query(`
    ALTER TABLE parties ADD COLUMN IF NOT EXISTS playable BOOLEAN NOT NULL DEFAULT false;
  `);
  const values = ALL_CANONICAL_PARTIES.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(", ");
  const params = ALL_CANONICAL_PARTIES.flatMap(({ slug, name, short_name, playable }) => [slug, name, short_name, playable]);
  await pool.query(
    `INSERT INTO parties (slug, name, short_name, playable) VALUES ${values}
     ON CONFLICT (slug) DO UPDATE SET short_name = EXCLUDED.short_name, playable = EXCLUDED.playable`,
    params
  );

  // Seed baseline 1997 party structure for the 3 playable parties (idempotent: only if empty)
  const BASELINE_STRUCTURES = {
    Conservative: {
      departments: { communications: 12, policy: 10, campaign: 15, compliance: 4, admin: 8, fundraising: 6, membership: 8, research: 7 },
      nationalOffices: [
        { region: "Scotland", size: "Regional Office", staffCount: 8 },
        { region: "Wales",    size: "Regional Office", staffCount: 6 },
      ],
    },
    Labour: {
      departments: { communications: 14, policy: 11, campaign: 18, compliance: 4, admin: 9, fundraising: 7, membership: 10, research: 7 },
      nationalOffices: [
        { region: "Scotland", size: "Regional Office", staffCount: 10 },
        { region: "Wales",    size: "Regional Office", staffCount: 8 },
      ],
    },
    "Liberal Democrat": {
      departments: { communications: 6, policy: 5, campaign: 8, compliance: 2, admin: 4, fundraising: 3, membership: 5, research: 4 },
      nationalOffices: [
        { region: "Scotland", size: "Regional Office", staffCount: 4 },
        { region: "Wales",    size: "Regional Office", staffCount: 3 },
      ],
    },
  };
  for (const [slug, base] of Object.entries(BASELINE_STRUCTURES)) {
    const totalDeptStaff   = Object.values(base.departments).reduce((s, v) => s + v, 0);
    const totalOfficeStaff = base.nationalOffices.reduce((s, o) => s + o.staffCount, 0);
    const totalStaff       = totalDeptStaff + totalOfficeStaff;
    const monthlyOverhead  = Math.round(totalStaff * 1500); // STAFF_COST_1997
    const structure = {
      departments:    base.departments,
      nationalOffices: base.nationalOffices,
      totalStaff,
      monthlyOverhead,
      unlocks: {},
    };
    await pool.query(
      `UPDATE parties
          SET party_structure = $1::jsonb
        WHERE slug = $2
          AND (party_structure IS NULL OR party_structure = '{}'::jsonb OR party_structure = 'null'::jsonb)`,
      [JSON.stringify(structure), slug]
    );
  }
}

/**
 * Parse the 1997 structured CSV to extract party vote/seat data and turnout.
 * Falls back to counting from constituencies_1997.json if the CSV is unavailable.
 */
function parse1997CSV() {
  try {
    const raw = readFileSync(resolve(__serverDir, "..", "assets", "1997_structured.csv"), "utf8");
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
    const parties = {};
    let turnoutTotal = 0;
    let turnoutPct = 0;

    for (const line of lines.slice(1)) { // skip header
      const cols = line.split(",");
      const [recordType, party] = cols;
      if (recordType === "vote_summary" && party) {
        const p = normaliseParty(party);
        const seats     = parseInt(cols[4], 10)  || 0;
        const votes     = parseInt(cols[5], 10)  || 0;
        const voteShare = parseFloat((cols[6] || "").replace("%", "")) || 0;
        if (!parties[p]) parties[p] = { seats: 0, votes: 0, voteShare: 0 };
        parties[p].seats     = seats;
        parties[p].votes     = votes;
        parties[p].voteShare = voteShare;
      } else if (recordType === "seat_breakdown" && party) {
        const p = normaliseParty(party);
        const seats = parseInt(cols[4], 10) || 0;
        if (!parties[p]) parties[p] = { seats: 0, votes: 0, voteShare: 0 };
        if (seats) parties[p].seats = seats;
      } else if (recordType === "overall_total") {
        const tp = parseFloat((cols[8] || "").replace("%", "")) || 0;
        const tt = parseInt(cols[9], 10) || 0;
        if (tp && !turnoutPct)    turnoutPct    = tp;
        if (tt && !turnoutTotal)  turnoutTotal  = tt;
      }
    }
    return {
      parties: Object.entries(parties).map(([party, d]) => ({ party, ...d })),
      turnoutTotal,
      turnoutPct,
    };
  } catch (e) {
    console.warn("[parse1997CSV] failed, falling back to constituencies JSON:", e.message);
    // Fallback: count seats from constituencies_1997.json (no vote data).
    try {
      const json = JSON.parse(readFileSync(resolve(__serverDir, "..", "data", "constituencies_1997.json"), "utf8"));
      const counts = {};
      for (const c of (json.constituencies || [])) {
        const p = normaliseParty(c.party);
        counts[p] = (counts[p] || 0) + 1;
      }
      return {
        parties: Object.entries(counts).map(([party, seats]) => ({ party, seats, votes: 0, voteShare: 0 })),
        turnoutTotal: 0,
        turnoutPct: 0,
      };
    } catch { return { parties: [], turnoutTotal: 0, turnoutPct: 0 }; }
  }
}

/**
 * Idempotent seed of the 1997 General Election baseline.
 * Uses assets/1997_structured.csv for accurate vote/seat/turnout data.
 */
async function seedElection1997() {
  // Check if the 1997 GE record already exists.
  const { rows: existing } = await pool.query(
    `SELECT id FROM elections WHERE type = 'general' AND polling_day = '1997-05-01' LIMIT 1`
  );

  if (existing.length > 0) {
    const elId = existing[0].id;
    // Ensure it is marked as current and last GE.
    await pool.query(
      `UPDATE elections SET is_current = true WHERE id = $1`,
      [elId]
    );
    await pool.query(
      `UPDATE app_state_elections SET last_general_election_id = $1, updated_at = NOW() WHERE id = 'main'`,
      [elId]
    );
    // Self-healing: if party summary rows are missing vote data, re-parse CSV and repair.
    const { rows: sumRows } = await pool.query(
      `SELECT COUNT(*) AS cnt, SUM(votes) AS total_votes FROM election_party_summary WHERE election_id = $1`,
      [elId]
    );
    const hasMissingVotes = Number(sumRows[0]?.total_votes || 0) === 0;
    if (hasMissingVotes) {
      console.log(`[seedElection1997] repairing missing vote/share data for existing 1997 GE (id=${elId})`);
      const csvData = parse1997CSV();
      for (const ps of csvData.parties) {
        await pool.query(
          `INSERT INTO election_party_summary (election_id, party, seats, votes, vote_share)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (election_id, party) DO UPDATE
             SET seats = EXCLUDED.seats, votes = EXCLUDED.votes, vote_share = EXCLUDED.vote_share`,
          [elId, ps.party, ps.seats, ps.votes, ps.voteShare]
        );
      }
      // Also repair turnout on the election row if missing.
      if (csvData.turnoutTotal || csvData.turnoutPct) {
        await pool.query(
          `UPDATE elections SET turnout_total = $1, turnout_pct = $2 WHERE id = $3 AND (turnout_total = 0 OR turnout_total IS NULL)`,
          [csvData.turnoutTotal, csvData.turnoutPct, elId]
        );
      }
      console.log(`[seedElection1997] repaired 1997 GE vote data: ${csvData.parties.map(p=>`${p.party}:${p.seats}`).join(", ")}`);
    }
    return;
  }

  // Parse the 1997 structured CSV.
  const csvData = parse1997CSV();

  // Create the election record.
  const { rows: elRows } = await pool.query(
    `INSERT INTO elections (type, polling_day, label, status, finalized_at, turnout_total, turnout_pct, is_current)
     VALUES ('general', '1997-05-01', 'May 1997 General Election', 'finalized', '1997-05-01T00:00:00Z', $1, $2, true)
     RETURNING id`,
    [csvData.turnoutTotal, csvData.turnoutPct]
  );
  const elId = elRows[0].id;

  // Insert party summary from CSV data.
  for (const ps of csvData.parties) {
    await pool.query(
      `INSERT INTO election_party_summary (election_id, party, seats, votes, vote_share)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (election_id, party) DO UPDATE
         SET seats = EXCLUDED.seats, votes = EXCLUDED.votes, vote_share = EXCLUDED.vote_share`,
      [elId, ps.party, ps.seats, ps.votes, ps.voteShare]
    );
  }
  console.log(`[seedElection1997] seeded 1997 GE (id=${elId}) from CSV: ${csvData.parties.map(p=>`${p.party}:${p.seats}`).join(", ")}`);

  // Mark as last general election.
  await pool.query(
    `UPDATE app_state_elections SET last_general_election_id = $1, updated_at = NOW() WHERE id = 'main'`,
    [elId]
  );
}

/**
 * Idempotent seed of 1997 constituencies from constituencies_1997.json.
 * Skips if constituencies table is already populated.
 */
async function seedConstituencies1997() {
  const { rows: existing } = await pool.query(`SELECT 1 FROM constituencies LIMIT 1`);
  if (existing.length > 0) return; // already populated

  let json;
  try {
    json = JSON.parse(readFileSync(resolve(__serverDir, "..", "data", "constituencies_1997.json"), "utf8"));
  } catch (e) {
    console.warn("[seedConstituencies1997] could not load constituencies_1997.json:", e.message);
    return;
  }

  const incoming = json.constituencies || [];
  if (incoming.length === 0) {
    console.warn("[seedConstituencies1997] constituencies_1997.json has no entries — skipping.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of incoming) {
      const party = normaliseParty(c.party);
      await client.query(
        `INSERT INTO constituencies (id, name, nation, region, party, mp_type, mp_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.name, c.nation, c.region, party, c.mpType || "", c.mpName || ""]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  console.log(`[seedConstituencies1997] seeded ${incoming.length} constituencies.`);
}

/**
 * Seed the 15 canonical scandal templates.  Idempotent — uses ON CONFLICT DO NOTHING.
 */
async function seedScandalTemplates() {
  const templates = [
    {
      id: "tpl-expenses",
      title: "Expenses Irregularity",
      category: "financial",
      severity_base: 3,
      time_window_months: 4,
      stages: [
        { key: "rumour", title: "Leak Emerges", text: "A whistleblower has reportedly passed information about your expenses claims to a national paper. Your party whip has been in touch.", choices: [
          { id: "a", label: "Proactively publish all expenses and issue a statement", flags_patch: { transparent: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Stay silent and wait for the story to develop", flags_patch: { silent: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Media Picks Up the Story", text: "Journalists are now running the expenses story. Your office is fielding calls.", choices: [
          { id: "a", label: "Hold a short press briefing and answer questions openly", flags_patch: { press_briefing: true }, next_stage_key: "party_review" },
          { id: "b", label: "Issue a written statement only and decline interviews", flags_patch: { written_only: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Party Whip Demands Answers", text: "The Chief Whip has asked for a full written account of the disputed claims and your explanation.", choices: [
          { id: "a", label: "Provide full account and offer to repay any disputed amounts", flags_patch: { cooperative: true }, next_stage_key: "resolution" },
          { id: "b", label: "Provide a partial account and contest the characterisation", flags_patch: { contested: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Party Reaches a Decision", text: "The party has reviewed the matter. The moderators will communicate the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-lobbyist-hospitality",
      title: "Lobbyist Hospitality",
      category: "financial",
      severity_base: 2,
      time_window_months: 3,
      stages: [
        { key: "rumour", title: "Hospitality Register Scrutinised", text: "A journalist has noted that you attended a private dinner hosted by a major lobbying firm and asks for comment.", choices: [
          { id: "a", label: "Confirm attendance and note it is properly registered", flags_patch: { registered: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Decline to comment", flags_patch: { no_comment: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Lobby Groups Scrutinised", text: "The paper is examining whether the lobbying firm has any interests before Parliament that you have voted on.", choices: [
          { id: "a", label: "Proactively recuse yourself from relevant upcoming votes", flags_patch: { recused: true }, next_stage_key: "party_review" },
          { id: "b", label: "Assert no conflict of interest exists", flags_patch: { denied_conflict: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Ethics Committee Notified", text: "The party's ethics officer has been informed and wants to review the register entry.", choices: [
          { id: "a", label: "Cooperate fully and supply all documentation", flags_patch: { full_cooperation: true }, next_stage_key: "resolution" },
          { id: "b", label: "Provide minimum required information", flags_patch: { minimal_cooperation: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Ethics Review Concluded", text: "The ethics officer's review is complete. The moderators will decide the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-messages-leak",
      title: "Private Messages Leak",
      category: "communications",
      severity_base: 3,
      time_window_months: 3,
      stages: [
        { key: "rumour", title: "Rumours of a Leak", text: "Word has reached you that private communications — possibly WhatsApp messages or emails — have been obtained by a journalist.", choices: [
          { id: "a", label: "Alert your whip and legal team immediately", flags_patch: { informed_whip: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Make discreet enquiries to find the source", flags_patch: { investigating_source: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Messages Published", text: "Several messages have appeared in a newspaper. The content is embarrassing but not conclusively damaging.", choices: [
          { id: "a", label: "Acknowledge the messages and provide context", flags_patch: { contextualised: true }, next_stage_key: "party_review" },
          { id: "b", label: "Question the authenticity of the messages", flags_patch: { disputed_authenticity: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Party Leadership Meeting", text: "You are called in for a conversation with senior party figures.", choices: [
          { id: "a", label: "Be fully candid about the contents and their context", flags_patch: { candid: true }, next_stage_key: "resolution" },
          { id: "b", label: "Maintain that the messages were taken out of context", flags_patch: { context_defence: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Party's Response Agreed", text: "The party has agreed on a response. Moderators will determine the consequences.", choices: [] }
      ]
    },
    {
      id: "tpl-bullying-allegations",
      title: "Bullying Allegations",
      category: "conduct",
      severity_base: 4,
      time_window_months: 5,
      stages: [
        { key: "rumour", title: "Complaint Filed", text: "A member of your staff has filed a formal complaint alleging bullying behaviour. The party's HR process has been triggered.", choices: [
          { id: "a", label: "Engage fully with the HR process and cooperate", flags_patch: { cooperating: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Seek legal advice before responding", flags_patch: { legal_advice: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Story Reaches the Press", text: "The allegation has been reported. Several former staff members have been approached for comment.", choices: [
          { id: "a", label: "Issue a statement expressing regret for any distress caused", flags_patch: { expressed_regret: true }, next_stage_key: "party_review" },
          { id: "b", label: "Strongly deny the allegations and prepare to challenge them", flags_patch: { strong_denial: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Independent Panel Convened", text: "The party has appointed an independent panel to review the complaint.", choices: [
          { id: "a", label: "Submit a written statement and attend any hearing requested", flags_patch: { attended_hearing: true }, next_stage_key: "resolution" },
          { id: "b", label: "Provide written statement only and decline to attend", flags_patch: { declined_attendance: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Panel Report Issued", text: "The independent panel has issued its findings. Moderators will determine the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-undeclared-donation",
      title: "Undeclared Donation",
      category: "financial",
      severity_base: 3,
      time_window_months: 4,
      stages: [
        { key: "rumour", title: "Donation Queried", text: "A journalist has found a donation to your constituency party that does not appear on the electoral register.", choices: [
          { id: "a", label: "Check records urgently and contact the Electoral Commission", flags_patch: { self_reported: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Insist all donations were properly declared", flags_patch: { insists_compliant: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Electoral Commission Enquiry", text: "The Electoral Commission has confirmed it is looking into the matter.", choices: [
          { id: "a", label: "Publish a full statement of all donations received", flags_patch: { published_all: true }, next_stage_key: "party_review" },
          { id: "b", label: "Await the Commission's findings before commenting further", flags_patch: { awaiting_commission: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Party Treasurer Called In", text: "Your party treasurer and you are asked to brief party leadership.", choices: [
          { id: "a", label: "Present a full and transparent account of all donations", flags_patch: { full_account: true }, next_stage_key: "resolution" },
          { id: "b", label: "Argue the matter is procedural and will be resolved administratively", flags_patch: { procedural_defence: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Commission Conclusion", text: "The Electoral Commission has completed its review. Moderators will decide the consequences.", choices: [] }
      ]
    },
    {
      id: "tpl-media-sting",
      title: "Media Sting Operation",
      category: "conduct",
      severity_base: 4,
      time_window_months: 3,
      stages: [
        { key: "rumour", title: "Contact from Undercover Reporter", text: "You receive an approach from someone claiming to represent a foreign business. You are later told by a source it may be a sting operation.", choices: [
          { id: "a", label: "Immediately alert your whip and do not take the meeting", flags_patch: { alerted_whip: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Attend the initial meeting to assess what is being asked", flags_patch: { attended_meeting: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Footage or Recording Published", text: "A newspaper publishes an account of the meeting. How you handled it shapes the narrative.", choices: [
          { id: "a", label: "Confirm you identified the approach as suspicious and acted accordingly", flags_patch: { proactive_response: true }, next_stage_key: "party_review" },
          { id: "b", label: "Issue a statement that your conduct was entirely proper", flags_patch: { proper_conduct_claimed: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Parliamentary Standards Notified", text: "The party has notified the Parliamentary Standards Commissioner as a precaution.", choices: [
          { id: "a", label: "Cooperate proactively with any Standards enquiry", flags_patch: { standards_cooperation: true }, next_stage_key: "resolution" },
          { id: "b", label: "Await formal notification before engaging", flags_patch: { awaiting_formal: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Standards Process Concluded", text: "The Standards process has concluded. Moderators will communicate the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-conflict-of-interest",
      title: "Conflict of Interest",
      category: "financial",
      severity_base: 3,
      time_window_months: 4,
      stages: [
        { key: "rumour", title: "Shareholding Discovered", text: "A researcher has identified that you hold shares in a company directly affected by legislation you voted on.", choices: [
          { id: "a", label: "Sell the shares and update the register immediately", flags_patch: { divested: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Review the register entry and consult the registrar", flags_patch: { consulting_registrar: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Media Questions Voting Record", text: "Journalists are examining each vote where the shareholding could be seen as relevant.", choices: [
          { id: "a", label: "Publish a full statement explaining each vote", flags_patch: { votes_explained: true }, next_stage_key: "party_review" },
          { id: "b", label: "Deny any impropriety and stand by your voting record", flags_patch: { record_defended: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Party Ethics Review", text: "The party ethics officer is conducting a formal review of the register entries and voting record.", choices: [
          { id: "a", label: "Submit all relevant documentation voluntarily", flags_patch: { submitted_voluntarily: true }, next_stage_key: "resolution" },
          { id: "b", label: "Await a formal request before providing documents", flags_patch: { awaiting_request: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Ethics Review Outcome", text: "The ethics review is complete. Moderators will determine the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-faction-leak",
      title: "Faction Internal Leak",
      category: "party",
      severity_base: 2,
      time_window_months: 3,
      stages: [
        { key: "rumour", title: "Party Strategy Leaked", text: "Details of a private faction meeting you attended have appeared in the press. Leadership wants to know the source.", choices: [
          { id: "a", label: "Assist leadership in identifying the source", flags_patch: { assisting: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Deny being the source and say nothing further", flags_patch: { denied: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Your Name Linked to Leak", text: "A journalist has suggested you may have been the source of the leak.", choices: [
          { id: "a", label: "Voluntarily speak to party officials to clear your name", flags_patch: { volunteered: true }, next_stage_key: "party_review" },
          { id: "b", label: "Issue a flat denial through your spokesperson", flags_patch: { flat_denial: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Party Disciplinary Process", text: "The party is conducting an internal disciplinary review.", choices: [
          { id: "a", label: "Cooperate fully and provide any evidence requested", flags_patch: { full_cooperation: true }, next_stage_key: "resolution" },
          { id: "b", label: "Provide a written statement and decline further comment", flags_patch: { written_only: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Disciplinary Decision", text: "The disciplinary process has concluded. Moderators will communicate the decision.", choices: [] }
      ]
    },
    {
      id: "tpl-plagiarised-speech",
      title: "Plagiarised Speech",
      category: "conduct",
      severity_base: 2,
      time_window_months: 2,
      stages: [
        { key: "rumour", title: "Speech Similarities Noted", text: "A sharp-eyed academic has posted on a forum that parts of your recent conference speech closely mirror a speech given by a US politician.", choices: [
          { id: "a", label: "Acknowledge the overlap and explain it was inadvertent", flags_patch: { acknowledged: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Argue the ideas are common currency and the comparison is unfair", flags_patch: { disputed: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Media Runs the Comparison", text: "Side-by-side comparisons are circulating on social media and in broadsheet columns.", choices: [
          { id: "a", label: "Issue a full apology and commit to reviewing speech-writing processes", flags_patch: { full_apology: true }, next_stage_key: "party_review" },
          { id: "b", label: "Say the speech drew on shared progressive values, not specific text", flags_patch: { deflected: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Communications Director Review", text: "The party's communications director wants to discuss speech-writing and attribution protocols.", choices: [
          { id: "a", label: "Agree to new oversight procedures for future speeches", flags_patch: { accepted_oversight: true }, next_stage_key: "resolution" },
          { id: "b", label: "Note the concern but maintain your speech-writing autonomy", flags_patch: { maintained_autonomy: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Matter Resolved or Noted", text: "The party's communications team has concluded its review. Moderators decide the impact.", choices: [] }
      ]
    },
    {
      id: "tpl-resources-misuse",
      title: "Parliamentary Resources Misuse",
      category: "financial",
      severity_base: 3,
      time_window_months: 4,
      stages: [
        { key: "rumour", title: "Staffing Query", text: "Questions are being asked about whether parliamentary staff or resources were used for party-political or personal activities.", choices: [
          { id: "a", label: "Commission an internal audit of office resource usage", flags_patch: { audit_ordered: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Deny any misuse and stand by your office management", flags_patch: { denied: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "IPSA Enquiry Reported", text: "The Independent Parliamentary Standards Authority has confirmed it is looking at your case.", choices: [
          { id: "a", label: "Publish audit findings and cooperate with IPSA", flags_patch: { published_audit: true }, next_stage_key: "party_review" },
          { id: "b", label: "Await IPSA's formal notification before taking action", flags_patch: { awaiting_ipsa: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Chief Whip Called In", text: "The Chief Whip has requested a full briefing on the matter.", choices: [
          { id: "a", label: "Brief the whip in full and offer to return any disputed amounts", flags_patch: { full_briefing: true }, next_stage_key: "resolution" },
          { id: "b", label: "Maintain that all resource use was within the rules", flags_patch: { within_rules: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "IPSA and Party Decision", text: "Both IPSA and the party have concluded their reviews. Moderators will determine the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-foreign-trip-funding",
      title: "Foreign Trip Funding",
      category: "financial",
      severity_base: 3,
      time_window_months: 4,
      stages: [
        { key: "rumour", title: "Trip Costs Questioned", text: "A freedom-of-information request has surfaced questions about who funded a trip you made to a foreign country.", choices: [
          { id: "a", label: "Voluntarily publish full details of the trip and its funding", flags_patch: { self_disclosed: true }, next_stage_key: "media_interest" },
          { id: "b", label: "State the trip was properly registered and leave it there", flags_patch: { registered_claim: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Funding Source Identified", text: "The press has identified the funding source. Questions are being asked about the nature of the relationship.", choices: [
          { id: "a", label: "Provide a detailed account of all meetings and discussions during the trip", flags_patch: { full_account: true }, next_stage_key: "party_review" },
          { id: "b", label: "Describe the trip as a standard diplomatic engagement", flags_patch: { framed_as_diplomatic: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Foreign Affairs Committee Notified", text: "The committee has been notified and the party is conducting a separate internal review.", choices: [
          { id: "a", label: "Cooperate with both the committee and internal review", flags_patch: { dual_cooperation: true }, next_stage_key: "resolution" },
          { id: "b", label: "Engage with one process at a time and await formal requests", flags_patch: { sequential_engagement: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Reviews Concluded", text: "Both reviews have been completed. Moderators will communicate the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-campaign-finance",
      title: "Campaign Finance Irregularity",
      category: "financial",
      severity_base: 4,
      time_window_months: 5,
      stages: [
        { key: "rumour", title: "Return Filing Queried", text: "Your election return is being examined after a local party member raised concerns about undisclosed contributions.", choices: [
          { id: "a", label: "Self-report to the Electoral Commission immediately", flags_patch: { self_reported: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Seek legal advice and await formal notification", flags_patch: { legal_advice: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Electoral Commission Formal Notice", text: "The Electoral Commission has issued a formal notice requesting clarification.", choices: [
          { id: "a", label: "Respond fully within the deadline and publish the response", flags_patch: { responded_publicly: true }, next_stage_key: "party_review" },
          { id: "b", label: "Respond to the Commission only, not publicly", flags_patch: { responded_privately: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Party Central Office Involved", text: "Central Office has become involved given the potential reputational impact.", choices: [
          { id: "a", label: "Work openly with Central Office to resolve any issues", flags_patch: { central_office_cooperation: true }, next_stage_key: "resolution" },
          { id: "b", label: "Handle the matter independently and brief Central Office after", flags_patch: { independent_handling: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Electoral Commission Decision", text: "The Electoral Commission has issued its findings. Moderators will determine the consequences.", choices: [] }
      ]
    },
    {
      id: "tpl-staff-relationship",
      title: "Staff Relationship Allegation",
      category: "conduct",
      severity_base: 3,
      time_window_months: 4,
      stages: [
        { key: "rumour", title: "Allegation Made", text: "A current or former member of your team has raised concerns about the nature of your relationship with them.", choices: [
          { id: "a", label: "Engage the party's confidential HR process immediately", flags_patch: { engaged_hr: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Strongly deny the allegation and consult a solicitor", flags_patch: { denial_legal: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Allegation Reported", text: "The allegation has appeared in a newspaper. The paper is seeking further corroboration.", choices: [
          { id: "a", label: "Make a brief public statement and let the HR process take its course", flags_patch: { public_statement: true }, next_stage_key: "party_review" },
          { id: "b", label: "Say nothing publicly pending the HR process", flags_patch: { silence: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Independent HR Review", text: "An independent reviewer has been appointed to look at the allegation.", choices: [
          { id: "a", label: "Cooperate fully and submit to any interview requested", flags_patch: { full_cooperation: true }, next_stage_key: "resolution" },
          { id: "b", label: "Provide written submissions only", flags_patch: { written_only: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "HR Review Outcome", text: "The independent review is complete. Moderators will communicate the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-hot-mic",
      title: "Hot Mic Comment",
      category: "communications",
      severity_base: 2,
      time_window_months: 2,
      stages: [
        { key: "rumour", title: "Recording Surfaces", text: "An audio clip is circulating that appears to capture you making an unguarded comment that could be construed as offensive or impolitic.", choices: [
          { id: "a", label: "Get ahead of the story with an immediate apology", flags_patch: { immediate_apology: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Question the context and accuracy of the clip", flags_patch: { context_challenged: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Clip Goes Viral", text: "The clip has been widely shared. Commentators are divided on its significance.", choices: [
          { id: "a", label: "Give a broadcast interview to clarify your remarks and apologise", flags_patch: { broadcast_apology: true }, next_stage_key: "party_review" },
          { id: "b", label: "Issue a written statement and decline broadcast interviews", flags_patch: { written_statement: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Communications Team Review", text: "The party's communications team wants to discuss the incident and your media handling.", choices: [
          { id: "a", label: "Engage constructively and agree to a media handling protocol", flags_patch: { agreed_protocol: true }, next_stage_key: "resolution" },
          { id: "b", label: "Note the concern and assert you will handle future situations independently", flags_patch: { independence_asserted: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Party Decides Next Steps", text: "The party has reached a view on the incident. Moderators will determine the outcome.", choices: [] }
      ]
    },
    {
      id: "tpl-protest-backlash",
      title: "Protest Backlash",
      category: "political",
      severity_base: 2,
      time_window_months: 3,
      stages: [
        { key: "rumour", title: "Constituency Protest Planned", text: "A group of constituents is organising a protest outside your surgery in response to your stance on a local issue.", choices: [
          { id: "a", label: "Invite protest organisers to a meeting to discuss their concerns", flags_patch: { invited_dialogue: true }, next_stage_key: "media_interest" },
          { id: "b", label: "Issue a statement defending your position", flags_patch: { position_defended: true }, next_stage_key: "media_interest" }
        ]},
        { key: "media_interest", title: "Protest Covered in Local Press", text: "The protest attracted media coverage. Your response is now part of the story.", choices: [
          { id: "a", label: "Attend the protest area and speak directly with demonstrators", flags_patch: { direct_engagement: true }, next_stage_key: "party_review" },
          { id: "b", label: "Continue to engage via written and social media channels only", flags_patch: { remote_engagement: true }, next_stage_key: "party_review" }
        ]},
        { key: "party_review", title: "Party Assesses Local Impact", text: "The party's local campaigning team is assessing the impact on your standing in the constituency.", choices: [
          { id: "a", label: "Accept party support for a local community engagement programme", flags_patch: { accepted_support: true }, next_stage_key: "resolution" },
          { id: "b", label: "Continue to handle the matter independently", flags_patch: { independent: true }, next_stage_key: "resolution" }
        ]},
        { key: "resolution", title: "Local Situation Assessment", text: "The party has assessed the local situation. Moderators will decide the political impact.", choices: [] }
      ]
    }
  ];

  for (const t of templates) {
    await pool.query(
      `INSERT INTO scandal_templates (id, title, category, severity_base, time_window_months, stages)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.title, t.category, t.severity_base, t.time_window_months, JSON.stringify(t.stages)]
    );
  }
}

/**
 * Seed the 1996–97 baseline budget figures.  Idempotent by default:
 * does nothing if last_year is already set, unless force=true.
 */
async function seedBudgetBaseline(force = false) {
  if (!force) {
    const { rows } = await pool.query(`SELECT last_year FROM budget_data WHERE id = 'main'`);
    if (rows.length && rows[0].last_year !== null) return; // already seeded
  }
  const lastYear = {
    label: "1996–97 Baseline",
    gdp: 1930,
    revenues: {
      "Income Tax": 102.65,
      "Corporate Tax": 34.74,
      "Value Added Tax": 92.17,
      "National Insurance": 66.62,
      "Fuel Duty": 23.28,
      "Stamp Duty": 9.96,
      "Business Rate Appropriations": 14.14,
    },
    expenditures: {
      "Health": 40.96,
      "Social Security": 59.42,
      "Education": 88.10,
      "Home Office": 34.94,
      "Ministry of Defense": 34.11,
      "Transport": 18.69,
      "Local Government": 61.21,
      "Environment": 6.54,
      "Energy": 5.58,
      "Culture": 0.06,
      "Housing": -2.45,
      "Business": -5.50,
      "Scottish Office": 21.14,
      "Welsh Office": 7.10,
      "Northern Ireland Office": 3.58,
    },
    capital: { "Capital Expenditure": 35.21 },
  };
  const currentYear = {
    label: "1997–98 (Seeded Baseline)",
    gdp: 1950,
    revenues: {
      "Income Tax": 104.40,
      "Corporate Tax": 36.10,
      "Value Added Tax": 93.20,
      "National Insurance": 67.15,
      "Fuel Duty": 24.04,
      "Stamp Duty": 12.81,
      "Business Rate Appropriations": 15.96,
    },
    expenditures: {
      "Health": 42.10,
      "Social Security": 60.20,
      "Education": 89.24,
      "Home Office": 29.25,
      "Ministry of Defense": 34.53,
      "Transport": 15.96,
      "Local Government": 63.98,
      "Environment": 6.67,
      "Energy": 5.58,
      "Culture": 0.01,
      "Housing": -11.88,
      "Business": 2.88,
      "Scottish Office": 22.51,
      "Welsh Office": 7.55,
      "Northern Ireland Office": 3.27,
    },
    capital: { "Capital Expenditure": 14.14 },
  };
  const adminControls = {
    debtInterestPercent: 7.20,
    debtInterestExpenditure: 31.11,
    charityReliefExpenditure: 0.41,
    otherExpensesExpenditure: -0.66,
  };
  await pool.query(
    `INSERT INTO budget_data (id, last_year, current_year, admin_controls, archive, pending, updated_at)
     VALUES ('main', $1::jsonb, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL, NOW())
     ON CONFLICT (id) DO UPDATE SET
       last_year      = EXCLUDED.last_year,
       current_year   = EXCLUDED.current_year,
       admin_controls = EXCLUDED.admin_controls,
       archive        = EXCLUDED.archive,
       pending        = NULL,
       updated_at     = NOW()`,
    [JSON.stringify(lastYear), JSON.stringify(currentYear), JSON.stringify(adminControls)]
  );
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
const CSRF_EXEMPT_PATHS = new Set([
  "/auth/login",
  "/api/auth/login",
  "/api/register",
  "/api/auth/resend-verification", // no session exists when resending a verification email
]);

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

function requireAdminOrMod(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not logged in" });
    return false;
  }
  const roles = Array.isArray(req.session.roles) ? req.session.roles : [];
  if (!roles.includes("admin") && !roles.includes("mod")) {
    res.status(403).json({ error: "Forbidden: admin or mod role required" });
    return false;
  }
  return true;
}

function requireAdminModOrSpeaker(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not logged in" });
    return false;
  }
  const roles = Array.isArray(req.session.roles) ? req.session.roles : [];
  if (!roles.includes("admin") && !roles.includes("mod") && !roles.includes("speaker")) {
    res.status(403).json({ error: "Forbidden: admin, mod, or speaker role required" });
    return false;
  }
  return true;
}

/**
 * Returns true if destructive seed/wipe/initialize endpoints are allowed.
 * These are only permitted outside production, or when ENABLE_DEV_SEED=true
 * is explicitly set (e.g. for staging environments that need seeding).
 */
function isDevSeedAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_SEED === "true";
}

/**
 * Normalise Discourse fields on entity objects returned by API endpoints.
 * Ensures discourse_topic_id and discourse_topic_url are always present
 * (even if null) so the UI can reliably check them without extra guards.
 * Also promotes legacy camelCase aliases so both forms are available.
 * Merges any legacy discourseTopicId/discourseTopicUrl into the canonical
 * `debate` object (topicId, topicUrl, opensAtSim, closesAtSim).
 */
function normaliseDiscourseFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const topicId  = obj.discourse_topic_id  ?? obj.discourseTopicId  ?? obj.debate?.topicId  ?? null;
  const topicUrl = obj.discourse_topic_url ?? obj.discourseTopicUrl ?? obj.debate?.topicUrl ?? obj.debateUrl ?? null;
  const existingDebate = obj.debate && typeof obj.debate === "object" ? obj.debate : {};
  return {
    ...obj,
    // snake_case (canonical API format)
    discourse_topic_id:  topicId,
    discourse_topic_url: topicUrl,
    // camelCase aliases (legacy client-side format)
    discourseTopicId:  topicId,
    discourseTopicUrl: topicUrl,
    // canonical debate object — always present with at least null fields
    debate: {
      topicId:     topicId,
      topicUrl:    topicUrl,
      opensAtSim:  existingDebate.opensAtSim  ?? null,
      closesAtSim: existingDebate.closesAtSim ?? null,
    },
  };
}

/**
 * Write an entry to the audit_log table.
 * Includes before/after JSON snapshots where provided.
 * Non-fatal: errors are logged but do not abort the request.
 */
async function writeAuditLog(actorId, action, entityType, entityId, beforeJson, afterJson) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, target, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        actorId,
        action,
        `${entityType}:${entityId}`,
        JSON.stringify({ entityType, entityId, before: beforeJson ?? null, after: afterJson ?? null }),
      ]
    );
  } catch (err) {
    console.error("[audit] write failed:", err.message);
  }
}

/**
 * Attach standardised content lifecycle fields to any content object.
 * Existing values are preserved; missing fields are filled with safe defaults.
 *
 * Lifecycle fields:
 *   createdAtSim   – { month, year } simulation date of creation
 *   createdAtReal  – real UTC ISO timestamp
 *   status         – "draft" | "open" | "closed" | "archived"
 *   visibility     – "public" | "party" | "cabinet" | "mod"
 *   autoArchiveAfterSimMonths – integer months after creation or null
 *   debate         – { topicId, topicUrl, opensAtSim, closesAtSim }
 */
function attachLifecycle(obj, simMonth, simYear, realNow) {
  const now = realNow || new Date().toISOString();
  const defaults = {
    createdAtSim: { month: simMonth ?? 8, year: simYear ?? 1997 },
    createdAtReal: now,
    status: "open",
    visibility: "public",
    autoArchiveAfterSimMonths: null,
    debate: { topicId: null, topicUrl: null, opensAtSim: null, closesAtSim: null },
  };
  return { ...defaults, ...obj,
    createdAtSim:  obj.createdAtSim  ?? defaults.createdAtSim,
    createdAtReal: obj.createdAtReal ?? defaults.createdAtReal,
    status:        obj.status        ?? defaults.status,
    visibility:    obj.visibility    ?? defaults.visibility,
    autoArchiveAfterSimMonths: obj.autoArchiveAfterSimMonths !== undefined
      ? obj.autoArchiveAfterSimMonths
      : defaults.autoArchiveAfterSimMonths,
    debate: obj.debate ? { ...defaults.debate, ...obj.debate } : defaults.debate,
  };
}

/**
 * Add n simulation months to a (year, month) pair, rolling year over.
 * Returns { sim_year, sim_month }.
 */
function addSimMonths(year, month, n) {
  const total = (month - 1) + n;
  return {
    sim_year:  year + Math.floor(total / 12),
    sim_month: (total % 12) + 1,
  };
}

/**
 * Resolve the active character UUID for the logged-in user.
 * Uses req.session.characterId if set and still valid, otherwise queries the DB.
 * Returns null if none found.
 */
async function getActiveCharacterId(req) {
  // Prefer session cache if it still points to a valid active character owned by this user
  if (req.session.characterId) {
    const { rows: check } = await pool.query(
      `SELECT id FROM characters WHERE id = $1 AND user_id = $2 AND is_active = true LIMIT 1`,
      [req.session.characterId, req.session.userId]
    );
    if (check.length) return check[0].id;
    // Stale/invalid — clear from session so DB canonical pointer is used going forward
    req.session.characterId = null;
  }
  // DB canonical pointer: users.active_character_id
  const { rows: ptr } = await pool.query(
    `SELECT c.id FROM users u
       JOIN characters c ON c.id = u.active_character_id
      WHERE u.id = $1 AND c.user_id = $1 AND c.is_active = TRUE
      LIMIT 1`,
    [req.session.userId]
  );
  if (ptr.length) return ptr[0].id;
  // Fallback: find any active character owned by this user (e.g. if pointer is not yet set)
  const { rows } = await pool.query(
    `SELECT id FROM characters WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
    [req.session.userId]
  );
  return rows.length ? rows[0].id : null;
}

/**
 * Load and decrypt Discourse credentials from app_config.
 * Returns { baseUrl, apiKey, apiUsername } or throws if not configured.
 */
async function loadDiscourseCredentials() {
  const { rows } = await pool.query(
    "SELECT key, value FROM app_config WHERE key IN ('discourse_base_url','discourse_api_key','discourse_api_username')"
  );
  const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const baseUrl     = (cfg.discourse_base_url || "").trim().replace(/\/$/, "");
  const apiKey      = cfg.discourse_api_key      ? discourseDecrypt(cfg.discourse_api_key)      : "";
  const apiUsername = cfg.discourse_api_username ? discourseDecrypt(cfg.discourse_api_username) : "";
  if (!baseUrl)     throw Object.assign(new Error("Discourse base URL not configured"),     { status: 400 });
  if (!apiKey)      throw Object.assign(new Error("Discourse API key not configured"),      { status: 400 });
  if (!apiUsername) throw Object.assign(new Error("Discourse API username not configured"), { status: 400 });
  return { baseUrl, apiKey, apiUsername };
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
 * GET /api/csrf-token — authenticated: returns (or creates) the CSRF token for the current session
 * GET /csrf-token    — legacy alias (backward-compatible)
 */
app.get(["/csrf-token", "/api/csrf-token"], (req, res) => {
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
 * POST /api/auth/login   — canonical
 * GET  /api/auth/me      — canonical
 * POST /api/auth/logout  — canonical
 * GET  /api/auth/verify-email?token=… — canonical (verify registration email token)
 * POST /api/auth/resend-verification  — canonical (re-send verification email)
 * Legacy aliases without /api prefix remain for backward compatibility.
 */

const authLimit = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post(["/auth/login", "/api/auth/login"], authLimit, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Missing email or password" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { rows } = await pool.query(
      "SELECT id, username, email, password_hash, roles, email_verified FROM users WHERE email = $1",
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

    // Require email verification
    if (!user.email_verified) {
      return res.status(403).json({ ok: false, error: "Please verify your email address before logging in. Check your inbox for a verification link, or visit the login page to request a new one." });
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

app.get(["/auth/me", "/api/auth/me"], authLimit, async (req, res) => {
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

app.post(["/auth/logout", "/api/auth/logout"], authLimit, (req, res) => {
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
 * REGISTRATION
 * POST /api/register            — public, rate-limited, CSRF-exempt
 * GET  /api/admin/registrations — admin only: list pending applications
 * POST /api/admin/registrations/:id/approve — admin only
 * POST /api/admin/registrations/:id/reject  — admin only
 */
const registerLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/;

app.post("/api/register", registerLimit, async (req, res) => {
  try {
    const { name, username, email, password, age_attested, marketing_opt_in, turnstile_token } = req.body || {};

    // Validate required fields
    if (!name || !username || !email || !password) {
      return res.status(400).json({ ok: false, error: "All fields are required." });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ ok: false, error: "Username must be 3–30 characters: letters, numbers, underscores, or hyphens only." });
    }
    if (typeof email !== "string" || !email.includes("@") || email.length > 254) {
      return res.status(400).json({ ok: false, error: "A valid email address is required." });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    }
    if (!age_attested) {
      return res.status(400).json({ ok: false, error: "You must confirm you are 16 or older." });
    }

    // Verify Turnstile token (if enabled)
    const remoteIp = req.ip || req.headers["x-forwarded-for"] || "";
    const turnstileOk = await verifyTurnstileToken(turnstile_token, remoteIp);
    if (!turnstileOk) {
      return res.status(400).json({ ok: false, error: "Anti-bot check failed. Please try again." });
    }

    const normalizedEmail    = email.toLowerCase().trim();
    const normalizedUsername = username.trim();
    const displayName        = String(name).trim().slice(0, 100);
    const optIn              = Boolean(marketing_opt_in);

    // Hash password before any DB checks to avoid timing side-channels leaking existence
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate a single-use email verification token (expires in 24 h)
    const verificationToken    = randomBytes(32).toString("hex");
    const verificationTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const REGISTRATION_SUCCESS_MSG = "Your application has been submitted. Please check your email to verify your address, then wait for admin approval before logging in.";

    // Check for a pre-existing registration or user account with this email.
    // Done before the INSERT so we can give a meaningful response instead of
    // silently swallowing a unique-constraint violation.
    const [pendingRes, userRes] = await Promise.all([
      pool.query(
        `SELECT id, status, email_verified, email_verification_token
           FROM pending_registrations WHERE email = $1`,
        [normalizedEmail]
      ),
      pool.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]),
    ]);

    if (pendingRes.rows.length > 0) {
      const prev = pendingRes.rows[0];
      if (prev.status === "rejected") {
        // Previous application was rejected — remove it so the user can apply again.
        await pool.query(`DELETE FROM pending_registrations WHERE id = $1`, [prev.id]);
        // Fall through to insert a fresh registration below.
      } else if (prev.status === "pending") {
        // Application already under review — resend verification email if not yet verified.
        // Fire-and-forget: same deliberate pattern used for the first-send below; we must
        // not block the response waiting for email delivery, and any failure is non-fatal.
        if (!prev.email_verified && prev.email_verification_token) {
          sendVerificationEmail(normalizedEmail, prev.email_verification_token).catch((e) =>
            console.error("[email] resend failed:", e)
          );
        }
        return res.json({ ok: true, message: REGISTRATION_SUCCESS_MSG });
      } else {
        // status === "approved": account already exists — return deliberate vague success
        // to avoid leaking account existence.
        return res.json({ ok: true, message: REGISTRATION_SUCCESS_MSG });
      }
    } else if (userRes.rows.length > 0) {
      // Email already has a user account (e.g. added directly by an admin).
      // Return deliberate vague success to avoid email enumeration.
      return res.json({ ok: true, message: REGISTRATION_SUCCESS_MSG });
    }

    // Insert the new application — unique constraint on username is the only remaining
    // conflict possible here (email was already checked above).
    try {
      await pool.query(
        `INSERT INTO pending_registrations
           (email, username, display_name, password_hash, age_attested, consent_version, consent_at,
            marketing_opt_in, marketing_opt_in_at,
            email_verification_token, email_verification_token_exp)
         VALUES ($1, $2, $3, $4, TRUE, 1, NOW(),
                 $5, CASE WHEN $5 THEN NOW() ELSE NULL END,
                 $6, $7)`,
        [normalizedEmail, normalizedUsername, displayName, passwordHash,
         optIn, verificationToken, verificationTokenExp]
      );
    } catch (dbErr) {
      if (dbErr.code === "23505") {
        // Username already taken — safe to reveal without leaking email existence.
        return res.status(409).json({ ok: false, error: "Username is already taken. Please choose a different username." });
      }
      throw dbErr;
    }

    // Send verification email (fire-and-forget — do not block the response)
    sendVerificationEmail(normalizedEmail, verificationToken).catch((e) =>
      console.error("[email] verification send failed:", e)
    );

    return res.json({ ok: true, message: REGISTRATION_SUCCESS_MSG });
  } catch (e) {
    console.error("[register]", e);
    res.status(500).json({ ok: false, error: "Server error. Please try again later." });
  }
});

const regAdminLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

const verifyEmailLimit = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

/**
 * GET /api/auth/verify-email?token=...
 * Verifies the email address associated with a pending registration token.
 * Marks email_verified=true and stores verified_at.
 */
app.get("/api/auth/verify-email", verifyEmailLimit, async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== "string" || token.length > 128) {
    return res.status(400).json({ ok: false, error: "Invalid or missing token." });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, email, status, email_verified, email_verification_token_exp
         FROM pending_registrations
        WHERE email_verification_token = $1
          AND status IN ('pending', 'approved')`,
      [token]
    );
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "Invalid or expired verification link." });
    }
    const reg = rows[0];
    if (reg.email_verified) {
      return res.json({ ok: true, message: "Email already verified." });
    }
    if (reg.email_verification_token_exp && new Date(reg.email_verification_token_exp) < new Date()) {
      return res.status(400).json({ ok: false, error: "Verification link has expired. Please request a new one." });
    }
    await pool.query(
      `UPDATE pending_registrations
          SET email_verified = TRUE,
              email_verified_at = NOW(),
              email_verification_token = NULL,
              email_verification_token_exp = NULL
        WHERE id = $1`,
      [reg.id]
    );
    // Also mark verified on the users table if already approved
    await pool.query(
      `UPDATE users
          SET email_verified = TRUE, email_verified_at = NOW()
        WHERE email = $1`,
      [reg.email]
    );
    // Tailor message based on application status
    const successMsg = reg.status === "approved"
      ? "Email verified successfully. You can now log in."
      : "Email verified successfully. Your application is awaiting admin approval — you will be able to log in once approved.";
    return res.json({ ok: true, message: successMsg });
  } catch (e) {
    console.error("[verify-email]", e);
    res.status(500).json({ ok: false, error: "Server error." });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resends the verification email (rate-limited, non-disclosing).
 */
const resendVerifyLimit = rateLimit({ windowMs: 60 * 60_000, max: 3, standardHeaders: true, legacyHeaders: false });

app.post("/api/auth/resend-verification", resendVerifyLimit, async (req, res) => {
  const genericOk = { ok: true, message: "If your email is pending verification, a new link has been sent." };
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") return res.json(genericOk);
    const normalizedEmail = email.toLowerCase().trim();

    const { rows } = await pool.query(
      `SELECT id, email, email_verified, verification_resent_at
         FROM pending_registrations
        WHERE email = $1 AND status = 'pending'`,
      [normalizedEmail]
    );
    if (!rows.length) return res.json(genericOk); // do not reveal existence

    const reg = rows[0];
    if (reg.email_verified) return res.json(genericOk);

    // Rate-limit resends: minimum 5 minutes between resends
    if (reg.verification_resent_at) {
      const elapsed = Date.now() - new Date(reg.verification_resent_at).getTime();
      if (elapsed < 5 * 60_000) return res.json(genericOk);
    }

    const newToken    = randomBytes(32).toString("hex");
    const newTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE pending_registrations
          SET email_verification_token     = $1,
              email_verification_token_exp = $2,
              verification_resent_at       = NOW()
        WHERE id = $3`,
      [newToken, newTokenExp, reg.id]
    );

    sendVerificationEmail(normalizedEmail, newToken).catch((e) =>
      console.error("[email] resend failed:", e)
    );
    return res.json(genericOk);
  } catch (e) {
    console.error("[resend-verification]", e);
    return res.json(genericOk); // always generic
  }
});

app.get("/api/admin/registrations", regAdminLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const status = req.query.status || "pending";
    const { rows } = await pool.query(
      `SELECT id, email, username, display_name, age_attested, consent_version, consent_at,
              status, reviewed_by, reviewed_at, created_at, email_verified
         FROM pending_registrations
        WHERE status = $1
        ORDER BY created_at ASC`,
      [status]
    );
    res.json({ ok: true, registrations: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/registrations/:id/approve", regAdminLimit, verifyCsrfToken, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM pending_registrations WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Registration not found or already reviewed." });
    const reg = rows[0];

    // Guard: if a user account already exists for this email (e.g. the applicant was
    // previously registered by another route), skip creating a duplicate.
    const { rows: existingUsers } = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [reg.email]
    );

    let userId;
    if (existingUsers.length > 0) {
      // An account already exists for this email (e.g. added directly by an admin or via a
      // previous approval that left the pending row un-cleaned).  Reuse it rather than
      // attempting a duplicate INSERT.  The existing account's credentials and roles are
      // preserved — the password_hash from this registration is intentionally discarded.
      userId = existingUsers[0].id;
    } else {
      // Create the user account (carry over email_verified from pending registration)
      userId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, username, email, password_hash, roles, email_verified, email_verified_at)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6)`,
        [userId, reg.username, reg.email, reg.password_hash,
         reg.email_verified || false, reg.email_verified_at || null]
      );
    }

    // Mark registration as approved
    await pool.query(
      `UPDATE pending_registrations
          SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
        WHERE id = $2`,
      [req.session.userId, id]
    );

    // Audit log
    pool.query(
      `INSERT INTO audit_log (actor_id, action, target, details) VALUES ($1, $2, $3, $4::jsonb)`,
      [req.session.userId, "registration-approved", reg.email, JSON.stringify({ userId, username: reg.username })]
    ).catch((e) => console.error("audit-log failed:", e));

    res.json({ ok: true, userId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/registrations/:id/reject", regAdminLimit, verifyCsrfToken, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    if (!Array.isArray(req.session.roles) || !req.session.roles.includes("admin")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT email, username FROM pending_registrations WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Registration not found or already reviewed." });
    const reg = rows[0];

    await pool.query(
      `UPDATE pending_registrations
          SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
        WHERE id = $2`,
      [req.session.userId, id]
    );

    pool.query(
      `INSERT INTO audit_log (actor_id, action, target, details) VALUES ($1, $2, $3, $4::jsonb)`,
      [req.session.userId, "registration-rejected", reg.email, JSON.stringify({ username: reg.username })]
    ).catch((e) => console.error("audit-log failed:", e));

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
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
    const roles = Array.isArray(req.session.roles) ? req.session.roles : [];
    if (!roles.includes("admin") && !roles.includes("mod") && !roles.includes("speaker")) {
      return res.status(403).json({ error: "Forbidden: admin, mod, or speaker role required" });
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
 * GET /api/config/enums — public (but requires auth); returns canonical enum arrays
 * for all dropdown fields used in character creation/editing.
 * This is the single source of truth for option values so UI and server always agree.
 */
const enumsReadLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
app.get("/api/config/enums", enumsReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    // Affiliations come from DB (so any catalog updates are reflected immediately)
    const { rows: affRows } = await pool.query(
      `SELECT id, category, name, monthly_fee FROM affiliations_catalog WHERE active = TRUE ORDER BY category, name`
    );
    // Group by category
    const affByCategory = {};
    for (const r of affRows) {
      (affByCategory[r.category] ??= []).push({ id: r.id, name: r.name, monthlyFee: Number(r.monthly_fee) });
    }
    const affiliationOptions = Object.entries(affByCategory).map(([category, items]) => ({ category, items }));
    res.json({
      homeTypes:              ENUM_HOME_TYPES,
      rentalTypes:            ENUM_RENTAL_TYPES,
      rentalTypesResidential: ENUM_RENTAL_TYPES_RESIDENTIAL,
      rentalTypesCommercial:  ENUM_RENTAL_TYPES_COMMERCIAL,
      rentalStatuses:         ENUM_RENTAL_STATUSES,
      educationOptions:       ENUM_EDUCATION_OPTIONS,
      careerOptions:          ENUM_CAREER_OPTIONS,
      familyOptions:          ENUM_FAMILY_OPTIONS,
      financialLevels:        ENUM_FINANCIAL_LEVELS,
      affiliationOptions,
    });
  } catch (e) {
    console.error("[GET /api/config/enums]", e);
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
      const id = randomUUID();
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
 * POST   /api/bills          — authenticated: create a bill
 * PUT    /api/bills/:id      — admin/mod: update a bill
 * DELETE /api/bills/:id      — admin/mod/speaker: delete a bill
 */

const crudReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const crudWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/bills", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, updated_at FROM bills ORDER BY updated_at DESC");
    res.json({ bills: rows.map((r) => normaliseDiscourseFields({ ...r.data, _updatedAt: r.updated_at })) });
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
    res.json({ bill: normaliseDiscourseFields({ ...rows[0].data, _updatedAt: rows[0].updated_at }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/bills", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const bill = req.body;
    if (!bill || typeof bill !== "object" || !bill.id) {
      return res.status(400).json({ error: "Body must be a bill object with an id" });
    }
    const { rows: clk } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const enriched = attachLifecycle({ ...bill }, sm, sy);
    const { rows } = await pool.query(
      `INSERT INTO bills (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [enriched.id, JSON.stringify(enriched)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/bills/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
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
  const client = await pool.connect();
  try {
    if (!requireAdminModOrSpeaker(req, res)) { client.release(); return; }

    await client.query("BEGIN");

    const { rowCount } = await client.query("DELETE FROM bills WHERE id = $1", [req.params.id]);
    if (!rowCount) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ error: "Bill not found" });
    }

    // Also remove the bill from the current state snapshot's orderPaperCommons so that
    // future saveState calls from stale sessions cannot re-insert the deleted bill.
    await client.query(
      `UPDATE state_snapshots
          SET data = jsonb_set(
            data,
            '{orderPaperCommons}',
            COALESCE(
              (SELECT jsonb_agg(elem)
                 FROM jsonb_array_elements(COALESCE(data->'orderPaperCommons', '[]'::jsonb)) AS elem
                WHERE (elem->>'id') != $1),
              '[]'::jsonb
            ),
            true
          )
        WHERE id = (SELECT snapshot_id FROM app_state_current WHERE id = 'main')`,
      [req.params.id]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BILL STAGE & PROCESS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bill stage constants. These mirror the client-side stage labels for consistency.
 * All stage transitions are now server-enforced.
 */
const BILL_STAGE_FIRST_READING   = "First Reading";
const BILL_STAGE_SECOND_READING  = "Second Reading";
const BILL_STAGE_REPORT_STAGE    = "Report Stage";
const BILL_STAGE_REPORT_DEBATE   = "Report Debate";
const BILL_STAGE_FINAL_DIVISION  = "Final Division";
const BILL_STAGE_PASSED_ASSENT   = "Passed - Awaiting Assent";
const BILL_STAGE_ROYAL_ASSENT    = "Act (Royal Assent Granted)";
const BILL_STAGE_REFUSED         = "First Reading Refused";
const BILL_STAGE_DEFEATED        = "Defeated in Division";
const BILL_STAGE_WITHDRAWN       = "Withdrawn";

/** Duration in simulation months for timed stages. */
const BILL_STAGE_MONTHS = {
  [BILL_STAGE_SECOND_READING]: 2,
  [BILL_STAGE_REPORT_DEBATE]:  2,
  [BILL_STAGE_FINAL_DIVISION]: 1,
};

/** How long a resolved bill stays on the order paper before archiving (sim months). */
const BILL_ORDER_PAPER_MONTHS = 4;

/**
 * Compute a { month, year } sim deadline by adding `months` to the current sim time.
 */
function simDeadline(simMonth, simYear, months) {
  const total = simMonth + months - 1; // 0-indexed offset
  return {
    month: ((total % 12) || 12),
    year:  simYear + Math.floor(total / 12),
  };
}

/**
 * Check whether a sim deadline { month, year } has passed given the current sim time.
 */
function simDeadlinePassed(deadline, simMonth, simYear) {
  if (!deadline) return false;
  if (simYear > deadline.year) return true;
  if (simYear === deadline.year && simMonth > deadline.month) return true;
  return false;
}

/** Remaining whole sim months until a deadline (0 if past). */
function simMonthsLeft(deadline, simMonth, simYear) {
  if (!deadline) return 0;
  const remaining = (deadline.year - simYear) * 12 + (deadline.month - simMonth);
  return Math.max(0, remaining);
}

// ── Helper: advance bill stage in DB and return the updated bill data ────────
async function advanceBillStage(billId, nextStage, simMonth, simYear, extraPatch = {}) {
  const stagePatch = {
    stage: nextStage,
    stageStartedAt: new Date().toISOString(),
    stageDeadlineSim: BILL_STAGE_MONTHS[nextStage]
      ? simDeadline(simMonth, simYear, BILL_STAGE_MONTHS[nextStage])
      : null,
    ...extraPatch,
  };
  const { rows } = await pool.query(
    `UPDATE bills SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2
     RETURNING id, data`,
    [JSON.stringify(stagePatch), billId]
  );
  return rows[0]?.data || null;
}

/**
 * Format a sim deadline as a TEXT value for the divisions.closes_at_sim column.
 * e.g. { month: 1, year: 1998 } → "1998-01"
 */
function simDeadlineToText(month, year) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Returns a closes_at_sim TEXT value 1 sim month from now. */
function nextSimMonth(simMonth, simYear) {
  const d = simDeadline(simMonth, simYear, 1);
  return simDeadlineToText(d.month, d.year);
}

// POST /api/bills/:id/first-reading — PM or Leader of House grants or refuses second reading
// Body: { action: "grant" | "refuse" }
app.post("/api/bills/:id/first-reading", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { action } = req.body || {};
    if (!["grant", "refuse"].includes(action)) {
      return res.status(400).json({ error: "action must be 'grant' or 'refuse'" });
    }

    // Permission: PM, Leader of the House, admin, or mod
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isStaff = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    let canAct = isStaff;
    if (!canAct) {
      const charId = await getActiveCharacterId(req);
      if (charId) {
        const { rows: cRows } = await pool.query(
          "SELECT office, role FROM characters WHERE id = $1", [charId]
        );
        const char = cRows[0] || {};
        canAct = ["prime-minister", "leader-commons"].includes(String(char.office || "")) ||
                 String(char.role || "") === "prime-minister";
      }
    }
    if (!canAct) return res.status(403).json({ error: "PM, Leader of the House, admin or mod required" });

    // Validate current stage
    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = billRows[0].data;
    if (bill.stage !== BILL_STAGE_FIRST_READING) {
      return res.status(409).json({ error: `Bill is not at First Reading (current: ${bill.stage})` });
    }

    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;

    let updatedBill;
    if (action === "grant") {
      updatedBill = await advanceBillStage(req.params.id, BILL_STAGE_SECOND_READING, sm, sy);
    } else {
      updatedBill = await advanceBillStage(req.params.id, BILL_STAGE_REFUSED, sm, sy, { status: "failed" });
    }

    await writeAuditLog(req.session.userId, `bill.first-reading.${action}`, "bill", req.params.id, bill, updatedBill);
    res.json({ ok: true, bill: updatedBill });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/bills/:id/report — admin/mod/speaker submits report for Report Stage → Report Debate
// Body: { content?, attachmentUrl? }
app.post("/api/bills/:id/report", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;

    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = billRows[0].data;
    if (bill.stage !== BILL_STAGE_REPORT_STAGE) {
      return res.status(409).json({ error: `Bill is not at Report Stage (current: ${bill.stage})` });
    }

    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;

    const charId = await getActiveCharacterId(req);
    const { content = null, attachmentUrl = null } = req.body || {};

    // Save report record
    await pool.query(
      `INSERT INTO bill_stage_reports (bill_id, submitted_by_id, content, attachment_url, sim_month, sim_year)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, charId || null, content || null, attachmentUrl || null, sm, sy]
    );

    // Advance stage
    const updatedBill = await advanceBillStage(req.params.id, BILL_STAGE_REPORT_DEBATE, sm, sy, {
      reportSubmittedAt: new Date().toISOString(),
      reportContent: content || null,
      reportAttachmentUrl: attachmentUrl || null,
    });

    await writeAuditLog(req.session.userId, "bill.report.submitted", "bill", req.params.id, bill, updatedBill);
    res.json({ ok: true, bill: updatedBill });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/bills/:id/withdraw — author, PM, or admin/mod withdraws a bill
app.post("/api/bills/:id/withdraw", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = billRows[0].data;

    if (["passed", "failed", "withdrawn"].includes(String(bill.status || ""))) {
      return res.status(409).json({ error: "Bill is already concluded and cannot be withdrawn" });
    }

    // Permission: bill author (by character name), PM, admin, or mod
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isStaff = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    let canWithdraw = isStaff;
    if (!canWithdraw) {
      const charId = await getActiveCharacterId(req);
      if (charId) {
        const { rows: cRows } = await pool.query(
          "SELECT name, office, role FROM characters WHERE id = $1", [charId]
        );
        const char = cRows[0] || {};
        // Author match or PM
        canWithdraw = String(char.name || "") === String(bill.author || "") ||
                      ["prime-minister", "leader-commons"].includes(String(char.office || "")) ||
                      String(char.role || "") === "prime-minister";
      }
    }
    if (!canWithdraw) return res.status(403).json({ error: "Bill author, PM, admin or mod required" });

    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;

    const updatedBill = await advanceBillStage(req.params.id, BILL_STAGE_WITHDRAWN, sm, sy, {
      status: "withdrawn",
      withdrawnAt: new Date().toISOString(),
    });

    await writeAuditLog(req.session.userId, "bill.withdraw", "bill", req.params.id, bill, updatedBill);
    res.json({ ok: true, bill: updatedBill });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/bills/:id/assent — admin/mod grants Royal Assent
app.post("/api/bills/:id/assent", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = billRows[0].data;

    if (bill.status !== "awaiting-assent") {
      return res.status(409).json({ error: `Bill is not awaiting assent (status: ${bill.status})` });
    }

    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;

    const updatedBill = await advanceBillStage(req.params.id, BILL_STAGE_ROYAL_ASSENT, sm, sy, {
      status: "passed",
      royalAssentGrantedAt: new Date().toISOString(),
      legislationKind: "Act of Parliament",
      // rename "Bill" to "Act" in title
      title: String(bill.title || "").replace(/\bbill\b/ig, "Act"),
    });

    await writeAuditLog(req.session.userId, "bill.assent", "bill", req.params.id, bill, updatedBill);
    res.json({ ok: true, bill: updatedBill });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Amendment endpoints ───────────────────────────────────────────────────────

// Stages during which amendments may be submitted (first 1.5 sim months only)
const AMENDMENT_ALLOWED_STAGES = new Set([BILL_STAGE_SECOND_READING, BILL_STAGE_REPORT_DEBATE]);

/** Returns true if the amendment window is open (first 1.5 months of a 2-month stage). */
function amendmentWindowOpen(bill, simMonth, simYear) {
  if (!AMENDMENT_ALLOWED_STAGES.has(bill.stage)) return false;
  const deadline = bill.stageDeadlineSim;
  if (!deadline) return true; // no deadline set yet → still open
  // The stage lasts 2 months. The window closes after the first 1.5 months.
  // We model this as: the window is open while at least 1 full sim month remains before the deadline.
  // (i.e. the window closes when < 1 month remains — 0.5 months left = window closed).
  const remaining = simMonthsLeft(deadline, simMonth, simYear);
  return remaining >= 1; // "at least 1 full sim month remaining" → window open
}

// POST /api/bills/:id/amendments — any MP submits an amendment
// Body: { articleNumber, type: replace|insert|delete, title, text }
app.post("/api/bills/:id/amendments", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const charId = await getActiveCharacterId(req);
    if (!charId) return res.status(403).json({ error: "No active character" });

    const { rows: cRows } = await pool.query(
      "SELECT name, party, role, office FROM characters WHERE id = $1", [charId]
    );
    if (!cRows.length) return res.status(403).json({ error: "Character not found" });
    const char = cRows[0];

    // Any MP role may submit amendments
    const mpRoles = ["backbencher", "minister", "shadow", "leader-opposition", "party-leader-3rd-4th", "prime-minister"];
    if (!mpRoles.includes(String(char.role || ""))) {
      return res.status(403).json({ error: "Only MPs may submit amendments" });
    }

    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = billRows[0].data;

    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;

    if (!amendmentWindowOpen(bill, sm, sy)) {
      return res.status(409).json({ error: "Amendment window is closed at this stage" });
    }

    const { articleNumber, type, title, text } = req.body || {};
    if (!title) return res.status(400).json({ error: "title is required" });
    if (!["replace", "insert", "delete"].includes(type)) {
      return res.status(400).json({ error: "type must be replace, insert, or delete" });
    }

    // Generate amendment ID
    const { rows: countRows } = await pool.query(
      "SELECT COUNT(*) AS cnt FROM bill_amendments WHERE bill_id = $1", [req.params.id]
    );
    const amendId = `A${Number(countRows[0]?.cnt || 0) + 1}`;

    const isAuthor = String(char.name || "") === String(bill.author || "");
    const initialStatus = isAuthor ? "accepted" : "proposed";

    await pool.query(
      `INSERT INTO bill_amendments
         (id, bill_id, article_number, amendment_type, title, text,
          proposed_by_id, proposed_by_name, proposed_by_party, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [amendId, req.params.id, articleNumber || null, type, title, text || "",
       charId, char.name, char.party || "Independent", initialStatus]
    );

    // If auto-accepted (author submitted), apply the amendment to bill text immediately
    if (isAuthor) {
      const updatedText = applyAmendmentToBillText(bill.billText || "", articleNumber, type, text || "");
      await pool.query(
        `UPDATE bills SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ billText: updatedText }), req.params.id]
      );
    }

    const { rows: amRows } = await pool.query(
      "SELECT * FROM bill_amendments WHERE bill_id = $1 AND id = $2", [req.params.id, amendId]
    );
    res.status(201).json({ ok: true, amendment: amRows[0], autoAccepted: isAuthor });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/bills/:id/amendments/:aid/decide — bill author accepts or refuses an amendment
// Body: { decision: "accept" | "refuse" }
app.post("/api/bills/:id/amendments/:aid/decide", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const charId = await getActiveCharacterId(req);
    if (!charId) return res.status(403).json({ error: "No active character" });

    const { decision } = req.body || {};
    if (!["accept", "refuse"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'accept' or 'refuse'" });
    }

    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = billRows[0].data;

    const { rows: amRows } = await pool.query(
      "SELECT * FROM bill_amendments WHERE bill_id = $1 AND id = $2", [req.params.id, req.params.aid]
    );
    if (!amRows.length) return res.status(404).json({ error: "Amendment not found" });
    const am = amRows[0];
    if (am.status !== "proposed") return res.status(409).json({ error: `Amendment is already ${am.status}` });

    // Only the bill author may decide
    const { rows: cRows } = await pool.query("SELECT name FROM characters WHERE id = $1", [charId]);
    if (!cRows.length || String(cRows[0].name) !== String(bill.author || "")) {
      // Check if author, admin or mod
      const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
      const isStaff = sessionRoles.includes("admin") || sessionRoles.includes("mod");
      if (!isStaff) return res.status(403).json({ error: "Only the bill author, admin or mod may decide on amendments" });
    }

    if (decision === "accept") {
      // Apply amendment to bill text
      const updatedText = applyAmendmentToBillText(bill.billText || "", am.article_number, am.amendment_type, am.text || "");
      await pool.query(`UPDATE bills SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ billText: updatedText }), req.params.id]);
      await pool.query(
        `UPDATE bill_amendments SET status = 'accepted', updated_at = NOW() WHERE bill_id = $1 AND id = $2`,
        [req.params.id, req.params.aid]
      );
    } else {
      // Refuse: check if 2+ party leaders already support — if so, trigger division instead
      const { rows: suppRows } = await pool.query(
        "SELECT COUNT(*) AS cnt FROM bill_amendment_supporters WHERE bill_id = $1 AND amendment_id = $2",
        [req.params.id, req.params.aid]
      );
      const supportCount = Number(suppRows[0]?.cnt || 0);
      if (supportCount >= 2) {
        // Trigger a 1-month amendment division via formal divisions table
        const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
        const sm = clk[0]?.sim_current_month ?? 8;
        const sy = clk[0]?.sim_current_year  ?? 1997;
        const closesAtSim = nextSimMonth(sm, sy);
        const { rows: divRows } = await pool.query(
          `INSERT INTO divisions (entity_type, entity_id, title, closes_at_sim)
           VALUES ('bill-amendment', $1, $2, $3)
           RETURNING id`,
          [`${req.params.id}:${req.params.aid}`, `Amendment ${req.params.aid} on: ${bill.title || req.params.id}`, closesAtSim]
        );
        await pool.query(
          `UPDATE bill_amendments SET status = 'in-division', division_id = $3, updated_at = NOW()
           WHERE bill_id = $1 AND id = $2`,
          [req.params.id, req.params.aid, divRows[0].id]
        );
      } else {
        await pool.query(
          `UPDATE bill_amendments SET status = 'refused', updated_at = NOW() WHERE bill_id = $1 AND id = $2`,
          [req.params.id, req.params.aid]
        );
      }
    }

    const { rows: updated } = await pool.query(
      "SELECT * FROM bill_amendments WHERE bill_id = $1 AND id = $2", [req.params.id, req.params.aid]
    );
    res.json({ ok: true, amendment: updated[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/bills/:id/amendments/:aid/support — party leader declares support for an amendment
// If 2+ leaders support → triggers a 1-month division on the amendment
app.post("/api/bills/:id/amendments/:aid/support", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const charId = await getActiveCharacterId(req);
    if (!charId) return res.status(403).json({ error: "No active character" });

    const { rows: cRows } = await pool.query("SELECT name, party, role FROM characters WHERE id = $1", [charId]);
    if (!cRows.length) return res.status(403).json({ error: "Character not found" });
    const char = cRows[0];

    const leaderRoles = ["prime-minister", "leader-opposition", "party-leader-3rd-4th"];
    if (!leaderRoles.includes(String(char.role || ""))) {
      return res.status(403).json({ error: "Only party leaders may declare formal support for amendments" });
    }

    const { rows: amRows } = await pool.query(
      "SELECT * FROM bill_amendments WHERE bill_id = $1 AND id = $2", [req.params.id, req.params.aid]
    );
    if (!amRows.length) return res.status(404).json({ error: "Amendment not found" });
    const am = amRows[0];
    if (am.status !== "proposed") return res.status(409).json({ error: `Amendment is already ${am.status}` });

    // Upsert support (party-based, one per party)
    await pool.query(
      `INSERT INTO bill_amendment_supporters (bill_id, amendment_id, character_id, party)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (bill_id, amendment_id, party) DO UPDATE SET character_id = EXCLUDED.character_id, added_at = NOW()`,
      [req.params.id, req.params.aid, charId, char.party || "Independent"]
    );

    const { rows: suppRows } = await pool.query(
      "SELECT COUNT(*) AS cnt FROM bill_amendment_supporters WHERE bill_id = $1 AND amendment_id = $2",
      [req.params.id, req.params.aid]
    );
    const supportCount = Number(suppRows[0]?.cnt || 0);
    let divisionTriggered = false;

    // 2+ leaders AND bill author has not yet accepted → auto-trigger amendment division
    if (supportCount >= 2 && am.status === "proposed") {
      const { rows: billRows } = await pool.query("SELECT data FROM bills WHERE id = $1", [req.params.id]);
      const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
      const sm = clk[0]?.sim_current_month ?? 8;
      const sy = clk[0]?.sim_current_year  ?? 1997;
      const bill = billRows[0]?.data || {};
      const closesAtSim = nextSimMonth(sm, sy);
      const { rows: divRows } = await pool.query(
        `INSERT INTO divisions (entity_type, entity_id, title, closes_at_sim)
         VALUES ('bill-amendment', $1, $2, $3)
         RETURNING id`,
        [`${req.params.id}:${req.params.aid}`, `Amendment ${req.params.aid} on: ${bill.title || req.params.id}`, closesAtSim]
      );
      await pool.query(
        `UPDATE bill_amendments SET status = 'in-division', division_id = $3, updated_at = NOW()
         WHERE bill_id = $1 AND id = $2`,
        [req.params.id, req.params.aid, divRows[0].id]
      );
      divisionTriggered = true;
    }

    const { rows: updated } = await pool.query(
      "SELECT * FROM bill_amendments WHERE bill_id = $1 AND id = $2", [req.params.id, req.params.aid]
    );
    res.json({ ok: true, amendment: updated[0], supportCount, divisionTriggered });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/bills/:id/amendments — list all amendments for a bill
app.get("/api/bills/:id/amendments", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT ba.*, 
              COALESCE(json_agg(bas.party ORDER BY bas.added_at) FILTER (WHERE bas.party IS NOT NULL), '[]') AS supporter_parties
         FROM bill_amendments ba
         LEFT JOIN bill_amendment_supporters bas ON bas.bill_id = ba.bill_id AND bas.amendment_id = ba.id
        WHERE ba.bill_id = $1
        GROUP BY ba.bill_id, ba.id
        ORDER BY ba.created_at ASC`,
      [req.params.id]
    );
    res.json({ amendments: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/bills/:id/final-division — admin/mod/speaker opens the Final Division
// (creates a formal division in the divisions table for the bill)
app.post("/api/bills/:id/final-division", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;

    const { rows: billRows } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = billRows[0].data;

    // Must be at Final Division stage
    if (bill.stage !== BILL_STAGE_FINAL_DIVISION) {
      return res.status(409).json({ error: `Bill must be at Final Division stage (current: ${bill.stage})` });
    }

    // Check no open amendment divisions still pending
    const { rows: pendingAmends } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM bill_amendments ba
         JOIN divisions d ON d.id = ba.division_id
        WHERE ba.bill_id = $1 AND ba.status = 'in-division' AND d.status = 'open'`,
      [req.params.id]
    );
    if (Number(pendingAmends[0]?.cnt || 0) > 0) {
      return res.status(409).json({ error: "All amendment divisions must be resolved before opening the final division" });
    }

    // Check no proposed amendments still pending author decision
    const { rows: pendingProposed } = await pool.query(
      "SELECT COUNT(*) AS cnt FROM bill_amendments WHERE bill_id = $1 AND status = 'proposed'",
      [req.params.id]
    );
    if (Number(pendingProposed[0]?.cnt || 0) > 0) {
      return res.status(409).json({ error: "All amendments must be accepted or refused before opening the final division" });
    }

    // Check if a formal division already exists
    const { rows: existDiv } = await pool.query(
      "SELECT id FROM divisions WHERE entity_type = 'bill' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1",
      [req.params.id]
    );
    if (existDiv.length) {
      return res.status(409).json({ error: "Final division already exists", divisionId: existDiv[0].id });
    }

    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const closesAtSim = nextSimMonth(sm, sy);

    const { rows: divRows } = await pool.query(
      `INSERT INTO divisions (entity_type, entity_id, title, closes_at_sim)
       VALUES ('bill', $1, $2, $3)
       RETURNING id, entity_type, entity_id, title, status, closes_at_sim, created_at`,
      [req.params.id, `Final Division: ${bill.title || req.params.id}`, closesAtSim]
    );

    // Record division id in bill data
    await pool.query(
      `UPDATE bills SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ formalDivisionId: divRows[0].id }), req.params.id]
    );

    await writeAuditLog(req.session.userId, "bill.final-division.opened", "bill", req.params.id, bill, divRows[0]);
    res.status(201).json({ ok: true, division: divRows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * Apply an amendment to bill text (article-based format).
 * This mirrors the client-side logic but runs on the server for DB-authoritative updates.
 */
function applyAmendmentToBillText(billText, articleNumber, type, amendText) {
  if (!billText || articleNumber == null) return billText;
  const lines = String(billText).split("\n");
  const articles = [];
  let current = null;
  lines.forEach((line) => {
    const m = line.match(/^ARTICLE\s+(\d+)\s+—\s+(.+)$/i);
    if (m) {
      if (current) articles.push(current);
      current = { number: Number(m[1]), heading: m[2], bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  });
  if (current) articles.push(current);

  const target = articles.find((a) => Number(a.number) === Number(articleNumber));
  if (!target) return billText;

  const oldText = target.bodyLines.join("\n").trim();
  if (type === "replace") target.bodyLines = [amendText];
  else if (type === "insert") target.bodyLines = [oldText, amendText].filter(Boolean);
  else if (type === "delete") target.bodyLines = [];

  // Reconstruct bill text
  const headerLines = [];
  let pastFirstArticle = false;
  for (const line of lines) {
    if (/^ARTICLE\s+\d+\s+—\s+.+$/i.test(line)) { pastFirstArticle = true; break; }
    headerLines.push(line);
  }
  const finalIdx = lines.findIndex((l) => /^FINAL ARTICLE\s+—/i.test(l));
  const finalPart = finalIdx >= 0 ? "\n" + lines.slice(finalIdx).join("\n") : "";

  const body = articles.map((a) => [
    `ARTICLE ${a.number} — ${a.heading}`,
    a.bodyLines.join("\n"),
  ].join("\n")).join("\n\n");

  return [headerLines.join("\n"), body, finalPart].join("\n").trim();
}
/** Party name regexes for parties with special voting rules. */
const SPEAKER_PARTY_RE  = /^speaker$/i;
const SINN_FEIN_PARTY_RE = /sinn\s*f[ée]in/i;

/**
 * Get party seat totals from the constituencies table.
 * This is the canonical, DB-authoritative source for weighted voting calculations,
 * matching what is displayed on the constituencies page.
 *
 * @param {Pool} pool - pg Pool
 * @returns {Promise<Object>} { partyName: seatCount }
 */
async function getPartySeatsFromConstituencies(pool) {
  const { rows } = await pool.query(
    "SELECT party, COUNT(*) AS seats FROM constituencies WHERE party IS NOT NULL AND party <> '' GROUP BY party"
  );
  return Object.fromEntries(rows.map((r) => [String(r.party), Number(r.seats)]));
}

/**
 * Compute weighted vote weights for all active players.
 *
 * Formula: each party's constituency seat total is distributed evenly among its
 * active, settled players. New backbenchers (<2 weeks) receive 1 until settled.
 * Absent players' weights delegate to their party leader (or a nominated deputy).
 *
 * Special rules:
 * - Speaker party members receive 0 weight (Speaker does not vote; tie-break only).
 * - Sinn Féin members receive 0 weight (do not take their seats).
 *
 * @param {Object} seatsByParty - { partyName: seatCount } from constituencies DB
 * @param {Array}  players      - active players from game state (with absent/delegatedTo/joinedAt/role)
 * @returns {{ effectiveWeights: Object, baseWeights: Object, leaderByParty: Object }}
 */
function computeAllPlayerWeights(seatsByParty, players) {
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
  const allPlayers = (players || []).filter((p) => p != null && p.active !== false);

  function isSettledBackbencher(p) {
    if (!p || p.role !== "backbencher") return true;
    const joined = Date.parse(p.joinedAt || "");
    if (!Number.isFinite(joined)) return true;
    return (Date.now() - joined) >= TWO_WEEKS_MS;
  }

  function findPartyLeader(members) {
    return (
      members.find((m) => m.partyLeader) ||
      members.find((m) => m.role === "prime-minister") ||
      members.find((m) => m.role === "leader-opposition") ||
      members.find((m) => m.role === "party-leader-3rd-4th") ||
      members[0] ||
      null
    );
  }

  // Group by party
  const byParty = new Map();
  allPlayers.forEach((p) => {
    const party = String(p.party || "Independent");
    if (!byParty.has(party)) byParty.set(party, []);
    byParty.get(party).push(p);
  });

  const baseWeights = {};
  const leaderByParty = {};

  byParty.forEach((members, party) => {
    members.forEach((m) => { baseWeights[String(m.name || "")] = 0; });

    // Speaker does not vote (tie-break only); Sinn Féin do not take their seats.
    if (SPEAKER_PARTY_RE.test(party) || SINN_FEIN_PARTY_RE.test(party)) return;

    const seats = Math.max(0, Math.floor(Number(seatsByParty[party] || 0)));
    const leader = findPartyLeader(members);
    if (leader) leaderByParty[party] = String(leader.name || "");

    const newBackbenchers = members.filter((m) => !isSettledBackbencher(m));
    newBackbenchers.forEach((m) => { baseWeights[String(m.name || "")] += 1; });

    const remaining = Math.max(0, seats - newBackbenchers.length);
    const splitMembers = members.filter((m) => isSettledBackbencher(m));

    if (!splitMembers.length) {
      if (leader) baseWeights[String(leader.name || "")] = (baseWeights[String(leader.name || "")] || 0) + remaining;
      return;
    }

    const each = Math.floor(remaining / splitMembers.length);
    const odd  = remaining - (each * splitMembers.length);
    splitMembers.forEach((m) => { baseWeights[String(m.name || "")] = (baseWeights[String(m.name || "")] || 0) + each; });

    if (odd > 0) {
      const leaderName = leader ? String(leader.name || "") : null;
      const oddTarget = leaderName && splitMembers.some((m) => m.name === leader.name)
        ? leaderName
        : String(splitMembers[0].name || "");
      baseWeights[oddTarget] = (baseWeights[oddTarget] || 0) + odd;
    }
  });

  // Delegation: absent players' weights route to their party leader (or deputy)
  const effectiveWeights = { ...baseWeights };
  const playersByName = Object.fromEntries(allPlayers.map((p) => [String(p.name || ""), p]));

  allPlayers.forEach((p) => {
    if (!p?.absent) return;
    const from = String(p.name || "");
    const amount = Number(effectiveWeights[from] || 0);
    if (amount <= 0) return;

    const party = String(p.party || "Independent");
    const leaderName = leaderByParty[party] || null;
    const isLeader = leaderName && from === leaderName;

    let target = null;
    if (isLeader) {
      const candidate = String(p.delegatedTo || "").trim();
      if (candidate && playersByName[candidate] && !playersByName[candidate].absent) {
        target = candidate;
      } else {
        target = allPlayers.find(
          (q) => String(q.party || "Independent") === party && q.name !== from && !q.absent
        )?.name || null;
      }
    } else if (leaderName && playersByName[leaderName] && !playersByName[leaderName].absent) {
      target = leaderName;
    }

    effectiveWeights[from] = 0;
    if (target && target !== from) {
      effectiveWeights[target] = (Number(effectiveWeights[target] || 0)) + amount;
    }
  });

  return { effectiveWeights, baseWeights, leaderByParty };
}

// PATCH /api/bills/:id/vote — authenticated: cast a server-authoritative vote on a bill division
app.patch("/api/bills/:id/vote", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const billId = req.params.id;
    const voteChoice = String(req.body?.vote || "").toLowerCase();
    if (!["aye", "no", "abstain"].includes(voteChoice)) {
      return res.status(400).json({ error: "vote must be aye, no, or abstain" });
    }

    // Get bill from DB
    const { rows: billRows } = await pool.query(
      "SELECT data FROM bills WHERE id = $1", [billId]
    );
    if (!billRows.length) return res.status(404).json({ error: "Bill not found" });
    const bill = { ...billRows[0].data };

    // Division must be open
    if (bill.division?.status && bill.division.status !== "open") {
      return res.status(409).json({ error: "Division is not open" });
    }

    // Get current active character from DB
    const { rows: charRows } = await pool.query(
      "SELECT name, party FROM characters WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1",
      [req.session.userId]
    );
    if (!charRows.length) return res.status(400).json({ error: "No active character found" });
    const { name: charName, party: charParty } = charRows[0];

    // Seat totals from constituencies DB (authoritative source — constituencies page)
    const seatsByParty = await getPartySeatsFromConstituencies(pool);

    // Load current game state for player list (absence/delegation info)
    const { rows: stateRows } = await pool.query(
      `SELECT ss.data
         FROM state_snapshots ss
         JOIN app_state_current asc2 ON ss.id = asc2.snapshot_id
        WHERE asc2.id = 'main'`
    );
    const stateData = stateRows[0]?.data ?? {};
    const players = Array.isArray(stateData?.players) ? stateData.players : [];

    // Compute effective weight server-side (seats from constituencies DB, players from state)
    const { effectiveWeights } = computeAllPlayerWeights(seatsByParty, players);
    const effectiveWeight = Number(effectiveWeights[charName] || 0);

    // Initialise division if this is the first vote
    bill.division ??= { status: "open", votes: {}, openedAt: Date.now(), rebelsByParty: {}, npcVotes: {} };
    bill.division.votes ??= {};

    // Store vote
    bill.division.votes[charName] = {
      actor: charName,
      party: charParty,
      choice: voteChoice,
      weight: effectiveWeight,
      effective_weight: effectiveWeight,
      at: Date.now(),
    };

    // Upsert bill to DB
    const { rowCount } = await pool.query(
      "UPDATE bills SET data = $1::jsonb, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(bill), billId]
    );
    if (!rowCount) return res.status(404).json({ error: "Bill not found" });

    // Compute server-side tally from stored votes
    const tally = { aye: 0, no: 0, abstain: 0 };
    Object.values(bill.division.votes).forEach((v) => {
      const c = String(v.choice || "abstain").toLowerCase();
      if (c in tally) tally[c] += Number(v.effective_weight ?? v.weight ?? 0);
    });

    res.json({
      ok: true,
      bill,
      vote: { actor: charName, choice: voteChoice, effective_weight: effectiveWeight },
      tally,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * MOTIONS
 * GET    /api/motions          — authenticated: list all motions (optional ?type=house|edm)
 * GET    /api/motions/:id      — authenticated: get one motion
 * POST   /api/motions          — authenticated: create a motion
 * PUT    /api/motions/:id      — admin/mod: update a motion
 * DELETE /api/motions/:id      — admin/mod/speaker: delete a motion
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
    res.json({ motions: rows.map((r) => normaliseDiscourseFields({ ...r.data, _motionType: r.motion_type, _updatedAt: r.updated_at })) });
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
    res.json({ motion: normaliseDiscourseFields({ ...rows[0].data, _motionType: rows[0].motion_type, _updatedAt: rows[0].updated_at }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/motions", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { motion_type = "house", ...motion } = req.body || {};
    if (!motion.id) {
      return res.status(400).json({ error: "Body must be a motion object with an id" });
    }
    if (motion_type !== "house" && motion_type !== "edm") {
      return res.status(400).json({ error: "motion_type must be 'house' or 'edm'" });
    }
    const { rows: clk } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const enriched = attachLifecycle({ ...motion }, sm, sy);
    const { rows } = await pool.query(
      `INSERT INTO motions (id, motion_type, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET motion_type = EXCLUDED.motion_type, data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [enriched.id, motion_type, JSON.stringify(enriched)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});


app.post("/api/motions/:id/sign", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const charId = await getActiveCharacterId(req);
    if (!charId) return res.status(403).json({ error: "No active character. Select a character first." });

    const { rows: motionRows } = await pool.query("SELECT motion_type, data FROM motions WHERE id = $1", [req.params.id]);
    if (!motionRows.length) return res.status(404).json({ error: "Motion not found" });
    if (motionRows[0].motion_type !== "edm") return res.status(400).json({ error: "Only EDMs can be signed" });

    const { rows: charRows } = await pool.query("SELECT id, name, party FROM characters WHERE id = $1", [charId]);
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });
    const char = charRows[0];

    const edm = motionRows[0].data || {};
    edm.signatures = Array.isArray(edm.signatures) ? edm.signatures : [];
    const already = edm.signatures.some((sig) => String(sig.name || "") === String(char.name || ""));
    if (already) return res.status(409).json({ error: "Already signed" });

    const weight = 1;

    edm.signatures.push({ name: char.name, party: char.party || "Independent", weight });

    await pool.query("UPDATE motions SET data = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(edm), req.params.id]);
    await writeAuditLog(req.session.userId, "motion.edm.sign", "motion", req.params.id, null, { signer: char.name, party: char.party || "Independent" });
    res.status(201).json({ ok: true, motion: normaliseDiscourseFields(edm) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/motions/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
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
    if (!requireAdminModOrSpeaker(req, res)) return;
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
 * POST   /api/statements          — authenticated: create a statement
 * PUT    /api/statements/:id      — admin/mod: update a statement
 * DELETE /api/statements/:id      — admin/mod/speaker: delete a statement
 */
app.get("/api/statements", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, updated_at FROM statements ORDER BY updated_at DESC");
    res.json({ statements: rows.map((r) => normaliseDiscourseFields({ ...r.data, _updatedAt: r.updated_at })) });
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
    res.json({ statement: normaliseDiscourseFields({ ...rows[0].data, _updatedAt: rows[0].updated_at }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/statements", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const stmt = req.body;
    if (!stmt || typeof stmt !== "object" || !stmt.id) {
      return res.status(400).json({ error: "Body must be a statement object with an id" });
    }
    const { rows: clk } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const enriched = attachLifecycle({ ...stmt }, sm, sy);
    const { rows } = await pool.query(
      `INSERT INTO statements (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [enriched.id, JSON.stringify(enriched)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/statements/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
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
    if (!requireAdminModOrSpeaker(req, res)) return;
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
 * POST   /api/regulations          — authenticated: create a regulation
 * PUT    /api/regulations/:id      — admin: update a regulation
 * DELETE /api/regulations/:id      — admin/mod/speaker: delete a regulation
 */
app.get("/api/regulations", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, updated_at FROM regulations ORDER BY updated_at DESC");
    res.json({ regulations: rows.map((r) => normaliseDiscourseFields({ ...r.data, _updatedAt: r.updated_at })) });
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
    res.json({ regulation: normaliseDiscourseFields({ ...rows[0].data, _updatedAt: rows[0].updated_at }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/regulations", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const reg = req.body;
    if (!reg || typeof reg !== "object" || !reg.id) {
      return res.status(400).json({ error: "Body must be a regulation object with an id" });
    }
    const { rows: clk } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const enriched = attachLifecycle({ ...reg }, sm, sy);
    const { rows } = await pool.query(
      `INSERT INTO regulations (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [enriched.id, JSON.stringify(enriched)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/regulations/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
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
    if (!requireAdminModOrSpeaker(req, res)) return;
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
 * POST   /api/questiontime-questions          — authenticated: create a question
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
    if (!requireAuth(req, res)) return;
    const q = req.body;
    if (!q || typeof q !== "object" || !q.id) {
      return res.status(400).json({ error: "Body must be a question object with an id" });
    }
    // Server-side dedup: reject if same askedBy + office + text was submitted within 10 minutes
    const askedBy = String(q.askedBy || "").trim();
    const office  = String(q.office  || "").trim();
    const text    = String(q.text    || "").trim();
    if (askedBy && office && text) {
      const { rows: dupeRows } = await pool.query(
        `SELECT id FROM questiontime_questions
          WHERE data->>'askedBy' = $1
            AND data->>'office'  = $2
            AND data->>'text'    = $3
            AND updated_at > NOW() - INTERVAL '10 minutes'
          LIMIT 1`,
        [askedBy, office, text]
      );
      if (dupeRows.length) {
        return res.status(409).json({ error: "A question with the same text was already submitted recently. Please wait before resubmitting." });
      }
    }
    const { rows: clk } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const enriched = attachLifecycle({ ...q }, sm, sy);
    const { rows } = await pool.query(
      `INSERT INTO questiontime_questions (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [enriched.id, JSON.stringify(enriched)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/questiontime-questions/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
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
    if (!requireAdminOrMod(req, res)) return;
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
    const newMonth = rows[0].sim_current_month;
    const newYear  = rows[0].sim_current_year;

    // Keep sim_state in sync so both clock representations agree.
    await pool.query(
      `UPDATE sim_state SET month = $1, year = $2, last_tick_at = NOW() WHERE id = 'main'`,
      [newMonth, newYear]
    );

    // Auto-archive content whose autoArchiveAfterSimMonths has elapsed.
    // We compare createdAtSim against the new sim date.
    const ARCHIVABLE_TABLES = [
      "bills", "motions", "statements", "regulations",
      "questiontime_questions", "press_items", "polling_entries",
    ];
    let archived = 0;
    for (const tbl of ARCHIVABLE_TABLES) {
      try {
        const { rowCount } = await pool.query(
          `UPDATE ${tbl}
              SET data = data || '{"status":"archived"}'::jsonb,
                  updated_at = NOW()
            WHERE (data->>'status') NOT IN ('archived','closed')
              AND (data->>'autoArchiveAfterSimMonths') IS NOT NULL
              AND (data->>'autoArchiveAfterSimMonths')::int > 0
              AND (
                (($1 - (data->'createdAtSim'->>'year')::int) * 12
                 + ($2 - (data->'createdAtSim'->>'month')::int))
                >= (data->>'autoArchiveAfterSimMonths')::int
              )`,
          [newYear, newMonth]
        );
        archived += rowCount ?? 0;
      } catch (archiveErr) {
        // Non-fatal: log and continue
        console.error(`[clock/tick] auto-archive failed for ${tbl}:`, archiveErr.message);
      }
    }

    await writeAuditLog(req.session.userId, "clock.tick", "sim_clock", "main", null, { ...rows[0], archivedItems: archived });

    // Automatic salary crediting — runs on every tick (catch-up for missed 2-month periods)
    runSalaryCrediting(newMonth, newYear).catch((e) => console.error("[clock/tick] salary crediting failed:", e.message));
    runShopUpkeep(newMonth, newYear).catch((e) => console.error("[clock/tick] shop upkeep failed:", e.message));
    runRevenuePayouts(newMonth, newYear).catch((e) => console.error("[clock/tick] revenue payouts failed:", e.message));
    runMembershipIntake(newMonth, newYear).catch((e) => console.error("[clock/tick] membership intake failed:", e.message));
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
    // Keep sim_state in sync so both clock representations agree.
    await pool.query(
      `UPDATE sim_state SET month = $1, year = $2 WHERE id = 'main'`,
      [month, year]
    );
    res.json({ ok: true, clock: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PRESS ITEMS
 * GET    /api/press              — public: list press items (optional ?type=release|conference)
 * GET    /api/press/:id          — public: get one press item
 * POST   /api/press              — admin/mod: create a press item
 * PUT    /api/press/:id          — admin/mod: update a press item
 * DELETE /api/press/:id          — admin/mod: delete a press item
 */
const pressReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const pressWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });
const MAX_TRANSCRIPT_FROM_LENGTH = 200;
const MAX_TRANSCRIPT_TEXT_LENGTH = 2000;

app.get("/api/press", pressReadLimit, async (req, res) => {
  try {
    const { type } = req.query;
    const q = type
      ? "SELECT id, press_type, data, updated_at FROM press_items WHERE press_type = $1 ORDER BY updated_at DESC"
      : "SELECT id, press_type, data, updated_at FROM press_items ORDER BY updated_at DESC";
    const params = type ? [type] : [];
    const { rows } = await pool.query(q, params);
    res.json({ items: rows.map((r) => normaliseDiscourseFields({ ...r.data, _pressType: r.press_type, _updatedAt: r.updated_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/press/:id", pressReadLimit, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, press_type, data, updated_at FROM press_items WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Press item not found" });
    res.json({ item: normaliseDiscourseFields({ ...rows[0].data, _pressType: rows[0].press_type, _updatedAt: rows[0].updated_at }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/press", pressWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { press_type = "release", ...item } = req.body || {};
    if (!item.id) {
      return res.status(400).json({ error: "Body must have an id field" });
    }
    const VALID_PRESS_TYPES = new Set(["release", "conference", "speech", "comment", "letter"]);
    if (!VALID_PRESS_TYPES.has(press_type)) {
      return res.status(400).json({ error: "press_type must be 'release', 'conference', 'speech', 'comment', or 'letter'" });
    }
    // Enforce NPC author restriction: only admin/mod/speaker may post comments with npcAuthor flag
    if (press_type === "comment" && item.npcAuthor) {
      const roles = Array.isArray(req.session.roles) ? req.session.roles : [];
      if (!roles.includes("admin") && !roles.includes("mod") && !roles.includes("speaker")) {
        return res.status(403).json({ error: "Only admin, mod, or speaker may post as NPC" });
      }
    }
    const { rows: clk } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const enriched = attachLifecycle({ ...item }, sm, sy);
    const { rows } = await pool.query(
      `INSERT INTO press_items (id, press_type, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET press_type = EXCLUDED.press_type, data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [enriched.id, press_type, JSON.stringify(enriched)]
    );
    await writeAuditLog(req.session.userId, "press.create", "press_items", enriched.id, null, enriched);
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/press/:id", pressWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { press_type, ...item } = req.body || {};
    const { rows: before } = await pool.query("SELECT data FROM press_items WHERE id = $1", [req.params.id]);
    if (!before.length) return res.status(404).json({ error: "Press item not found" });
    const updated = { ...before[0].data, ...item, id: req.params.id };
    const ptCols = press_type ? ", press_type = $3" : "";
    const params = press_type
      ? [JSON.stringify(updated), req.params.id, press_type]
      : [JSON.stringify(updated), req.params.id];
    const { rows } = await pool.query(
      `UPDATE press_items SET data = $1::jsonb, updated_at = NOW()${ptCols} WHERE id = $2 RETURNING id, updated_at`,
      params
    );
    await writeAuditLog(req.session.userId, "press.update", "press_items", req.params.id, before[0].data, updated);
    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/press/:id", pressWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM press_items WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Press item not found" });
    await writeAuditLog(req.session.userId, "press.delete", "press_items", req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/press/:id/transcript — player appends to their own press conference transcript
// Allows the conference author to add an answer entry or walk-off entry.
// Staff (admin/mod/speaker) may post NPC journalist questions.
app.patch("/api/press/:id/transcript", pressWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { entry } = req.body || {};
    if (!entry || typeof entry !== "object" || typeof entry.text !== "string") {
      return res.status(400).json({ error: "entry.text required" });
    }

    const { rows } = await pool.query("SELECT data FROM press_items WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Press item not found" });
    const item = rows[0].data;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isStaff = sessionRoles.includes("admin") || sessionRoles.includes("mod") || sessionRoles.includes("speaker");
    const isQuestion = entry.isQuestion === true;

    if (isQuestion) {
      // Only staff may post NPC journalist questions
      if (!isStaff) {
        return res.status(403).json({ error: "Only staff may submit press conference questions" });
      }
    } else {
      // Answer / walk-off: only the conference author (player)
      if (!req.session.characterId) return res.status(403).json({ error: "Forbidden: no active character" });
      const { rows: charRows } = await pool.query(
        "SELECT name FROM characters WHERE id = $1 AND user_id = $2 AND is_active = TRUE",
        [req.session.characterId, req.session.userId]
      );
      if (!charRows.length || item.author !== charRows[0].name) {
        return res.status(403).json({ error: "Only the conference author may add transcript entries" });
      }
      // Anti-spam: author may only answer if there is at least one unanswered question
      if (!entry.walkOff) {
        const transcript = Array.isArray(item.transcript) ? item.transcript : [];
        const questionCount = transcript.filter((t) => t.isQuestion === true).length;
        const answerCount   = transcript.filter((t) => !t.isQuestion && !t.walkOff).length;
        if (questionCount === 0 || answerCount >= questionCount) {
          return res.status(400).json({ error: "No unanswered questions to reply to" });
        }
      }
    }

    if (item.status === "closed") return res.status(409).json({ error: "Conference is closed" });

    const entryId = `te-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const safeEntry = {
      id:        entryId,
      from:      typeof entry.from === "string" ? entry.from.slice(0, MAX_TRANSCRIPT_FROM_LENGTH) : "Character",
      text:      entry.text.slice(0, MAX_TRANSCRIPT_TEXT_LENGTH),
      createdAt: new Date().toISOString(),
    };
    if (isQuestion) {
      safeEntry.isQuestion = true;
      if (typeof entry.paper === "string")    safeEntry.paper    = entry.paper.slice(0, 100);
      if (typeof entry.corrName === "string") safeEntry.corrName = entry.corrName.slice(0, 100);
    }
    if (entry.walkOff) safeEntry.walkOff = true;

    if (!item.transcript) item.transcript = [];
    item.transcript.push(safeEntry);

    if (entry.walkOff) item.status = "closed";

    const { rows: updated } = await pool.query(
      "UPDATE press_items SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at",
      [JSON.stringify(item), req.params.id]
    );
    res.json({ ok: true, id: updated[0].id, entryId, updatedAt: updated[0].updated_at });
  } catch (e) {
    console.error("[PATCH /api/press/:id/transcript]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/press/:id/mark — admin/mod any day; speaker Sundays only
app.post("/api/press/:id/mark", pressWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const roles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = roles.includes("admin") || roles.includes("mod");
    const isSpeakerRole = roles.includes("speaker");

    if (!isAdminOrMod && !isSpeakerRole) {
      return res.status(403).json({ error: "Forbidden: admin, mod, or speaker role required for marking" });
    }
    // Speaker may only mark on Sundays (UTC)
    if (!isAdminOrMod && isSpeakerRole) {
      if (new Date().getUTCDay() !== 0) {
        return res.status(403).json({ error: "Press marking is only available on Sundays for speakers" });
      }
    }

    const { score, impact } = req.body || {};
    if (score === undefined || score === null) {
      return res.status(400).json({ error: "score is required" });
    }
    const numScore = Number(score);
    if (isNaN(numScore) || numScore < -5 || numScore > 5) {
      return res.status(400).json({ error: "score must be between -5 and +5" });
    }
    const safeImpact = Array.isArray(impact) ? impact.map((s) => String(s).trim()).filter(Boolean) : [];

    const { rows } = await pool.query(
      "SELECT data, press_type FROM press_items WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Press item not found" });

    const item = { ...rows[0].data };
    const prevData = rows[0].data;
    item.score = numScore;
    item.impact = safeImpact;
    item.is_marked = true;
    item.marked_by = req.session.userId;
    item.marked_at = new Date().toISOString();
    if (rows[0].press_type === "conference") {
      item.status = "closed";
    }

    const { rows: updated } = await pool.query(
      "UPDATE press_items SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at",
      [JSON.stringify(item), req.params.id]
    );
    await writeAuditLog(req.session.userId, "press.mark", "press_items", req.params.id, prevData, item);
    res.json({ ok: true, id: updated[0].id, updatedAt: updated[0].updated_at, item });
  } catch (e) {
    console.error("[POST /api/press/:id/mark]", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POLLING ENTRIES
 * GET    /api/polling            — public: list polling entries
 * GET    /api/polling/:id        — public: get one polling entry
 * POST   /api/polling            — admin: create a polling entry
 * PUT    /api/polling/:id        — admin: update a polling entry
 * DELETE /api/polling/:id        — admin: delete a polling entry
 */
const pollReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const pollWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/polling", pollReadLimit, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, data, updated_at FROM polling_entries ORDER BY updated_at DESC"
    );
    res.json({ entries: rows.map((r) => ({ ...r.data, _updatedAt: r.updated_at })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/polling/:id", pollReadLimit, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, data, updated_at FROM polling_entries WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Polling entry not found" });
    res.json({ entry: { ...rows[0].data, _updatedAt: rows[0].updated_at } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/polling", pollWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const entry = req.body;
    if (!entry || typeof entry !== "object" || !entry.id) {
      return res.status(400).json({ error: "Body must be a polling entry with an id" });
    }
    const { rows: clk } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const enriched = attachLifecycle({ ...entry }, sm, sy);
    const { rows } = await pool.query(
      `INSERT INTO polling_entries (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id, updated_at`,
      [enriched.id, JSON.stringify(enriched)]
    );
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/polling/:id", pollWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const entry = req.body;
    if (!entry || typeof entry !== "object") {
      return res.status(400).json({ error: "Body must be a polling entry object" });
    }
    const { rows: before } = await pool.query("SELECT data FROM polling_entries WHERE id = $1", [req.params.id]);
    if (!before.length) return res.status(404).json({ error: "Polling entry not found" });
    const updated = { ...before[0].data, ...entry, id: req.params.id };
    const { rows } = await pool.query(
      `UPDATE polling_entries SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, updated_at`,
      [JSON.stringify(updated), req.params.id]
    );
    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/polling/:id", pollWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM polling_entries WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Polling entry not found" });
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
};

app.post("/api/debates/create", discourseWriteLimit, async (req, res) => {
  try {
    // Debate topic creation is restricted to admin and mod users.
    if (!requireAuth(req, res)) return;
    const roles = Array.isArray(req.session.roles) ? req.session.roles : [];
    if (!roles.includes("admin") && !roles.includes("mod")) {
      return res.status(403).json({ error: "Forbidden: admin or mod role required to create debate topics" });
    }

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
    // Check both the dedicated columns (canonical) and the JSONB data (legacy).
    const { rows: existing } = await pool.query(
      `SELECT COALESCE(discourse_topic_id, data->>'discourseTopicId')  AS topic_id,
              COALESCE(discourse_topic_url, data->>'discourseTopicUrl') AS topic_url
         FROM ${table} WHERE id = $1`,
      [String(entityId)]
    );
    if (existing.length && existing[0].topic_id) {
      const existingUrl = existing[0].topic_url || null;
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

    // Patch the entity row: update both dedicated columns and JSONB data for full compatibility.
    await pool.query(
      `UPDATE ${table}
          SET data                = data || $1::jsonb,
              discourse_topic_id  = $3,
              discourse_topic_url = $4,
              updated_at          = NOW()
        WHERE id = $2`,
      [JSON.stringify({ discourseTopicId: topicId, discourseTopicUrl: topicUrl }), String(entityId), String(topicId), topicUrl]
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
 * GET /api/debates/payload/:entityType/:entityId
 *
 * Stub: returns a structured "debate payload" for the given entity without
 * making any external Discourse API calls.  Use this to inspect the data
 * contract before wiring up live auto-thread creation.
 *
 * entityType: bill | motion | statement | regulation | question
 *
 * Response: {
 *   ok: true,
 *   payload: {
 *     title, body, category, tags, visibilityGroups,
 *     canonicalUrl,
 *     discourse: { category, groupVisibility },
 *     debate: { provider, status, topicId, topicUrl }
 *   }
 * }
 */
app.get("/api/debates/payload/:entityType/:entityId", discourseReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { entityType, entityId } = req.params;
    if (!DEBATE_ENTITY_TABLES[entityType]) {
      return res.status(400).json({
        error: `entityType must be one of: ${Object.keys(DEBATE_ENTITY_TABLES).join(", ")}`,
      });
    }

    const table = DEBATE_ENTITY_TABLES[entityType];
    // `table` is derived from DEBATE_ENTITY_TABLES — a static compile-time whitelist of
    // known-safe table names validated above.  Interpolating it here is not a SQL-injection risk.
    const { rows } = await pool.query(
      `SELECT id, data, created_at FROM ${table} WHERE id = $1`,
      [String(entityId)]
    );
    if (!rows.length) return res.status(404).json({ error: `${entityType} not found` });

    const entity = rows[0];
    const d = entity.data || {};

    // Resolve the canonical UI base URL from config (never hardcoded).
    const { rows: cfgRows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key = 'ui_base_url'"
    );
    const uiBase = (cfgRows[0]?.value || "").trim().replace(/\/$/, "");

    // Build entity-specific fields for the payload.
    const entityPageMap = {
      bill:       "bill.html",
      motion:     "motion.html",
      statement:  "statement.html",
      regulation: "regulation.html",
    };
    const canonicalUrl = uiBase
      ? `${uiBase}/${entityPageMap[entityType]}?id=${encodeURIComponent(entityId)}`
      : null;

    const title = d.title || d.name || `${entityType} ${entityId}`;
    const author = d.author || d.tabled_by || "";
    const status = d.status || d.stage || "draft";

    // Build the body text for the Discourse topic.
    const body = [
      `**${title}**`,
      author ? `Introduced by: ${author}` : null,
      d.department ? `Department: ${d.department}` : null,
      `Status: ${status}`,
      canonicalUrl ? `\n[View on Rule Britannia](${canonicalUrl})` : null,
      d.text || d.body || d.content ? `\n---\n${String(d.text || d.body || d.content || "").slice(0, 500)}` : null,
    ].filter(Boolean).join("\n");

    // Category and visibility groups per entity type.
    const categoryMap = {
      bill:       "Bills",
      motion:     "Motions",
      statement:  "Statements",
      regulation: "Regulations",
      question:   "Question_Time",
    };
    const visibilityGroups = ["Backbenchers", "Cabinet", "Shadow_Cabinet"];

    const existingTopicId  = d.discourseTopicId  ?? d.discourse_topic_id  ?? d.debate?.topicId  ?? null;
    const existingTopicUrl = d.discourseTopicUrl ?? d.discourse_topic_url ?? d.debate?.topicUrl ?? null;

    res.json({
      ok: true,
      payload: {
        title,
        body,
        category: categoryMap[entityType],
        tags:     [entityType, status].filter(Boolean),
        visibilityGroups,
        canonicalUrl,
        discourse: {
          category:        categoryMap[entityType],
          groupVisibility: visibilityGroups,
        },
        debate: {
          provider:  "discourse",
          status:    existingTopicId ? "created" : "pending",
          topicId:   existingTopicId,
          topicUrl:  existingTopicUrl,
        },
      },
    });
  } catch (e) {
    console.error("[debates/payload]", e);
    res.status(500).json({ error: "Server error" });
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

    // Always fetch: clock + config.  Conditionally fetch: user row + state + active character.
    const [clockRows, configRows, userRows, stateRows, charRows] = await Promise.all([
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

      // Canonical active character: prefer session pointer, then DB pointer, then any active char.
      isLoggedIn
        ? pool.query(
            `SELECT c.id, c.name, c.party, c.constituency, c.avatar, c.avatar_attribution, c.bio, c.personal_background,
                    c.date_of_birth, c.education, c.career_background, c.family, c.year_first_elected,
                    c.financial_background_level, c.twitter_handle,
                    c.is_active, c.user_id
               FROM characters c
              WHERE c.user_id = $1 AND c.is_active = TRUE
              ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                       c.created_at DESC
              LIMIT 1`,
            [req.session.userId]
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
    // Expose SSO availability so the login page can show the Discourse login button.
    config.sso_enabled = ssoEnabled;
    // Expose Turnstile config (site key is public; secret key is never sent to client).
    config.turnstile_enabled  = TURNSTILE_ENABLED;
    config.turnstile_site_key = TURNSTILE_SITE_KEY;

    if (isLoggedIn && !userRows.length) {
      // Session references a deleted user; destroy it silently.
      req.session.destroy(() => {});
      return res.json({ clock, config, user: null, csrfToken: null, state: null });
    }

    if (!isLoggedIn) {
      return res.json({ clock, config, user: null, csrfToken: null, state: null, is_demo: true });
    }

    // Lazily generate CSRF token for sessions that pre-date the feature.
    if (!req.session.csrfToken) {
      req.session.csrfToken = generateCsrfToken();
    }

    const user = userRows[0];
    const state = stateRows[0] ? { data: stateRows[0].data, updatedAt: stateRows[0].updated_at } : null;

    // Build canonical currentCharacter from the DB row (null when no active character).
    let currentCharacter = null;
    if (charRows[0]) {
      const c = charRows[0];
      currentCharacter = {
        id:                       c.id,
        name:                     c.name,
        party:                    c.party || "",
        constituency:             c.constituency || "",
        avatar:                   c.avatar || "",
        avatarAttribution:        c.avatar_attribution || "",
        bio:                      c.bio || c.personal_background || "",
        is_active:                c.is_active,
        dateOfBirth:              c.date_of_birth || "",
        education:                c.education || "",
        careerBackground:         c.career_background || "",
        family:                   c.family || "",
        yearFirstElected:         c.year_first_elected || "",
        financialBackgroundLevel: c.financial_background_level != null ? String(c.financial_background_level) : "",
        twitterHandle:            c.twitter_handle || "",
      };
    }

    res.json({ clock, config, user, csrfToken: req.session.csrfToken, state, currentCharacter, is_demo: false });
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

// ═══════════════════════════════════════════════════════════════════════════
// CHARACTERS
// GET    /api/characters           — authenticated: list characters
// GET    /api/characters/:id       — authenticated: get one character
// POST   /api/characters           — admin: create character
// PATCH  /api/characters/:id       — admin: update character
// ═══════════════════════════════════════════════════════════════════════════

const charReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const charWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/characters", charReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { active } = req.query;
    let q = "SELECT id, user_id, name, party, constituency, roles, offices, is_active, created_at FROM characters";
    const params = [];
    if (active === "true") { q += " WHERE is_active = TRUE"; }
    else if (active === "false") { q += " WHERE is_active = FALSE"; }
    q += " ORDER BY name";
    const { rows } = await pool.query(q, params);
    res.json({ characters: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// IMPORTANT: /mine must be registered BEFORE /:id so Express does not treat
// the literal string "mine" as a UUID parameter (which would cause a 500).
app.get("/api/characters/mine", charReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT id, user_id, name, party, constituency, roles, offices, is_active, created_at,
              date_of_birth, education, career_background, family, year_first_elected,
              personal_background, bio, financial_background_level, avatar, twitter_handle, home, rentals
         FROM characters WHERE user_id = $1 ORDER BY created_at`,
      [req.session.userId]
    );
    res.json({ characters: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/characters/:id", charReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, user_id, name, party, constituency, roles, offices, is_active, created_at FROM characters WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Character not found" });
    res.json({ character: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/characters", charWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { user_id, name, party = "", constituency = "", roles = [], offices = [], is_active = true } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (party && !ALL_CANONICAL_PARTIES.some((p) => p.name === party)) {
      return res.status(400).json({ error: `party must be one of: ${ALL_CANONICAL_PARTIES.map((p) => p.name).join(", ")}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO characters (user_id, name, party, constituency, roles, offices, is_active)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       RETURNING id, user_id, name, party, constituency, roles, offices, is_active, created_at`,
      [user_id || null, name.trim(), party, constituency, JSON.stringify(roles), JSON.stringify(offices), is_active]
    );
    // Seed backbencher salary position for all player characters
    if (rows[0].user_id) {
      await pool.query(
        "INSERT INTO character_positions (character_id, position_key) VALUES ($1, 'backbencher') ON CONFLICT DO NOTHING",
        [rows[0].id]
      );
    }
    await writeAuditLog(req.session.userId, "character.create", "character", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, character: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/characters/:id", charWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows: before } = await pool.query(
      "SELECT id, user_id, name, party, constituency, roles, offices, is_active FROM characters WHERE id = $1",
      [req.params.id]
    );
    if (!before.length) return res.status(404).json({ error: "Character not found" });

    const old = before[0];
    const { user_id = old.user_id, name = old.name, party = old.party,
            constituency = old.constituency, roles = old.roles,
            offices = old.offices, is_active = old.is_active } = req.body || {};

    if (party && !ALL_CANONICAL_PARTIES.some((p) => p.name === party)) {
      return res.status(400).json({ error: `party must be one of: ${ALL_CANONICAL_PARTIES.map((p) => p.name).join(", ")}` });
    }

    const { rows } = await pool.query(
      `UPDATE characters
          SET user_id = $1, name = $2, party = $3, constituency = $4,
              roles = $5::jsonb, offices = $6::jsonb, is_active = $7
        WHERE id = $8
        RETURNING id, user_id, name, party, constituency, roles, offices, is_active, created_at`,
      [user_id, name, party, constituency, JSON.stringify(roles), JSON.stringify(offices), is_active, req.params.id]
    );
    await writeAuditLog(req.session.userId, "character.update", "character", req.params.id, old, rows[0]);
    res.json({ ok: true, character: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/characters/:id/profile — admin/mod/speaker: directly update profile fields (no approval queue)
app.post("/api/admin/characters/:id/profile", charWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;

    const { rows: before } = await pool.query(
      `SELECT c.id, c.education, c.career_background, c.family, c.date_of_birth,
              c.financial_background_level, c.twitter_handle, c.avatar,
              cf.bank_balance, cf.annual_salary_override
         FROM characters c
         LEFT JOIN character_finance cf ON cf.character_id = c.id
        WHERE c.id = $1`,
      [req.params.id]
    );
    if (!before.length) return res.status(404).json({ error: "Character not found" });

    const {
      education, career_background, family, date_of_birth,
      financial_background_level, twitter_handle, avatar, avatar_attribution,
      bank_balance, salary_annual,
    } = req.body || {};

    // Validate date_of_birth if provided
    if (date_of_birth !== undefined && date_of_birth !== null && date_of_birth !== "") {
      const dob = new Date(String(date_of_birth));
      if (isNaN(dob.getTime())) {
        return res.status(400).json({ error: "date_of_birth must be a valid date (YYYY-MM-DD)" });
      }
    }

    const setClauses = [];
    const params = [];
    let i = 1;
    if (education         !== undefined) { setClauses.push(`education = $${i++}`);                  params.push(String(education || "").slice(0, 500)); }
    if (career_background !== undefined) { setClauses.push(`career_background = $${i++}`);          params.push(String(career_background || "").slice(0, 500)); }
    if (family            !== undefined) { setClauses.push(`family = $${i++}`);                     params.push(String(family || "").slice(0, 500)); }
    if (date_of_birth     !== undefined) { setClauses.push(`date_of_birth = $${i++}`);              params.push(String(date_of_birth || "").slice(0, 50) || null); }
    if (twitter_handle    !== undefined) { setClauses.push(`twitter_handle = $${i++}`);             params.push(String(twitter_handle || "").trim().replace(/^@+/, "").slice(0, 100)); }
    if (avatar            !== undefined) { setClauses.push(`avatar = $${i++}`);                     params.push(String(avatar || "").slice(0, 500)); }
    if (avatar_attribution !== undefined) { setClauses.push(`avatar_attribution = $${i++}`);        params.push(String(avatar_attribution || "").slice(0, 500)); }
    if (financial_background_level !== undefined) {
      const lvl = parseInt(financial_background_level, 10);
      setClauses.push(`financial_background_level = $${i++}`);
      params.push(Number.isFinite(lvl) && lvl >= 1 && lvl <= 10 ? lvl : null);
    }

    if (setClauses.length) {
      params.push(req.params.id);
      await pool.query(`UPDATE characters SET ${setClauses.join(", ")} WHERE id = $${i}`, params);
    }

    // Update finance fields if provided
    if (bank_balance !== undefined || salary_annual !== undefined) {
      // Ensure finance row exists first
      await pool.query(
        `INSERT INTO character_finance (character_id, bank_balance) VALUES ($1, 0) ON CONFLICT (character_id) DO NOTHING`,
        [req.params.id]
      );
      const finClauses = [];
      const finParams = [];
      let j = 1;
      if (bank_balance  !== undefined) { finClauses.push(`bank_balance = $${j++}`);             finParams.push(parseFloat(bank_balance) ?? 0); }
      if (salary_annual !== undefined) { finClauses.push(`annual_salary_override = $${j++}`);   finParams.push(salary_annual !== "" ? parseFloat(salary_annual) : null); }
      finParams.push(req.params.id);
      await pool.query(
        `UPDATE character_finance SET ${finClauses.join(", ")}, updated_at = NOW() WHERE character_id = $${j}`,
        finParams
      );
    }

    await writeAuditLog(req.session.userId, "admin.character.profile.update", "character", req.params.id, before[0], req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/admin/characters/:id/profile]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHARACTER APPLICATIONS (DB-backed creation flow)
// GET  /api/characters/mine                      — authenticated: list caller's characters
// POST /api/characters/select                    — authenticated: set session active character
// POST /api/characters/apply                     — authenticated: submit character application
// GET  /api/characters/applications/mine         — authenticated: get own applications
// GET  /api/admin/characters/applications        — admin/mod: list applications
// POST /api/admin/characters/applications/:id/approve — admin/mod: approve application
// POST /api/admin/characters/applications/:id/reject  — admin/mod: reject application
// ═══════════════════════════════════════════════════════════════════════════

const charAppReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const charAppWriteLimit = rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true, legacyHeaders: false });

// POST /api/characters/select — set session active character
app.post("/api/characters/select", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { character_id } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });

    const { rows } = await pool.query(
      `SELECT id, user_id, name, party, constituency, roles, offices, is_active, created_at,
              date_of_birth, education, career_background, family, year_first_elected,
              personal_background, bio, financial_background_level, avatar, twitter_handle, home, rentals
         FROM characters WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
      [character_id, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Character not found or not yours" });

    // Set DB-canonical pointer
    await pool.query(
      "UPDATE users SET active_character_id = $1 WHERE id = $2",
      [rows[0].id, req.session.userId]
    );

    req.session.characterId = rows[0].id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: "Session save failed" });
      res.json({ ok: true, character: rows[0] });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/characters/apply — submit a character application
app.post("/api/characters/apply", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const {
      name, party = "", constituency = "",
      date_of_birth, education, career_background, family,
      year_first_elected, personal_background, bio,
      financial_background_level = 1,
      avatar = "", avatar_attribution = "", twitter_handle = "",
      home = {}, rentals = []
    } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!avatar_attribution || typeof avatar_attribution !== "string" || !avatar_attribution.trim()) {
      return res.status(400).json({ error: "avatar_attribution (who is your avatar?) is required" });
    }

    // Enforce bio max length
    const bioValue = bio != null ? String(bio).slice(0, 2000) : (personal_background ?? null);

    // Only the three canonical playable parties are accepted.
    if (party && !PLAYABLE_PARTIES.includes(party)) {
      return res.status(400).json({ error: `party must be one of: ${PLAYABLE_PARTIES.join(", ")}` });
    }

    // Check applicant has no active character (DB-canonical pointer or any active character)
    const { rows: userRow } = await pool.query(
      "SELECT active_character_id FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (userRow[0]?.active_character_id) {
      return res.status(409).json({ error: "You already have an active character. Mark it inactive before applying." });
    }
    const { rows: existing } = await pool.query(
      "SELECT id FROM characters WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
      [req.session.userId]
    );
    if (existing.length) {
      return res.status(409).json({ error: "You already have an active character. Mark it inactive before applying." });
    }

    // Check no pending application already
    const { rows: pending } = await pool.query(
      "SELECT id FROM pending_character_applications WHERE applicant_user_id = $1 AND status = 'pending' LIMIT 1",
      [req.session.userId]
    );
    if (pending.length) {
      return res.status(409).json({ error: "You already have a pending application." });
    }

    // Check constituency not already taken by an active character
    if (constituency) {
      const { rows: taken } = await pool.query(
        "SELECT id FROM characters WHERE LOWER(constituency) = LOWER($1) AND is_active = TRUE LIMIT 1",
        [constituency]
      );
      if (taken.length) {
        return res.status(409).json({ error: "That constituency is already taken by an active character." });
      }
    }

    // Get applicant username
    const { rows: userRows } = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
    const applicantUsername = userRows[0]?.username ?? req.session.userId;

    const { rows } = await pool.query(
      `INSERT INTO pending_character_applications
         (applicant_user_id, applicant_username, name, party, constituency,
          date_of_birth, education, career_background, family, year_first_elected,
          personal_background, bio, financial_background_level, avatar, avatar_attribution, twitter_handle, home, rentals)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb)
       RETURNING *`,
      [
        req.session.userId, applicantUsername, name.trim(), party, constituency,
        date_of_birth ?? null, education ?? null, career_background ?? null,
        family ?? null, year_first_elected ?? null, personal_background ?? null, bioValue,
        Number(financial_background_level) || 1,
        String(avatar || "").trim(),
        String(avatar_attribution || "").trim(),
        String(twitter_handle || "").trim().replace(/^@+/, ""),
        JSON.stringify(home), JSON.stringify(rentals)
      ]
    );
    await writeAuditLog(req.session.userId, "character.apply", "pending_character_application", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, application: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/characters/applications/mine — list own applications
app.get("/api/characters/applications/mine", charAppReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT * FROM pending_character_applications WHERE applicant_user_id = $1 ORDER BY submitted_at DESC",
      [req.session.userId]
    );
    res.json({ applications: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/characters/applications — list all applications (admin/mod)
app.get("/api/admin/characters/applications", charAppReadLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { status } = req.query;
    let q = "SELECT * FROM pending_character_applications";
    const params = [];
    if (status) { q += " WHERE status = $1"; params.push(status); }
    q += " ORDER BY submitted_at DESC";
    const { rows } = await pool.query(q, params);
    res.json({ applications: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/characters/applications/:id/approve — approve and create character
app.post("/api/admin/characters/applications/:id/approve", charAppWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAdminOrMod(req, res)) return;

    const { rows: appRows } = await client.query(
      "SELECT * FROM pending_character_applications WHERE id = $1",
      [req.params.id]
    );
    if (!appRows.length) return res.status(404).json({ error: "Application not found" });
    const app_ = appRows[0];
    if (app_.status !== "pending") return res.status(409).json({ error: `Application is already ${app_.status}` });

    // Server-side constituency check
    if (app_.constituency) {
      const { rows: taken } = await client.query(
        "SELECT id FROM characters WHERE LOWER(constituency) = LOWER($1) AND is_active = TRUE LIMIT 1",
        [app_.constituency]
      );
      if (taken.length) {
        return res.status(409).json({ error: "Constituency is already taken by an active character." });
      }
    }

    await client.query("BEGIN");

    // Deactivate any existing active characters for the applicant
    await client.query(
      "UPDATE characters SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE",
      [app_.applicant_user_id]
    );

    // Create the character, linking it back to the originating application
    const { rows: charRows } = await client.query(
      `INSERT INTO characters
         (user_id, application_id, name, party, constituency, roles, offices, is_active,
          date_of_birth, education, career_background, family, year_first_elected,
          personal_background, bio, financial_background_level, avatar, avatar_attribution, twitter_handle, home, rentals)
       VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,TRUE,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb)
       RETURNING *`,
      [
        app_.applicant_user_id, req.params.id, app_.name, app_.party, app_.constituency,
        app_.date_of_birth, app_.education, app_.career_background, app_.family,
        app_.year_first_elected, app_.personal_background, app_.bio ?? null,
        app_.financial_background_level,
        app_.avatar, app_.avatar_attribution, app_.twitter_handle,
        JSON.stringify(app_.home ?? {}), JSON.stringify(app_.rentals ?? [])
      ]
    );
    const character = charRows[0];

    // Set DB-canonical active character pointer on the user
    await client.query(
      "UPDATE users SET active_character_id = $1 WHERE id = $2",
      [character.id, app_.applicant_user_id]
    );

    // Mark application approved
    await client.query(
      "UPDATE pending_character_applications SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );

    await client.query("COMMIT");

    // Seed backbencher salary position for newly created character (best-effort)
    await pool.query(
      "INSERT INTO character_positions (character_id, position_key) VALUES ($1, 'backbencher') ON CONFLICT DO NOTHING",
      [character.id]
    ).catch((e) => console.warn("[approve] backbencher seed failed:", e.message));

    // Seed starting bank balance from financial background level (one-time, only if no finance row exists)
    const startingBalance = STARTING_BALANCES[Math.min(10, Math.max(1, Number(app_.financial_background_level) || 5))] ?? 25000;
    await pool.query(
      `INSERT INTO character_finance (character_id, bank_balance)
       VALUES ($1, $2)
       ON CONFLICT (character_id) DO UPDATE
         SET bank_balance = EXCLUDED.bank_balance
         WHERE character_finance.bank_balance = 0`,
      [character.id, startingBalance]
    ).catch((e) => console.warn("[approve] starting balance seed failed:", e.message));

    // Update the applicant's active sessions to reflect the new active character (best-effort).
    try {
      await pool.query(
        `UPDATE sessions
            SET sess = jsonb_set(sess::jsonb, '{characterId}', to_jsonb($1::text))::json
          WHERE sess::jsonb->>'userId' = $2`,
        [character.id, app_.applicant_user_id]
      );
    } catch (sessErr) {
      console.warn("[approve] session update for applicant failed (non-fatal):", sessErr.message);
    }

    await writeAuditLog(
      req.session.userId, "character.application.approve",
      "pending_character_application", req.params.id,
      app_, { ...app_, status: "approved", character_id: character.id }
    );
    res.json({ ok: true, character });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// POST /api/admin/characters/applications/:id/reject — reject application
app.post("/api/admin/characters/applications/:id/reject", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    const { rows: appRows } = await pool.query(
      "SELECT * FROM pending_character_applications WHERE id = $1",
      [req.params.id]
    );
    if (!appRows.length) return res.status(404).json({ error: "Application not found" });
    const app_ = appRows[0];
    if (app_.status !== "pending") return res.status(409).json({ error: `Application is already ${app_.status}` });

    await pool.query(
      "UPDATE pending_character_applications SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );

    await writeAuditLog(
      req.session.userId, "character.application.reject",
      "pending_character_application", req.params.id,
      app_, { ...app_, status: "rejected" }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/characters/:id/set-inactive — admin/mod: mark a character inactive
app.post("/api/admin/characters/:id/set-inactive", charWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    const { rows: before } = await pool.query(
      "SELECT id, user_id, name, is_active FROM characters WHERE id = $1",
      [req.params.id]
    );
    if (!before.length) return res.status(404).json({ error: "Character not found" });
    if (!before[0].is_active) return res.status(409).json({ error: "Character is already inactive" });

    const { rows } = await pool.query(
      "UPDATE characters SET is_active = FALSE WHERE id = $1 RETURNING id, user_id, name, party, constituency, is_active",
      [req.params.id]
    );

    // Clear DB-canonical active character pointer if it points to this character
    if (before[0].user_id) {
      await pool.query(
        "UPDATE users SET active_character_id = NULL WHERE id = $1 AND active_character_id = $2",
        [before[0].user_id, req.params.id]
      );
    }

    await writeAuditLog(
      req.session.userId, "character.set-inactive", "character", req.params.id,
      before[0], rows[0]
    );

    // Clear the characterId pointer from any sessions belonging to the character's owner
    // so they are forced to re-select (and getActiveCharacterId will return NULL via DB).
    if (before[0].user_id) {
      try {
        await pool.query(
          `UPDATE sessions
              SET sess = (sess::jsonb - 'characterId')::json
            WHERE sess::jsonb->>'userId'     = $1
              AND sess::jsonb->>'characterId' = $2`,
          [before[0].user_id, req.params.id]
        );
      } catch (sessErr) {
        console.warn("[set-inactive] session clear failed (non-fatal):", sessErr.message);
      }
    }

    res.json({ ok: true, character: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/repair/character-owner-pointers — admin/mod: reconcile approved applications
// whose created characters have a missing or incorrect user_id owner pointer.
app.post("/api/admin/repair/character-owner-pointers", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    // Diagnostic counts — collected before repairs so they reflect the "problem" state
    const { rows: orphanRows } = await pool.query(`
      SELECT id, name, party, constituency, is_active
        FROM characters WHERE user_id IS NULL ORDER BY name LIMIT 50
    `);
    const orphansCount = orphanRows.length;

    const { rows: approvedAppsRows } = await pool.query(`
      SELECT COUNT(*) AS cnt FROM pending_character_applications WHERE status = 'approved'
    `);
    const approvedAppsCount = Number(approvedAppsRows[0]?.cnt ?? 0);

    // Step 1: Fix user_id on characters linked to approved applications.
    // Prefer matching by application_id (exact link set during approval).
    // Fall back to case-insensitive name match with whitespace normalization;
    // party and constituency used as tiebreakers when non-empty.
    const { rows: fixedById } = await pool.query(`
      UPDATE characters c
         SET user_id = pca.applicant_user_id,
             application_id = COALESCE(c.application_id, pca.id)
        FROM pending_character_applications pca
       WHERE pca.status = 'approved'
         AND c.application_id = pca.id
         AND (c.user_id IS NULL OR c.user_id != pca.applicant_user_id)
      RETURNING c.id, c.name, pca.applicant_user_id AS new_user_id, pca.applicant_username
    `);

    const { rows: fixedByName } = await pool.query(`
      UPDATE characters c
         SET user_id = pca.applicant_user_id,
             application_id = COALESCE(c.application_id, pca.id)
        FROM pending_character_applications pca
       WHERE pca.status = 'approved'
         AND c.application_id IS NULL
         AND REGEXP_REPLACE(LOWER(c.name),    '\\s+', ' ', 'g') =
             REGEXP_REPLACE(LOWER(pca.name),  '\\s+', ' ', 'g')
         AND (pca.party        = '' OR LOWER(c.party)        = LOWER(pca.party))
         AND (pca.constituency = '' OR LOWER(c.constituency) = LOWER(pca.constituency))
         AND (c.user_id IS NULL OR c.user_id != pca.applicant_user_id)
      RETURNING c.id, c.name, pca.applicant_user_id AS new_user_id, pca.applicant_username
    `);

    const fixed = [...fixedById, ...fixedByName];

    // Step 2: Repair users.active_character_id where it is NULL but deterministically resolvable.
    // If a user owns exactly one active character, set the pointer.
    // Use ARRAY_AGG(id)[1] instead of MIN(id) because id is a UUID type and
    // Postgres does not support MIN(uuid); when HAVING COUNT(*) = 1 the array
    // has exactly one element so [1] is the safe portable pick.
    const { rows: activePointerFixed } = await pool.query(`
      UPDATE users u
         SET active_character_id = c.id
        FROM (
          SELECT user_id, (ARRAY_AGG(id))[1] AS char_id
            FROM characters
           WHERE is_active = TRUE AND user_id IS NOT NULL
           GROUP BY user_id
          HAVING COUNT(*) = 1
        ) sub
        JOIN characters c ON c.id = sub.char_id
       WHERE u.id = sub.user_id
         AND (u.active_character_id IS NULL OR u.active_character_id != c.id)
      RETURNING u.id, c.id AS char_id
    `);
    const activePointerFixedCount = activePointerFixed.length;

    // Step 3: Clear stale session characterId pointers.
    let sessionsCleared = 0;
    try {
      const { rowCount } = await pool.query(`
        UPDATE sessions
           SET sess = (sess::jsonb - 'characterId')::json
         WHERE sess::jsonb->>'characterId' IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM characters c
              WHERE c.id::text      = sess::jsonb->>'characterId'
                AND c.user_id::text = sess::jsonb->>'userId'
                AND c.is_active     = TRUE
           )
      `);
      sessionsCleared = rowCount ?? 0;
    } catch (sessErr) {
      console.warn("[repair] session cleanup failed (non-fatal):", sessErr.message);
    }

    if (fixed.length || activePointerFixedCount > 0 || sessionsCleared > 0) {
      await writeAuditLog(
        req.session.userId, "admin.repair.character-owner-pointers", "characters", null,
        null, {
          fixed_count: fixed.length,
          active_pointer_fixed_count: activePointerFixedCount,
          sessions_cleared: sessionsCleared,
          fixed,
        }
      );
    }

    const parts = [];
    if (fixed.length) parts.push(`Repaired ${fixed.length} character owner pointer(s).`);
    if (activePointerFixedCount > 0) parts.push(`Fixed ${activePointerFixedCount} active character pointer(s) on users.`);
    if (sessionsCleared > 0) parts.push(`Cleared ${sessionsCleared} stale session pointer(s).`);

    res.json({
      ok: true,
      orphans_count: orphansCount,
      approved_applications_count: approvedAppsCount,
      matched_by_application_id_count: fixedById.length,
      matched_by_name_fallback_count: fixedByName.length,
      fixed_count: fixed.length,
      active_pointer_fixed_count: activePointerFixedCount,
      sessions_cleared: sessionsCleared,
      orphans: orphanRows.map((r) => ({ id: r.id, name: r.name, party: r.party, constituency: r.constituency, is_active: r.is_active })),
      fixed: fixed.map((r) => ({ id: r.id, name: r.name, new_user_id: r.new_user_id, applicant_username: r.applicant_username })),
      message: parts.length ? parts.join(" ") : "No characters needed repair.",
    });
  } catch (e) {
    const errId = Date.now().toString(36);
    console.error(`[repair/character-owner-pointers] errId=${errId}`, e);
    res.status(500).json({ error: "Server error", errId });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BIOGRAPHY CHANGE REQUESTS
// POST /api/characters/bio-change — submit a bio change request
// GET  /api/characters/bio-changes/mine — list own pending bio changes
// GET  /api/admin/bio-changes — list all pending bio changes (admin/mod/speaker)
// POST /api/admin/bio-changes/:id/approve — approve a bio change
// POST /api/admin/bio-changes/:id/reject  — reject a bio change
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/characters/bio-change", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { proposed_bio } = req.body || {};
    if (!proposed_bio || typeof proposed_bio !== "string" || !proposed_bio.trim()) {
      return res.status(400).json({ error: "proposed_bio is required" });
    }
    if (proposed_bio.length > 2000) {
      return res.status(400).json({ error: "Biography must be 2000 characters or fewer" });
    }

    // Resolve active character for this user
    const { rows: charRows } = await pool.query(
      "SELECT id FROM characters WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
      [req.session.userId]
    );
    if (!charRows.length) {
      return res.status(404).json({ error: "No active character found" });
    }
    const character_id = charRows[0].id;

    // Only one pending bio change per character at a time
    const { rows: existing } = await pool.query(
      "SELECT id FROM pending_bio_changes WHERE character_id = $1 AND status = 'pending' LIMIT 1",
      [character_id]
    );
    if (existing.length) {
      return res.status(409).json({ error: "You already have a pending biography change request." });
    }

    const { rows } = await pool.query(
      `INSERT INTO pending_bio_changes (character_id, user_id, proposed_bio)
       VALUES ($1,$2,$3) RETURNING *`,
      [character_id, req.session.userId, proposed_bio.trim()]
    );
    await writeAuditLog(req.session.userId, "bio_change.submit", "pending_bio_changes", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, change: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/characters/bio-changes/mine", charAppReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: charRows } = await pool.query(
      "SELECT id FROM characters WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
      [req.session.userId]
    );
    if (!charRows.length) return res.json({ changes: [] });
    const { rows } = await pool.query(
      "SELECT * FROM pending_bio_changes WHERE character_id = $1 ORDER BY submitted_at DESC",
      [charRows[0].id]
    );
    res.json({ changes: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/admin/bio-changes", charAppReadLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { status } = req.query;
    let q = `SELECT pbc.*, c.name AS character_name, u.username AS submitter_username
             FROM pending_bio_changes pbc
             JOIN characters c ON c.id = pbc.character_id
             JOIN users u ON u.id = pbc.user_id`;
    const params = [];
    if (status) { q += " WHERE pbc.status = $1"; params.push(status); }
    q += " ORDER BY pbc.submitted_at DESC";
    const { rows } = await pool.query(q, params);
    res.json({ changes: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/bio-changes/:id/approve", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows: changeRows } = await pool.query(
      "SELECT * FROM pending_bio_changes WHERE id = $1",
      [req.params.id]
    );
    if (!changeRows.length) return res.status(404).json({ error: "Bio change request not found" });
    const change = changeRows[0];
    if (change.status !== "pending") {
      return res.status(409).json({ error: `Bio change request is already ${change.status}` });
    }

    // Apply the bio to the character record
    await pool.query(
      "UPDATE characters SET bio = $1 WHERE id = $2",
      [change.proposed_bio, change.character_id]
    );
    await pool.query(
      "UPDATE pending_bio_changes SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );
    await writeAuditLog(
      req.session.userId, "bio_change.approve", "pending_bio_changes", req.params.id,
      change, { ...change, status: "approved" }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/bio-changes/:id/reject", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows: changeRows } = await pool.query(
      "SELECT * FROM pending_bio_changes WHERE id = $1",
      [req.params.id]
    );
    if (!changeRows.length) return res.status(404).json({ error: "Bio change request not found" });
    const change = changeRows[0];
    if (change.status !== "pending") {
      return res.status(409).json({ error: `Bio change request is already ${change.status}` });
    }

    await pool.query(
      "UPDATE pending_bio_changes SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );
    await writeAuditLog(
      req.session.userId, "bio_change.reject", "pending_bio_changes", req.params.id,
      change, { ...change, status: "rejected" }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Avatar Change Requests ────────────────────────────────────────────────────
// POST /api/characters/avatar-change — submit an avatar change request
// GET  /api/characters/avatar-changes/mine — list own pending avatar changes
// GET  /api/admin/avatar-changes — list all pending avatar changes (admin/mod/speaker)
// POST /api/admin/avatar-changes/:id/approve — approve an avatar change
// POST /api/admin/avatar-changes/:id/reject  — reject an avatar change
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/characters/avatar-change", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { proposed_avatar, proposed_avatar_attribution } = req.body || {};
    if (!proposed_avatar || typeof proposed_avatar !== "string" || !proposed_avatar.trim()) {
      return res.status(400).json({ error: "proposed_avatar is required" });
    }
    if (!proposed_avatar_attribution || typeof proposed_avatar_attribution !== "string" || !proposed_avatar_attribution.trim()) {
      return res.status(400).json({ error: "proposed_avatar_attribution (who is your avatar?) is required" });
    }

    const { rows: charRows } = await pool.query(
      "SELECT id FROM characters WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
      [req.session.userId]
    );
    if (!charRows.length) {
      return res.status(404).json({ error: "No active character found" });
    }
    const character_id = charRows[0].id;

    const { rows: existing } = await pool.query(
      "SELECT id FROM pending_avatar_changes WHERE character_id = $1 AND status = 'pending' LIMIT 1",
      [character_id]
    );
    if (existing.length) {
      return res.status(409).json({ error: "You already have a pending avatar change request." });
    }

    const { rows } = await pool.query(
      `INSERT INTO pending_avatar_changes (character_id, user_id, proposed_avatar, proposed_avatar_attribution)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [character_id, req.session.userId, proposed_avatar.trim(), proposed_avatar_attribution.trim()]
    );
    await writeAuditLog(req.session.userId, "avatar_change.submit", "pending_avatar_changes", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, change: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/characters/avatar-changes/mine", charAppReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: charRows } = await pool.query(
      "SELECT id FROM characters WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
      [req.session.userId]
    );
    if (!charRows.length) return res.json({ changes: [] });
    const { rows } = await pool.query(
      "SELECT * FROM pending_avatar_changes WHERE character_id = $1 ORDER BY submitted_at DESC",
      [charRows[0].id]
    );
    res.json({ changes: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/admin/avatar-changes", charAppReadLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { status } = req.query;
    let q = `SELECT pac.*, c.name AS character_name, u.username AS submitter_username
             FROM pending_avatar_changes pac
             JOIN characters c ON c.id = pac.character_id
             JOIN users u ON u.id = pac.user_id`;
    const params = [];
    if (status) { q += " WHERE pac.status = $1"; params.push(status); }
    q += " ORDER BY pac.submitted_at DESC";
    const { rows } = await pool.query(q, params);
    res.json({ changes: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/avatar-changes/:id/approve", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows: changeRows } = await pool.query(
      "SELECT * FROM pending_avatar_changes WHERE id = $1",
      [req.params.id]
    );
    if (!changeRows.length) return res.status(404).json({ error: "Avatar change request not found" });
    const change = changeRows[0];
    if (change.status !== "pending") {
      return res.status(409).json({ error: `Avatar change request is already ${change.status}` });
    }

    await pool.query(
      "UPDATE characters SET avatar = $1, avatar_attribution = $2 WHERE id = $3",
      [change.proposed_avatar, change.proposed_avatar_attribution, change.character_id]
    );
    await pool.query(
      "UPDATE pending_avatar_changes SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );
    await writeAuditLog(
      req.session.userId, "avatar_change.approve", "pending_avatar_changes", req.params.id,
      change, { ...change, status: "approved" }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/avatar-changes/:id/reject", charAppWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows: changeRows } = await pool.query(
      "SELECT * FROM pending_avatar_changes WHERE id = $1",
      [req.params.id]
    );
    if (!changeRows.length) return res.status(404).json({ error: "Avatar change request not found" });
    const change = changeRows[0];
    if (change.status !== "pending") {
      return res.status(409).json({ error: `Avatar change request is already ${change.status}` });
    }

    await pool.query(
      "UPDATE pending_avatar_changes SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );
    await writeAuditLog(
      req.session.userId, "avatar_change.reject", "pending_avatar_changes", req.params.id,
      change, { ...change, status: "rejected" }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

const propertyWriteLimit = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.post("/api/mod/property/set", propertyWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { character_id, home, rentals } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });

    const { rows: before } = await pool.query(
      "SELECT id, name, home, rentals FROM characters WHERE id = $1",
      [character_id]
    );
    if (!before.length) return res.status(404).json({ error: "Character not found" });

    // Normalize home: ensure mortgaged is boolean
    const normalizedHome = home ?? before[0].home ?? {};
    if (home) {
      normalizedHome.mortgaged = !!home.mortgaged;
    }

    // Normalize rentals: ensure status is lowercase/trimmed, mortgaged is boolean
    const VALID_STATUSES = new Set(["occupied", "vacant", "under renovation"]);
    const normalizedRentals = (rentals ?? before[0].rentals ?? []).map((r) => {
      const status = String(r.status || "occupied").toLowerCase().trim();
      return {
        ...r,
        status:    VALID_STATUSES.has(status) ? status : "occupied",
        mortgaged: !!r.mortgaged,
      };
    });

    const { rows } = await pool.query(
      `UPDATE characters SET home = $1::jsonb, rentals = $2::jsonb WHERE id = $3
       RETURNING id, name, home, rentals`,
      [JSON.stringify(normalizedHome), JSON.stringify(normalizedRentals), character_id]
    );
    await writeAuditLog(
      req.session.userId, "character.property.set", "character", character_id,
      { home: before[0].home, rentals: before[0].rentals },
      { home: rows[0].home, rentals: rows[0].rentals }
    );
    res.json({ ok: true, character: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PARTIES (DB-backed leadership)
// GET  /api/parties/:partyId           — authenticated: get party info
// POST /api/parties/:partyId/leadership — authenticated: set chairman/whip (leader or admin/mod)
// ═══════════════════════════════════════════════════════════════════════════

const partyReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const partyWriteLimit = rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true, legacyHeaders: false });

// GET /api/parties/canonical — must be before /:partyId to avoid being caught by the param route
app.get("/api/parties/canonical", partyReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query(
      `SELECT slug, name, short_name, playable FROM parties ORDER BY playable DESC, name`
    );
    res.json({ parties: rows });
  } catch (e) {
    console.error("[GET /api/parties/canonical]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/parties/:partyId", partyReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const [partyResult, shopResult] = await Promise.all([
      pool.query(
        `SELECT p.*,
                lc.id   AS leader_id,      lc.name AS leader_name,      lc.avatar AS leader_avatar,
                cc.id   AS chairman_id,    cc.name AS chairman_name,    cc.avatar AS chairman_avatar,
                wc.id   AS whip_id,        wc.name AS whip_name,        wc.avatar AS whip_avatar,
                cw.id   AS chief_whip_id,  cw.name AS chief_whip_name,  cw.avatar AS chief_whip_avatar,
                dw.id   AS deputy_whip_id, dw.name AS deputy_whip_name, dw.avatar AS deputy_whip_avatar
           FROM parties p
           LEFT JOIN characters lc ON lc.id = p.leader_character_id
           LEFT JOIN characters cc ON cc.id = p.chairman_character_id
           LEFT JOIN characters wc ON wc.id = p.whip_character_id
           LEFT JOIN characters cw ON cw.id = p.chief_whip_character_id
           LEFT JOIN characters dw ON dw.id = p.deputy_whip_character_id
          WHERE p.slug = $1`,
        [req.params.partyId]
      ),
      pool.query(
        `SELECT id, item_id, item_name, price, monthly_upkeep, effects, risk_modifier, purchased_at
           FROM party_shop_purchases WHERE party_slug = $1 ORDER BY purchased_at`,
        [req.params.partyId]
      ),
    ]);

    if (!partyResult.rows.length) return res.status(404).json({ error: "Party not found" });
    const party = partyResult.rows[0];
    party.partyShopPurchases = shopResult.rows.map((p) => ({
      id:            p.id,
      itemId:        p.item_id,
      itemName:      p.item_name,
      name:          p.item_name,
      price:         Number(p.price),
      monthlyUpkeep: Number(p.monthly_upkeep),
      effects:       Array.isArray(p.effects) ? p.effects : [],
      riskModifier:  p.risk_modifier ?? null,
      purchasedAt:   p.purchased_at,
    }));
    // Include drafts array from DB column
    party.drafts = Array.isArray(party.drafts) ? party.drafts : [];
    // Expose membership fee
    party.membershipFeeAnnual = Number(party.membership_fee_annual || 0);
    res.json({ party });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/parties/:partyId/set-leader — admin/mod only: set party leader (DB-backed)
app.post("/api/parties/:partyId/set-leader", partyWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { character_id } = req.body || {};

    const { rows: partyRows } = await pool.query("SELECT * FROM parties WHERE slug = $1", [req.params.partyId]);
    if (!partyRows.length) return res.status(404).json({ error: "Party not found" });
    const partyData = partyRows[0];
    const oldLeaderId = partyData.leader_character_id;

    if (character_id) {
      const { rows: charRows } = await pool.query(
        "SELECT id, party FROM characters WHERE id = $1 AND is_active = TRUE", [character_id]
      );
      if (!charRows.length) return res.status(404).json({ error: "Character not found or inactive" });
      if (charRows[0].party.toLowerCase() !== partyData.slug.toLowerCase()) {
        return res.status(409).json({ error: "Character does not belong to this party" });
      }
    }

    const { rows: updated } = await pool.query(
      "UPDATE parties SET leader_character_id = $1, updated_at = NOW() WHERE slug = $2 RETURNING *",
      [character_id || null, req.params.partyId]
    );

    // Recompute salary positions for old and new leader
    for (const charId of [oldLeaderId, character_id].filter(Boolean)) {
      await recomputeSalaryPositions(charId).catch((e) => console.error("[salary positions]", charId, e.message));
    }

    await writeAuditLog(req.session.userId, "party.leader.set", "party", partyData.id,
      { leader_character_id: oldLeaderId }, { leader_character_id: character_id || null });
    res.json({ ok: true, party: updated[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/parties/:partyId/leadership", partyWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { role, character_id } = req.body || {};
    if (!role || !["chairman", "whip"].includes(role)) {
      return res.status(400).json({ error: "role must be 'chairman' or 'whip'" });
    }

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");

    // Non-admin/mod must be the active character who is party leader
    if (!isAdminOrMod) {
      if (!req.session.characterId) {
        return res.status(403).json({ error: "No active character selected" });
      }
      const { rows: partyRows } = await pool.query(
        "SELECT leader_character_id FROM parties WHERE slug = $1",
        [req.params.partyId]
      );
      if (!partyRows.length) return res.status(404).json({ error: "Party not found" });
      if (String(partyRows[0].leader_character_id) !== String(req.session.characterId)) {
        return res.status(403).json({ error: "Only the party leader (or admin/mod) can assign chairman/whip" });
      }
    }

    // Validate party exists
    const { rows: partyRows } = await pool.query("SELECT * FROM parties WHERE slug = $1", [req.params.partyId]);
    if (!partyRows.length) return res.status(404).json({ error: "Party not found" });
    const partyData = partyRows[0];

    // Validate character belongs to this party (if a character_id is given)
    if (character_id) {
      const { rows: charRows } = await pool.query(
        "SELECT id, party FROM characters WHERE id = $1 AND is_active = TRUE",
        [character_id]
      );
      if (!charRows.length) return res.status(404).json({ error: "Character not found or inactive" });
      if (charRows[0].party.toLowerCase() !== partyData.slug.toLowerCase()) {
        return res.status(409).json({ error: "Character does not belong to this party" });
      }
    }

    // Use conditional to avoid string interpolation in SQL (no dynamic column names)
    let updateQ, colKey;
    if (role === "chairman") {
      updateQ = "UPDATE parties SET chairman_character_id = $1, updated_at = NOW() WHERE slug = $2 RETURNING *";
      colKey = "chairman_character_id";
    } else {
      updateQ = "UPDATE parties SET whip_character_id = $1, updated_at = NOW() WHERE slug = $2 RETURNING *";
      colKey = "whip_character_id";
    }
    const { rows: updated } = await pool.query(updateQ, [character_id || null, req.params.partyId]);

    await writeAuditLog(
      req.session.userId, `party.leadership.set_${role}`, "party", partyData.id,
      { [colKey]: partyData[colKey] },
      { [colKey]: character_id || null }
    );
    res.json({ ok: true, party: updated[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/parties/:partyId/chief-whip
// Body: { chiefWhipId: UUID|null, deputyWhipId?: UUID|null }
// Requires: party leader OR admin/mod
app.post("/api/parties/:partyId/chief-whip", partyWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { chiefWhipId = null, deputyWhipId = null } = req.body || {};

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");

    const { rows: partyRows } = await pool.query(
      "SELECT * FROM parties WHERE slug = $1", [req.params.partyId]
    );
    if (!partyRows.length) return res.status(404).json({ error: "Party not found" });
    const partyData = partyRows[0];

    if (!isAdminOrMod) {
      if (!req.session.characterId) return res.status(403).json({ error: "No active character selected" });
      if (String(partyData.leader_character_id) !== String(req.session.characterId)) {
        return res.status(403).json({ error: "Only the party leader (or admin/mod) can assign whips" });
      }
    }

    // Validate chief whip belongs to party if given
    if (chiefWhipId) {
      const { rows: charRows } = await pool.query(
        "SELECT party FROM characters WHERE id = $1 AND is_active = TRUE", [chiefWhipId]
      );
      if (!charRows.length) return res.status(404).json({ error: "Chief whip character not found or inactive" });
      if (charRows[0].party.toLowerCase() !== partyData.slug.toLowerCase()) {
        return res.status(409).json({ error: "Chief whip character does not belong to this party" });
      }
    }

    const { rows: updated } = await pool.query(
      `UPDATE parties SET chief_whip_character_id = $1, deputy_whip_character_id = $2, updated_at = NOW()
        WHERE slug = $3 RETURNING *`,
      [chiefWhipId || null, deputyWhipId || null, req.params.partyId]
    );
    await writeAuditLog(req.session.userId, "party.chief_whip.set", "party", partyData.id,
      { chief_whip_character_id: partyData.chief_whip_character_id, deputy_whip_character_id: partyData.deputy_whip_character_id },
      { chief_whip_character_id: chiefWhipId || null, deputy_whip_character_id: deputyWhipId || null }
    );
    res.json({ ok: true, party: updated[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Shop price index ─────────────────────────────────────────────────────────
// GET  /api/shop/price-index          — authenticated: read current price index
// POST /api/shop/apply-inflation      — admin/mod: apply economy inflation (12-sim-month cooldown)
// POST /api/finance/shop-upkeep       — authenticated: update caller's monthly shop upkeep total
// ═══════════════════════════════════════════════════════════════════════════════

const shopIndexLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

app.get("/api/shop/price-index", shopIndexLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT price_index, last_applied_sim_month, last_applied_sim_year, updated_at
         FROM shop_price_index WHERE id = 'main'`
    );
    if (!rows.length) return res.json({ priceIndex: 1.0, lastAppliedSimMonth: null, lastAppliedSimYear: null });
    const row = rows[0];
    res.json({
      priceIndex:           Number(row.price_index),
      lastAppliedSimMonth:  row.last_applied_sim_month,
      lastAppliedSimYear:   row.last_applied_sim_year,
      updatedAt:            row.updated_at,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/shop/apply-inflation", shopIndexLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    // Read current sim date
    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const currentMonth = clockRows[0]?.sim_current_month ?? 8;
    const currentYear  = clockRows[0]?.sim_current_year  ?? 1997;

    // Read current price index record
    const { rows: piRows } = await pool.query(
      "SELECT price_index, last_applied_sim_month, last_applied_sim_year FROM shop_price_index WHERE id = 'main'"
    );
    const piRow        = piRows[0] || {};
    const currentIndex = Number(piRow.price_index || 1.0);
    const lastMonth    = piRow.last_applied_sim_month;
    const lastYear     = piRow.last_applied_sim_year;

    // Enforce 12 sim-month cooldown
    if (lastMonth != null && lastYear != null) {
      const monthsSinceLast = (currentYear - lastYear) * 12 + (currentMonth - lastMonth);
      if (monthsSinceLast < 12) {
        return res.status(429).json({
          error: `Inflation can only be applied once every 12 sim months. ${12 - monthsSinceLast} sim month(s) remaining.`,
          monthsRemaining: 12 - monthsSinceLast,
        });
      }
    }

    // Read inflation rate: prefer client-provided value (from economy page state),
    // fall back to reading from the app state blob (economyPage.topline.inflation)
    const clientInflationPct = Number(req.body?.inflationPct);
    let inflationPct = Number.isFinite(clientInflationPct) && clientInflationPct > 0
      ? clientInflationPct
      : null;

    if (inflationPct === null) {
      const { rows: stateRows } = await pool.query(
        `SELECT s.data FROM app_state_current c
           JOIN state_snapshots s ON s.id = c.snapshot_id
          WHERE c.id = 'main'`
      );
      const stateData = stateRows[0]?.data || {};
      inflationPct = Number(stateData?.economyPage?.topline?.inflation ?? 0);
    }

    if (!Number.isFinite(inflationPct) || inflationPct <= 0) {
      return res.status(400).json({
        error: "No inflation rate configured. Please set an inflation value on the Economy page first.",
      });
    }

    const newIndex = Math.round(currentIndex * (1 + inflationPct / 100) * 10000) / 10000;

    await pool.query(
      `UPDATE shop_price_index
          SET price_index            = $1,
              last_applied_sim_month = $2,
              last_applied_sim_year  = $3,
              updated_at             = NOW()
        WHERE id = 'main'`,
      [newIndex, currentMonth, currentYear]
    );

    await writeAuditLog(
      req.session.userId, "shop.apply_inflation", "shop_price_index", "main",
      { price_index: currentIndex },
      { price_index: newIndex, inflation_pct: inflationPct }
    );

    res.json({ ok: true, oldIndex: currentIndex, newIndex, inflationPct, appliedSimMonth: currentMonth, appliedSimYear: currentYear });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/finance/shop-upkeep — update calling character's monthly shop upkeep total
const financeWriteLimit = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

app.post("/api/finance/shop-upkeep", financeWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const charId = req.session.characterId;
    if (!charId) return res.status(400).json({ error: "No active character selected" });
    const upkeep = Math.max(0, Number(req.body?.upkeep ?? 0));
    await pool.query(
      `INSERT INTO character_finance (character_id, shop_monthly_upkeep)
            VALUES ($1, $2)
       ON CONFLICT (character_id) DO UPDATE SET shop_monthly_upkeep = $2, updated_at = NOW()`,
      [charId, upkeep]
    );
    res.json({ ok: true, shopMonthlyUpkeep: upkeep });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Player finance + shop purchases (DB-backed) ──────────────────────────────
// GET  /api/me/finance                              — authenticated: read own character finance
// POST /api/characters/profile-change               — authenticated: submit profile fields for approval
// GET  /api/characters/profile-changes/mine         — authenticated: list own pending profile change requests
// GET  /api/admin/profile-changes                   — admin/mod/speaker: list all pending
// POST /api/admin/profile-changes/:id/approve       — admin/mod/speaker: approve + apply
// POST /api/admin/profile-changes/:id/reject        — admin/mod/speaker: reject
// POST /api/me/character/shop-purchases             — authenticated: record a shop purchase
// DELETE /api/me/character/shop-purchases/:id       — authenticated (owner) or admin/mod: remove
// POST  /api/me/character/additional-revenue        — admin/mod: add revenue stream
// DELETE /api/me/character/additional-revenue/:id   — admin/mod: remove revenue stream
// ─────────────────────────────────────────────────────────────────────────────

const meFinanceReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const meFinanceWriteLimit = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });

// GET /api/me/finance — authenticated owner: full finance snapshot for active character
app.get("/api/me/finance", meFinanceReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    // Resolve active character for the caller (with property fields for finance computation)
    const { rows: charRows } = await pool.query(
      `SELECT c.id, c.home, c.rentals, c.financial_background_level, c.education, c.career_background, c.family
         FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                 c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) return res.status(404).json({ error: "No active character found" });
    const charId    = charRows[0].id;
    const character = charRows[0];

    // Finance row (may not exist yet)
    const { rows: finRows } = await pool.query(
      `SELECT bank_balance, shop_monthly_upkeep, finance_overspend FROM character_finance WHERE character_id = $1`,
      [charId]
    );
    const fin = finRows[0] ?? { bank_balance: 0, shop_monthly_upkeep: 0, finance_overspend: false };

    // Additional revenue streams
    const { rows: revRows } = await pool.query(
      `SELECT id, label, annual_amount FROM character_additional_revenue WHERE character_id = $1 ORDER BY created_at`,
      [charId]
    );

    // Shop purchases
    const { rows: purchaseRows } = await pool.query(
      `SELECT id, item_id, item_name, price, base_price, monthly_upkeep, effects, risk_modifier, purchased_at
         FROM character_shop_purchases WHERE character_id = $1 ORDER BY purchased_at`,
      [charId]
    );

    // Computed annual salary
    const { rows: simRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const simMonth = simRows[0]?.sim_current_month ?? 8;
    const simYear  = simRows[0]?.sim_current_year  ?? 1997;
    const simIndex = simYear * 12 + (simMonth - 1);
    const { annualSalary } = await resolvedAnnualSalary(charId, simIndex);

    // Finance config — provides financeCostIndex for cost computations
    const finConfig = await getFinanceConfig();
    const financeCostIndex = finConfig.financeCostIndex;

    // Property-derived finance fields (costs inflation-adjusted via financeCostIndex)
    const propFinance = computePropertyFinance(character, financeCostIndex);
    const shopUpkeep  = Number(fin.shop_monthly_upkeep) || 0;

    // Affiliation membership fees — only approved affiliations count
    // Fees multiplied by financeCostIndex (per requirements)
    const { rows: affRows } = await pool.query(
      `SELECT ac.id AS affiliation_id, ac.name, ac.category, ac.monthly_fee
         FROM character_affiliations ca
         JOIN affiliations_catalog ac ON ac.id = ca.affiliation_id
        WHERE ca.character_id = $1 AND ca.status = 'approved'
        ORDER BY ac.category, ac.name`,
      [charId]
    );
    const affiliationsMonthlyFeesItems = affRows.map((r) => ({
      affiliationId: r.affiliation_id,
      name:          r.name,
      category:      r.category,
      monthlyFee:    Math.round(Number(r.monthly_fee) * financeCostIndex),
    }));
    const affiliationsMonthlyFees = affiliationsMonthlyFeesItems.reduce((sum, a) => sum + a.monthlyFee, 0);

    const totalMonthlyUpkeep = shopUpkeep + propFinance.propertyMonthlyUpkeep + affiliationsMonthlyFees;

    res.json({
      characterId:              charId,
      bankBalance:              Number(fin.bank_balance),
      shopMonthlyUpkeep:        shopUpkeep,
      financeOverspend:         !!fin.finance_overspend,
      annualSalary,
      // Property finance fields
      homeLivingCostsMonthly:   propFinance.homeLivingCostsMonthly,
      rentalIncomeMonthly:      propFinance.rentalIncomeMonthly,
      rentalCostsMonthly:       propFinance.rentalCostsMonthly,
      propertyMonthlyUpkeep:    propFinance.propertyMonthlyUpkeep,
      // Affiliation membership fees
      affiliationsMonthlyFees,
      affiliationsMonthlyFeesItems,
      totalMonthlyUpkeep,
      livingCostMultiplier:     propFinance.livingCostMultiplier,
      mortgageFactor:           propFinance.mortgageFactor,
      financeCostIndex,
      additionalRevenue: revRows.map((r) => ({
        id:           r.id,
        label:        r.label,
        annualAmount: Number(r.annual_amount),
      })),
      shopPurchases: purchaseRows.map((p) => ({
        id:            p.id,
        itemId:        p.item_id,
        itemName:      p.item_name,
        price:         Number(p.price),
        basePrice:     Number(p.base_price),
        monthlyUpkeep: Number(p.monthly_upkeep),
        effects:       Array.isArray(p.effects) ? p.effects : [],
        riskModifier:  p.risk_modifier ?? null,
        purchasedAt:   p.purchased_at,
      })),
    });
  } catch (e) {
    console.error("[GET /api/me/finance]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/me/finance/summary — authenticated owner: concise finance snapshot for debugging/validation
app.get("/api/me/finance/summary", meFinanceReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { rows: charRows } = await pool.query(
      `SELECT c.id, c.home, c.rentals, c.financial_background_level, c.education, c.career_background, c.family
         FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                 c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) return res.status(404).json({ error: "No active character found" });
    const charId    = charRows[0].id;
    const character = charRows[0];

    const { rows: finRows } = await pool.query(
      `SELECT bank_balance, shop_monthly_upkeep, finance_overspend FROM character_finance WHERE character_id = $1`,
      [charId]
    );
    const fin = finRows[0] ?? { bank_balance: 0, shop_monthly_upkeep: 0, finance_overspend: false };

    const { rows: simRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const simMonth = simRows[0]?.sim_current_month ?? 8;
    const simYear  = simRows[0]?.sim_current_year  ?? 1997;

    const finConfig = await getFinanceConfig();
    const financeCostIndex = finConfig.financeCostIndex;
    const propFinance = computePropertyFinance(character, financeCostIndex);

    // Starting balance for their financial level (from finance_config or default)
    const bgLevel = Math.min(10, Math.max(1, Number(character.financial_background_level) || 5));
    const startingBalances = finConfig.startingBalances;
    const startingBalanceAmount = Number(
      startingBalances[bgLevel] ?? startingBalances[String(bgLevel)] ?? STARTING_BALANCES_DEFAULT[bgLevel] ?? 25000
    );

    // Mortgage markup: extra monthly cost due to mortgage on primary home
    const home = character.home ?? {};
    const mortgaged = !!home.mortgaged;
    const homeBase = HOME_MONTHLY_COSTS[home.type] ?? 0;
    const { rows: affRows } = await pool.query(
      `SELECT COALESCE(SUM(ac.monthly_fee), 0) AS total
         FROM character_affiliations ca
         JOIN affiliations_catalog ac ON ac.id = ca.affiliation_id
        WHERE ca.character_id = $1 AND ca.status = 'approved'`,
      [charId]
    );
    const affiliationsMonthlyFees = Math.round(Number(affRows[0]?.total ?? 0) * financeCostIndex);
    const shopUpkeep = Number(fin.shop_monthly_upkeep) || 0;

    const homeLivingCostsMonthly  = propFinance.homeLivingCostsMonthly;
    const rentalIncomeMonthly     = propFinance.rentalIncomeMonthly;
    const rentalCostsMonthly      = propFinance.rentalCostsMonthly;
    // Monthly mortgage markup = extra cost from mortgage on home only
    let mortgageMarkup = 0;
    if (mortgaged && homeBase > 0) {
      const mortgageF  = propFinance.mortgageFactor;
      const noMortgage = Math.round(homeBase * propFinance.livingCostMultiplier * financeCostIndex);
      mortgageMarkup   = homeLivingCostsMonthly - noMortgage;
    }
    const netMonthlyDelta = rentalIncomeMonthly - homeLivingCostsMonthly - affiliationsMonthlyFees - shopUpkeep;

    res.json({
      characterId:          charId,
      simMonth,
      simYear,
      bankBalance:          Number(fin.bank_balance),
      financeOverspend:     !!fin.finance_overspend,
      startingBalanceAmount,
      monthlyLivingCost:    homeLivingCostsMonthly,
      monthlyMortgageMarkup: mortgageMarkup,
      monthlyRentalIncome:  rentalIncomeMonthly,
      monthlyRentalCosts:   rentalCostsMonthly,
      monthlyAffiliationCosts: affiliationsMonthlyFees,
      shopMonthlyUpkeep:    shopUpkeep,
      netMonthlyDelta,
      financeCostIndex,
    });
  } catch (e) {
    console.error("[GET /api/me/finance/summary]", e);
    res.status(500).json({ error: "Server error" });
  }
});

const profileChangeReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const profileChangeWriteLimit = rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true, legacyHeaders: false });

app.post("/api/characters/profile-change", profileChangeWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const { rows: charRows } = await pool.query(
      `SELECT c.id FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                 c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) return res.status(404).json({ error: "No active character found" });
    const charId = charRows[0].id;

    const {
      education, career_background, family,
      date_of_birth, financial_background_level, twitter_handle,
    } = req.body || {};

    // Validate date_of_birth if provided (must be a parseable date)
    if (date_of_birth !== undefined && date_of_birth !== null && date_of_birth !== "") {
      const dob = new Date(String(date_of_birth));
      if (isNaN(dob.getTime())) {
        return res.status(400).json({ error: "date_of_birth must be a valid date (YYYY-MM-DD)" });
      }
    }

    // At least one field must be provided
    const hasField = [education, career_background, family, date_of_birth, financial_background_level, twitter_handle]
      .some((v) => v !== undefined && v !== null && v !== "");
    if (!hasField) return res.status(400).json({ error: "At least one profile field must be provided" });

    // Only one pending profile-change per character at a time
    const { rows: existing } = await pool.query(
      "SELECT id FROM pending_profile_changes WHERE character_id = $1 AND status = 'pending' LIMIT 1",
      [charId]
    );
    if (existing.length) {
      return res.status(409).json({ error: "You already have a pending profile change request." });
    }

    const lvl = financial_background_level !== undefined
      ? (() => { const n = parseInt(financial_background_level, 10); return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null; })()
      : undefined;

    const { rows } = await pool.query(
      `INSERT INTO pending_profile_changes
         (character_id, user_id,
          proposed_education, proposed_career_background, proposed_family,
          proposed_date_of_birth, proposed_financial_bg_level, proposed_twitter_handle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        charId, req.session.userId,
        education          !== undefined ? String(education          || "").slice(0, 500) : null,
        career_background  !== undefined ? String(career_background  || "").slice(0, 500) : null,
        family             !== undefined ? String(family             || "").slice(0, 500) : null,
        date_of_birth      !== undefined ? String(date_of_birth      || "").slice(0,  50) || null : null,
        lvl !== undefined ? lvl : null,
        twitter_handle     !== undefined ? String(twitter_handle || "").trim().replace(/^@+/, "").slice(0, 100) : null,
      ]
    );
    await writeAuditLog(req.session.userId, "profile_change.submit", "pending_profile_changes", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, change: rows[0] });
  } catch (e) {
    console.error("[POST /api/characters/profile-change]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/characters/profile-changes/mine — player: list own pending profile change requests
app.get("/api/characters/profile-changes/mine", profileChangeReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: charRows } = await pool.query(
      "SELECT id FROM characters WHERE user_id = $1 AND is_active = TRUE LIMIT 1",
      [req.session.userId]
    );
    if (!charRows.length) return res.json({ changes: [] });
    const { rows } = await pool.query(
      "SELECT * FROM pending_profile_changes WHERE character_id = $1 ORDER BY submitted_at DESC",
      [charRows[0].id]
    );
    res.json({ changes: rows });
  } catch (e) {
    console.error("[GET /api/characters/profile-changes/mine]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/profile-changes — admin/mod/speaker: list profile change requests
app.get("/api/admin/profile-changes", profileChangeReadLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { status } = req.query;
    let q = `SELECT pc.*, c.name AS character_name, u.username AS submitter_username
             FROM pending_profile_changes pc
             JOIN characters c ON c.id = pc.character_id
             JOIN users u ON u.id = pc.user_id`;
    const params = [];
    if (status) { q += " WHERE pc.status = $1"; params.push(status); }
    q += " ORDER BY pc.submitted_at DESC";
    const { rows } = await pool.query(q, params);
    res.json({ changes: rows });
  } catch (e) {
    console.error("[GET /api/admin/profile-changes]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/profile-changes/:id/approve — approve and apply profile fields to characters table
app.post("/api/admin/profile-changes/:id/approve", profileChangeWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows: changeRows } = await pool.query(
      "SELECT * FROM pending_profile_changes WHERE id = $1",
      [req.params.id]
    );
    if (!changeRows.length) return res.status(404).json({ error: "Profile change request not found" });
    const change = changeRows[0];
    if (change.status !== "pending") {
      return res.status(409).json({ error: `Profile change request is already ${change.status}` });
    }

    // Build dynamic UPDATE — only apply non-null proposed fields
    const setClauses = [];
    const params = [];
    let i = 1;
    if (change.proposed_education         !== null) { setClauses.push(`education = $${i++}`);                  params.push(change.proposed_education); }
    if (change.proposed_career_background !== null) { setClauses.push(`career_background = $${i++}`);          params.push(change.proposed_career_background); }
    if (change.proposed_family            !== null) { setClauses.push(`family = $${i++}`);                     params.push(change.proposed_family); }
    if (change.proposed_date_of_birth     !== null) { setClauses.push(`date_of_birth = $${i++}`);              params.push(change.proposed_date_of_birth); }
    if (change.proposed_financial_bg_level!== null) { setClauses.push(`financial_background_level = $${i++}`); params.push(change.proposed_financial_bg_level); }
    if (change.proposed_twitter_handle    !== null) { setClauses.push(`twitter_handle = $${i++}`);             params.push(change.proposed_twitter_handle); }

    if (setClauses.length) {
      params.push(change.character_id);
      await pool.query(`UPDATE characters SET ${setClauses.join(", ")} WHERE id = $${i}`, params);
    }

    await pool.query(
      "UPDATE pending_profile_changes SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );
    await writeAuditLog(req.session.userId, "profile_change.approve", "pending_profile_changes", req.params.id,
      change, { ...change, status: "approved" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/admin/profile-changes/:id/approve]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/profile-changes/:id/reject — reject a profile change request
app.post("/api/admin/profile-changes/:id/reject", profileChangeWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows: changeRows } = await pool.query(
      "SELECT * FROM pending_profile_changes WHERE id = $1",
      [req.params.id]
    );
    if (!changeRows.length) return res.status(404).json({ error: "Profile change request not found" });
    const change = changeRows[0];
    if (change.status !== "pending") {
      return res.status(409).json({ error: `Profile change request is already ${change.status}` });
    }
    await pool.query(
      "UPDATE pending_profile_changes SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
      [req.session.userId, req.params.id]
    );
    await writeAuditLog(req.session.userId, "profile_change.reject", "pending_profile_changes", req.params.id,
      change, { ...change, status: "rejected" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/admin/profile-changes/:id/reject]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/me/character/shop-purchases — record a shop purchase, deduct from bank
app.post("/api/me/character/shop-purchases", meFinanceWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAuth(req, res)) return;

    const { rows: charRows } = await client.query(
      `SELECT c.id FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                 c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) { client.release(); return res.status(404).json({ error: "No active character found" }); }
    const charId = charRows[0].id;

    const { item_id, item_name, price, monthly_upkeep, base_price = 0, effects = [], risk_modifier = null } = req.body || {};
    if (!item_id || !item_name) { client.release(); return res.status(400).json({ error: "item_id and item_name are required" }); }

    const itemPrice     = Math.max(0, Number(price        || 0));
    const itemUpkeep    = Math.max(0, Number(monthly_upkeep || 0));
    const itemBasePrice = Math.max(0, Number(base_price   || 0));

    await client.query("BEGIN");

    // Ensure finance row exists
    await client.query(
      `INSERT INTO character_finance (character_id, bank_balance) VALUES ($1, 0) ON CONFLICT (character_id) DO NOTHING`,
      [charId]
    );

    // Check balance and deduct atomically
    const { rows: finRows } = await client.query(
      `SELECT bank_balance FROM character_finance WHERE character_id = $1 FOR UPDATE`,
      [charId]
    );
    if (!finRows.length || Number(finRows[0].bank_balance) < itemPrice) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(402).json({ error: "Insufficient funds" });
    }

    await client.query(
      `UPDATE character_finance SET bank_balance = bank_balance - $1, updated_at = NOW() WHERE character_id = $2`,
      [itemPrice, charId]
    );

    // Insert purchase record
    const { rows: purchaseRows } = await client.query(
      `INSERT INTO character_shop_purchases (character_id, item_id, item_name, price, base_price, monthly_upkeep, effects, risk_modifier)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       RETURNING id, item_id, item_name, price, base_price, monthly_upkeep, effects, risk_modifier, purchased_at`,
      [charId, String(item_id), String(item_name), itemPrice, itemBasePrice, itemUpkeep, JSON.stringify(effects), risk_modifier ? JSON.stringify(risk_modifier) : null]
    );

    // Recalculate and persist total monthly upkeep
    const { rows: upkeepRows } = await client.query(
      `SELECT COALESCE(SUM(monthly_upkeep), 0) AS total FROM character_shop_purchases WHERE character_id = $1`,
      [charId]
    );
    await client.query(
      `UPDATE character_finance SET shop_monthly_upkeep = $1, updated_at = NOW() WHERE character_id = $2`,
      [Number(upkeepRows[0].total), charId]
    );

    await client.query("COMMIT");

    const p = purchaseRows[0];
    res.status(201).json({
      ok: true,
      purchase: {
        id:            p.id,
        itemId:        p.item_id,
        itemName:      p.item_name,
        price:         Number(p.price),
        basePrice:     Number(p.base_price),
        monthlyUpkeep: Number(p.monthly_upkeep),
        effects:       Array.isArray(p.effects) ? p.effects : [],
        riskModifier:  p.risk_modifier ?? null,
        purchasedAt:   p.purchased_at,
      },
      newBankBalance: Number(finRows[0].bank_balance) - itemPrice,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[POST /api/me/character/shop-purchases]", e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// DELETE /api/me/character/shop-purchases/:id — remove a shop purchase (admin/mod or character owner)
app.delete("/api/me/character/shop-purchases/:id", meFinanceWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAuth(req, res)) return;

    const { rows: charRows } = await client.query(
      `SELECT c.id FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                 c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) { client.release(); return res.status(404).json({ error: "No active character found" }); }
    const charId = charRows[0].id;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod") || sessionRoles.includes("speaker");

    // Verify the purchase belongs to the caller's character (or caller is admin/mod)
    const { rows: pRows } = await client.query(
      `SELECT character_id FROM character_shop_purchases WHERE id = $1`,
      [req.params.id]
    );
    if (!pRows.length) { client.release(); return res.status(404).json({ error: "Purchase not found" }); }
    if (!isAdminOrMod && pRows[0].character_id !== charId) {
      client.release();
      return res.status(403).json({ error: "Forbidden" });
    }

    const targetCharId = pRows[0].character_id;

    await client.query("BEGIN");
    await client.query(`DELETE FROM character_shop_purchases WHERE id = $1`, [req.params.id]);

    // Recalculate total monthly upkeep
    const { rows: upkeepRows } = await client.query(
      `SELECT COALESCE(SUM(monthly_upkeep), 0) AS total FROM character_shop_purchases WHERE character_id = $1`,
      [targetCharId]
    );
    await client.query(
      `UPDATE character_finance
          SET shop_monthly_upkeep = $1::numeric,
              finance_overspend   = CASE WHEN $1::numeric = 0 THEN false ELSE finance_overspend END,
              updated_at          = NOW()
        WHERE character_id = $2`,
      [Number(upkeepRows[0].total), targetCharId]
    );
    await client.query("COMMIT");

    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[DELETE /api/me/character/shop-purchases/:id]", e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// POST /api/me/character/shop-purchases/:id/sell
// Player sells one purchased shop item for 50% of its CURRENT price (price * priceIndex * 0.5).
// The purchase record is removed and the refund credited to their bank.
app.post("/api/me/character/shop-purchases/:id/sell", meFinanceWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAuth(req, res)) return;

    // Resolve active character
    const { rows: charRows } = await client.query(
      `SELECT c.id FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                 c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) return res.status(404).json({ error: "No active character found" });
    const charId = charRows[0].id;

    // Fetch the purchase — must belong to the caller's character
    const { rows: pRows } = await client.query(
      `SELECT id, character_id, item_id, item_name, price, monthly_upkeep, effects, risk_modifier
         FROM character_shop_purchases WHERE id = $1`,
      [req.params.id]
    );
    if (!pRows.length) return res.status(404).json({ error: "Purchase not found" });
    if (pRows[0].character_id !== charId) return res.status(403).json({ error: "Forbidden" });

    const purchase = pRows[0];

    // Items with price == 0 cannot be sold (use dismiss instead)
    if (Number(purchase.price) === 0) {
      return res.status(400).json({ error: "Free items must be dismissed, not sold. Use the Dismiss action." });
    }

    // Fetch current price index for refund calculation
    const { rows: piRows } = await client.query(
      `SELECT price_index FROM shop_price_index WHERE id = 'main'`
    );
    const priceIndex = Number(piRows[0]?.price_index ?? 1);
    const currentPrice = Math.round(Number(purchase.price) * priceIndex);
    const refund = Math.round(currentPrice * 0.5);

    await client.query("BEGIN");
    await client.query(`DELETE FROM character_shop_purchases WHERE id = $1`, [purchase.id]);

    // Recalculate total monthly upkeep
    const { rows: upkeepRows } = await client.query(
      `SELECT COALESCE(SUM(monthly_upkeep), 0) AS total FROM character_shop_purchases WHERE character_id = $1`,
      [charId]
    );
    await client.query(
      `UPDATE character_finance
          SET bank_balance        = bank_balance + $1,
              shop_monthly_upkeep = $2::numeric,
              finance_overspend   = CASE WHEN $2::numeric = 0 THEN false ELSE finance_overspend END,
              updated_at          = NOW()
        WHERE character_id = $3`,
      [refund, Number(upkeepRows[0].total), charId]
    );
    await client.query("COMMIT");

    const { rows: finRows } = await client.query(
      `SELECT bank_balance FROM character_finance WHERE character_id = $1`, [charId]
    );
    await writeAuditLog(req.session.userId, "shop.sell", "character_shop_purchases", purchase.id, purchase, { refund });
    res.json({ ok: true, refund, newBankBalance: Number(finRows[0]?.bank_balance ?? 0) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[POST /api/me/character/shop-purchases/:id/sell]", e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// POST /api/me/character/shop-purchases/:id/dismiss
// Player dismisses one free-with-upkeep shop item (price == 0, upkeep > 0).
// Removes the purchase record and upkeep; no refund.
app.post("/api/me/character/shop-purchases/:id/dismiss", meFinanceWriteLimit, async (req, res) => {
  const requestId = randomUUID();
  let client;
  let charId;
  try {
    if (!requireAuth(req, res)) return;

    client = await pool.connect();

    const { rows: charRows } = await client.query(
      `SELECT c.id FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC,
                 c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) return res.status(404).json({ error: "No active character found" });
    charId = charRows[0].id;

    const { rows: pRows } = await client.query(
      `SELECT id, character_id, item_id, item_name, price, monthly_upkeep
         FROM character_shop_purchases WHERE id = $1`,
      [req.params.id]
    );
    if (!pRows.length) return res.status(404).json({ error: "Purchase not found" });
    if (pRows[0].character_id !== charId) return res.status(403).json({ error: "Forbidden" });

    const purchase = pRows[0];

    // Only free items (price == 0) can be dismissed; paid items must be sold
    if (Number(purchase.price) !== 0) {
      return res.status(400).json({ error: "Paid items must be sold, not dismissed. Use the Sell action." });
    }

    await client.query("BEGIN");
    await client.query(`DELETE FROM character_shop_purchases WHERE id = $1`, [purchase.id]);

    const { rows: upkeepRows } = await client.query(
      `SELECT COALESCE(SUM(monthly_upkeep), 0) AS total FROM character_shop_purchases WHERE character_id = $1`,
      [charId]
    );
    const newUpkeep = Number(upkeepRows[0].total);

    // Ensure character_finance row exists before updating upkeep
    await client.query(
      `INSERT INTO character_finance (character_id, bank_balance)
       VALUES ($1, 0) ON CONFLICT (character_id) DO NOTHING`,
      [charId]
    );
    await client.query(
      `UPDATE character_finance
          SET shop_monthly_upkeep = $1::numeric,
              finance_overspend   = CASE WHEN $1::numeric = 0 THEN false ELSE finance_overspend END,
              updated_at          = NOW()
        WHERE character_id = $2`,
      [newUpkeep, charId]
    );
    await client.query("COMMIT");

    await writeAuditLog(req.session.userId, "shop.dismiss", "character_shop_purchases", purchase.id, purchase, null);
    res.json({ ok: true });
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(
      "[POST /api/me/character/shop-purchases/:id/dismiss]",
      { requestId, userId: req.session?.userId, charId: charId ?? "unknown", purchaseId: req.params.id },
      e
    );
    res.status(500).json({ error: "Server error", requestId });
  } finally {
    if (client) client.release();
  }
});

// POST /api/me/character/additional-revenue — admin/mod: add revenue stream to active character
app.post("/api/me/character/additional-revenue", meFinanceWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;

    const { character_id, label, annual_amount } = req.body || {};
    const targetCharId = character_id || req.session.characterId;
    if (!targetCharId) return res.status(400).json({ error: "character_id required" });

    const amount = Number(annual_amount || 0);
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ error: "label is required" });
    }

    const { rows: charCheck } = await pool.query("SELECT id FROM characters WHERE id = $1", [targetCharId]);
    if (!charCheck.length) return res.status(404).json({ error: "Character not found" });

    const { rows } = await pool.query(
      `INSERT INTO character_additional_revenue (character_id, label, annual_amount) VALUES ($1, $2, $3) RETURNING *`,
      [targetCharId, label.trim().slice(0, 200), amount]
    );
    res.status(201).json({ ok: true, revenue: { id: rows[0].id, label: rows[0].label, annualAmount: Number(rows[0].annual_amount) } });
  } catch (e) {
    console.error("[POST /api/me/character/additional-revenue]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/me/character/additional-revenue/:id — admin/mod: remove a revenue stream
app.delete("/api/me/character/additional-revenue/:id", meFinanceWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;

    const { rows } = await pool.query(
      `DELETE FROM character_additional_revenue WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Revenue stream not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/me/character/additional-revenue/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});
// GET  /api/parties/:partyId/structure  — authenticated: read party structure
// POST /api/parties/:partyId/structure  — chairman/leader/admin/mod: update
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/parties/:partyId/structure", partyReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT party_structure, treasury_overspend FROM parties WHERE slug = $1",
      [req.params.partyId]
    );
    if (!rows.length) return res.status(404).json({ error: "Party not found" });
    res.json({ structure: rows[0].party_structure || {}, treasuryOverspend: rows[0].treasury_overspend });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/parties/:partyId/structure", partyWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");

    if (!isAdminOrMod) {
      if (!req.session.characterId) {
        return res.status(403).json({ error: "No active character selected" });
      }
      const { rows: pr } = await pool.query(
        "SELECT leader_character_id, chairman_character_id FROM parties WHERE slug = $1",
        [req.params.partyId]
      );
      if (!pr.length) return res.status(404).json({ error: "Party not found" });
      const isLeader  = String(pr[0].leader_character_id)  === String(req.session.characterId);
      const isChairman= String(pr[0].chairman_character_id) === String(req.session.characterId);
      if (!isLeader && !isChairman) {
        return res.status(403).json({ error: "Only the party chairman, leader, or admin/mod can update party structure" });
      }
    }

    const structure = req.body?.structure;
    if (!structure || typeof structure !== "object") {
      return res.status(400).json({ error: "Body must be { structure: <object> }" });
    }

    const safe = {
      nationalOffices: Array.isArray(structure.nationalOffices)
        ? structure.nationalOffices.slice(0, 20).map((o) => ({
            region:     String(o.region || "").trim().slice(0, 100),
            size:       String(o.size   || "Regional").trim().slice(0, 50),
            staffCount: Math.max(0, Math.min(500, Number(o.staffCount || 0))),
          }))
        : [],
      departments: {
        communications: Math.max(0, Math.min(200, Number(structure.departments?.communications || 0))),
        policy:         Math.max(0, Math.min(200, Number(structure.departments?.policy         || 0))),
        campaign:       Math.max(0, Math.min(200, Number(structure.departments?.campaign       || 0))),
        compliance:     Math.max(0, Math.min(200, Number(structure.departments?.compliance     || 0))),
        admin:          Math.max(0, Math.min(200, Number(structure.departments?.admin          || 0))),
        fundraising:    Math.max(0, Math.min(200, Number(structure.departments?.fundraising    || 0))),
        membership:     Math.max(0, Math.min(200, Number(structure.departments?.membership     || 0))),
        research:       Math.max(0, Math.min(200, Number(structure.departments?.research       || 0))),
      },
      monthlyOverhead: Math.max(0, Number(structure.monthlyOverhead || 0)),
      unlocks: (typeof structure.unlocks === "object" && structure.unlocks !== null) ? structure.unlocks : {},
    };
    safe.totalStaff =
      safe.nationalOffices.reduce((s, o) => s + o.staffCount, 0) +
      Object.values(safe.departments).reduce((s, v) => s + v, 0);

    const { rows: updated } = await pool.query(
      `UPDATE parties
          SET party_structure = $1::jsonb,
              updated_at      = NOW()
        WHERE slug = $2
       RETURNING party_structure, treasury_overspend`,
      [JSON.stringify(safe), req.params.partyId]
    );
    if (!updated.length) return res.status(404).json({ error: "Party not found" });

    await writeAuditLog(
      req.session.userId, "party.structure.update", "party", req.params.partyId,
      null, { structure: safe }
    );
    res.json({ ok: true, structure: updated[0].party_structure });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Party treasury / info ─────────────────────────────────────────────────────
// POST /api/parties/:partyId/treasury — admin/mod or party chairman/leader
// Body: { cash?, debt?, members?, hqUrl? }
app.post("/api/parties/:partyId/treasury", partyWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");

    if (!isAdminOrMod) {
      if (!req.session.characterId) return res.status(403).json({ error: "No active character selected" });
      const { rows: pr } = await pool.query(
        "SELECT leader_character_id, chairman_character_id FROM parties WHERE slug = $1",
        [req.params.partyId]
      );
      if (!pr.length) return res.status(404).json({ error: "Party not found" });
      const isLeader   = String(pr[0].leader_character_id)   === String(req.session.characterId);
      const isChairman = String(pr[0].chairman_character_id) === String(req.session.characterId);
      if (!isLeader && !isChairman) {
        return res.status(403).json({ error: "Only the party chairman, leader, or admin/mod can update the party treasury" });
      }
    }

    const { cash, debt, members, hqUrl, adminOverride } = req.body || {};

    // Build treasury patch object and optional hq_url update
    const treasuryValues = {};
    if (cash    !== undefined) treasuryValues.cash    = parseFloat(cash)    ?? 0;
    if (debt    !== undefined) treasuryValues.debt    = parseFloat(debt)    ?? 0;

    // Members count: rate-limited to once per 6 sim months per party (admin can override)
    if (members !== undefined) {
      const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
      const simMonth = clk[0]?.sim_current_month ?? 8;
      const simYear  = clk[0]?.sim_current_year  ?? 1997;
      const currentSimIndex = simYear * 12 + (simMonth - 1);

      const { rows: partyRow } = await pool.query(
        "SELECT last_members_update_sim_index FROM parties WHERE slug = $1",
        [req.params.partyId]
      );
      const lastUpdateSimIndex = partyRow[0]?.last_members_update_sim_index ?? null;
      const monthsSinceLast = lastUpdateSimIndex != null ? currentSimIndex - lastUpdateSimIndex : Infinity;

      if (monthsSinceLast < 6 && !isAdminOrMod) {
        return res.status(429).json({
          error: `Members count can only be updated once every 6 sim months. Next update available in ${6 - monthsSinceLast} sim month(s).`
        });
      }
      // Admin override: allowed to bypass, but must be flagged explicitly for audit
      if (monthsSinceLast < 6 && isAdminOrMod && !adminOverride) {
        return res.status(409).json({
          error: `Members count was recently updated. Pass adminOverride: true to force update.`,
          monthsSinceLast,
        });
      }

      treasuryValues.members = parseFloat(members) ?? 0;
      // Update last_members_update_sim_index tracking (done in the UPDATE below via extra SET clause)
      req._updateMembersSimIndex = currentSimIndex;
      req._membersAdminOverride  = !!adminOverride;
    }

    if (!Object.keys(treasuryValues).length && hqUrl === undefined) {
      return res.status(400).json({ error: "No fields provided" });
    }

    const finalParams = [];
    let idx = 1;
    let setClauseParts = [];

    if (Object.keys(treasuryValues).length) {
      setClauseParts.push(`treasury = COALESCE(treasury,'{}') || $${idx++}::jsonb`);
      finalParams.push(JSON.stringify(treasuryValues));
    }
    if (hqUrl !== undefined) {
      setClauseParts.push(`hq_url = $${idx++}`);
      finalParams.push(String(hqUrl || "").trim() || null);
    }
    if (req._updateMembersSimIndex != null) {
      setClauseParts.push(`last_members_update_sim_index = $${idx++}`);
      finalParams.push(req._updateMembersSimIndex);
    }
    setClauseParts.push("updated_at = NOW()");
    finalParams.push(req.params.partyId);

    const { rows } = await pool.query(
      `UPDATE parties SET ${setClauseParts.join(", ")} WHERE slug = $${idx} RETURNING slug, treasury, hq_url`,
      finalParams
    );
    if (!rows.length) return res.status(404).json({ error: "Party not found" });

    const auditExtra = req._membersAdminOverride ? { ...req.body, adminOverride: true } : req.body;
    await writeAuditLog(req.session.userId, "party.treasury.update", "party", req.params.partyId, null, auditExtra);
    res.json({ ok: true, treasury: rows[0].treasury, hqUrl: rows[0].hq_url });
  } catch (e) {
    console.error("[POST /api/parties/:partyId/treasury]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Party membership fee ──────────────────────────────────────────────────────
// POST /api/parties/:partyId/membership-fee — chairman/admin/mod only
app.post("/api/parties/:partyId/membership-fee", partyWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");

    if (!isAdminOrMod) {
      if (!req.session.characterId) return res.status(403).json({ error: "No active character selected" });
      const { rows: pr } = await pool.query(
        "SELECT chairman_character_id FROM parties WHERE slug = $1",
        [req.params.partyId]
      );
      if (!pr.length) return res.status(404).json({ error: "Party not found" });
      const isChairman = String(pr[0].chairman_character_id) === String(req.session.characterId);
      if (!isChairman) {
        return res.status(403).json({ error: "Only the party chairman or admin/mod can set the membership fee" });
      }
    }

    const fee = parseFloat(req.body?.fee ?? req.body?.membership_fee_annual);
    if (!Number.isFinite(fee) || fee < 0) {
      return res.status(400).json({ error: "fee must be a non-negative number" });
    }

    const { rows } = await pool.query(
      `UPDATE parties SET membership_fee_annual = $1, updated_at = NOW() WHERE slug = $2
       RETURNING slug, membership_fee_annual`,
      [fee, req.params.partyId]
    );
    if (!rows.length) return res.status(404).json({ error: "Party not found" });

    await writeAuditLog(req.session.userId, "party.membership_fee.set", "party", req.params.partyId, null, { fee });
    res.json({ ok: true, membershipFeeAnnual: Number(rows[0].membership_fee_annual) });
  } catch (e) {
    console.error("[POST /api/parties/:partyId/membership-fee]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Party donations ───────────────────────────────────────────────────────────
// GET /api/parties/:partyId/donations — chairman/leader/admin/mod
app.get("/api/parties/:partyId/donations", partyReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");

    if (!isAdminOrMod) {
      if (!req.session.characterId) return res.status(403).json({ error: "No active character selected" });
      const { rows: pr } = await pool.query(
        "SELECT leader_character_id, chairman_character_id FROM parties WHERE slug = $1",
        [req.params.partyId]
      );
      if (!pr.length) return res.status(404).json({ error: "Party not found" });
      const isLeader   = String(pr[0].leader_character_id)   === String(req.session.characterId);
      const isChairman = String(pr[0].chairman_character_id) === String(req.session.characterId);
      if (!isLeader && !isChairman) {
        return res.status(403).json({ error: "Only the party chairman, leader, or admin/mod can view donations" });
      }
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "100", 10)));
    const { rows } = await pool.query(
      `SELECT id, party_slug, from_name, amount, note, sim_month, sim_year, created_at
         FROM party_donations WHERE party_slug = $1
        ORDER BY created_at DESC LIMIT $2`,
      [req.params.partyId, limit]
    );
    res.json({
      donations: rows.map((d) => ({
        id:        d.id,
        fromName:  d.from_name,
        amount:    Number(d.amount),
        note:      d.note,
        simMonth:  d.sim_month,
        simYear:   d.sim_year,
        createdAt: d.created_at,
      })),
    });
  } catch (e) {
    console.error("[GET /api/parties/:partyId/donations]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/parties/:partyId/donations — admin/mod only
app.post("/api/parties/:partyId/donations", partyWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAdminOrMod(req, res)) { client.release(); return; }

    const fromName = String(req.body?.fromName || req.body?.from_name || "").trim().slice(0, 200);
    const amount   = parseFloat(req.body?.amount);
    const note     = String(req.body?.note || "").trim().slice(0, 500);

    if (!fromName) { client.release(); return res.status(400).json({ error: "fromName is required" }); }
    if (!Number.isFinite(amount) || amount <= 0) { client.release(); return res.status(400).json({ error: "amount must be a positive number" }); }

    const { rows: clk } = await client.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const simMonth = clk[0]?.sim_current_month ?? 8;
    const simYear  = clk[0]?.sim_current_year  ?? 1997;

    await client.query("BEGIN");
    const { rows: partyRows } = await client.query(
      "SELECT id FROM parties WHERE slug = $1 FOR UPDATE",
      [req.params.partyId]
    );
    if (!partyRows.length) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ error: "Party not found" });
    }

    await client.query(
      `UPDATE parties
          SET treasury = jsonb_set(COALESCE(treasury,'{}'), '{cash}',
                           to_jsonb((COALESCE((treasury->>'cash')::numeric, 0) + $1))),
              updated_at = NOW()
        WHERE slug = $2`,
      [amount, req.params.partyId]
    );
    const { rows: donation } = await client.query(
      `INSERT INTO party_donations (party_slug, from_name, amount, note, sim_month, sim_year)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.partyId, fromName, amount, note, simMonth, simYear]
    );
    await client.query("COMMIT");

    await writeAuditLog(req.session.userId, "party.donation.add", "party_donations", donation[0].id, null,
      { partySlug: req.params.partyId, fromName, amount, note });

    client.release();
    res.json({
      ok: true,
      donation: {
        id:        donation[0].id,
        fromName:  donation[0].from_name,
        amount:    Number(donation[0].amount),
        note:      donation[0].note,
        simMonth:  donation[0].sim_month,
        simYear:   donation[0].sim_year,
        createdAt: donation[0].created_at,
      },
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    console.error("[POST /api/parties/:partyId/donations]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Party shop purchases ──────────────────────────────────────────────────────
const partyShopLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

// GET /api/parties/:partyId/shop-purchases
app.get("/api/parties/:partyId/shop-purchases", partyReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT id, item_id, item_name, price, monthly_upkeep, effects, risk_modifier, purchased_at
         FROM party_shop_purchases WHERE party_slug = $1 ORDER BY purchased_at`,
      [req.params.partyId]
    );
    res.json({
      purchases: rows.map((p) => ({
        id:            p.id,
        itemId:        p.item_id,
        itemName:      p.item_name,
        name:          p.item_name,
        price:         Number(p.price),
        monthlyUpkeep: Number(p.monthly_upkeep),
        effects:       Array.isArray(p.effects) ? p.effects : [],
        riskModifier:  p.risk_modifier ?? null,
        purchasedAt:   p.purchased_at,
      })),
    });
  } catch (e) {
    console.error("[GET /api/parties/:partyId/shop-purchases]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/parties/:partyId/shop-purchases — buy a party shop item (atomic: deduct treasury)
app.post("/api/parties/:partyId/shop-purchases", partyShopLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAuth(req, res)) { client.release(); return; }

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    if (!isAdminOrMod) {
      if (!req.session.characterId) { client.release(); return res.status(403).json({ error: "No active character selected" }); }
      const { rows: pr } = await client.query(
        "SELECT leader_character_id, chairman_character_id FROM parties WHERE slug = $1",
        [req.params.partyId]
      );
      if (!pr.length) { client.release(); return res.status(404).json({ error: "Party not found" }); }
      const isLeader   = String(pr[0].leader_character_id)   === String(req.session.characterId);
      const isChairman = String(pr[0].chairman_character_id) === String(req.session.characterId);
      if (!isLeader && !isChairman) { client.release(); return res.status(403).json({ error: "Forbidden" }); }
    }

    const { item_id, item_name, price, monthly_upkeep, effects, risk_modifier } = req.body || {};
    if (!item_id || !item_name) { client.release(); return res.status(400).json({ error: "item_id and item_name required" }); }
    const priceParsed  = Math.max(0, parseFloat(price)          || 0);
    const upkeepParsed = Math.max(0, parseFloat(monthly_upkeep) || 0);

    await client.query("BEGIN");

    // Check party treasury has sufficient funds
    const { rows: partyRows } = await client.query(
      "SELECT id, treasury FROM parties WHERE slug = $1 FOR UPDATE",
      [req.params.partyId]
    );
    if (!partyRows.length) { await client.query("ROLLBACK"); client.release(); return res.status(404).json({ error: "Party not found" }); }
    const currentCash = Number(partyRows[0].treasury?.cash ?? 0);
    if (currentCash < priceParsed) { await client.query("ROLLBACK"); client.release(); return res.status(409).json({ error: "Insufficient party funds" }); }

    // Deduct from treasury
    const newCash = currentCash - priceParsed;
    await client.query(
      `UPDATE parties SET treasury = COALESCE(treasury,'{}') || $1::jsonb, updated_at = NOW() WHERE slug = $2`,
      [JSON.stringify({ cash: newCash }), req.params.partyId]
    );

    // Insert purchase record
    const { rows: inserted } = await client.query(
      `INSERT INTO party_shop_purchases (party_slug, item_id, item_name, price, monthly_upkeep, effects, risk_modifier)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.partyId, String(item_id).slice(0,100), String(item_name).slice(0,200),
       priceParsed, upkeepParsed,
       JSON.stringify(Array.isArray(effects) ? effects : []),
       risk_modifier ? JSON.stringify(risk_modifier) : null]
    );

    await client.query("COMMIT");
    await writeAuditLog(req.session.userId, "party.shop.purchase", "party_shop_purchases", inserted[0].id, null, inserted[0]);
    res.status(201).json({
      ok: true,
      purchase: {
        id:            inserted[0].id,
        itemId:        inserted[0].item_id,
        itemName:      inserted[0].item_name,
        name:          inserted[0].item_name,
        price:         Number(inserted[0].price),
        monthlyUpkeep: Number(inserted[0].monthly_upkeep),
        effects:       inserted[0].effects,
        riskModifier:  inserted[0].risk_modifier,
        purchasedAt:   inserted[0].purchased_at,
      },
      newTreasuryCash: newCash,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[POST /api/parties/:partyId/shop-purchases]", e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// DELETE /api/parties/:partyId/shop-purchases/:id — remove a party shop purchase
app.delete("/api/parties/:partyId/shop-purchases/:id", partyShopLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    if (!isAdminOrMod) return res.status(403).json({ error: "Admin or mod required" });

    const { rows } = await pool.query(
      "DELETE FROM party_shop_purchases WHERE id = $1 AND party_slug = $2 RETURNING id",
      [req.params.id, req.params.partyId]
    );
    if (!rows.length) return res.status(404).json({ error: "Purchase not found" });

    await writeAuditLog(req.session.userId, "party.shop.remove", "party_shop_purchases", req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/parties/:partyId/shop-purchases/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Party drafts ──────────────────────────────────────────────────────────────
// POST /api/parties/:partyId/drafts — persist party draft documents
// Body: { drafts: [...] }
app.post("/api/parties/:partyId/drafts", partyWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");

    if (!isAdminOrMod) {
      if (!req.session.characterId) return res.status(403).json({ error: "No active character selected" });
      // Any active character who is a member of the party may save drafts
      const { rows: cr } = await pool.query(
        "SELECT party FROM characters WHERE id = $1 AND is_active = TRUE",
        [req.session.characterId]
      );
      if (!cr.length) return res.status(403).json({ error: "No active character found" });
      const isPartyMember = (cr[0].party || "").toLowerCase() === req.params.partyId.toLowerCase();
      if (!isPartyMember) return res.status(403).json({ error: "Forbidden" });
    }

    const drafts = req.body?.drafts;
    if (!Array.isArray(drafts)) return res.status(400).json({ error: "Body must be { drafts: [] }" });

    const { rows } = await pool.query(
      "UPDATE parties SET drafts = $1::jsonb, updated_at = NOW() WHERE slug = $2 RETURNING slug",
      [JSON.stringify(drafts), req.params.partyId]
    );
    if (!rows.length) return res.status(404).json({ error: "Party not found" });

    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/parties/:partyId/drafts]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Cabinet & Shadow Cabinet drafts (DB-backed) ───────────────────────────────
const groupDraftReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const groupDraftWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

/**
 * Returns the character_id of the caller's active character, or null.
 * Also returns whether the caller is admin/mod/speaker.
 */
async function resolveCallerCharacter(req) {
  const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
  const isStaff = sessionRoles.includes("admin") || sessionRoles.includes("mod") || sessionRoles.includes("speaker");
  if (isStaff) return { isStaff: true, charId: null };
  if (!req.session.characterId) return { isStaff: false, charId: null };
  const { rows } = await pool.query(
    "SELECT id FROM characters WHERE id = $1 AND is_active = TRUE",
    [req.session.characterId]
  );
  return { isStaff: false, charId: rows[0]?.id || null };
}

/**
 * Check whether a character holds any office of the given type ('cabinet' or 'shadow').
 */
async function isOfficeHolder(charId, officeType) {
  const { rows } = await pool.query(
    `SELECT 1 FROM office_assignments oa
       JOIN offices o ON o.id = oa.office_id
      WHERE oa.character_id = $1 AND o.type = $2
      LIMIT 1`,
    [charId, officeType]
  );
  return rows.length > 0;
}

// GET /api/cabinet/drafts — fetch cabinet draft bills (cabinet members + admin/mod/speaker)
app.get("/api/cabinet/drafts", groupDraftReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { isStaff, charId } = await resolveCallerCharacter(req);
    if (!isStaff) {
      if (!charId) return res.status(403).json({ error: "No active character" });
      const ok = await isOfficeHolder(charId, "cabinet");
      if (!ok) return res.status(403).json({ error: "Cabinet access only" });
    }
    const { rows } = await pool.query(
      "SELECT drafts FROM group_drafts WHERE group_key = 'cabinet'"
    );
    res.json({ drafts: rows[0]?.drafts || [] });
  } catch (e) {
    console.error("[GET /api/cabinet/drafts]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/cabinet/drafts — save cabinet draft bills (cabinet members + admin/mod/speaker)
// Body: { drafts: [...] }
app.post("/api/cabinet/drafts", groupDraftWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { isStaff, charId } = await resolveCallerCharacter(req);
    if (!isStaff) {
      if (!charId) return res.status(403).json({ error: "No active character" });
      const ok = await isOfficeHolder(charId, "cabinet");
      if (!ok) return res.status(403).json({ error: "Cabinet access only" });
    }
    const { drafts } = req.body || {};
    if (!Array.isArray(drafts)) return res.status(400).json({ error: "Body must be { drafts: [] }" });
    await pool.query(
      `INSERT INTO group_drafts (group_key, drafts, updated_at)
          VALUES ('cabinet', $1::jsonb, NOW())
       ON CONFLICT (group_key)
       DO UPDATE SET drafts = EXCLUDED.drafts, updated_at = NOW()`,
      [JSON.stringify(drafts)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/cabinet/drafts]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/shadowcabinet/drafts — fetch shadow cabinet draft bills
app.get("/api/shadowcabinet/drafts", groupDraftReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { isStaff, charId } = await resolveCallerCharacter(req);
    if (!isStaff) {
      if (!charId) return res.status(403).json({ error: "No active character" });
      const ok = await isOfficeHolder(charId, "shadow");
      if (!ok) return res.status(403).json({ error: "Shadow cabinet access only" });
    }
    const { rows } = await pool.query(
      "SELECT drafts FROM group_drafts WHERE group_key = 'shadowcabinet'"
    );
    res.json({ drafts: rows[0]?.drafts || [] });
  } catch (e) {
    console.error("[GET /api/shadowcabinet/drafts]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/shadowcabinet/drafts — save shadow cabinet draft bills
// Body: { drafts: [...] }
app.post("/api/shadowcabinet/drafts", groupDraftWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { isStaff, charId } = await resolveCallerCharacter(req);
    if (!isStaff) {
      if (!charId) return res.status(403).json({ error: "No active character" });
      const ok = await isOfficeHolder(charId, "shadow");
      if (!ok) return res.status(403).json({ error: "Shadow cabinet access only" });
    }
    const { drafts } = req.body || {};
    if (!Array.isArray(drafts)) return res.status(400).json({ error: "Body must be { drafts: [] }" });
    await pool.query(
      `INSERT INTO group_drafts (group_key, drafts, updated_at)
          VALUES ('shadowcabinet', $1::jsonb, NOW())
       ON CONFLICT (group_key)
       DO UPDATE SET drafts = EXCLUDED.drafts, updated_at = NOW()`,
      [JSON.stringify(drafts)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/shadowcabinet/drafts]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Character work plan (constituency work allocation) ────────────────────────
const cwpReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const cwpWriteLimit = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });
const MAX_JOB_TITLE_LENGTH = 200;

// GET /api/me/work-plan — return active character's work plan
app.get("/api/me/work-plan", cwpReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: charRows } = await pool.query(
      `SELECT c.id FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC, c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) return res.status(404).json({ error: "No active character" });
    const charId = charRows[0].id;

    const { rows } = await pool.query(
      "SELECT hours, second_job_title_company, last_saved_sim_index, updated_at FROM character_work_plans WHERE character_id = $1",
      [charId]
    );
    if (!rows.length) return res.json({ workPlan: null });
    res.json({
      workPlan: {
        hours:                   rows[0].hours || {},
        secondJobTitleCompany:   rows[0].second_job_title_company || "",
        lastSavedSimIndex:       rows[0].last_saved_sim_index,
        updatedAt:               rows[0].updated_at,
      },
    });
  } catch (e) {
    console.error("[GET /api/me/work-plan]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/me/work-plan — upsert active character's work plan
app.post("/api/me/work-plan", cwpWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: charRows } = await pool.query(
      `SELECT c.id FROM characters c
        WHERE c.user_id = $1 AND c.is_active = TRUE
        ORDER BY (c.id = (SELECT active_character_id FROM users WHERE id = $1)) DESC, c.created_at DESC
        LIMIT 1`,
      [req.session.userId]
    );
    if (!charRows.length) return res.status(404).json({ error: "No active character" });
    const charId = charRows[0].id;

    const { hours, secondJobTitleCompany = "", lastSavedSimIndex = 0 } = req.body || {};
    if (!hours || typeof hours !== "object") return res.status(400).json({ error: "hours object required" });

    await pool.query(
      `INSERT INTO character_work_plans (character_id, hours, second_job_title_company, last_saved_sim_index, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, NOW())
       ON CONFLICT (character_id) DO UPDATE
         SET hours                    = EXCLUDED.hours,
             second_job_title_company = EXCLUDED.second_job_title_company,
             last_saved_sim_index     = EXCLUDED.last_saved_sim_index,
             updated_at               = NOW()`,
      [charId, JSON.stringify(hours), String(secondJobTitleCompany).slice(0, MAX_JOB_TITLE_LENGTH), Number(lastSavedSimIndex) || 0]
    );
    await writeAuditLog(req.session.userId, "work_plan.save", "character_work_plans", charId, null, { lastSavedSimIndex });
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/me/work-plan]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST   /api/offices              — admin: create office
// POST   /api/offices/:id/assign   — admin: assign character to office
// DELETE /api/offices/:id/assign/:characterId — admin: remove assignment
// ═══════════════════════════════════════════════════════════════════════════

const officeReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const officeWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/offices", officeReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(`
      SELECT o.id, o.name, o.type, o.spec_id, o.created_at,
             json_agg(json_build_object(
               'character_id', a.character_id,
               'character_name', c.name,
               'assigned_at', a.assigned_at
             ) ORDER BY a.assigned_at) FILTER (WHERE a.character_id IS NOT NULL) AS assignments
        FROM offices o
        LEFT JOIN office_assignments a ON a.office_id = o.id
        LEFT JOIN characters c ON c.id = a.character_id
       GROUP BY o.id
       ORDER BY o.type, o.name
    `);
    res.json({ offices: rows.map((r) => ({ ...r, assignments: r.assignments || [] })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/offices", officeWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { name, type = "parliamentary" } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const validTypes = ["cabinet", "shadow", "parliamentary", "other"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
    }
    const { rows } = await pool.query(
      "INSERT INTO offices (name, type) VALUES ($1, $2) RETURNING id, name, type, created_at",
      [name.trim(), type]
    );
    await writeAuditLog(req.session.userId, "office.create", "office", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, office: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/offices/:id/assign", officeWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { character_id } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });

    // Verify office and character exist
    const [{ rows: offRows }, { rows: charRows }] = await Promise.all([
      pool.query("SELECT id, name, type, spec_id FROM offices WHERE id = $1", [req.params.id]),
      pool.query("SELECT id, name FROM characters WHERE id = $1", [character_id]),
    ]);
    if (!offRows.length)  return res.status(404).json({ error: "Office not found" });
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });
    const office = offRows[0];

    // Permission: admin/mod always allowed; PM can assign non-PM cabinet; LOTO can assign non-LOTO shadow
    const sessionRoles = Array.isArray(req.session?.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    if (!isAdminOrMod) {
      const callerCharId = await getActiveCharacterId(req);
      if (!callerCharId) return res.status(403).json({ error: "Forbidden" });
      if (office.type === "cabinet" && office.spec_id !== "prime-minister") {
        const { rows: pmCheck } = await pool.query(
          `SELECT 1 FROM office_assignments oa JOIN offices o ON o.id = oa.office_id
            WHERE o.spec_id = 'prime-minister' AND oa.character_id = $1`, [callerCharId]
        );
        if (!pmCheck.length) return res.status(403).json({ error: "Only the Prime Minister or admin/mod can appoint cabinet offices" });
      } else if (office.type === "shadow" && office.spec_id !== "leader-opposition") {
        const { rows: lotoCheck } = await pool.query(
          `SELECT 1 FROM office_assignments oa JOIN offices o ON o.id = oa.office_id
            WHERE o.spec_id = 'leader-opposition' AND oa.character_id = $1`, [callerCharId]
        );
        if (!lotoCheck.length) return res.status(403).json({ error: "Only the Leader of the Opposition or admin/mod can appoint shadow offices" });
      } else {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    // Get current holder for salary recomputation
    const { rows: oldRows } = await pool.query(
      "SELECT character_id FROM office_assignments WHERE office_id = $1 LIMIT 1",
      [req.params.id]
    );
    const oldCharId = oldRows[0]?.character_id ?? null;

    // Exclusive assignment: clear any existing holders then insert new
    const { rows } = await pool.query(
      `INSERT INTO office_assignments (office_id, character_id)
       VALUES ($1, $2)
       ON CONFLICT (office_id, character_id) DO UPDATE SET assigned_at = NOW()
       RETURNING id, office_id, character_id, assigned_at`,
      [req.params.id, character_id]
    );
    await pool.query(
      "DELETE FROM office_assignments WHERE office_id = $1 AND character_id != $2",
      [req.params.id, character_id]
    );

    // Recompute salary positions for old and new holder
    const toRecompute = new Set([oldCharId, character_id].filter(Boolean));
    for (const charId of toRecompute) {
      await recomputeSalaryPositions(charId).catch((e) => console.error("[salary positions]", charId, e.message));
    }

    await writeAuditLog(req.session.userId, "office.assign", "office_assignment", rows[0].id,
      { old_character_id: oldCharId }, { office_id: req.params.id, character_id });
    res.status(201).json({ ok: true, assignment: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/offices/:id/assign/:characterId", officeWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;

    // Permission check (same logic as assign)
    const { rows: offRows } = await pool.query(
      "SELECT type, spec_id FROM offices WHERE id = $1", [req.params.id]
    );
    if (!offRows.length) return res.status(404).json({ error: "Office not found" });
    const office = offRows[0];

    const sessionRoles = Array.isArray(req.session?.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    if (!isAdminOrMod) {
      const callerCharId = await getActiveCharacterId(req);
      if (!callerCharId) return res.status(403).json({ error: "Forbidden" });
      if (office.type === "cabinet" && office.spec_id !== "prime-minister") {
        const { rows: pmCheck } = await pool.query(
          `SELECT 1 FROM office_assignments oa JOIN offices o ON o.id = oa.office_id
            WHERE o.spec_id = 'prime-minister' AND oa.character_id = $1`, [callerCharId]
        );
        if (!pmCheck.length) return res.status(403).json({ error: "Forbidden" });
      } else if (office.type === "shadow" && office.spec_id !== "leader-opposition") {
        const { rows: lotoCheck } = await pool.query(
          `SELECT 1 FROM office_assignments oa JOIN offices o ON o.id = oa.office_id
            WHERE o.spec_id = 'leader-opposition' AND oa.character_id = $1`, [callerCharId]
        );
        if (!lotoCheck.length) return res.status(403).json({ error: "Forbidden" });
      } else {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const { rowCount } = await pool.query(
      "DELETE FROM office_assignments WHERE office_id = $1 AND character_id = $2",
      [req.params.id, req.params.characterId]
    );
    if (!rowCount) return res.status(404).json({ error: "Assignment not found" });

    // Recompute salary for removed character
    await recomputeSalaryPositions(req.params.characterId).catch((e) => console.error("[salary positions]", e.message));

    await writeAuditLog(req.session.userId, "office.unassign", "office_assignment",
      `${req.params.id}:${req.params.characterId}`, { office_id: req.params.id, character_id: req.params.characterId }, null);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DIVISIONS (generic weighted voting engine)
// POST  /api/divisions/create    — admin: open a division
// POST  /api/divisions/:id/vote  — authenticated: cast vote
// POST  /api/divisions/:id/close — admin: close division and tally
// GET   /api/divisions           — authenticated: list divisions
// GET   /api/divisions/:id       — authenticated: get division with tally
// ═══════════════════════════════════════════════════════════════════════════

const divReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const divWriteLimit = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });

app.get("/api/divisions", divReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { status } = req.query;
    let q = "SELECT id, entity_type, entity_id, title, status, closes_at, created_at FROM divisions";
    const params = [];
    if (status === "open" || status === "closed") {
      q += " WHERE status = $1"; params.push(status);
    }
    q += " ORDER BY created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json({ divisions: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/divisions/:id", divReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, entity_type, entity_id, title, status, closes_at, created_at FROM divisions WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Division not found" });

    // Aggregate weighted tally
    const { rows: votes } = await pool.query(
      `SELECT dv.vote,
              SUM(dv.effective_weight) AS total_weight,
              COUNT(*) AS count,
              COALESCE(c.party, 'Independent') AS party
         FROM division_votes dv
         LEFT JOIN characters c ON c.id = dv.character_id
        WHERE dv.division_id = $1
        GROUP BY dv.vote, COALESCE(c.party, 'Independent')`,
      [req.params.id]
    );
    const tally = { aye: 0, no: 0, abstain: 0 };
    const byParty = {};
    votes.forEach((v) => {
      tally[v.vote] = Number(tally[v.vote] || 0) + Number(v.total_weight || 0);
      byParty[v.party] ??= { aye: 0, no: 0, abstain: 0 };
      byParty[v.party][v.vote] = Number(byParty[v.party][v.vote] || 0) + Number(v.total_weight || 0);
    });

    const { rows: delegations } = await pool.query(
      `SELECT character_id, delegation_source_character_id
         FROM division_votes
        WHERE division_id = $1
          AND delegation_source_character_id IS NOT NULL`,
      [req.params.id]
    );

    const immutableResult = rows[0].immutable_result || null;

    res.json({ division: rows[0], tally, byParty, delegationMap: delegations, immutableResult });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/divisions/create — admin/mod/speaker: create a division for a given entity
app.post("/api/divisions/create", divWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const canCreate = sessionRoles.includes("admin") || sessionRoles.includes("mod") || sessionRoles.includes("speaker");
    if (!canCreate) return res.status(403).json({ error: "admin, mod or speaker role required" });

    const { entity_type, entity_id, title = "", closes_at, closes_at_sim } = req.body || {};
    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: "entity_type and entity_id are required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO divisions (entity_type, entity_id, title, closes_at, closes_at_sim)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, entity_type, entity_id, title, status, closes_at, closes_at_sim, npc_votes, rebels_by_party, outcome, created_at`,
      [entity_type, String(entity_id), title, closes_at || null, closes_at_sim || null]
    );
    await writeAuditLog(req.session.userId, "division.create", "division", rows[0].id, null, rows[0]);
    res.status(201).json({ ok: true, division: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/divisions/for-entity/:entityType/:entityId — look up a division by entity
app.get("/api/divisions/for-entity/:entityType/:entityId", divReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { entityType, entityId } = req.params;
    const { rows } = await pool.query(
      `SELECT id, entity_type, entity_id, title, status, closes_at, closes_at_sim,
              npc_votes, rebels_by_party, outcome, created_at
         FROM divisions WHERE entity_type = $1 AND entity_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [entityType, entityId]
    );
    if (!rows.length) return res.status(404).json({ error: "No division found for this entity" });

    const division = rows[0];

    // Tally using effective_weight (server-computed seat-proportional values)
    const { rows: votes } = await pool.query(
      `SELECT vote, SUM(effective_weight) AS total_weight, COUNT(*) AS count
         FROM division_votes WHERE division_id = $1
        GROUP BY vote`,
      [division.id]
    );
    const tally = { aye: 0, no: 0, abstain: 0 };
    votes.forEach((v) => { tally[v.vote] = Number(v.total_weight); });

    // Also add NPC party votes to the live tally
    const npcV = division.npc_votes || {};
    const rebelP = division.rebels_by_party || {};
    const { rows: seatRows } = await pool.query(
      "SELECT party_name, COUNT(*) AS seats FROM constituencies WHERE party_name IS NOT NULL AND party_name <> '' GROUP BY party_name"
    );
    const seatsByParty = Object.fromEntries(seatRows.map(r => [r.party_name, Number(r.seats)]));
    for (const [party, npcVote] of Object.entries(npcV)) {
      if (tally[npcVote] === undefined) continue;
      const seats = Number(seatsByParty[party] || 0);
      const rebels = Number(rebelP[party] || 0);
      if (seats > 0) tally[npcVote] += Math.max(0, seats - rebels);
    }

    // Caller's own vote and effective weight
    const charId = await getActiveCharacterId(req);
    let myVote = null;
    let myWeight = 0;
    if (charId) {
      const { rows: mv } = await pool.query(
        "SELECT vote, effective_weight AS weight FROM division_votes WHERE division_id = $1 AND character_id = $2",
        [division.id, charId]
      );
      myVote = mv[0] || null;

      // Compute the caller's current effective weight from constituencies DB
      try {
        const { rows: charRows } = await pool.query(
          "SELECT name FROM characters WHERE id = $1", [charId]
        );
        const charName = charRows[0]?.name || "";
        const seatsByParty = await getPartySeatsFromConstituencies(pool);
        const { rows: stateRows } = await pool.query(
          `SELECT ss.data FROM state_snapshots ss
             JOIN app_state_current asc2 ON ss.id = asc2.snapshot_id
            WHERE asc2.id = 'main'`
        );
        const statePlayers = Array.isArray(stateRows[0]?.data?.players) ? stateRows[0].data.players : [];
        const { effectiveWeights } = computeAllPlayerWeights(seatsByParty, statePlayers);
        myWeight = Number(effectiveWeights[charName] || 0);
      } catch (wErr) { console.error("[division.for-entity myWeight]", wErr.message); /* weight display is best-effort */ }
    }

    res.json({ division, tally, myVote, myWeight });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/divisions/:id/vote — cast or update the caller's vote
// Body: { vote: 'aye'|'no'|'abstain' }
// Weight is ALWAYS computed server-side from constituencies DB + player state (client-supplied weight is ignored).
app.post("/api/divisions/:id/vote", divWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { vote } = req.body || {};
    if (!vote) return res.status(400).json({ error: "vote is required" });
    const validVotes = ["aye", "no", "abstain"];
    if (!validVotes.includes(vote)) {
      return res.status(400).json({ error: `vote must be one of: ${validVotes.join(", ")}` });
    }

    // Resolve the active character for the caller
    const charId = await getActiveCharacterId(req);
    if (!charId) return res.status(403).json({ error: "No active character. Select a character first." });

    // Verify division is open
    const { rows: divRows } = await pool.query(
      "SELECT id, status FROM divisions WHERE id = $1",
      [req.params.id]
    );
    if (!divRows.length) return res.status(404).json({ error: "Division not found" });
    if (divRows[0].status !== "open") return res.status(409).json({ error: "Division is closed" });

    // Get character name and party for weight computation and rebellion check
    const { rows: charRows } = await pool.query(
      "SELECT name, party FROM characters WHERE id = $1", [charId]
    );
    const charParty = charRows[0]?.party || null;
    const charName  = charRows[0]?.name  || null;

    // Compute effective weight server-side:
    //   seats from constituencies DB (authoritative source)
    //   player list from game state (for absence/delegation)
    let effectiveWeight = 1;
    try {
      const seatsByParty = await getPartySeatsFromConstituencies(pool);
      const { rows: stateRows } = await pool.query(
        `SELECT ss.data FROM state_snapshots ss
           JOIN app_state_current asc2 ON ss.id = asc2.snapshot_id
          WHERE asc2.id = 'main'`
      );
      const statePlayers = Array.isArray(stateRows[0]?.data?.players) ? stateRows[0].data.players : [];
      const { effectiveWeights } = computeAllPlayerWeights(seatsByParty, statePlayers);
      effectiveWeight = Number(effectiveWeights[charName] || 0);
    } catch (wErr) {
      console.error("[division.vote weight-calc]", wErr.message);
      // Fall back to weight=1 so the vote is still recorded
    }

    // Save vote (upsert) — client-supplied weight is always ignored
    const { rows: voteRows } = await pool.query(
      `INSERT INTO division_votes (division_id, character_id, vote, weight, effective_weight, delegation_source_character_id)
       VALUES ($1, $2, $3, $4, $4, NULL)
       ON CONFLICT (division_id, character_id)
       DO UPDATE SET vote = EXCLUDED.vote, weight = EXCLUDED.weight, effective_weight = EXCLUDED.effective_weight,
                     delegation_source_character_id = NULL, voted_at = NOW()
       RETURNING id, division_id, character_id, vote, weight, effective_weight, delegation_source_character_id, voted_at`,
      [req.params.id, charId, vote, effectiveWeight]
    );

    // Rebellion logging: check if party instruction exists and vote differs
    if (charParty) {
      try {
        const { rows: instrRows } = await pool.query(
          `SELECT position, whip_level, set_at_sim FROM division_party_instructions
            WHERE division_id = $1 AND party_slug = $2`,
          [req.params.id, charParty]
        );
        if (instrRows.length) {
          const instr = instrRows[0];
          if (instr.position !== "free" && instr.position !== vote) {
            // Get current sim date for recording
            const { rows: clk } = await pool.query(
              "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
            );
            const sm = clk[0]?.sim_current_month ?? 8;
            const sy = clk[0]?.sim_current_year  ?? 1997;
            const simStr = `${sy}-${String(sm).padStart(2, "0")}`;
            await pool.query(
              `INSERT INTO division_rebellion_log
                 (division_id, character_id, party_slug, party_position, mp_vote, whip_level, recorded_at_sim)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [req.params.id, charId, charParty, instr.position, vote, instr.whip_level, simStr]
            );
          }
        }
      } catch (rebErr) {
        console.error("[division.vote rebellion-log]", rebErr.message);
      }
    }

    // Return updated tally
    const { rows: tallyRows } = await pool.query(
      `SELECT vote, SUM(effective_weight) AS total_weight FROM division_votes WHERE division_id = $1 GROUP BY vote`,
      [req.params.id]
    );
    const tally = { aye: 0, no: 0, abstain: 0 };
    tallyRows.forEach((v) => { tally[v.vote] = Number(v.total_weight); });

    res.json({ ok: true, vote: voteRows[0], tally });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/divisions/:id/close — admin/mod/speaker: close a division and compute outcome
app.post("/api/divisions/:id/close", divWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const canClose = sessionRoles.includes("admin") || sessionRoles.includes("mod") || sessionRoles.includes("speaker");
    if (!canClose) return res.status(403).json({ error: "admin, mod or speaker role required" });

    // Fetch constituency seat totals (authoritative source) outside the transaction
    const seatsByParty = await getPartySeatsFromConstituencies(pool);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: divRows } = await client.query(
        "SELECT id, status, entity_type, entity_id, title, npc_votes, rebels_by_party FROM divisions WHERE id = $1 FOR UPDATE",
        [req.params.id]
      );
      if (!divRows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Division not found" }); }
      if (divRows[0].status === "closed") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Already closed" }); }

      // Compute player tally (uses server-computed effective_weight per vote)
      const { rows: votes } = await client.query(
        `SELECT vote, SUM(effective_weight) AS total_weight FROM division_votes WHERE division_id = $1 GROUP BY vote`,
        [req.params.id]
      );
      const tally = { aye: 0, no: 0, abstain: 0 };
      votes.forEach((v) => { tally[v.vote] = Number(v.total_weight); });

      // Add NPC votes — npc_votes: { "SNP": "aye" }, rebels_by_party: { "SNP": 5 }
      // Seat counts come from the constituencies DB (not from rebels_by_party keys).
      // Sinn Féin and Speaker are excluded automatically (0 seats taken / no vote).
      const npcVotes    = divRows[0].npc_votes    || {};
      const rebelsByPty = divRows[0].rebels_by_party || {};
      for (const [party, npcVote] of Object.entries(npcVotes)) {
        if (tally[npcVote] === undefined) continue;
        if (SINN_FEIN_PARTY_RE.test(party) || SPEAKER_PARTY_RE.test(party)) continue;
        const seats  = Number(seatsByParty[party] || 0);
        const rebels = Number(rebelsByPty[party] || 0);
        if (seats > 0) tally[npcVote] += Math.max(0, seats - rebels);
      }

      // Sinn Féin seats auto-abstain (do not take seats — excluded from aye/no counts)
      for (const [party, seats] of Object.entries(seatsByParty)) {
        if (SINN_FEIN_PARTY_RE.test(party) && seats > 0) {
          tally.abstain += seats;
        }
      }

      const outcome = tally.aye > tally.no ? "passed" : tally.no > tally.aye ? "failed" : "tied";
      const immutableResult = { tally, outcome, closedAt: new Date().toISOString() };
      await client.query(
        "UPDATE divisions SET status = 'closed', outcome = $2, immutable_result = $3::jsonb WHERE id = $1",
        [req.params.id, outcome, JSON.stringify(immutableResult)]
      );

      await client.query("COMMIT");
      await writeAuditLog(req.session.userId, "division.close", "division", req.params.id, divRows[0], { ...divRows[0], status: "closed", tally, outcome });
      res.json({ ok: true, division: { ...divRows[0], status: "closed", outcome, immutable_result: immutableResult }, tally, immutableResult });
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

// PATCH /api/divisions/:id/npc-votes — admin/mod/speaker: set NPC vote positions and rebel counts
app.patch("/api/divisions/:id/npc-votes", divWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const canSet = sessionRoles.includes("admin") || sessionRoles.includes("mod") || sessionRoles.includes("speaker");
    if (!canSet) return res.status(403).json({ error: "admin, mod or speaker role required" });

    const { npc_votes = {}, rebels_by_party = {} } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE divisions SET npc_votes = $1::jsonb, rebels_by_party = $2::jsonb
        WHERE id = $3
       RETURNING id, npc_votes, rebels_by_party`,
      [JSON.stringify(npc_votes), JSON.stringify(rebels_by_party), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Division not found" });
    res.json({ ok: true, division: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Division party instruction endpoints ────────────────────────────────────
// POST /api/divisions/:divisionId/party-instruction
// Body: { partySlug, position, whipLevel, note? }
// Requires: admin/mod, OR the party's Chief Whip (Party Leader as fallback if no whip assigned)
app.post("/api/divisions/:divisionId/party-instruction", divWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { partySlug, position, whipLevel = 0, note = "" } = req.body || {};
    if (!partySlug || !position) return res.status(400).json({ error: "partySlug and position are required" });
    const validPos = ["aye", "no", "abstain", "free"];
    if (!validPos.includes(position)) return res.status(400).json({ error: `position must be one of: ${validPos.join(", ")}` });
    if (![0,1,2,3].includes(Number(whipLevel))) return res.status(400).json({ error: "whipLevel must be 0, 1, 2 or 3" });

    // Verify division exists
    const { rows: divRows } = await pool.query("SELECT id FROM divisions WHERE id = $1", [req.params.divisionId]);
    if (!divRows.length) return res.status(404).json({ error: "Division not found" });

    // Permission: admin/mod OR chief whip (party leader is fallback if no chief whip assigned)
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    if (!isAdminOrMod) {
      const charId = await getActiveCharacterId(req);
      if (!charId) return res.status(403).json({ error: "No active character" });
      const { rows: ptyRows } = await pool.query(
        "SELECT leader_character_id, chief_whip_character_id FROM parties WHERE slug = $1", [partySlug]
      );
      if (!ptyRows.length) return res.status(404).json({ error: "Party not found" });
      // Chief Whip takes precedence; Party Leader is the fallback only when no Chief Whip is assigned.
      const chiefWhipId = ptyRows[0].chief_whip_character_id;
      const leaderId    = ptyRows[0].leader_character_id;
      let allowed = [];
      if (chiefWhipId) allowed = [String(chiefWhipId)];
      else if (leaderId) allowed = [String(leaderId)];
      if (!allowed.includes(String(charId))) {
        return res.status(403).json({ error: "Only the party chief whip (or party leader if no whip is assigned) can set party instructions" });
      }
    }

    const charId = await getActiveCharacterId(req);
    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const simStr = `${sy}-${String(sm).padStart(2, "0")}`;

    const { rows } = await pool.query(
      `INSERT INTO division_party_instructions
         (division_id, party_slug, position, whip_level, note, set_by_character_id, set_by_user_id, set_at_sim)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (division_id, party_slug)
       DO UPDATE SET position = EXCLUDED.position, whip_level = EXCLUDED.whip_level,
                     note = EXCLUDED.note, set_by_character_id = EXCLUDED.set_by_character_id,
                     set_by_user_id = EXCLUDED.set_by_user_id, set_at_sim = EXCLUDED.set_at_sim,
                     updated_at = now()
       RETURNING *`,
      [req.params.divisionId, partySlug, position, Number(whipLevel), note || null, charId || null, req.session.userId, simStr]
    );
    res.json({ ok: true, instruction: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/divisions/:divisionId/party-instruction/:partySlug
app.get("/api/divisions/:divisionId/party-instruction/:partySlug", divReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      `SELECT dpi.*, c.name AS set_by_name
         FROM division_party_instructions dpi
         LEFT JOIN characters c ON c.id = dpi.set_by_character_id
        WHERE dpi.division_id = $1 AND dpi.party_slug = $2`,
      [req.params.divisionId, req.params.partySlug]
    );
    if (!rows.length) return res.json({ instruction: null });
    res.json({ instruction: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/divisions/:divisionId/rebel-request
// Body: { requestedVote, message? }
app.post("/api/divisions/:divisionId/rebel-request", divWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { requestedVote, message = "" } = req.body || {};
    if (!requestedVote || !["aye","no","abstain"].includes(requestedVote)) {
      return res.status(400).json({ error: "requestedVote must be aye, no or abstain" });
    }

    const charId = await getActiveCharacterId(req);
    if (!charId) return res.status(403).json({ error: "No active character" });

    const { rows: charRows } = await pool.query("SELECT party FROM characters WHERE id = $1", [charId]);
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });
    const partySlug = charRows[0].party;

    const { rows: divRows } = await pool.query("SELECT id FROM divisions WHERE id = $1", [req.params.divisionId]);
    if (!divRows.length) return res.status(404).json({ error: "Division not found" });

    // Cancel any existing pending request before creating a new one
    await pool.query(
      `UPDATE division_rebel_requests SET status = 'cancelled'
        WHERE division_id = $1 AND character_id = $2 AND status = 'pending'`,
      [req.params.divisionId, charId]
    );

    const { rows } = await pool.query(
      `INSERT INTO division_rebel_requests (division_id, character_id, party_slug, requested_vote, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.divisionId, charId, partySlug, requestedVote, message || null]
    );
    res.status(201).json({ ok: true, request: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/divisions/:divisionId/rebel-request — caller's own rebel request
app.get("/api/divisions/:divisionId/rebel-request", divReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const charId = await getActiveCharacterId(req);
    if (!charId) return res.json({ request: null });
    const { rows } = await pool.query(
      `SELECT r.*, c.name AS decided_by_name
         FROM division_rebel_requests r
         LEFT JOIN characters c ON c.id = r.decided_by_character_id
        WHERE r.division_id = $1 AND r.character_id = $2
        ORDER BY r.created_at DESC LIMIT 1`,
      [req.params.divisionId, charId]
    );
    res.json({ request: rows[0] || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/divisions/:divisionId/rebel-request/:requestId/decide
// Body: { status: 'granted'|'refused' }
// Requires: chief whip, party leader, or admin/mod
app.post("/api/divisions/:divisionId/rebel-request/:requestId/decide", divWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { status: decision } = req.body || {};
    if (!["granted","refused"].includes(decision)) {
      return res.status(400).json({ error: "status must be 'granted' or 'refused'" });
    }

    const { rows: reqRows } = await pool.query(
      "SELECT * FROM division_rebel_requests WHERE id = $1 AND division_id = $2",
      [req.params.requestId, req.params.divisionId]
    );
    if (!reqRows.length) return res.status(404).json({ error: "Request not found" });
    if (reqRows[0].status !== "pending") return res.status(409).json({ error: "Request is no longer pending" });

    const partySlug = reqRows[0].party_slug;
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isAdminOrMod = sessionRoles.includes("admin") || sessionRoles.includes("mod");
    if (!isAdminOrMod) {
      const charId = await getActiveCharacterId(req);
      if (!charId) return res.status(403).json({ error: "No active character" });
      const { rows: ptyRows } = await pool.query(
        "SELECT leader_character_id, chief_whip_character_id FROM parties WHERE slug = $1", [partySlug]
      );
      if (!ptyRows.length) return res.status(404).json({ error: "Party not found" });
      const allowed = [String(ptyRows[0].leader_character_id), String(ptyRows[0].chief_whip_character_id)];
      if (!allowed.includes(String(charId))) {
        return res.status(403).json({ error: "Only the party leader or chief whip can decide rebel requests" });
      }
    }

    const deciderId = await getActiveCharacterId(req);
    const { rows: clk } = await pool.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const sm = clk[0]?.sim_current_month ?? 8;
    const sy = clk[0]?.sim_current_year  ?? 1997;
    const simStr = `${sy}-${String(sm).padStart(2, "0")}`;

    const { rows } = await pool.query(
      `UPDATE division_rebel_requests
          SET status = $1, decided_by_character_id = $2, decided_by_user_id = $3, decided_at_sim = $4
        WHERE id = $5 RETURNING *`,
      [decision, deciderId || null, req.session.userId, simStr, req.params.requestId]
    );
    res.json({ ok: true, request: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION TIME (structured DB-driven)
// GET    /api/qt/questions                  — authenticated: list QT questions
// POST   /api/qt/questions                  — authenticated: submit question
// PATCH  /api/qt/questions/:id              — admin/mod: update status
// POST   /api/qt/questions/:id/answer       — authenticated: post answer
// POST   /api/qt/questions/:id/followup     — authenticated: post follow-up
// GET    /api/qt/questions/:id              — authenticated: get question + answers
// ═══════════════════════════════════════════════════════════════════════════

const qtReadLimit  = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const qtWriteLimit = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });

app.get("/api/qt/questions", qtReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { office_id, status } = req.query;
    let q = `
      SELECT q.id, q.office_id, q.question_text, q.status, q.created_at, q.updated_at,
             c.name AS asked_by_name
        FROM qt_questions q
        LEFT JOIN characters c ON c.id = q.asked_by_character_id
    `;
    const params = [];
    const where = [];
    if (office_id) { params.push(office_id); where.push(`q.office_id = $${params.length}`); }
    if (status)    { params.push(status);    where.push(`q.status = $${params.length}`); }
    if (where.length) q += " WHERE " + where.join(" AND ");
    q += " ORDER BY q.created_at DESC";
    const { rows } = await pool.query(q, params);
    res.json({ questions: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/qt/questions/:id", qtReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows: qRows } = await pool.query(
      `SELECT q.id, q.office_id, q.question_text, q.status, q.created_at, q.updated_at,
              q.asked_by_character_id, c.name AS asked_by_name
         FROM qt_questions q LEFT JOIN characters c ON c.id = q.asked_by_character_id
        WHERE q.id = $1`,
      [req.params.id]
    );
    if (!qRows.length) return res.status(404).json({ error: "Question not found" });

    const [{ rows: answers }, { rows: followups }] = await Promise.all([
      pool.query(
        `SELECT a.id, a.answer_text, a.created_at, c.name AS answered_by_name
           FROM qt_answers a LEFT JOIN characters c ON c.id = a.answered_by_character_id
          WHERE a.question_id = $1 ORDER BY a.created_at`,
        [req.params.id]
      ),
      pool.query(
        `SELECT f.id, f.followup_text, f.answer_text, f.created_at, c.name AS asked_by_name
           FROM qt_followups f LEFT JOIN characters c ON c.id = f.asked_by_character_id
          WHERE f.question_id = $1 ORDER BY f.created_at`,
        [req.params.id]
      ),
    ]);

    res.json({ question: qRows[0], answers, followups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions", qtWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { office_id, question_text } = req.body || {};
    if (!office_id || !question_text) {
      return res.status(400).json({ error: "office_id and question_text are required" });
    }
    // Always derive character from session — never trust client-supplied asked_by_character_id
    const charId = await getActiveCharacterId(req);
    // Server-side dedup: same character + office + text within 10 minutes → 409
    if (charId) {
      const { rows: dupeRows } = await pool.query(
        `SELECT id FROM qt_questions
          WHERE asked_by_character_id = $1
            AND office_id             = $2
            AND question_text         = $3
            AND created_at > NOW() - INTERVAL '10 minutes'
          LIMIT 1`,
        [charId, office_id, question_text.trim()]
      );
      if (dupeRows.length) {
        return res.status(409).json({ error: "A question with the same text was already submitted recently. Please wait before resubmitting." });
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO qt_questions (office_id, asked_by_character_id, question_text)
       VALUES ($1, $2, $3)
       RETURNING id, office_id, asked_by_character_id, question_text, status, created_at`,
      [office_id, charId || null, question_text.trim()]
    );
    res.status(201).json({ ok: true, question: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/qt/questions/:id", qtWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { status } = req.body || {};
    const validStatuses = ["open", "answered", "archived"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    }
    const { rows } = await pool.query(
      "UPDATE qt_questions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status",
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Question not found" });
    await writeAuditLog(req.session.userId, "qt.question.status", "qt_question", req.params.id, null, rows[0]);
    res.json({ ok: true, question: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/qt/questions/:id/answer", qtWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { answered_by_character_id, answer_text } = req.body || {};
    if (!answer_text || !answer_text.trim()) {
      return res.status(400).json({ error: "answer_text is required" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: qRows } = await client.query(
        "SELECT id, status FROM qt_questions WHERE id = $1", [req.params.id]
      );
      if (!qRows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Question not found" }); }

      const { rows } = await client.query(
        `INSERT INTO qt_answers (question_id, answered_by_character_id, answer_text)
         VALUES ($1, $2, $3) RETURNING id, question_id, answer_text, created_at`,
        [req.params.id, answered_by_character_id || null, answer_text.trim()]
      );
      await client.query(
        "UPDATE qt_questions SET status = 'answered', updated_at = NOW() WHERE id = $1",
        [req.params.id]
      );
      await client.query("COMMIT");
      res.status(201).json({ ok: true, answer: rows[0] });
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

app.post("/api/qt/questions/:id/followup", qtWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { asked_by_character_id, followup_text, answer_text = "" } = req.body || {};
    if (!followup_text || !followup_text.trim()) {
      return res.status(400).json({ error: "followup_text is required" });
    }
    const { rows: qRows } = await pool.query("SELECT id FROM qt_questions WHERE id = $1", [req.params.id]);
    if (!qRows.length) return res.status(404).json({ error: "Question not found" });

    const { rows } = await pool.query(
      `INSERT INTO qt_followups (question_id, asked_by_character_id, followup_text, answer_text)
       VALUES ($1, $2, $3, $4) RETURNING id, question_id, followup_text, answer_text, created_at`,
      [req.params.id, asked_by_character_id || null, followup_text.trim(), answer_text.trim()]
    );
    res.status(201).json({ ok: true, followup: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATION STATE
// GET   /api/sim        — authenticated: get current sim state
// POST  /api/sim/tick   — admin: advance simulation clock by one month
// POST  /api/sim/set    — admin: set simulation state directly
// ═══════════════════════════════════════════════════════════════════════════

const simReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const simWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/sim", simReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, year, month, is_paused, last_tick_at FROM sim_state WHERE id = 'main'");
    if (!rows.length) return res.status(404).json({ error: "Sim state not found" });
    res.json({ sim: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/sim/tick", simWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(`
      UPDATE sim_state
         SET month        = CASE WHEN month = 12 THEN 1 ELSE month + 1 END,
             year         = CASE WHEN month = 12 THEN year + 1 ELSE year END,
             last_tick_at = NOW()
       WHERE id = 'main' AND is_paused = FALSE
       RETURNING id, year, month, is_paused, last_tick_at
    `);
    if (!rows.length) {
      // Either not found or paused
      const { rows: current } = await pool.query("SELECT is_paused FROM sim_state WHERE id = 'main'");
      if (current.length && current[0].is_paused) {
        return res.status(409).json({ error: "Simulation is paused" });
      }
      return res.status(404).json({ error: "Sim state not found" });
    }
    // Keep sim_clock in sync so both clock representations agree.
    await pool.query(
      `UPDATE sim_clock SET sim_current_month = $1, sim_current_year = $2, real_last_tick = NOW() WHERE id = 'main'`,
      [rows[0].month, rows[0].year]
    );
    await writeAuditLog(req.session.userId, "sim.tick", "sim_state", "main", null, rows[0]);

    // Automatic salary crediting — runs on every tick (catch-up for missed 2-month periods)
    runSalaryCrediting(rows[0].month, rows[0].year).catch((e) => console.error("[sim/tick] salary crediting failed:", e.message));
    runShopUpkeep(rows[0].month, rows[0].year).catch((e) => console.error("[sim/tick] shop upkeep failed:", e.message));
    runMembershipIntake(rows[0].month, rows[0].year).catch((e) => console.error("[sim/tick] membership intake failed:", e.message));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/sim/set", simWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { year, month, is_paused } = req.body || {};
    if (year != null && (typeof year !== "number" || year < 1900 || year > 2200)) {
      return res.status(400).json({ error: "year must be a number between 1900 and 2200" });
    }
    if (month != null && (typeof month !== "number" || month < 1 || month > 12)) {
      return res.status(400).json({ error: "month must be a number between 1 and 12" });
    }

    const { rows: before } = await pool.query("SELECT year, month, is_paused FROM sim_state WHERE id = 'main'");
    if (!before.length) return res.status(404).json({ error: "Sim state not found" });

    const fields = [];
    const params = [];
    if (year      != null) { params.push(year);      fields.push(`year = $${params.length}`); }
    if (month     != null) { params.push(month);     fields.push(`month = $${params.length}`); }
    if (is_paused != null) { params.push(is_paused); fields.push(`is_paused = $${params.length}`); }
    if (!fields.length) return res.status(400).json({ error: "Nothing to update" });

    params.push("main");
    const { rows } = await pool.query(
      `UPDATE sim_state SET ${fields.join(", ")} WHERE id = $${params.length}
       RETURNING id, year, month, is_paused, last_tick_at`,
      params
    );
    // Keep sim_clock in sync when year/month change.
    if (year != null || month != null) {
      await pool.query(
        `UPDATE sim_clock SET
           sim_current_month = $1,
           sim_current_year  = $2,
           real_last_tick    = NOW()
         WHERE id = 'main'`,
        [rows[0].month, rows[0].year]
      );
    }
    await writeAuditLog(req.session.userId, "sim.set", "sim_state", "main", before[0], rows[0]);
    res.json({ ok: true, sim: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BILLS — add PATCH for stage transitions (triggers Discourse on 2nd Reading)
// PATCH /api/bills/:id   — admin/mod: update bill fields (stage triggers Discourse)
// ═══════════════════════════════════════════════════════════════════════════

app.patch("/api/bills/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rows: before } = await pool.query("SELECT id, data FROM bills WHERE id = $1", [req.params.id]);
    if (!before.length) return res.status(404).json({ error: "Bill not found" });

    const updated = { ...before[0].data, ...req.body, id: req.params.id };
    const { rows } = await pool.query(
      "UPDATE bills SET data = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING id, data, updated_at",
      [JSON.stringify(updated), req.params.id]
    );

    const newStage = updated.stage || updated.status;
    const oldStage = before[0].data?.stage || before[0].data?.status;

    // Auto-create Discourse topic when bill enters Second Reading (if not already linked)
    let topicUrl = updated.discourseTopicUrl || null;
    if (
      newStage === "second_reading" &&
      oldStage !== "second_reading" &&
      !updated.discourseTopicId
    ) {
      try {
        const { baseUrl, apiKey, apiUsername } = await loadDiscourseCredentials();
        const title = `[Bill] ${updated.title || req.params.id} — Second Reading Debate`;
        const raw   = updated.summary || updated.body || `Debate on **${updated.title || req.params.id}** at Second Reading.`;
        const { topicId, topicUrl: url } = await dcWithRetry(
          () => dcCreateTopic(baseUrl, apiKey, apiUsername, title, raw),
          3, 500
        );
        topicUrl = url;
        await pool.query(
          `UPDATE bills SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ discourseTopicId: topicId, discourseTopicUrl: url }), req.params.id]
        );
        rows[0].data = { ...rows[0].data, discourseTopicId: topicId, discourseTopicUrl: url };
      } catch (discErr) {
        // Non-fatal: log and continue; topic can be synced manually
        console.error("[bills/patch] Discourse auto-topic failed:", discErr.message);
      }
    }

    await writeAuditLog(req.session.userId, "bill.patch", "bill", req.params.id, before[0].data, rows[0].data);
    res.json({ ok: true, bill: { ...rows[0].data, _updatedAt: rows[0].updated_at }, topicUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: Discourse sync — re-sync bills missing Discourse topic link
// POST /api/admin/discourse-sync-bills — admin
// ═══════════════════════════════════════════════════════════════════════════

const discourseBillSyncLimit = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

app.post("/api/admin/discourse-sync-bills", discourseBillSyncLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    // Find bills at second_reading stage without a Discourse topic
    const { rows: bills } = await pool.query(
      `SELECT id, data FROM bills
        WHERE (data->>'stage' = 'second_reading' OR data->>'status' = 'second_reading')
          AND data->>'discourseTopicId' IS NULL`
    );

    if (!bills.length) return res.json({ ok: true, synced: 0, message: "No bills need syncing" });

    let baseUrl, apiKey, apiUsername;
    try {
      ({ baseUrl, apiKey, apiUsername } = await loadDiscourseCredentials());
    } catch (credErr) {
      return res.status(400).json({ ok: false, error: credErr.message });
    }

    const results = [];
    for (const bill of bills) {
      try {
        const title = `[Bill] ${bill.data.title || bill.id} — Second Reading Debate`;
        const raw   = bill.data.summary || bill.data.body || `Debate on **${bill.data.title || bill.id}** at Second Reading.`;
        const { topicId, topicUrl } = await dcWithRetry(
          () => dcCreateTopic(baseUrl, apiKey, apiUsername, title, raw),
          3, 500
        );
        await pool.query(
          `UPDATE bills SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify({ discourseTopicId: topicId, discourseTopicUrl: topicUrl }), bill.id]
        );
        results.push({ id: bill.id, ok: true, topicId, topicUrl });
      } catch (err) {
        results.push({ id: bill.id, ok: false, error: err.message });
      }
    }

    const synced = results.filter((r) => r.ok).length;
    await writeAuditLog(req.session.userId, "admin.discourse-sync-bills", "bills", "*", null, { synced, results });
    res.json({ ok: true, synced, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: wipe-content — safe sim reset (no user/registration deletion)
// POST /api/admin/wipe-content
//
// Wipes gameplay/content tables and resets the sim clock + state to the
// August 1997 baseline.  User accounts and pending registrations are
// NOT touched.  Requires a typed confirmation body: { confirm: "WIPE CONTENT" }
// ═══════════════════════════════════════════════════════════════════════════

const wipeContentLimit = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

app.post("/api/admin/wipe-content", wipeContentLimit, async (req, res) => {
  try {
    if (!isDevSeedAllowed()) return res.status(404).json({ error: "Not found" });
    if (!requireAdmin(req, res)) return;

    const { confirm: confirmText } = req.body || {};
    if (confirmText !== "WIPE CONTENT") {
      return res.status(400).json({
        ok: false,
        error: "Confirmation text mismatch. Type WIPE CONTENT exactly to proceed.",
      });
    }

    // Wipe all gameplay/content tables
    await pool.query(
      "TRUNCATE bills, motions, statements, regulations, questiontime_questions, press_items, polling_entries"
    );

    // Reset sim clock to August 1997
    await pool.query(`
      INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
      VALUES ('main', 8, 1997, 1)
      ON CONFLICT (id) DO UPDATE SET
        sim_current_month = 8,
        sim_current_year  = 1997,
        rate              = 1,
        real_last_tick    = NOW()
    `);

    // Reset sim_state to August 1997
    await pool.query(`
      INSERT INTO sim_state (id, year, month, is_paused)
      VALUES ('main', 1997, 8, true)
      ON CONFLICT (id) DO UPDATE SET
        year        = 1997,
        month       = 8,
        is_paused   = true,
        last_tick_at = NULL
    `);

    // Reset app_state_current — create a fresh empty snapshot and point to it
    const { rows: snapRows } = await pool.query(
      `INSERT INTO state_snapshots (label, data)
         VALUES ('Post-wipe baseline (August 1997)', '{}'::jsonb)
       RETURNING id`
    );
    const newSnapshotId = snapRows[0].id;
    await pool.query(
      `INSERT INTO app_state_current (id, snapshot_id)
         VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET snapshot_id = $1`,
      [newSnapshotId]
    );

    await writeAuditLog(req.session.userId, "admin.wipe-content", "all", "*", null, {
      tables: ["bills", "motions", "statements", "regulations", "questiontime_questions", "press_items", "polling_entries"],
      simResetTo: "August 1997",
      newSnapshotId,
    });

    // Ensure baseline constituencies are present after reset (idempotent — skips if already seeded)
    await seedConstituencies1997();

    res.json({
      ok: true,
      message: "Content wiped and sim reset to August 1997. User accounts are intact.",
      wiped: ["bills", "motions", "statements", "regulations", "questiontime_questions", "press_items", "polling_entries"],
      simResetTo: "August 1997",
    });
  } catch (e) {
    console.error("[wipe-content]", e);
    res.status(500).json({ ok: false, error: "Server error during wipe" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: seed-demo — reset DB to a fully-populated baseline state
// POST /api/admin/seed-demo   — admin: idempotent demo data seeder
// POST /api/admin/seed        — canonical alias (same handler)
// ═══════════════════════════════════════════════════════════════════════════

const seedDemoLimit = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

async function handleSeedDemo(req, res) {
  try {
    if (!isDevSeedAllowed()) return res.status(404).json({ error: "Not found" });
    if (!requireAdmin(req, res)) return;

    // ── Reset clock to August 1997 ─────────────────────────────────────────
    await pool.query(`
      INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
      VALUES ('main', 8, 1997, 1)
      ON CONFLICT (id) DO UPDATE SET
        sim_current_month = 8,
        sim_current_year  = 1997,
        rate              = 1,
        real_last_tick    = NOW()
    `);

    // ── Reset sim_state (authoritative pause/tick state) to August 1997 ───
    await pool.query(`
      INSERT INTO sim_state (id, year, month, is_paused)
      VALUES ('main', 1997, 8, true)
      ON CONFLICT (id) DO UPDATE SET
        year         = 1997,
        month        = 8,
        is_paused    = true,
        last_tick_at = NULL
    `);

    // ── Clear existing content ─────────────────────────────────────────────
    await pool.query(
      "TRUNCATE bills, motions, statements, regulations, questiontime_questions, press_items, polling_entries"
    );

    const SIM_MONTH = 8;
    const SIM_YEAR  = 1997;
    const NOW_ISO   = new Date().toISOString();
    const lc = (extra = {}) => attachLifecycle(extra, SIM_MONTH, SIM_YEAR, NOW_ISO);

    // ── Bills ──────────────────────────────────────────────────────────────
    const bills = [
      { id: "bill-001", title: "Education Standards Bill", summary: "Raises the school leaving age to 18 and introduces national curriculum benchmarks.", sponsor: "Secretary of State for Education", party: "Labour", stage: "second_reading", ...lc({ autoArchiveAfterSimMonths: 6 }) },
      { id: "bill-002", title: "National Health Service (Modernisation) Bill", summary: "Reforms NHS internal market and introduces primary care trusts.", sponsor: "Secretary of State for Health", party: "Labour", stage: "committee", ...lc({ autoArchiveAfterSimMonths: 9 }) },
      { id: "bill-003", title: "Crime and Disorder Bill", summary: "Introduces ASBOs and youth offending teams.", sponsor: "Home Secretary", party: "Labour", stage: "first_reading", ...lc({ autoArchiveAfterSimMonths: 6 }) },
      { id: "bill-004", title: "Bank of England (Independence) Bill", summary: "Grants the Bank of England operational independence to set interest rates.", sponsor: "Chancellor of the Exchequer", party: "Labour", stage: "royal_assent", ...lc({ status: "closed", autoArchiveAfterSimMonths: null }) },
      { id: "bill-005", title: "Devolution (Scotland) Bill", summary: "Establishes the Scottish Parliament with primary legislative competence.", sponsor: "Secretary of State for Scotland", party: "Labour", stage: "report", ...lc({ autoArchiveAfterSimMonths: 6 }) },
    ];
    for (const b of bills) {
      await pool.query(
        `INSERT INTO bills (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [b.id, JSON.stringify(b)]
      );
    }

    // ── Motions ────────────────────────────────────────────────────────────
    const motions = [
      { id: "motion-001", number: 1, title: "This House welcomes the Northern Ireland peace process", type: "house", proposedBy: "Prime Minister", party: "Labour", text: "This House welcomes the progress made in the Northern Ireland peace process and supports the Government's continued engagement with all parties to achieve a lasting settlement.", ...lc({ autoArchiveAfterSimMonths: 3 }) },
      { id: "motion-002", number: 2, title: "Early Day Motion on NHS Waiting Times", type: "edm", proposedBy: "Opposition Leader", party: "Conservative", text: "This House notes with concern the increase in NHS waiting times over the past quarter.", ...lc({ autoArchiveAfterSimMonths: 2 }) },
      { id: "motion-003", number: 3, title: "Motion on Economic Policy", type: "house", proposedBy: "Chancellor", party: "Labour", text: "This House approves the Government's economic strategy for sustainable growth.", ...lc({ autoArchiveAfterSimMonths: 3 }) },
    ];
    for (const m of motions) {
      const mt = m.type === "edm" ? "edm" : "house";
      await pool.query(
        `INSERT INTO motions (id, motion_type, data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET motion_type = EXCLUDED.motion_type, data = EXCLUDED.data, updated_at = NOW()`,
        [m.id, mt, JSON.stringify(m)]
      );
    }

    // ── Statements ────────────────────────────────────────────────────────
    const statements = [
      { id: "stmt-001", number: 1, title: "Statement on Computer Systems and the Year 2000", minister: "Chancellor of the Duchy of Lancaster", party: "Labour", text: "The Government is establishing a task force to assess the readiness of public sector computer systems for the Year 2000 date change and will report to Parliament in due course.", ...lc({ autoArchiveAfterSimMonths: 3 }) },
      { id: "stmt-002", number: 2, title: "Statement on BSE Crisis", minister: "Secretary of State for Health", party: "Labour", text: "Following expert advice, the Government is implementing additional food safety measures regarding beef products.", ...lc({ autoArchiveAfterSimMonths: 4 }) },
      { id: "stmt-003", number: 3, title: "Statement on Hong Kong Handover", minister: "Foreign Secretary", party: "Labour", text: "The Government confirms that the handover of Hong Kong to China on 1 July 1997 proceeded in accordance with the Joint Declaration.", ...lc({ status: "closed" }) },
    ];
    for (const s of statements) {
      await pool.query(
        `INSERT INTO statements (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [s.id, JSON.stringify(s)]
      );
    }

    // ── Regulations ───────────────────────────────────────────────────────
    const regulations = [
      { id: "reg-001", regulationNumber: "SI 1997/1234", shortTitle: "Education (Teacher Pay) Regulations 1997", minister: "Secretary of State for Education", party: "Labour", text: "These Regulations set the pay scales for qualified teachers in England and Wales.", ...lc({ autoArchiveAfterSimMonths: 12 }) },
      { id: "reg-002", regulationNumber: "SI 1997/2345", shortTitle: "Road Traffic (Motorways) Regulations 1997", minister: "Secretary of State for Transport", party: "Labour", text: "These Regulations amend the national speed limit provisions applicable to motorways and dual carriageways.", ...lc({ autoArchiveAfterSimMonths: 6 }) },
    ];
    for (const r of regulations) {
      await pool.query(
        `INSERT INTO regulations (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [r.id, JSON.stringify(r)]
      );
    }

    // ── Question Time questions ───────────────────────────────────────────
    const qtQuestions = [
      { id: "qt-001", office: "prime-minister", askedBy: "William Hague", askedByParty: "Conservative", text: "Will the Prime Minister confirm the Government's plans for Scottish devolution?", status: "open", ...lc({ autoArchiveAfterSimMonths: 1 }) },
      { id: "qt-002", office: "chancellor", askedBy: "Michael Portillo", askedByParty: "Conservative", text: "Can the Chancellor explain why interest rates have risen twice since the election?", answer: "Interest rate decisions are now independently taken by the Bank of England's Monetary Policy Committee.", status: "answered", ...lc({ autoArchiveAfterSimMonths: 1 }) },
      { id: "qt-003", office: "home", askedBy: "Ann Widdecombe", askedByParty: "Conservative", text: "What steps is the Home Secretary taking to reduce youth crime in urban areas?", status: "open", ...lc({ autoArchiveAfterSimMonths: 1 }) },
    ];
    for (const q of qtQuestions) {
      await pool.query(
        `INSERT INTO questiontime_questions (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [q.id, JSON.stringify(q)]
      );
    }

    // ── Press items ───────────────────────────────────────────────────────
    const pressItems = [
      { id: "press-001", press_type: "release",    title: "Government Announces £1bn Schools Investment", headline: "Historic investment to modernise Britain's schools", body: "The Secretary of State for Education today announced a landmark £1 billion investment programme for school buildings.", author: "Number 10 Press Office", party: "Labour",        ...lc({ autoArchiveAfterSimMonths: 3 }) },
      { id: "press-002", press_type: "conference", title: "PM Holds Press Conference on Economy",          headline: "Prime Minister outlines economic strategy",    body: "At a Downing Street press conference, the Prime Minister outlined the Government's five-point plan for economic stability.", author: "Number 10 Press Office", party: "Labour",        ...lc({ autoArchiveAfterSimMonths: 2 }) },
      { id: "press-003", press_type: "release",    title: "Opposition Attacks NHS Record",                headline: "Conservative leader calls for urgent inquiry", body: "William Hague called for a full parliamentary inquiry into NHS waiting times, accusing the Government of broken promises.", author: "Conservative Party HQ",   party: "Conservative", ...lc({ autoArchiveAfterSimMonths: 2 }) },
    ];
    for (const p of pressItems) {
      const { press_type = "release", ...itemData } = p;
      await pool.query(
        `INSERT INTO press_items (id, press_type, data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET press_type = EXCLUDED.press_type, data = EXCLUDED.data, updated_at = NOW()`,
        [itemData.id, press_type, JSON.stringify(itemData)]
      );
    }

    // ── Polling entries ───────────────────────────────────────────────────
    const pollingEntries = [
      { id: "poll-001", weekLabel: "Aug Week 1 1997", simMonth: 8, simYear: 1997, parties: { Labour: 55, Conservative: 30, "Lib Dem": 12, Other: 3 }, ...lc({ autoArchiveAfterSimMonths: 24 }) },
      { id: "poll-002", weekLabel: "Aug Week 2 1997", simMonth: 8, simYear: 1997, parties: { Labour: 54, Conservative: 31, "Lib Dem": 12, Other: 3 }, ...lc({ autoArchiveAfterSimMonths: 24 }) },
      { id: "poll-003", weekLabel: "Aug Week 3 1997", simMonth: 8, simYear: 1997, parties: { Labour: 56, Conservative: 29, "Lib Dem": 12, Other: 3 }, ...lc({ autoArchiveAfterSimMonths: 24 }) },
    ];
    for (const pe of pollingEntries) {
      await pool.query(
        `INSERT INTO polling_entries (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [pe.id, JSON.stringify(pe)]
      );
    }

    await writeAuditLog(req.session.userId, "admin.seed-demo", "all", "*", null, {
      bills: bills.length, motions: motions.length, statements: statements.length,
      regulations: regulations.length, qtQuestions: qtQuestions.length,
      pressItems: pressItems.length, pollingEntries: pollingEntries.length,
    });

    res.json({
      ok: true,
      message: "Demo data seeded successfully. Simulation reset to August 1997.",
      counts: {
        bills: bills.length, motions: motions.length, statements: statements.length,
        regulations: regulations.length, qtQuestions: qtQuestions.length,
        pressItems: pressItems.length, pollingEntries: pollingEntries.length,
      },
    });
  } catch (e) {
    console.error("[seed-demo]", e);
    res.status(500).json({ error: "Server error during demo seed" });
  }
}

app.post("/api/admin/seed-demo", seedDemoLimit, handleSeedDemo);

// ─── POST /api/admin/seed — canonical alias for /api/admin/seed-demo ─────────
// Resets entire backend state to a clean, fully-populated baseline.
// Fully idempotent — safe to call repeatedly during development.
app.post("/api/admin/seed", seedDemoLimit, handleSeedDemo);

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD SUMMARY
// GET /api/admin/dashboard   — admin: summary data for moderator dashboard
// ═══════════════════════════════════════════════════════════════════════════

const dashboardLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

app.get("/api/admin/dashboard", dashboardLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const [qtPending, openDivisions, billsAwaitingDebate, recentAudit, pendingRegs] = await Promise.all([
      pool.query(
        "SELECT COUNT(*) AS count FROM qt_questions WHERE status = 'open'"
      ),
      pool.query(
        "SELECT COUNT(*) AS count FROM divisions WHERE status = 'open'"
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM bills
          WHERE (data->>'stage' = 'second_reading' OR data->>'status' = 'second_reading')
            AND data->>'discourseTopicId' IS NULL`
      ),
      pool.query(
        `SELECT id, actor_id, action, target, created_at
           FROM audit_log ORDER BY created_at DESC LIMIT 10`
      ),
      pool.query(
        "SELECT COUNT(*) AS count FROM pending_registrations WHERE status = 'pending'"
      ),
    ]);

    res.json({
      pendingQtQuestions:   Number(qtPending.rows[0].count),
      openDivisions:        Number(openDivisions.rows[0].count),
      billsAwaitingDebate:  Number(billsAwaitingDebate.rows[0].count),
      recentAuditLog:       recentAudit.rows,
      pendingRegistrations: Number(pendingRegs.rows[0].count),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SCANDAL SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

const scandalReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const scandalWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

// ── GET /api/scandals/mine ────────────────────────────────────────────────
app.get("/api/scandals/mine", scandalReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const characterId = await getActiveCharacterId(req);
    if (!characterId) return res.status(400).json({ error: "No active character" });

    const [optInRows, situationRows, scandalRows, choiceRows] = await Promise.all([
      pool.query(
        `SELECT opted_in FROM scandal_opt_in WHERE character_id = $1`,
        [characterId]
      ),
      pool.query(
        `SELECT ss.id, ss.template_id, ss.title_override, ss.status,
                ss.created_sim_year, ss.created_sim_month,
                ss.expires_sim_year, ss.expires_sim_month, ss.created_at,
                st.title, st.category, st.severity_base, st.time_window_months, st.stages
           FROM scandal_situations ss
           JOIN scandal_templates  st ON st.id = ss.template_id
          WHERE ss.character_id = $1 AND ss.status = 'open'
          ORDER BY ss.created_at DESC`,
        [characterId]
      ),
      pool.query(
        `SELECT id, template_id, title, category, severity_base, severity_current,
                stage_key, status, stage_started_sim_year, stage_started_sim_month,
                stage_deadline_sim_year, stage_deadline_sim_month, time_window_months,
                flags, public_notes, created_at, closed_at
           FROM scandals
          WHERE character_id = $1
          ORDER BY created_at DESC`,
        [characterId]
      ),
      pool.query(
        `SELECT spc.id, spc.scandal_id, spc.stage_key, spc.choice_id,
                spc.choice_label, spc.flags_patch, spc.created_sim_year,
                spc.created_sim_month, spc.created_at
           FROM scandal_player_choices spc
           JOIN scandals s ON s.id = spc.scandal_id
          WHERE s.character_id = $1
          ORDER BY spc.created_at ASC`,
        [characterId]
      ),
    ]);

    res.json({
      opted_in:      optInRows.rows[0]?.opted_in ?? false,
      situations:    situationRows.rows,
      scandals:      scandalRows.rows,
      player_choices: choiceRows.rows,
    });
  } catch (e) {
    console.error("[GET /api/scandals/mine]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/scandals/optin ──────────────────────────────────────────────
app.post("/api/scandals/optin", scandalWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const characterId = await getActiveCharacterId(req);
    if (!characterId) return res.status(400).json({ error: "No active character" });

    const opted_in = !!req.body?.opted_in;
    await pool.query(
      `INSERT INTO scandal_opt_in (character_id, opted_in, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (character_id) DO UPDATE SET opted_in = EXCLUDED.opted_in, updated_at = now()`,
      [characterId, opted_in]
    );
    res.json({ ok: true, opted_in });
  } catch (e) {
    console.error("[POST /api/scandals/optin]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/scandals/situations/:id/respond ─────────────────────────────
app.post("/api/scandals/situations/:id/respond", scandalWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const characterId = await getActiveCharacterId(req);
    if (!characterId) return res.status(400).json({ error: "No active character" });

    const { action } = req.body || {};
    if (!["investigate", "ignore", "report_party"].includes(action)) {
      return res.status(400).json({ error: "action must be investigate, ignore, or report_party" });
    }

    // Load situation and verify it belongs to this character
    const { rows: sitRows } = await pool.query(
      `SELECT ss.*, st.title, st.category, st.severity_base, st.time_window_months, st.stages
         FROM scandal_situations ss
         JOIN scandal_templates  st ON st.id = ss.template_id
        WHERE ss.id = $1 AND ss.character_id = $2 AND ss.status = 'open'`,
      [req.params.id, characterId]
    );
    if (!sitRows.length) return res.status(404).json({ error: "Situation not found or not open" });
    const sit = sitRows[0];

    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const simMonth = clockRows[0]?.sim_current_month ?? 8;
    const simYear  = clockRows[0]?.sim_current_year  ?? 1997;

    if (action === "ignore") {
      await pool.query(
        `UPDATE scandal_situations SET status = 'closed' WHERE id = $1`,
        [sit.id]
      );
      return res.json({ ok: true, action: "ignored" });
    }

    // investigate or report_party → create a scandal
    const stages = Array.isArray(sit.stages) ? sit.stages : [];
    const firstStageKey = stages.length ? stages[0].key : "rumour";
    const deadline = addSimMonths(simYear, simMonth, sit.time_window_months);
    const title = sit.title_override || sit.title;
    const flags = action === "report_party" ? { reported_to_party: true } : {};

    const { rows: newRows } = await pool.query(
      `INSERT INTO scandals
         (character_id, template_id, title, category, severity_base, severity_current,
          stage_key, status, stage_started_sim_year, stage_started_sim_month,
          stage_deadline_sim_year, stage_deadline_sim_month, time_window_months,
          flags, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$5,$6,'open',$7,$8,$9,$10,$11,$12::jsonb,$13)
       RETURNING id`,
      [
        characterId, sit.template_id, title, sit.category, sit.severity_base,
        firstStageKey, simYear, simMonth,
        deadline.sim_year, deadline.sim_month, sit.time_window_months,
        JSON.stringify(flags), sit.created_by_user_id,
      ]
    );

    // Close the situation
    await pool.query(
      `UPDATE scandal_situations SET status = 'closed' WHERE id = $1`,
      [sit.id]
    );

    res.json({ ok: true, action, scandal_id: newRows[0].id });
  } catch (e) {
    console.error("[POST /api/scandals/situations/:id/respond]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/scandals/:id/choose ─────────────────────────────────────────
app.post("/api/scandals/:id/choose", scandalWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const characterId = await getActiveCharacterId(req);
    if (!characterId) return res.status(400).json({ error: "No active character" });

    const { choice_id } = req.body || {};
    if (!choice_id) return res.status(400).json({ error: "choice_id is required" });

    // Load scandal and verify ownership
    const { rows: scandalRows } = await pool.query(
      `SELECT s.*, st.stages
         FROM scandals s
         JOIN scandal_templates st ON st.id = s.template_id
        WHERE s.id = $1 AND s.character_id = $2 AND s.status IN ('open')`,
      [req.params.id, characterId]
    );
    if (!scandalRows.length) return res.status(404).json({ error: "Scandal not found, not yours, or not open" });
    const scandal = scandalRows[0];

    // Find the current stage in the template
    const stages = Array.isArray(scandal.stages) ? scandal.stages : [];
    const currentStage = stages.find((s) => s.key === scandal.stage_key);
    if (!currentStage) return res.status(400).json({ error: "Current stage not found in template" });

    // Find the choice
    const choices = Array.isArray(currentStage.choices) ? currentStage.choices : [];
    const choice = choices.find((c) => c.id === choice_id);
    if (!choice) return res.status(400).json({ error: "Invalid choice_id for this stage" });

    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const simMonth = clockRows[0]?.sim_current_month ?? 8;
    const simYear  = clockRows[0]?.sim_current_year  ?? 1997;

    // Append player choice
    await pool.query(
      `INSERT INTO scandal_player_choices
         (scandal_id, stage_key, choice_id, choice_label, flags_patch,
          actor_character_id, created_sim_year, created_sim_month)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [
        scandal.id, scandal.stage_key, choice.id, choice.label,
        JSON.stringify(choice.flags_patch || {}),
        characterId, simYear, simMonth,
      ]
    );

    // Merge flags_patch into scandal.flags
    const newFlags = { ...(scandal.flags || {}), ...(choice.flags_patch || {}) };

    // Determine next stage
    const nextStageKey = choice.next_stage_key || null;
    let newStatus = "open";
    let closedAt = null;

    if (!nextStageKey) {
      newStatus = "closed";
      closedAt = new Date().toISOString();
    } else if (nextStageKey === "party_review") {
      newStatus = "awaiting_mod";
    }

    const deadline = nextStageKey
      ? addSimMonths(simYear, simMonth, scandal.time_window_months)
      : { sim_year: simYear, sim_month: simMonth };

    await pool.query(
      `UPDATE scandals SET
         stage_key               = COALESCE($2, stage_key),
         status                  = $3,
         stage_started_sim_year  = $4,
         stage_started_sim_month = $5,
         stage_deadline_sim_year = $6,
         stage_deadline_sim_month= $7,
         flags                   = $8::jsonb,
         closed_at               = $9
       WHERE id = $1`,
      [
        scandal.id,
        nextStageKey,
        newStatus,
        simYear, simMonth,
        deadline.sim_year, deadline.sim_month,
        JSON.stringify(newFlags),
        closedAt,
      ]
    );

    res.json({ ok: true, next_stage_key: nextStageKey, status: newStatus });
  } catch (e) {
    console.error("[POST /api/scandals/:id/choose]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/mod/scandal-templates ───────────────────────────────────────
app.get("/api/mod/scandal-templates", scandalReadLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rows } = await pool.query(
      `SELECT id, title, category, severity_base, time_window_months, stages, is_enabled
         FROM scandal_templates
        ORDER BY title`
    );
    res.json({ templates: rows });
  } catch (e) {
    console.error("[GET /api/mod/scandal-templates]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/mod/scandals/opted-in-characters ─────────────────────────────
app.get("/api/mod/scandals/opted-in-characters", scandalReadLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.party
         FROM scandal_opt_in soi
         JOIN characters c ON c.id = soi.character_id
        WHERE soi.opted_in = true
        ORDER BY c.name`
    );
    res.json({ characters: rows });
  } catch (e) {
    console.error("[GET /api/mod/scandals/opted-in-characters]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/mod/scandal-templates ──────────────────────────────────────
app.post("/api/mod/scandal-templates", scandalWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { id, title, category, severity_base, time_window_months, stages, is_enabled = true } = req.body || {};
    if (!id || !title || !category || !severity_base || !time_window_months || !stages) {
      return res.status(400).json({ error: "id, title, category, severity_base, time_window_months, stages are required" });
    }
    await pool.query(
      `INSERT INTO scandal_templates (id, title, category, severity_base, time_window_months, stages, is_enabled)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (id) DO UPDATE SET
         title              = EXCLUDED.title,
         category           = EXCLUDED.category,
         severity_base      = EXCLUDED.severity_base,
         time_window_months = EXCLUDED.time_window_months,
         stages             = EXCLUDED.stages,
         is_enabled         = EXCLUDED.is_enabled`,
      [id, title, category, Number(severity_base), Number(time_window_months), JSON.stringify(stages), is_enabled]
    );
    res.json({ ok: true, id });
  } catch (e) {
    console.error("[POST /api/mod/scandal-templates]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/mod/scandals/situations/create ──────────────────────────────
app.post("/api/mod/scandals/situations/create", scandalWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { character_id, template_id, title_override, expires_in_months } = req.body || {};
    if (!character_id || !template_id) {
      return res.status(400).json({ error: "character_id and template_id are required" });
    }

    // Enforce opt-in server-side
    const { rows: optRows } = await pool.query(
      `SELECT opted_in FROM scandal_opt_in WHERE character_id = $1`,
      [character_id]
    );
    if (!optRows.length || !optRows[0].opted_in) {
      return res.status(403).json({ error: "Character has not opted in to scandals" });
    }

    // Verify template exists
    const { rows: tplRows } = await pool.query(
      `SELECT id, time_window_months FROM scandal_templates WHERE id = $1 AND is_enabled = true`,
      [template_id]
    );
    if (!tplRows.length) return res.status(404).json({ error: "Template not found or disabled" });
    const tpl = tplRows[0];

    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const simMonth = clockRows[0]?.sim_current_month ?? 8;
    const simYear  = clockRows[0]?.sim_current_year  ?? 1997;

    const windowMonths = expires_in_months ? Number(expires_in_months) : tpl.time_window_months;
    const expires = addSimMonths(simYear, simMonth, windowMonths);

    const { rows: newRows } = await pool.query(
      `INSERT INTO scandal_situations
         (character_id, template_id, title_override, status,
          created_sim_year, created_sim_month, expires_sim_year, expires_sim_month,
          created_by_user_id)
       VALUES ($1,$2,$3,'open',$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        character_id, template_id, title_override || null,
        simYear, simMonth, expires.sim_year, expires.sim_month,
        req.session.userId,
      ]
    );

    await writeAuditLog(req.session.userId, "scandal.situation.create", "scandal_situations", newRows[0].id, null, {
      character_id, template_id, title_override,
    });

    res.json({ ok: true, id: newRows[0].id });
  } catch (e) {
    console.error("[POST /api/mod/scandals/situations/create]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/mod/scandals/open ────────────────────────────────────────────
app.get("/api/mod/scandals/open", scandalReadLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    const [scandalRows, choiceRows, decisionRows, situationRows] = await Promise.all([
      pool.query(
        `SELECT s.*, c.name AS character_name
           FROM scandals s
           JOIN characters c ON c.id = s.character_id
          WHERE s.status IN ('open','awaiting_mod')
          ORDER BY s.created_at DESC`
      ),
      pool.query(
        `SELECT spc.*
           FROM scandal_player_choices spc
           JOIN scandals s ON s.id = spc.scandal_id
          WHERE s.status IN ('open','awaiting_mod')
          ORDER BY spc.created_at ASC`
      ),
      pool.query(
        `SELECT smd.*
           FROM scandal_mod_decisions smd
           JOIN scandals s ON s.id = smd.scandal_id
          WHERE s.status IN ('open','awaiting_mod')
          ORDER BY smd.created_at ASC`
      ),
      pool.query(
        `SELECT ss.*, st.title, st.category, c.name AS character_name
           FROM scandal_situations ss
           JOIN scandal_templates st ON st.id = ss.template_id
           JOIN characters c ON c.id = ss.character_id
          WHERE ss.status = 'open'
          ORDER BY ss.created_at DESC`
      ),
    ]);

    res.json({
      scandals:   scandalRows.rows,
      player_choices: choiceRows.rows,
      mod_decisions:  decisionRows.rows,
      situations:     situationRows.rows,
    });
  } catch (e) {
    console.error("[GET /api/mod/scandals/open]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/mod/scandals/:id/decision ──────────────────────────────────
app.post("/api/mod/scandals/:id/decision", scandalWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    const { decision_type, severity_delta = 0, next_stage_key, public_statement, internal_notes = "" } = req.body || {};
    if (!decision_type) return res.status(400).json({ error: "decision_type is required" });

    // Load scandal
    const { rows: scandalRows } = await pool.query(
      `SELECT * FROM scandals WHERE id = $1`,
      [req.params.id]
    );
    if (!scandalRows.length) return res.status(404).json({ error: "Scandal not found" });
    const scandal = scandalRows[0];

    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const simMonth = clockRows[0]?.sim_current_month ?? 8;
    const simYear  = clockRows[0]?.sim_current_year  ?? 1997;

    // Append mod decision
    await pool.query(
      `INSERT INTO scandal_mod_decisions
         (scandal_id, decision_type, severity_delta, next_stage_key, public_statement,
          internal_notes, decided_by_user_id, created_sim_year, created_sim_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        scandal.id, decision_type, Number(severity_delta), next_stage_key || null,
        public_statement || null, internal_notes, req.session.userId,
        simYear, simMonth,
      ]
    );

    // Compute updated scandal fields
    const newSeverity = scandal.severity_current + Number(severity_delta);
    let newStageKey = next_stage_key || scandal.stage_key;
    let newStatus = "open";
    let closedAt = scandal.closed_at;

    if (decision_type === "close" || (!next_stage_key && decision_type !== "severity_update")) {
      newStatus = "closed";
      closedAt = new Date().toISOString();
    } else if (next_stage_key === "party_review") {
      newStatus = "awaiting_mod";
    }

    // Update public_notes if statement provided
    const publicNotes = Array.isArray(scandal.public_notes) ? scandal.public_notes : [];
    if (public_statement) {
      publicNotes.push({ statement: public_statement, at_sim_year: simYear, at_sim_month: simMonth });
    }

    const deadline = addSimMonths(simYear, simMonth, scandal.time_window_months);

    await pool.query(
      `UPDATE scandals SET
         severity_current        = $2,
         stage_key               = $3,
         status                  = $4,
         stage_started_sim_year  = $5,
         stage_started_sim_month = $6,
         stage_deadline_sim_year = $7,
         stage_deadline_sim_month= $8,
         public_notes            = $9::jsonb,
         closed_at               = $10
       WHERE id = $1`,
      [
        scandal.id, newSeverity, newStageKey, newStatus,
        simYear, simMonth, deadline.sim_year, deadline.sim_month,
        JSON.stringify(publicNotes), closedAt,
      ]
    );

    await writeAuditLog(req.session.userId, "scandal.mod.decision", "scandals", scandal.id, scandal, {
      decision_type, severity_delta, next_stage_key,
    });

    res.json({ ok: true, status: newStatus, stage_key: newStageKey });
  } catch (e) {
    console.error("[POST /api/mod/scandals/:id/decision]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/mod/scandals/:id/close ─────────────────────────────────────
app.post("/api/mod/scandals/:id/close", scandalWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;

    const { rows } = await pool.query(
      `UPDATE scandals SET status = 'closed', closed_at = now()
        WHERE id = $1 AND status != 'closed'
        RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Scandal not found or already closed" });

    await writeAuditLog(req.session.userId, "scandal.mod.close", "scandals", req.params.id, null, null);

    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/mod/scandals/:id/close]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ELECTIONS (DB-backed)
// GET  /api/elections                          — authenticated: list elections
// GET  /api/elections/current                  — authenticated: last GE + party summary
// GET  /api/elections/seat-totals              — authenticated: current seat totals from constituencies
// POST /api/elections                          — admin/mod: create election
// PUT  /api/elections/:id                      — admin/mod: update election metadata/changes
// POST /api/elections/:id/finalize             — admin/mod: apply flips + write events, set last GE
// GET  /api/elections/:id/changes              — authenticated: list constituency changes for election
// POST /api/admin/elections/seed-1997          — admin/mod: idempotent seed of 1997 GE
// GET  /api/elections/bodies/current           — authenticated: current result per body
// GET  /api/elections/bodies/archive           — authenticated: archived (replaced) results
// POST /api/elections/bodies                   — admin/mod: submit new result for a body
// GET  /api/parties/canonical                  — authenticated: list all canonical parties
// GET  /api/constituencies/:id/events          — authenticated: event log for a constituency
// ═══════════════════════════════════════════════════════════════════════════════

const electionReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const electionWriteLimit = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });

// GET /api/elections/seat-totals
app.get("/api/elections/seat-totals", electionReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query(
      `SELECT party, COUNT(*) AS seats FROM constituencies GROUP BY party ORDER BY seats DESC`
    );
    res.json({ totals: rows.map(r => ({ party: r.party, seats: Number(r.seats) })) });
  } catch (e) {
    console.error("[GET /api/elections/seat-totals]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/elections/current
app.get("/api/elections/current", electionReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows: stateRows } = await pool.query(
      `SELECT last_general_election_id FROM app_state_elections WHERE id = 'main'`
    );
    const lastGeId = stateRows[0]?.last_general_election_id || null;
    if (!lastGeId) return res.json({ election: null, partySummary: [] });

    const { rows: elRows } = await pool.query(
      `SELECT id, type, polling_day, label, status, finalized_at FROM elections WHERE id = $1`,
      [lastGeId]
    );
    if (!elRows.length) return res.json({ election: null, partySummary: [] });

    const { rows: summaryRows } = await pool.query(
      `SELECT party, seats, vote_share FROM election_party_summary WHERE election_id = $1 ORDER BY seats DESC`,
      [lastGeId]
    );
    res.json({
      election: elRows[0],
      partySummary: summaryRows.map(r => ({ party: r.party, seats: Number(r.seats), voteShare: Number(r.vote_share) })),
    });
  } catch (e) {
    console.error("[GET /api/elections/current]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/elections
app.get("/api/elections", electionReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query(
      `SELECT e.id, e.type, e.polling_day, e.label, e.status, e.finalized_at,
              u.username AS finalized_by_username
         FROM elections e
         LEFT JOIN users u ON u.id = e.finalized_by
        ORDER BY e.polling_day DESC`
    );
    res.json({ elections: rows });
  } catch (e) {
    console.error("[GET /api/elections]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/elections
app.post("/api/elections", electionWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { type = "general", polling_day, label = "" } = req.body || {};
    if (!polling_day) return res.status(400).json({ error: "polling_day is required" });
    const { rows } = await pool.query(
      `INSERT INTO elections (type, polling_day, label, status, created_by)
       VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
      [type, polling_day, label, req.session.userId]
    );
    await writeAuditLog(req.session.userId, "election.create", "elections", rows[0].id, null, req.body);
    res.status(201).json({ ok: true, election: rows[0] });
  } catch (e) {
    console.error("[POST /api/elections]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/elections/:id  — update label / polling_day
app.put("/api/elections/:id", electionWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { label, polling_day } = req.body || {};
    const { rows: before } = await pool.query("SELECT * FROM elections WHERE id = $1", [req.params.id]);
    if (!before.length) return res.status(404).json({ error: "Election not found" });
    if (before[0].status === "finalized") return res.status(400).json({ error: "Cannot edit a finalized election" });
    const { rows } = await pool.query(
      `UPDATE elections SET label = COALESCE($2, label), polling_day = COALESCE($3, polling_day), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id, label ?? null, polling_day ?? null]
    );
    await writeAuditLog(req.session.userId, "election.update", "elections", req.params.id, before[0], req.body);
    res.json({ ok: true, election: rows[0] });
  } catch (e) {
    console.error("[PUT /api/elections/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/elections/:id/changes
app.get("/api/elections/:id/changes", electionReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query(
      `SELECT ecc.id, ecc.constituency_id, c.name AS constituency_name,
              ecc.party_from, ecc.party_to, ecc.notes
         FROM election_constituency_changes ecc
         LEFT JOIN constituencies c ON c.id = ecc.constituency_id
        WHERE ecc.election_id = $1
        ORDER BY c.name`,
      [req.params.id]
    );
    res.json({ changes: rows });
  } catch (e) {
    console.error("[GET /api/elections/:id/changes]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/elections/:id/changes  — replace all flip entries for a pending election
app.put("/api/elections/:id/changes", electionWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { changes = [], partySummary = [] } = req.body || {};
    const { rows: before } = await pool.query("SELECT * FROM elections WHERE id = $1", [req.params.id]);
    if (!before.length) return res.status(404).json({ error: "Election not found" });
    if (before[0].status === "finalized") return res.status(400).json({ error: "Cannot edit a finalized election" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM election_constituency_changes WHERE election_id = $1", [req.params.id]);
      for (const ch of changes) {
        if (!ch.constituency_id || !ch.party_to) continue;
        await client.query(
          `INSERT INTO election_constituency_changes (election_id, constituency_id, party_from, party_to, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (election_id, constituency_id) DO UPDATE
             SET party_from = EXCLUDED.party_from, party_to = EXCLUDED.party_to, notes = EXCLUDED.notes`,
          [req.params.id, ch.constituency_id, ch.party_from || "", ch.party_to, ch.notes || ""]
        );
      }

      // Upsert party summary if provided.
      if (partySummary.length) {
        await client.query("DELETE FROM election_party_summary WHERE election_id = $1", [req.params.id]);
        for (const ps of partySummary) {
          if (!ps.party) continue;
          await client.query(
            `INSERT INTO election_party_summary (election_id, party, seats, vote_share)
             VALUES ($1, $2, $3, $4) ON CONFLICT (election_id, party) DO UPDATE
               SET seats = EXCLUDED.seats, vote_share = EXCLUDED.vote_share`,
            [req.params.id, ps.party, ps.seats || 0, ps.vote_share || 0]
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/elections/:id/changes]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/elections/:id/finalize
// Applies constituency flips, writes constituency_events, updates last_general_election_id.
app.post("/api/elections/:id/finalize", electionWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rows: elRows } = await pool.query("SELECT * FROM elections WHERE id = $1", [req.params.id]);
    if (!elRows.length) return res.status(404).json({ error: "Election not found" });
    const election = elRows[0];
    if (election.status === "finalized") return res.status(400).json({ error: "Already finalized" });

    const { rows: changes } = await pool.query(
      `SELECT * FROM election_constituency_changes WHERE election_id = $1`,
      [req.params.id]
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Apply each flip to constituencies and write constituency_events.
      let appliedCount = 0;
      for (const ch of changes) {
        // Resolve party_from if not stored.
        let partyFrom = ch.party_from || "";
        if (!partyFrom) {
          const { rows: cRows } = await client.query("SELECT party FROM constituencies WHERE id = $1", [ch.constituency_id]);
          partyFrom = cRows[0]?.party || "";
        }

        await client.query(
          `UPDATE constituencies SET party = $2, updated_at = NOW() WHERE id = $1`,
          [ch.constituency_id, ch.party_to]
        );

        await client.query(
          `INSERT INTO constituency_events
             (constituency_id, change_type, party_from, party_to, effective_date, notes, election_id, actor_id)
           VALUES ($1, 'general_election', $2, $3, $4, $5, $6, $7)`,
          [
            ch.constituency_id,
            partyFrom,
            ch.party_to,
            election.polling_day,
            ch.notes || "",
            req.params.id,
            req.session.userId,
          ]
        );
        appliedCount += 1;
      }

      // Mark election as finalized.
      await client.query(
        `UPDATE elections SET status = 'finalized', finalized_by = $2, finalized_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [req.params.id, req.session.userId]
      );

      // Update last_general_election_id if this is a general election.
      if (election.type === "general") {
        await client.query(
          `UPDATE app_state_elections SET last_general_election_id = $1, updated_at = NOW() WHERE id = 'main'`,
          [req.params.id]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await writeAuditLog(req.session.userId, "election.finalize", "elections", req.params.id, election, { appliedCount: changes.length });
    res.json({ ok: true, appliedCount: changes.length });
  } catch (e) {
    console.error("[POST /api/elections/:id/finalize]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/elections/seed-1997  — idempotent re-seed of 1997 baseline
app.post("/api/admin/elections/seed-1997", electionWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await seedElection1997();
    const { rows } = await pool.query(
      `SELECT e.id, e.type, e.polling_day, e.label, e.status
         FROM elections e
         JOIN app_state_elections s ON s.last_general_election_id = e.id
        WHERE s.id = 'main' LIMIT 1`
    );
    res.json({ ok: true, election: rows[0] || null });
  } catch (e) {
    console.error("[POST /api/admin/elections/seed-1997]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Election Bodies (results dashboard) ──────────────────────────────────────
// GET  /api/elections/bodies/current   — current result per body (public: read)
// GET  /api/elections/bodies/archive   — all replaced results (public: read)
// POST /api/elections/bodies           — admin/mod: submit new result for a body

const ELECTION_BODY_TYPES = [
  "general",
  "european_parliament",
  "scottish_parliament",
  "welsh_assembly",
  "northern_irish_assembly",
  "english_locals",
  "scottish_locals",
  "welsh_locals",
  "northern_irish_locals",
];

// GET /api/elections/bodies/current
app.get("/api/elections/bodies/current", electionReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows: elRows } = await pool.query(
      `SELECT id, type, polling_day, label, status, turnout_total, turnout_pct, finalized_at
         FROM elections
        WHERE is_current = true
        ORDER BY polling_day DESC`
    );
    const results = [];
    for (const el of elRows) {
      const { rows: ps } = await pool.query(
        `SELECT party, seats, votes, vote_share
           FROM election_party_summary
          WHERE election_id = $1
          ORDER BY seats DESC`,
        [el.id]
      );
      results.push({
        ...el,
        turnout_total: Number(el.turnout_total),
        turnout_pct: Number(el.turnout_pct),
        party_summary: ps.map(r => ({
          party: r.party,
          seats: Number(r.seats),
          votes: Number(r.votes),
          vote_share: Number(r.vote_share),
        })),
      });
    }
    res.json({ results });
  } catch (e) {
    console.error("[GET /api/elections/bodies/current]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/elections/bodies/archive
app.get("/api/elections/bodies/archive", electionReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows: elRows } = await pool.query(
      `SELECT id, type, polling_day, label, status, turnout_total, turnout_pct, finalized_at
         FROM elections
        WHERE is_current = false AND status = 'finalized'
        ORDER BY polling_day DESC`
    );
    const results = [];
    for (const el of elRows) {
      const { rows: ps } = await pool.query(
        `SELECT party, seats, votes, vote_share
           FROM election_party_summary
          WHERE election_id = $1
          ORDER BY seats DESC`,
        [el.id]
      );
      results.push({
        ...el,
        turnout_total: Number(el.turnout_total),
        turnout_pct: Number(el.turnout_pct),
        party_summary: ps.map(r => ({
          party: r.party,
          seats: Number(r.seats),
          votes: Number(r.votes),
          vote_share: Number(r.vote_share),
        })),
      });
    }
    res.json({ results });
  } catch (e) {
    console.error("[GET /api/elections/bodies/archive]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/elections/bodies  — submit new result for a body (replaces current, archives previous)
app.post("/api/elections/bodies", electionWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { body_type, polling_day, label = "", turnout_total = 0, turnout_pct = 0, party_summary = [] } = req.body || {};
    if (!body_type || !ELECTION_BODY_TYPES.includes(body_type)) {
      return res.status(400).json({ error: `body_type must be one of: ${ELECTION_BODY_TYPES.join(", ")}` });
    }
    if (!polling_day) return res.status(400).json({ error: "polling_day is required" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Archive previous current result for this body type.
      await client.query(
        `UPDATE elections SET is_current = false, updated_at = NOW()
          WHERE type = $1 AND is_current = true`,
        [body_type]
      );

      // Create the new election record as current.
      // $2 = polling_day (DATE), $7 = finalized_at (TIMESTAMPTZ) — same value but separate
      // parameters to avoid 42P08 "inconsistent types deduced for parameter" error.
      const { rows: elRows } = await client.query(
        `INSERT INTO elections (type, polling_day, label, status, finalized_at, turnout_total, turnout_pct, is_current, created_by)
         VALUES ($1, $2, $3, 'finalized', $7, $4, $5, true, $6)
         RETURNING id`,
        [body_type, polling_day, label, Number(turnout_total), Number(turnout_pct), req.session.userId, polling_day]
      );
      const elId = elRows[0].id;

      // Insert party summary.
      for (const ps of party_summary) {
        if (!ps.party) continue;
        await client.query(
          `INSERT INTO election_party_summary (election_id, party, seats, votes, vote_share)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (election_id, party) DO UPDATE
             SET seats = EXCLUDED.seats, votes = EXCLUDED.votes, vote_share = EXCLUDED.vote_share`,
          [elId, ps.party, Number(ps.seats) || 0, Number(ps.votes) || 0, Number(ps.vote_share) || 0]
        );
      }

      // For general elections, update the last_general_election_id.
      if (body_type === "general") {
        await client.query(
          `UPDATE app_state_elections SET last_general_election_id = $1, updated_at = NOW() WHERE id = 'main'`,
          [elId]
        );
      }

      await client.query("COMMIT");
      await writeAuditLog(req.session.userId, "election.body.submit", "elections", elId, null, { body_type, polling_day, label });
      res.status(201).json({ ok: true, id: elId });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[POST /api/elections/bodies]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/elections/bodies/:id", electionWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM elections WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Election result not found" });
    await writeAuditLog(req.session.userId, "election.body.delete", "elections", req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/elections/bodies/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});


app.get("/api/constituencies/:id/events", electionReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query(
      `SELECT ce.id, ce.change_type, ce.party_from, ce.party_to,
              ce.effective_date, ce.notes, ce.created_at,
              e.label AS election_label, e.polling_day,
              u.username AS actor_username
         FROM constituency_events ce
         LEFT JOIN elections e ON e.id = ce.election_id
         LEFT JOIN users u ON u.id = ce.actor_id
        WHERE ce.constituency_id = $1
        ORDER BY ce.created_at DESC`,
      [req.params.id]
    );
    res.json({ events: rows });
  } catch (e) {
    console.error("[GET /api/constituencies/:id/events]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTITUENCIES (DB-backed)
// GET    /api/constituencies                        — authenticated: list all
// POST   /api/constituencies                        — admin/mod/speaker: upsert one
// PUT    /api/constituencies/:id                    — admin/mod/speaker: update one
// DELETE /api/constituencies/:id                    — admin/mod/speaker: delete one
// POST   /api/admin/constituencies/initialize-1997  — bulk-seed from JSON; requires confirm=true
// DELETE /api/admin/constituencies/clear            — admin only: wipe all
// ═══════════════════════════════════════════════════════════════════════════════

const constReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const constWriteLimit = rateLimit({ windowMs: 60_000, max: 60,  standardHeaders: true, legacyHeaders: false });

// Helper: load the committed 1997 JSON (lazy, cached after first load)
let _constituencies1997 = null;
function load1997Json() {
  if (!_constituencies1997) {
    const p = resolve(__serverDir, "..", "data", "constituencies_1997.json");
    _constituencies1997 = JSON.parse(readFileSync(p, "utf8"));
  }
  return _constituencies1997;
}

app.get("/api/constituencies", constReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query(
      `SELECT id, name, nation, region, party, mp_type, mp_name, updated_at
         FROM constituencies ORDER BY nation, region, name`
    );
    res.json({
      constituencies: rows.map(r => ({
        id: r.id, name: r.name, nation: r.nation, region: r.region,
        party: r.party, mpType: r.mp_type, mpName: r.mp_name,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) {
    console.error("[GET /api/constituencies]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/constituencies", constWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { id, name, nation, region, party, mpType = "", mpName = "" } = req.body || {};
    if (!id || !name || !nation || !region || !party) {
      return res.status(400).json({ error: "id, name, nation, region, party are required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO constituencies (id, name, nation, region, party, mp_type, mp_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, nation = EXCLUDED.nation, region = EXCLUDED.region,
             party = EXCLUDED.party, mp_type = EXCLUDED.mp_type, mp_name = EXCLUDED.mp_name,
             updated_at = NOW()
       RETURNING id, updated_at`,
      [id, name, nation, region, party, mpType, mpName]
    );
    await writeAuditLog(req.session.userId, "constituency.upsert", "constituencies", id, null, req.body);
    res.status(201).json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error("[POST /api/constituencies]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/constituencies/:id", constWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { name, nation, region, party, mpType, mpName } = req.body || {};
    const { rows: before } = await pool.query(
      "SELECT * FROM constituencies WHERE id = $1", [req.params.id]
    );
    if (!before.length) return res.status(404).json({ error: "Constituency not found" });
    const b = before[0];
    const { rows } = await pool.query(
      `UPDATE constituencies
         SET name = $2, nation = $3, region = $4, party = $5,
             mp_type = $6, mp_name = $7, updated_at = NOW()
       WHERE id = $1
       RETURNING id, updated_at`,
      [
        req.params.id,
        name    ?? b.name,
        nation  ?? b.nation,
        region  ?? b.region,
        party   ?? b.party,
        mpType  !== undefined ? mpType  : b.mp_type,
        mpName  !== undefined ? mpName  : b.mp_name,
      ]
    );
    await writeAuditLog(req.session.userId, "constituency.update", "constituencies", req.params.id, b, req.body);

    // Write constituency_events entry if the party changed or change_type provided.
    const { changeType, effectiveDate, notes: evNotes } = req.body || {};
    const partyChanged = party && party !== b.party;
    if (partyChanged || changeType) {
      await pool.query(
        `INSERT INTO constituency_events
           (constituency_id, change_type, party_from, party_to, effective_date, notes, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.params.id,
          changeType || (partyChanged ? "correction" : "admin_override"),
          b.party,
          party ?? b.party,
          effectiveDate || null,
          evNotes || "",
          req.session.userId,
        ]
      );
    }

    // If party changed and mp_type is character, also update the character's party in DB.
    const resolvedMpType = mpType !== undefined ? mpType : b.mp_type;
    const constName = name ?? b.name;
    if (partyChanged && resolvedMpType === "character") {
      await pool.query(
        `UPDATE characters SET party = $1 WHERE LOWER(constituency) = LOWER($2) AND is_active = TRUE`,
        [party, constName]
      );
    }

    res.json({ ok: true, id: rows[0].id, updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error("[PUT /api/constituencies/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/constituencies/:id", constWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rowCount } = await pool.query(
      "DELETE FROM constituencies WHERE id = $1", [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Constituency not found" });
    await writeAuditLog(req.session.userId, "constituency.delete", "constituencies", req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/constituencies/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/constituencies/initialize-1997", constWriteLimit, async (req, res) => {
  try {
    if (!isDevSeedAllowed()) return res.status(404).json({ error: "Not found" });
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { confirm } = req.body || {};
    if (!confirm) {
      return res.status(400).json({ error: "Send confirm: true to confirm overwriting all constituencies" });
    }

    const json = load1997Json();
    const incoming = json.constituencies;
    // The 1997 UK general election used 659 constituencies.
    if (!Array.isArray(incoming) || incoming.length !== 659) {
      return res.status(500).json({
        error: `constituencies_1997.json must contain exactly 659 entries (found ${incoming?.length ?? 0}). ` +
               "Re-run scripts/convert-1997-csv.js to regenerate."
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM constituencies");
      for (const c of incoming) {
        await client.query(
          `INSERT INTO constituencies (id, name, nation, region, party, mp_type, mp_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [c.id, c.name, c.nation, c.region, c.party, c.mpType || "", c.mpName || ""]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await writeAuditLog(
      req.session.userId, "constituencies.initialize_1997", "constituencies",
      "bulk", null, { count: incoming.length }
    );
    res.json({ ok: true, count: incoming.length });
  } catch (e) {
    console.error("[POST /api/admin/constituencies/initialize-1997]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/admin/constituencies/clear", constWriteLimit, async (req, res) => {
  try {
    if (!isDevSeedAllowed()) return res.status(404).json({ error: "Not found" });
    if (!requireAdmin(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM constituencies");
    await writeAuditLog(req.session.userId, "constituencies.clear", "constituencies", "all", null, { deleted: rowCount });
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    console.error("[DELETE /api/admin/constituencies/clear]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARLIAMENT STATUS (DB-backed government formation metadata)
// GET  /api/parliament/status  — authenticated: read current government metadata
// PUT  /api/parliament/status  — admin/mod/speaker: update government metadata
// ═══════════════════════════════════════════════════════════════════════════════

const parlStatusReadLimit  = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const parlStatusWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

const VALID_GOV_TYPES = ["Majority", "Minority", "Coalition", "Confidence and Supply"];

app.get("/api/parliament/status", parlStatusReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const { rows } = await pool.query("SELECT * FROM parliament_status WHERE id = 'main'");
    if (!rows.length) return res.json({ governmentType: "Majority", governingParties: [], confidenceSupplyParties: [] });
    const r = rows[0];
    res.json({
      governmentType: r.government_type,
      governingParties: Array.isArray(r.governing_parties) ? r.governing_parties : [],
      confidenceSupplyParties: Array.isArray(r.confidence_supply_parties) ? r.confidence_supply_parties : [],
      updatedAt: r.updated_at,
    });
  } catch (e) {
    console.error("[GET /api/parliament/status]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/parliament/status", parlStatusWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { governmentType, governingParties = [], confidenceSupplyParties = [] } = req.body || {};
    if (!VALID_GOV_TYPES.includes(governmentType)) {
      return res.status(400).json({ error: `governmentType must be one of: ${VALID_GOV_TYPES.join(", ")}` });
    }
    if (!Array.isArray(governingParties) || !Array.isArray(confidenceSupplyParties)) {
      return res.status(400).json({ error: "governingParties and confidenceSupplyParties must be arrays" });
    }
    await pool.query(
      `INSERT INTO parliament_status (id, government_type, governing_parties, confidence_supply_parties, updated_at)
       VALUES ('main', $1, $2::jsonb, $3::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
         SET government_type           = EXCLUDED.government_type,
             governing_parties         = EXCLUDED.governing_parties,
             confidence_supply_parties = EXCLUDED.confidence_supply_parties,
             updated_at                = NOW()`,
      [governmentType, JSON.stringify(governingParties), JSON.stringify(confidenceSupplyParties)]
    );
    await writeAuditLog(req.session.userId, "parliament_status.update", "parliament_status", "main", null, req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/parliament/status]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET API
// GET  /api/budget                  — authenticated: fetch current budget from DB
// POST /api/admin/budget/seed       — admin-only: seed 1996–97 baseline (idempotent)
// PUT  /api/admin/budget/controls   — admin-only: update static admin controls
// POST /api/budget/draft            — admin/mod: submit a new budget draft
// POST /api/admin/budget/approve    — admin-only: approve pending draft
// POST /api/admin/budget/reject     — admin-only: reject pending draft
// ═══════════════════════════════════════════════════════════════════════════

const budgetReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const budgetWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

app.get("/api/budget", budgetReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(`SELECT last_year, current_year, admin_controls, archive, pending FROM budget_data WHERE id = 'main'`);
    if (!rows.length) return res.json({ lastYear: null, currentYear: null, adminControls: {}, archive: [], pending: null });
    const r = rows[0];
    res.json({
      lastYear:      r.last_year,
      currentYear:   r.current_year,
      adminControls: r.admin_controls || {},
      archive:       r.archive || [],
      pending:       r.pending || null,
    });
  } catch (e) {
    console.error("[GET /api/budget]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/budget/seed", budgetWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { force = false } = req.body || {};
    if (!force) {
      const { rows } = await pool.query(`SELECT last_year FROM budget_data WHERE id = 'main'`);
      if (rows.length && rows[0].last_year !== null) {
        return res.status(409).json({ error: "Budget already seeded. Send { force: true } to overwrite.", alreadySeeded: true });
      }
    }
    await seedBudgetBaseline(true);
    await writeAuditLog(req.session.userId, "admin.budget.seed", "budget_data", "main", null, { force });
    res.json({ ok: true, message: "Budget baseline seeded successfully." });
  } catch (e) {
    console.error("[POST /api/admin/budget/seed]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/admin/budget/controls", budgetWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { debtInterestPercent, debtInterestExpenditure, charityReliefExpenditure, otherExpensesExpenditure } = req.body || {};
    const controls = {
      debtInterestPercent:       Number(debtInterestPercent       ?? 7.2),
      debtInterestExpenditure:   Number(debtInterestExpenditure   ?? 31.11),
      charityReliefExpenditure:  Number(charityReliefExpenditure  ?? 0.41),
      otherExpensesExpenditure:  Number(otherExpensesExpenditure  ?? -0.66),
    };
    await pool.query(
      `UPDATE budget_data SET admin_controls = $1::jsonb, updated_at = NOW() WHERE id = 'main'`,
      [JSON.stringify(controls)]
    );
    res.json({ ok: true, adminControls: controls });
  } catch (e) {
    console.error("[PUT /api/admin/budget/controls]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/budget/draft", budgetWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { budget, submittedBy } = req.body || {};
    if (!budget || typeof budget !== "object") return res.status(400).json({ error: "budget object required" });
    const pending = { budget, submittedBy: String(submittedBy || ""), submittedAt: new Date().toLocaleString("en-GB") };
    await pool.query(
      `UPDATE budget_data SET pending = $1::jsonb, updated_at = NOW() WHERE id = 'main'`,
      [JSON.stringify(pending)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/budget/draft]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/budget/approve", budgetWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(`SELECT last_year, current_year, archive, pending FROM budget_data WHERE id = 'main'`);
    if (!rows.length) return res.status(404).json({ error: "Budget data not found" });
    const { last_year, current_year, archive, pending } = rows[0];
    if (!pending) return res.status(400).json({ error: "No pending budget to approve" });
    const approved = { ...pending.budget, label: `Approved ${new Date().toLocaleDateString("en-GB")}`, approvedAt: new Date().toLocaleString("en-GB") };
    const newArchive = [...(archive || [])];
    if (last_year) newArchive.push(last_year);
    await pool.query(
      `UPDATE budget_data SET last_year = $1::jsonb, current_year = $2::jsonb, archive = $3::jsonb, pending = NULL, updated_at = NOW() WHERE id = 'main'`,
      [JSON.stringify(current_year), JSON.stringify(approved), JSON.stringify(newArchive)]
    );
    await writeAuditLog(req.session.userId, "admin.budget.approve", "budget_data", "main", null, {});
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/admin/budget/approve]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/admin/budget/reject", budgetWriteLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    await pool.query(`UPDATE budget_data SET pending = NULL, updated_at = NOW() WHERE id = 'main'`);
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/admin/budget/reject]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TEAM READ-ONLY
// GET /api/team — returns Admins/Mods/Speaker with only safe public fields.
// Available to any logged-in user (not just admins).
// ═══════════════════════════════════════════════════════════════════════════

const teamReadLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

app.get("/api/team", teamReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
    const { rows } = await pool.query(`
      SELECT u.username,
             COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles,
             (SELECT c.name FROM characters c WHERE c.id = u.active_character_id LIMIT 1) AS active_character
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role IN ('admin', 'mod', 'speaker')
       GROUP BY u.id, u.username, u.active_character_id
       ORDER BY u.username
    `);
    res.json({ users: rows.map((r) => ({ username: r.username, roles: r.roles || [], activeCharacter: r.active_character || "" })) });
  } catch (e) {
    console.error("[GET /api/team]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Public profile — read-only character summary for a user (logged-in required)
// GET /api/profile?user=<username>
// Returns safe public fields only.
// ═══════════════════════════════════════════════════════════════════════════

const profileReadLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

app.get("/api/profile", profileReadLimit, async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: "Login required" });
    const username = String(req.query.user || "").trim();
    if (!username) return res.status(400).json({ error: "Missing ?user= parameter" });

    const { rows } = await pool.query(
      `SELECT u.username,
              c.id          AS char_id,
              c.name        AS char_name,
              c.party,
              c.constituency,
              c.avatar,
              COALESCE(c.bio, c.personal_background, '') AS bio,
              c.financial_background_level,
              c.date_of_birth,
              c.education,
              c.career_background,
              c.family,
              c.year_first_elected
         FROM users u
         LEFT JOIN characters c ON c.id = u.active_character_id
        WHERE LOWER(u.username) = LOWER($1)
        LIMIT 1`,
      [username]
    );

    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const r = rows[0];

    // Fetch approved affiliations from relational table
    let approvedAffiliations = [];
    if (r.char_id) {
      const { rows: affRows } = await pool.query(
        `SELECT ac.id, ac.category, ac.name
           FROM character_affiliations ca
           JOIN affiliations_catalog ac ON ac.id = ca.affiliation_id
          WHERE ca.character_id = $1 AND ca.status = 'approved'
          ORDER BY ac.category, ac.name`,
        [r.char_id]
      );
      approvedAffiliations = affRows;
    }

    res.json({
      username:  r.username,
      character: r.char_name ? {
        name:                    r.char_name,
        party:                   r.party                || "",
        constituency:            r.constituency         || "",
        avatar:                  r.avatar               || "",
        bio:                     r.bio                  || "",
        financial_background_level: r.financial_background_level ?? null,
        approved_affiliations:   approvedAffiliations,
        date_of_birth:           r.date_of_birth        || "",
        education:               r.education            || "",
        career_background:       r.career_background    || "",
        family:                  r.family               || "",
        year_first_elected:      r.year_first_elected   || "",
      } : null,
    });
  } catch (e) {
    console.error("[GET /api/profile]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Affiliations workflow
// GET  /api/me/character/:id/affiliations           — owner: fetch own affiliations
// POST /api/me/character/:id/affiliations           — owner: submit tick list (diff)
// GET  /api/control-panel/affiliations/pending      — staff: list pending requests
// POST /api/control-panel/affiliations/:rid/decide  — staff: approve or reject
// ═══════════════════════════════════════════════════════════════════════════

const affiliationsReadLimit  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const affiliationsWriteLimit = rateLimit({ windowMs: 60_000, max: 30,  standardHeaders: true, legacyHeaders: false });

// GET /api/me/character/:id/affiliations — owner gets approved + all pending rows
app.get("/api/me/character/:id/affiliations", affiliationsReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const charId = req.params.id;
    // Verify ownership
    const { rows: own } = await pool.query(
      "SELECT id FROM characters WHERE id = $1 AND user_id = $2",
      [charId, req.session.userId]
    );
    if (!own.length) return res.status(403).json({ error: "Not your character" });

    const { rows } = await pool.query(
      `SELECT ca.id AS request_id, ca.affiliation_id, ca.status,
              ca.requested_at, ca.reviewed_at, ca.reviewed_by, ca.review_note,
              ac.category, ac.name
         FROM character_affiliations ca
         JOIN affiliations_catalog ac ON ac.id = ca.affiliation_id
        WHERE ca.character_id = $1
        ORDER BY ac.category, ac.name`,
      [charId]
    );
    res.json({ affiliations: rows });
  } catch (e) {
    console.error("[GET /api/me/character/:id/affiliations]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/me/character/:id/affiliations — diff-based submission
// Body: { requestedAffiliationIds: string[] }
app.post("/api/me/character/:id/affiliations", affiliationsWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const charId = req.params.id;
    // Verify ownership
    const { rows: own } = await pool.query(
      "SELECT id FROM characters WHERE id = $1 AND user_id = $2",
      [charId, req.session.userId]
    );
    if (!own.length) return res.status(403).json({ error: "Not your character" });

    const requested = req.body?.requestedAffiliationIds;
    if (!Array.isArray(requested)) return res.status(400).json({ error: "requestedAffiliationIds must be an array" });

    // Validate all requested IDs exist in catalog
    const cleanRequested = [...new Set(requested.map((s) => String(s).trim()).filter(Boolean))];
    if (cleanRequested.length > 0) {
      const { rows: valid } = await pool.query(
        "SELECT id FROM affiliations_catalog WHERE id = ANY($1::text[]) AND active = TRUE",
        [cleanRequested]
      );
      const validIds = new Set(valid.map((r) => r.id));
      const invalid = cleanRequested.filter((id) => !validIds.has(id));
      if (invalid.length) return res.status(400).json({ error: `Unknown affiliation IDs: ${invalid.join(", ")}` });
    }

    // Fetch current rows for this character
    const { rows: current } = await pool.query(
      "SELECT affiliation_id, status FROM character_affiliations WHERE character_id = $1",
      [charId]
    );
    const currentMap = new Map(current.map((r) => [r.affiliation_id, r.status]));
    const requestedSet = new Set(cleanRequested);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const [affId, status] of currentMap) {
        if (status === "pending_add" && !requestedSet.has(affId)) {
          // User unchecked something they'd previously requested — cancel the pending add
          await client.query(
            "DELETE FROM character_affiliations WHERE character_id = $1 AND affiliation_id = $2",
            [charId, affId]
          );
        } else if (status === "approved" && !requestedSet.has(affId)) {
          // User unchecked an approved affiliation → create pending_remove
          await client.query(
            `UPDATE character_affiliations
                SET status = 'pending_remove', requested_at = NOW(), requested_by = $3,
                    reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
              WHERE character_id = $1 AND affiliation_id = $2`,
            [charId, affId, req.session.userId]
          );
        } else if (status === "pending_remove" && requestedSet.has(affId)) {
          // User re-checked something pending removal → cancel: revert to approved
          await client.query(
            `UPDATE character_affiliations
                SET status = 'approved', reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
              WHERE character_id = $1 AND affiliation_id = $2`,
            [charId, affId]
          );
        } else if ((status === "rejected_add" || status === "rejected_remove") && requestedSet.has(affId)) {
          // Re-request a previously rejected item → new pending_add
          await client.query(
            `UPDATE character_affiliations
                SET status = 'pending_add', requested_at = NOW(), requested_by = $3,
                    reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
              WHERE character_id = $1 AND affiliation_id = $2`,
            [charId, affId, req.session.userId]
          );
        }
      }

      for (const affId of requestedSet) {
        if (!currentMap.has(affId)) {
          // Brand new tick → pending_add
          await client.query(
            `INSERT INTO character_affiliations (character_id, affiliation_id, status, requested_by)
             VALUES ($1, $2, 'pending_add', $3)`,
            [charId, affId, req.session.userId]
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await writeAuditLog(req.session.userId, "affiliations.submit", "character", charId, null, { requested: cleanRequested.length });

    // Return updated state
    const { rows: updated } = await pool.query(
      `SELECT ca.id AS request_id, ca.affiliation_id, ca.status,
              ca.requested_at, ca.reviewed_at, ca.reviewed_by, ca.review_note,
              ac.category, ac.name
         FROM character_affiliations ca
         JOIN affiliations_catalog ac ON ac.id = ca.affiliation_id
        WHERE ca.character_id = $1
        ORDER BY ac.category, ac.name`,
      [charId]
    );
    res.json({ ok: true, affiliations: updated });
  } catch (e) {
    console.error("[POST /api/me/character/:id/affiliations]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/control-panel/affiliations/pending — staff: all pending_add/pending_remove rows
app.get("/api/control-panel/affiliations/pending", affiliationsReadLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows } = await pool.query(
      `SELECT ca.id AS request_id, ca.character_id, ca.affiliation_id, ca.status,
              ca.requested_at, ca.review_note,
              ac.category, ac.name AS affiliation_name,
              c.name  AS character_name, c.party, c.constituency,
              u.username
         FROM character_affiliations ca
         JOIN affiliations_catalog ac ON ac.id = ca.affiliation_id
         JOIN characters c ON c.id = ca.character_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE ca.status IN ('pending_add','pending_remove')
        ORDER BY ca.requested_at`,
    );
    res.json({ requests: rows });
  } catch (e) {
    console.error("[GET /api/control-panel/affiliations/pending]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/control-panel/affiliations/:rid/decide — staff: approve or reject
// Body: { decision: "approve"|"reject", note?: string }
app.post("/api/control-panel/affiliations/:rid/decide", affiliationsWriteLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rid } = req.params;
    const decision = String(req.body?.decision || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 500);
    if (decision !== "approve" && decision !== "reject") {
      return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    }

    const { rows } = await pool.query(
      "SELECT id, character_id, affiliation_id, status FROM character_affiliations WHERE id = $1",
      [rid]
    );
    if (!rows.length) return res.status(404).json({ error: "Affiliation request not found" });
    const row = rows[0];

    if (row.status !== "pending_add" && row.status !== "pending_remove") {
      return res.status(409).json({ error: "Request is not in a pending state" });
    }

    const reviewer = req.session.userId;
    const reviewerName = req.session.username || String(reviewer);

    if (decision === "approve") {
      if (row.status === "pending_add") {
        await pool.query(
          `UPDATE character_affiliations
              SET status = 'approved', reviewed_at = NOW(), reviewed_by = $2, review_note = $3
            WHERE id = $1`,
          [rid, reviewerName, note || null]
        );
      } else {
        // pending_remove approved → delete the row entirely
        await pool.query("DELETE FROM character_affiliations WHERE id = $1", [rid]);
      }
    } else {
      // reject
      if (row.status === "pending_add") {
        // Delete the row — allows re-request later
        await pool.query("DELETE FROM character_affiliations WHERE id = $1", [rid]);
      } else {
        // pending_remove rejected → keep the affiliation approved
        await pool.query(
          `UPDATE character_affiliations
              SET status = 'approved', reviewed_at = NOW(), reviewed_by = $2, review_note = $3
            WHERE id = $1`,
          [rid, reviewerName, note || null]
        );
      }
    }

    await writeAuditLog(reviewer, `affiliations.${decision}`, "character_affiliation", rid, null,
      { affiliation_id: row.affiliation_id, character_id: row.character_id, original_status: row.status, note });
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/control-panel/affiliations/:rid/decide]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: users — list all DB users with their roles
// GET /api/admin/users
// ═══════════════════════════════════════════════════════════════════════════

const adminUsersLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

app.get("/api/admin/users", adminUsersLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.email,
             u.active_character_id,
             COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles,
             (SELECT c.name FROM characters c WHERE c.id = u.active_character_id LIMIT 1) AS active_character_name
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
       GROUP BY u.id, u.username, u.email, u.active_character_id
       ORDER BY u.username
    `);
    res.json({
      users: rows.map((r) => ({
        id:                  r.id,
        username:            r.username,
        email:               r.email,
        roles:               r.roles || [],
        activeCharacterId:   r.active_character_id || null,
        activeCharacter:     r.active_character_name || "",
      })),
    });
  } catch (e) {
    console.error("[GET /api/admin/users]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: User–Character Management endpoints ─────────────────────────────

const adminCharMgmtLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

// GET /api/admin/characters — list characters with optional filters
// Query params: owned=unowned|owned, active=true|false
app.get("/api/admin/characters", adminCharMgmtLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { owned, active } = req.query;
    const conditions = [];
    const params = [];
    if (owned === "unowned") {
      conditions.push("c.user_id IS NULL");
    } else if (owned === "owned") {
      conditions.push("c.user_id IS NOT NULL");
    }
    if (active === "true") {
      conditions.push("c.is_active = TRUE");
    } else if (active === "false") {
      conditions.push("c.is_active = FALSE");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.party, c.constituency, c.is_active, c.user_id, c.created_at,
             u.username AS owner_username
        FROM characters c
        LEFT JOIN users u ON u.id = c.user_id
      ${where}
       ORDER BY c.is_active DESC, c.name ASC
    `, params);
    res.json({ characters: rows });
  } catch (e) {
    console.error("[GET /api/admin/characters]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/characters/:id/assign-owner — assign a character to a user
app.post("/api/admin/characters/:id/assign-owner", adminCharMgmtLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAdmin(req, res)) return;
    const { user_id, set_active = false } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id is required" });

    const { rows: charRows } = await client.query(
      "SELECT id, name, user_id, is_active FROM characters WHERE id = $1",
      [req.params.id]
    );
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });
    const char = charRows[0];

    const { rows: userRows } = await client.query(
      "SELECT id, username FROM users WHERE id = $1",
      [user_id]
    );
    if (!userRows.length) return res.status(404).json({ error: "User not found" });

    await client.query("BEGIN");

    if (set_active) {
      // Deactivate any other active characters for this user
      await client.query(
        "UPDATE characters SET is_active = FALSE WHERE user_id = $1 AND is_active = TRUE AND id <> $2",
        [user_id, req.params.id]
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE characters SET user_id = $1, is_active = $2 WHERE id = $3
       RETURNING id, name, user_id, is_active`,
      [user_id, set_active ? true : char.is_active, req.params.id]
    );

    if (set_active) {
      await client.query(
        "UPDATE users SET active_character_id = $1 WHERE id = $2",
        [req.params.id, user_id]
      );
    } else if (char.user_id && char.user_id !== user_id) {
      // Character is being re-assigned away from previous owner — clear old owner's pointer if needed
      await client.query(
        "UPDATE users SET active_character_id = NULL WHERE id = $1 AND active_character_id = $2",
        [char.user_id, req.params.id]
      );
    }

    await client.query("COMMIT");

    await writeAuditLog(
      req.session.userId, "admin.character.assign-owner", "character", req.params.id,
      { user_id: char.user_id, is_active: char.is_active },
      { user_id, set_active }
    );
    res.json({ ok: true, character: updated[0] });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[POST /api/admin/characters/:id/assign-owner]", e);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// POST /api/admin/users/:id/active-character — set or clear a user's active character pointer
app.post("/api/admin/users/:id/active-character", adminCharMgmtLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { character_id } = req.body || {}; // null = clear pointer

    const { rows: userRows } = await pool.query("SELECT id FROM users WHERE id = $1", [req.params.id]);
    if (!userRows.length) return res.status(404).json({ error: "User not found" });

    if (character_id) {
      // Validate character is owned by this user and active
      const { rows: charRows } = await pool.query(
        "SELECT id FROM characters WHERE id = $1 AND user_id = $2 AND is_active = TRUE",
        [character_id, req.params.id]
      );
      if (!charRows.length) {
        return res.status(404).json({ error: "Character not found, not owned by user, or not active" });
      }
      await pool.query(
        "UPDATE users SET active_character_id = $1 WHERE id = $2",
        [character_id, req.params.id]
      );
    } else {
      await pool.query(
        "UPDATE users SET active_character_id = NULL WHERE id = $1",
        [req.params.id]
      );
    }

    await writeAuditLog(
      req.session.userId, "admin.user.set-active-character", "user", req.params.id,
      null, { character_id: character_id || null }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/admin/users/:id/active-character]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN: reset-baseline — full wipe of election/constituency data and re-seed
// POST /api/admin/reset-baseline
//
// Admin-only.  Clears: constituency_events, constituencies,
// election_constituency_changes, election_party_summary, elections, and
// resets app_state_elections pointers.  Then re-seeds canonical parties,
// the May 1997 baseline election, and all 659 baseline constituencies so
// the app returns to a consistent "new world" state.
//
// Requires body: { confirm: "RESET BASELINE" }
// ═══════════════════════════════════════════════════════════════════════════

const resetBaselineLimit = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

app.post("/api/admin/reset-baseline", resetBaselineLimit, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { confirm: confirmText } = req.body || {};
    if (confirmText !== "RESET BASELINE") {
      return res.status(400).json({
        ok: false,
        error: "Confirmation text mismatch. Send { confirm: \"RESET BASELINE\" } to proceed.",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Clear all election-related and constituency data in dependency order.
      await client.query("DELETE FROM constituency_events");
      await client.query("DELETE FROM constituencies");
      await client.query("DELETE FROM election_constituency_changes");
      await client.query("DELETE FROM election_party_summary");
      await client.query("DELETE FROM elections");
      await client.query(
        `UPDATE app_state_elections
            SET last_general_election_id = NULL, updated_at = NOW()
          WHERE id = 'main'`
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Re-seed canonical parties, 1997 election baseline, and 1997 constituencies.
    await seedPlayableParties();
    await seedElection1997();
    await seedConstituencies1997();

    await writeAuditLog(req.session.userId, "admin.reset-baseline", "all", "*", null, {
      cleared: ["constituency_events", "constituencies", "election_constituency_changes",
                "election_party_summary", "elections", "app_state_elections.pointers"],
      reseeded: ["parties", "elections (1997)", "constituencies (1997)"],
    });

    res.json({
      ok: true,
      message: "Baseline reset complete. May 1997 election and 659 constituencies re-seeded.",
    });
  } catch (e) {
    console.error("[POST /api/admin/reset-baseline]", e);
    res.status(500).json({ ok: false, error: "Server error during baseline reset" });
  }
});



// ═══════════════════════════════════════════════════════════════════════════
// PLAYERBASE — staff roster page + finance management APIs
// GET  /api/admin/playerbase
// POST /api/admin/finance/set-bank
// POST /api/admin/finance/set-positions
// POST /api/admin/finance/revenue            (create)
// PATCH /api/admin/finance/revenue/:id       (update)
// DELETE /api/admin/finance/revenue/:id      (delete)
// POST /api/admin/salary-scales/uprate
// ═══════════════════════════════════════════════════════════════════════════

const playerbaseLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
const financeLimit    = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

// GET /api/admin/playerbase — full roster with characters and finance context
app.get("/api/admin/playerbase", playerbaseLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;

    // All users with roles
    const { rows: users } = await pool.query(`
      SELECT u.id, u.username,
             COALESCE(array_agg(ur.role ORDER BY ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
       GROUP BY u.id, u.username
       ORDER BY u.username
    `);

    // All characters (owned by any user) with their finance + positions
    const { rows: chars } = await pool.query(`
      SELECT c.id, c.user_id, c.name, c.party, c.constituency, c.is_active,
             cf.bank_balance,
             cf.annual_salary_override,
             cf.last_paid_sim_index,
             COALESCE(
               (SELECT json_agg(cp.position_key ORDER BY cp.position_key)
                  FROM character_positions cp WHERE cp.character_id = c.id),
               '[]'::json
             ) AS positions,
             COALESCE(
               (SELECT json_agg(json_build_object('id', ar.id, 'label', ar.label, 'annual_amount', ar.annual_amount)
                                ORDER BY ar.created_at)
                  FROM character_additional_revenue ar WHERE ar.character_id = c.id),
               '[]'::json
             ) AS additional_revenue
        FROM characters c
        LEFT JOIN character_finance cf ON cf.character_id = c.id
       WHERE c.user_id IS NOT NULL
       ORDER BY c.name ASC
    `);

    // Get current sim index for salary computation
    const { rows: simRows } = await pool.query(
      "SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const simMonth = simRows[0]?.sim_current_month ?? 8;
    const simYear  = simRows[0]?.sim_current_year  ?? 1997;
    const simIndex = simYear * 12 + (simMonth - 1);

    // Resolve salary scale roles for quick client-side salary display
    const scale = await resolveActiveSalaryScale(simIndex);
    const scaleRoles = scale?.roles ?? {};

    // Group characters by user_id
    const charsByUser = {};
    for (const c of chars) {
      if (!charsByUser[c.user_id]) charsByUser[c.user_id] = [];
      charsByUser[c.user_id].push({
        id:                   c.id,
        name:                 c.name,
        party:                c.party,
        constituency:         c.constituency,
        is_active:            c.is_active,
        bankBalance:          Number(c.bank_balance ?? 0),
        annualSalaryOverride: c.annual_salary_override != null ? Number(c.annual_salary_override) : null,
        lastPaidSimIndex:     c.last_paid_sim_index ?? null,
        positions:            Array.isArray(c.positions) ? c.positions : [],
        additionalRevenue:    Array.isArray(c.additional_revenue) ? c.additional_revenue : [],
      });
    }

    // Build roster
    const roster = users.map((u) => ({
      id:         u.id,
      username:   u.username,
      roles:      u.roles || [],
      characters: (charsByUser[u.id] || []).map((ch) => {
        // Compute annual salary from positions (Rule 1: highest wins)
        let computedSalary = 0;
        for (const pos of ch.positions) {
          const s = Number(scaleRoles[pos] ?? 0);
          if (s > computedSalary) computedSalary = s;
        }
        const annualSalary = ch.annualSalaryOverride != null ? ch.annualSalaryOverride : computedSalary;
        return { ...ch, computedSalary, annualSalary };
      }),
    }));

    res.json({ roster, scaleRoles, simIndex });
  } catch (e) {
    console.error("[GET /api/admin/playerbase]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/finance/set-bank — set bank balance for a character
app.post("/api/admin/finance/set-bank", financeLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { character_id, bank_balance } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });
    const balance = parseFloat(bank_balance);
    if (!Number.isFinite(balance)) return res.status(400).json({ error: "bank_balance must be a number" });

    const { rows: charRows } = await pool.query("SELECT id FROM characters WHERE id = $1", [character_id]);
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });

    await pool.query(`
      INSERT INTO character_finance (character_id, bank_balance)
      VALUES ($1, $2)
      ON CONFLICT (character_id) DO UPDATE SET bank_balance = $2, updated_at = NOW()
    `, [character_id, balance]);

    await writeAuditLog(req.session.userId, "admin.finance.set-bank", "character", character_id, null, { bank_balance: balance });
    res.json({ ok: true, bank_balance: balance });
  } catch (e) {
    console.error("[POST /api/admin/finance/set-bank]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/finance/set-salary-override — set/clear salary override
app.post("/api/admin/finance/set-salary-override", financeLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { character_id, annual_salary_override } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });

    const override = annual_salary_override != null && annual_salary_override !== ""
      ? parseFloat(annual_salary_override)
      : null;
    if (override != null && !Number.isFinite(override)) {
      return res.status(400).json({ error: "annual_salary_override must be a number or null" });
    }

    await pool.query(`
      INSERT INTO character_finance (character_id, annual_salary_override)
      VALUES ($1, $2)
      ON CONFLICT (character_id) DO UPDATE SET annual_salary_override = $2, updated_at = NOW()
    `, [character_id, override]);

    await writeAuditLog(req.session.userId, "admin.finance.set-salary-override", "character", character_id, null, { annual_salary_override: override });
    res.json({ ok: true, annual_salary_override: override });
  } catch (e) {
    console.error("[POST /api/admin/finance/set-salary-override]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/finance/set-positions — set character positions (replaces all); marks positions_override
app.post("/api/admin/finance/set-positions", financeLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { character_id, positions } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });
    if (!Array.isArray(positions)) return res.status(400).json({ error: "positions must be an array" });

    const { rows: charRows } = await pool.query("SELECT id FROM characters WHERE id = $1", [character_id]);
    if (!charRows.length) return res.status(404).json({ error: "Character not found" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM character_positions WHERE character_id = $1", [character_id]);
      for (const pos of positions) {
        const key = String(pos || "").trim();
        if (key) {
          await client.query(
            "INSERT INTO character_positions (character_id, position_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [character_id, key]
          );
        }
      }
      // Mark as manual override so auto-recompute won't overwrite
      await client.query(
        `INSERT INTO character_finance (character_id, positions_override)
         VALUES ($1, true)
         ON CONFLICT (character_id) DO UPDATE SET positions_override = true, updated_at = NOW()`,
        [character_id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await writeAuditLog(req.session.userId, "admin.finance.set-positions", "character", character_id, null, { positions });
    res.json({ ok: true, positions });
  } catch (e) {
    console.error("[POST /api/admin/finance/set-positions]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/finance/revenue — create additional revenue entry
app.post("/api/admin/finance/revenue", financeLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { character_id, label, annual_amount } = req.body || {};
    if (!character_id) return res.status(400).json({ error: "character_id is required" });
    if (!label || !String(label).trim()) return res.status(400).json({ error: "label is required" });
    const amount = parseFloat(annual_amount);
    if (!Number.isFinite(amount)) return res.status(400).json({ error: "annual_amount must be a number" });

    const { rows } = await pool.query(
      "INSERT INTO character_additional_revenue (character_id, label, annual_amount) VALUES ($1, $2, $3) RETURNING id, label, annual_amount, created_at",
      [character_id, String(label).trim(), amount]
    );
    await writeAuditLog(req.session.userId, "admin.finance.revenue.create", "character", character_id, null, rows[0]);
    res.json({ ok: true, revenue: rows[0] });
  } catch (e) {
    console.error("[POST /api/admin/finance/revenue]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/admin/finance/revenue/:id — update additional revenue entry
app.patch("/api/admin/finance/revenue/:id", financeLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { label, annual_amount } = req.body || {};
    const updates = [];
    const params = [];
    if (label != null) { params.push(String(label).trim()); updates.push(`label = $${params.length}`); }
    if (annual_amount != null) {
      const amount = parseFloat(annual_amount);
      if (!Number.isFinite(amount)) return res.status(400).json({ error: "annual_amount must be a number" });
      params.push(amount); updates.push(`annual_amount = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: "Nothing to update" });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE character_additional_revenue SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING id, character_id, label, annual_amount`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: "Revenue entry not found" });
    await writeAuditLog(req.session.userId, "admin.finance.revenue.update", "revenue", req.params.id, null, rows[0]);
    res.json({ ok: true, revenue: rows[0] });
  } catch (e) {
    console.error("[PATCH /api/admin/finance/revenue/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/finance/revenue/:id — delete additional revenue entry
app.delete("/api/admin/finance/revenue/:id", financeLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { rows } = await pool.query(
      "DELETE FROM character_additional_revenue WHERE id = $1 RETURNING id, character_id",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Revenue entry not found" });
    await writeAuditLog(req.session.userId, "admin.finance.revenue.delete", "revenue", req.params.id, null, rows[0]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/admin/finance/revenue/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/salary-scales/uprate — create new scale with % uplift from current
app.post("/api/admin/salary-scales/uprate", financeLimit, async (req, res) => {
  try {
    if (!requireAdminModOrSpeaker(req, res)) return;
    const { name, effective_from_sim_index, pct_uplift } = req.body || {};
    const simIdx = parseInt(effective_from_sim_index, 10);
    if (!Number.isFinite(simIdx)) return res.status(400).json({ error: "effective_from_sim_index must be an integer" });
    const uplift = parseFloat(pct_uplift ?? 0);
    if (!Number.isFinite(uplift)) return res.status(400).json({ error: "pct_uplift must be a number" });
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name is required" });

    // Get current scale roles as basis
    const scale = await resolveActiveSalaryScale(simIdx);
    if (!scale) return res.status(404).json({ error: "No active salary scale found to base uplift on" });

    const factor = 1 + uplift / 100;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: newScale } = await client.query(
        "INSERT INTO salary_scales (name, effective_from_sim_index) VALUES ($1, $2) RETURNING id",
        [String(name).trim(), simIdx]
      );
      const newScaleId = newScale[0].id;
      const { rows: oldRoles } = await client.query(
        "SELECT role_key, annual_salary FROM salary_scale_roles WHERE scale_id = $1",
        [scale.id]
      );
      for (const r of oldRoles) {
        await client.query(
          "INSERT INTO salary_scale_roles (scale_id, role_key, annual_salary) VALUES ($1, $2, $3)",
          [newScaleId, r.role_key, Math.round(Number(r.annual_salary) * factor)]
        );
      }
      await client.query("COMMIT");
      await writeAuditLog(req.session.userId, "admin.salary-scales.uprate", "salary_scales", newScaleId, null,
        { basedOn: scale.id, pct_uplift: uplift, effective_from_sim_index: simIdx });
      res.json({ ok: true, scale_id: newScaleId, based_on: scale.id, pct_uplift: uplift });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("[POST /api/admin/salary-scales/uprate]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Finance Config Admin Endpoints ────────────────────────────────────────────
// GET  /api/admin/finance/config           — read current finance config
// PATCH /api/admin/finance/salary-bands    — update salary bands (once per sim year)
// PATCH /api/admin/finance/starting-balances — update starting balances (once per sim year)
// POST  /api/admin/finance/apply-inflation — apply inflation to finance cost index (once per sim year)

const adminFinanceLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

// GET /api/admin/finance/config
app.get("/api/admin/finance/config", adminFinanceLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const cfg = await getFinanceConfig();
    // Also return current sim year for UI display
    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const currentSimYear = clockRows[0]?.sim_current_year ?? null;
    res.json({ ...cfg, currentSimYear });
  } catch (e) {
    console.error("[GET /api/admin/finance/config]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/admin/finance/salary-bands
app.patch("/api/admin/finance/salary-bands", adminFinanceLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { salaryBands, adminOverride } = req.body || {};
    if (!salaryBands || typeof salaryBands !== "object" || Array.isArray(salaryBands)) {
      return res.status(400).json({ error: "salaryBands must be an object mapping position keys to annual salaries" });
    }
    // Validate: all values must be non-negative numbers
    for (const [k, v] of Object.entries(salaryBands)) {
      if (!Number.isFinite(Number(v)) || Number(v) < 0) {
        return res.status(400).json({ error: `Invalid salary for position '${k}': must be a non-negative number` });
      }
    }
    // Read current sim year
    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const currentSimYear = clockRows[0]?.sim_current_year ?? null;
    // Enforce once-per-sim-year (unless adminOverride)
    const cfg = await getFinanceConfig();
    if (!adminOverride && cfg.lastSalaryBandsSimYear != null && currentSimYear != null
        && cfg.lastSalaryBandsSimYear >= currentSimYear) {
      return res.status(429).json({
        error: `Salary bands have already been updated this sim year (${cfg.lastSalaryBandsSimYear}). Use adminOverride to force.`,
        lastUpdatedSimYear: cfg.lastSalaryBandsSimYear,
      });
    }
    // Normalise values to integers
    const normalised = Object.fromEntries(Object.entries(salaryBands).map(([k, v]) => [k, Math.round(Number(v))]));
    const before = cfg.salaryBands;
    await pool.query(
      `UPDATE finance_config
          SET salary_bands               = $1::jsonb,
              last_salary_bands_sim_year = $2,
              updated_at                 = NOW(),
              updated_by                 = $3
        WHERE id = 'main'`,
      [JSON.stringify(normalised), currentSimYear, req.session.userId]
    );
    await writeAuditLog(req.session.userId, "admin.finance.salary-bands.update", "finance_config", "main",
      { salaryBands: before }, { salaryBands: normalised, simYear: currentSimYear });
    res.json({ ok: true, salaryBands: normalised, simYear: currentSimYear });
    // Recompute salary positions for ALL active characters so their salaryAnnual reflects the new bands
    pool.query("SELECT id FROM characters WHERE status = 'active'")
      .then(({ rows }) => Promise.all(rows.map((r) => recomputeSalaryPositions(r.id))))
      .catch((e) => console.error("[salary-bands] recompute all failed:", e.message));
  } catch (e) {
    console.error("[PATCH /api/admin/finance/salary-bands]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/admin/finance/starting-balances
app.patch("/api/admin/finance/starting-balances", adminFinanceLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { startingBalances, adminOverride } = req.body || {};
    if (!startingBalances || typeof startingBalances !== "object" || Array.isArray(startingBalances)) {
      return res.status(400).json({ error: "startingBalances must be an object mapping levels (1-10) to starting amounts" });
    }
    // Validate: keys 1-10, values non-negative numbers
    for (const [k, v] of Object.entries(startingBalances)) {
      const level = Number(k);
      if (!Number.isInteger(level) || level < 1 || level > 10) {
        return res.status(400).json({ error: `Invalid level key '${k}': must be an integer 1–10` });
      }
      if (!Number.isFinite(Number(v)) || Number(v) < 0) {
        return res.status(400).json({ error: `Invalid starting balance for level '${k}': must be a non-negative number` });
      }
    }
    // Read current sim year
    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const currentSimYear = clockRows[0]?.sim_current_year ?? null;
    // Enforce once-per-sim-year (unless adminOverride)
    const cfg = await getFinanceConfig();
    if (!adminOverride && cfg.lastStartingBalancesSimYear != null && currentSimYear != null
        && cfg.lastStartingBalancesSimYear >= currentSimYear) {
      return res.status(429).json({
        error: `Starting balances have already been updated this sim year (${cfg.lastStartingBalancesSimYear}). Use adminOverride to force.`,
        lastUpdatedSimYear: cfg.lastStartingBalancesSimYear,
      });
    }
    const normalised = Object.fromEntries(Object.entries(startingBalances).map(([k, v]) => [String(k), Math.round(Number(v))]));
    const before = cfg.startingBalances;
    await pool.query(
      `UPDATE finance_config
          SET starting_balances               = $1::jsonb,
              last_starting_balances_sim_year = $2,
              updated_at                      = NOW(),
              updated_by                      = $3
        WHERE id = 'main'`,
      [JSON.stringify(normalised), currentSimYear, req.session.userId]
    );
    await writeAuditLog(req.session.userId, "admin.finance.starting-balances.update", "finance_config", "main",
      { startingBalances: before }, { startingBalances: normalised, simYear: currentSimYear });
    res.json({ ok: true, startingBalances: normalised, simYear: currentSimYear });
  } catch (e) {
    console.error("[PATCH /api/admin/finance/starting-balances]", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/finance/apply-inflation
app.post("/api/admin/finance/apply-inflation", adminFinanceLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { adminOverride, dryRun } = req.body || {};

    // Read current sim year
    const { rows: clockRows } = await pool.query(
      "SELECT sim_current_year FROM sim_clock WHERE id = 'main'"
    );
    const currentSimYear = clockRows[0]?.sim_current_year ?? null;

    // Enforce once-per-sim-year (unless adminOverride)
    const cfg = await getFinanceConfig();
    if (!adminOverride && cfg.lastInflationSimYear != null && currentSimYear != null
        && cfg.lastInflationSimYear >= currentSimYear) {
      return res.status(429).json({
        error: `Finance cost inflation has already been applied this sim year (${cfg.lastInflationSimYear}). Use adminOverride to force.`,
        lastAppliedSimYear: cfg.lastInflationSimYear,
      });
    }

    // Read inflation rate from client body, or fall back to economy page topline
    const clientInflationPct = Number(req.body?.inflationPct);
    let inflationPct = Number.isFinite(clientInflationPct) && clientInflationPct > 0
      ? clientInflationPct
      : null;
    if (inflationPct === null) {
      const { rows: stateRows } = await pool.query(
        `SELECT s.data FROM app_state_current c
           JOIN state_snapshots s ON s.id = c.snapshot_id
          WHERE c.id = 'main'`
      );
      const stateData = stateRows[0]?.data || {};
      inflationPct = Number(stateData?.economyPage?.topline?.inflation ?? 0);
    }
    if (!Number.isFinite(inflationPct) || inflationPct <= 0) {
      return res.status(400).json({
        error: "No inflation rate configured. Please set an inflation value on the Economy page first.",
      });
    }

    const oldIndex = cfg.financeCostIndex;
    const newIndex = Math.round(oldIndex * (1 + inflationPct / 100) * 10000) / 10000;

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, oldIndex, newIndex, inflationPct, simYear: currentSimYear });
    }

    await pool.query(
      `UPDATE finance_config
          SET finance_cost_index    = $1,
              last_inflation_sim_year = $2,
              updated_at            = NOW(),
              updated_by            = $3
        WHERE id = 'main'`,
      [newIndex, currentSimYear, req.session.userId]
    );
    await writeAuditLog(req.session.userId, "admin.finance.apply-inflation", "finance_config", "main",
      { financeCostIndex: oldIndex }, { financeCostIndex: newIndex, inflationPct, simYear: currentSimYear });
    res.json({ ok: true, oldIndex, newIndex, inflationPct, simYear: currentSimYear });
  } catch (e) {
    console.error("[POST /api/admin/finance/apply-inflation]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/redlion", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, created_at FROM red_lion_posts ORDER BY created_at ASC");
    res.json({ posts: rows.map((r) => ({ ...r.data, _createdAt: r.created_at })) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/redlion", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const post = req.body;
    if (!post?.id) return res.status(400).json({ error: "id required" });
    await pool.query(
      `INSERT INTO red_lion_posts (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
      [post.id, JSON.stringify(post)]
    );
    res.status(201).json({ ok: true, id: post.id });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/redlion/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await pool.query("DELETE FROM red_lion_posts WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

// ── EVENTS ────────────────────────────────────────────────────────────────────
app.get("/api/events", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, created_at FROM game_events ORDER BY created_at ASC");
    res.json({ events: rows.map((r) => ({ ...r.data, _createdAt: r.created_at })) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/events", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const event = req.body;
    if (!event?.id) return res.status(400).json({ error: "id required" });
    await pool.query(
      `INSERT INTO game_events (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
      [event.id, JSON.stringify(event)]
    );
    res.status(201).json({ ok: true, id: event.id });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.put("/api/events/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const sessionRoles = Array.isArray(req.session.roles) ? req.session.roles : [];
    const isStaff = sessionRoles.includes("admin") || sessionRoles.includes("mod") || sessionRoles.includes("speaker");

    // Non-staff may only update their own event (verified by character name on the stored record)
    if (!isStaff) {
      const { rows: existing } = await pool.query(
        "SELECT data FROM game_events WHERE id = $1", [req.params.id]
      );
      if (!existing.length) return res.status(404).json({ error: "Event not found" });

      if (!req.session.characterId) return res.status(403).json({ error: "Forbidden: no active character" });
      const { rows: charRows } = await pool.query(
        "SELECT name FROM characters WHERE id = $1 AND user_id = $2 AND is_active = TRUE",
        [req.session.characterId, req.session.userId]
      );
      if (!charRows.length) return res.status(403).json({ error: "Forbidden" });
      const storedAuthor = existing[0].data?.submittedBy || existing[0].data?.author || "";
      if (storedAuthor !== charRows[0].name) {
        return res.status(403).json({ error: "Only the event author or staff may update this event" });
      }
    }

    const event = req.body;
    await pool.query(
      `UPDATE game_events SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(event), req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/events/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM game_events WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Event not found" });
    await writeAuditLog(req.session.userId, "event.delete", "game_events", req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

// ── ONLINE POSTS ──────────────────────────────────────────────────────────────
app.get("/api/online", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const type = req.query.type;
    const { rows } = type
      ? await pool.query("SELECT id, post_type, data, created_at FROM online_posts WHERE post_type = $1 ORDER BY created_at ASC", [type])
      : await pool.query("SELECT id, post_type, data, created_at FROM online_posts ORDER BY created_at ASC");
    res.json({ posts: rows.map((r) => ({ ...r.data, _post_type: r.post_type, _createdAt: r.created_at })) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/online", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { post_type = "web", ...post } = req.body || {};
    if (!post?.id) return res.status(400).json({ error: "id required" });
    await pool.query(
      `INSERT INTO online_posts (id, post_type, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
      [post.id, post_type, JSON.stringify(post)]
    );
    res.status(201).json({ ok: true, id: post.id });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/online/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM online_posts WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Online post not found" });
    await writeAuditLog(req.session.userId, "online.delete", "online_posts", req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

// ── FUNDRAISING ───────────────────────────────────────────────────────────────
app.get("/api/fundraising", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data, created_at FROM fundraising_items ORDER BY created_at ASC");
    res.json({ items: rows.map((r) => ({ ...r.data, _createdAt: r.created_at })) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/fundraising", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const item = req.body;
    if (!item?.id) return res.status(400).json({ error: "id required" });
    await pool.query(
      `INSERT INTO fundraising_items (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
      [item.id, JSON.stringify(item)]
    );
    res.status(201).json({ ok: true, id: item.id });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

app.put("/api/fundraising/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const item = req.body;
    await pool.query(
      `UPDATE fundraising_items SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(item), req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});

// POST /api/fundraising/:id/credit-party — admin/mod: credit party treasury from fundraising revenue
// Body: { partySlug, amount, note? }
// Credits party treasury cash atomically, adds combined ledger entry (from_name = campaign name / "Fundraising")
app.post("/api/fundraising/:id/credit-party", crudWriteLimit, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!requireAdminOrMod(req, res)) { client.release(); return; }

    const partySlug = String(req.body?.partySlug || "").trim();
    const amount    = parseFloat(req.body?.amount);
    const note      = String(req.body?.note || "").trim().slice(0, 500);

    if (!partySlug) { client.release(); return res.status(400).json({ error: "partySlug is required" }); }
    if (!Number.isFinite(amount) || amount <= 0) { client.release(); return res.status(400).json({ error: "amount must be a positive number" }); }

    // Get the fundraising item for its campaign name
    const { rows: itemRows } = await client.query(
      "SELECT id, data FROM fundraising_items WHERE id = $1",
      [req.params.id]
    );
    if (!itemRows.length) { client.release(); return res.status(404).json({ error: "Fundraising item not found" }); }

    const campaignName = String(itemRows[0].data?.name || itemRows[0].data?.title || "Fundraising").trim().slice(0, 200);

    const { rows: clk } = await client.query("SELECT sim_current_month, sim_current_year FROM sim_clock WHERE id = 'main'");
    const simMonth = clk[0]?.sim_current_month ?? 8;
    const simYear  = clk[0]?.sim_current_year  ?? 1997;

    await client.query("BEGIN");
    const { rows: partyRows } = await client.query(
      "SELECT id FROM parties WHERE slug = $1 FOR UPDATE",
      [partySlug]
    );
    if (!partyRows.length) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ error: "Party not found" });
    }

    await client.query(
      `UPDATE parties
          SET treasury = jsonb_set(COALESCE(treasury,'{}'), '{cash}',
                           to_jsonb((COALESCE((treasury->>'cash')::numeric, 0) + $1))),
              updated_at = NOW()
        WHERE slug = $2`,
      [amount, partySlug]
    );
    const { rows: donation } = await client.query(
      `INSERT INTO party_donations (party_slug, from_name, amount, note, sim_month, sim_year)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [partySlug, campaignName, amount, note || `Fundraising revenue: ${campaignName}`, simMonth, simYear]
    );
    await client.query("COMMIT");

    await writeAuditLog(req.session.userId, "party.donation.fundraising", "party_donations", donation[0].id, null,
      { partySlug, campaignName, amount, fundraisingItemId: req.params.id });

    client.release();
    res.json({
      ok: true,
      donation: {
        id:        donation[0].id,
        fromName:  donation[0].from_name,
        amount:    Number(donation[0].amount),
        note:      donation[0].note,
        simMonth:  donation[0].sim_month,
        simYear:   donation[0].sim_year,
        createdAt: donation[0].created_at,
      },
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    console.error("[POST /api/fundraising/:id/credit-party]", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/fundraising/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { rowCount } = await pool.query("DELETE FROM fundraising_items WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Fundraising item not found" });
    await writeAuditLog(req.session.userId, "fundraising.delete", "fundraising_items", req.params.id, null, null);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Server error" }); }
});


// ── News Stories API ─────────────────────────────────────────────────────────
// GET  /api/news          — authenticated: list all stories newest first
// POST /api/news          — admin/mod: create story
// PATCH /api/news/:id     — admin/mod: update story
// DELETE /api/news/:id    — admin/mod: delete story

app.get("/api/news", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT id, headline, text, category, image_url, is_breaking, flavour, sim_date, created_at FROM news_stories ORDER BY created_at DESC"
    );
    res.json({ stories: rows.map((r) => ({
      id: r.id, headline: r.headline, text: r.text, category: r.category,
      imageUrl: r.image_url, isBreaking: r.is_breaking, flavour: r.flavour,
      simDate: r.sim_date, createdAt: r.created_at,
    })) });
  } catch (e) { console.error("[GET /api/news]", e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/news", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { id, headline, text, category = "Politics", imageUrl = "", isBreaking = false, flavour = false, simDate = "" } = req.body || {};
    if (!id || !headline || !text) return res.status(400).json({ error: "id, headline and text required" });
    const { rows } = await pool.query(
      `INSERT INTO news_stories (id, headline, text, category, image_url, is_breaking, flavour, sim_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, headline, text, category, imageUrl, !!isBreaking, !!flavour, simDate, req.session.userId]
    );
    if (!rows.length) return res.status(409).json({ error: "Story ID already exists" });
    res.json({ ok: true, id });
  } catch (e) { console.error("[POST /api/news]", e); res.status(500).json({ error: "Server error" }); }
});

app.patch("/api/news/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { headline, text, imageUrl, isBreaking, simDate } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE news_stories SET
         headline    = COALESCE($2, headline),
         text        = COALESCE($3, text),
         image_url   = COALESCE($4, image_url),
         is_breaking = COALESCE($5, is_breaking),
         sim_date    = COALESCE($6, sim_date)
       WHERE id = $1 RETURNING id`,
      [req.params.id, headline ?? null, text ?? null, imageUrl ?? null, isBreaking != null ? !!isBreaking : null, simDate ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: "Story not found" });
    res.json({ ok: true });
  } catch (e) { console.error("[PATCH /api/news/:id]", e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/news/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await pool.query("DELETE FROM news_stories WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error("[DELETE /api/news/:id]", e); res.status(500).json({ error: "Server error" }); }
});

// ── Rules API ─────────────────────────────────────────────────────────────────
app.get("/api/rules", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, title, body, sort_order FROM rules_items ORDER BY sort_order ASC, id ASC");
    res.json({ items: rows });
  } catch (e) { console.error("[GET /api/rules]", e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/rules", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const { rows } = await pool.query(
      "INSERT INTO rules_items (title, body) VALUES ($1,$2) RETURNING id, title, body",
      [title, body]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (e) { console.error("[POST /api/rules]", e); res.status(500).json({ error: "Server error" }); }
});

app.patch("/api/rules/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const { rows } = await pool.query(
      "UPDATE rules_items SET title=$2, body=$3, updated_at=NOW() WHERE id=$1 RETURNING id",
      [req.params.id, title, body]
    );
    if (!rows.length) return res.status(404).json({ error: "Rule not found" });
    res.json({ ok: true });
  } catch (e) { console.error("[PATCH /api/rules/:id]", e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/rules/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await pool.query("DELETE FROM rules_items WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error("[DELETE /api/rules/:id]", e); res.status(500).json({ error: "Server error" }); }
});

// ── Guides API ────────────────────────────────────────────────────────────────
app.get("/api/guides", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, title, body, sort_order FROM guides_items ORDER BY sort_order ASC, id ASC");
    res.json({ items: rows });
  } catch (e) { console.error("[GET /api/guides]", e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/guides", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const { rows } = await pool.query(
      "INSERT INTO guides_items (title, body) VALUES ($1,$2) RETURNING id, title, body",
      [title, body]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (e) { console.error("[POST /api/guides]", e); res.status(500).json({ error: "Server error" }); }
});

app.patch("/api/guides/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const { rows } = await pool.query(
      "UPDATE guides_items SET title=$2, body=$3, updated_at=NOW() WHERE id=$1 RETURNING id",
      [req.params.id, title, body]
    );
    if (!rows.length) return res.status(404).json({ error: "Guide not found" });
    res.json({ ok: true });
  } catch (e) { console.error("[PATCH /api/guides/:id]", e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/guides/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await pool.query("DELETE FROM guides_items WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error("[DELETE /api/guides/:id]", e); res.status(500).json({ error: "Server error" }); }
});

// ── Civil Service Briefings API ───────────────────────────────────────────────
app.get("/api/civil-service/briefings", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query(
      "SELECT * FROM cs_briefings ORDER BY created_at DESC"
    );
    res.json({ briefings: rows.map((r) => ({
      id: r.id, title: r.title, target_officeId: r.target_office,
      cc_officeIds: r.cc_offices, status: r.status,
      currentStageIdx: r.current_stage_idx, awaitingNextStage: r.awaiting_next_stage,
      stages: r.stages, auditLog: r.audit_log,
      createdBy: r.created_by, createdAt: r.created_at_sim,
    })) });
  } catch (e) { console.error("[GET /api/civil-service/briefings]", e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/civil-service/briefings", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { title, target_officeId = "", cc_officeIds = [], stages = [], createdBy = "", createdAt = "" } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    const { rows } = await pool.query(
      `INSERT INTO cs_briefings (title, target_office, cc_offices, stages, current_stage_idx, created_by, created_at_sim)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,0,$5,$6)
       RETURNING id`,
      [title, target_officeId, JSON.stringify(cc_officeIds), JSON.stringify(stages), createdBy, createdAt]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { console.error("[POST /api/civil-service/briefings]", e); res.status(500).json({ error: "Server error" }); }
});

app.patch("/api/civil-service/briefings/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { status, currentStageIdx, awaitingNextStage, stages, auditLog } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE cs_briefings SET
         status              = COALESCE($2, status),
         current_stage_idx   = COALESCE($3, current_stage_idx),
         awaiting_next_stage = COALESCE($4, awaiting_next_stage),
         stages              = CASE WHEN $5::text IS NOT NULL THEN $5::jsonb ELSE stages END,
         audit_log           = CASE WHEN $6::text IS NOT NULL THEN $6::jsonb ELSE audit_log END,
         updated_at          = NOW()
       WHERE id = $1 RETURNING id`,
      [req.params.id, status ?? null, currentStageIdx ?? null, awaitingNextStage ?? null,
       stages != null ? JSON.stringify(stages) : null,
       auditLog != null ? JSON.stringify(auditLog) : null]
    );
    if (!rows.length) return res.status(404).json({ error: "Briefing not found" });
    res.json({ ok: true });
  } catch (e) { console.error("[PATCH /api/civil-service/briefings/:id]", e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/civil-service/briefings/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await pool.query("DELETE FROM cs_briefings WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error("[DELETE /api/civil-service/briefings/:id]", e); res.status(500).json({ error: "Server error" }); }
});

// ── Civil Service Cases API ───────────────────────────────────────────────────
app.get("/api/civil-service/cases", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT * FROM cs_cases ORDER BY created_at DESC");
    res.json({ cases: rows.map((r) => ({
      id: r.id, deptId: r.dept_id, title: r.title, status: r.status,
      createdBy: r.created_by, createdByAvatar: r.created_by_avatar,
      createdAt: r.created_at_sim, closedAt: r.closed_at_sim, closedBy: r.closed_by,
      messages: r.messages,
    })) });
  } catch (e) { console.error("[GET /api/civil-service/cases]", e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/civil-service/cases", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { deptId = "", title, createdBy = "", createdByAvatar = "", createdAt = "", messages = [] } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    const { rows } = await pool.query(
      `INSERT INTO cs_cases (dept_id, title, created_by, created_by_avatar, created_at_sim, messages)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
      [deptId, title, createdBy, createdByAvatar, createdAt, JSON.stringify(messages)]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { console.error("[POST /api/civil-service/cases]", e); res.status(500).json({ error: "Server error" }); }
});

app.patch("/api/civil-service/cases/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { status, closedAt, closedBy, messages } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE cs_cases SET
         status        = COALESCE($2, status),
         closed_at_sim = COALESCE($3, closed_at_sim),
         closed_by     = COALESCE($4, closed_by),
         messages      = CASE WHEN $5::text IS NOT NULL THEN $5::jsonb ELSE messages END,
         updated_at    = NOW()
       WHERE id = $1 RETURNING id`,
      [req.params.id, status ?? null, closedAt ?? null, closedBy ?? null,
       messages != null ? JSON.stringify(messages) : null]
    );
    if (!rows.length) return res.status(404).json({ error: "Case not found" });
    res.json({ ok: true });
  } catch (e) { console.error("[PATCH /api/civil-service/cases/:id]", e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/civil-service/cases/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await pool.query("DELETE FROM cs_cases WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error("[DELETE /api/civil-service/cases/:id]", e); res.status(500).json({ error: "Server error" }); }
});

// ── Online post edit (PATCH) ──────────────────────────────────────────────────
app.patch("/api/online/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: "body required" });
    const { rows } = await pool.query(
      "UPDATE online_posts SET body = $2 WHERE id = $1 RETURNING id",
      [req.params.id, body]
    );
    if (!rows.length) return res.status(404).json({ error: "Post not found" });
    res.json({ ok: true });
  } catch (e) { console.error("[PATCH /api/online/:id]", e); res.status(500).json({ error: "Server error" }); }
});

// ── Bodies API ────────────────────────────────────────────────────────────────
// GET /api/bodies      — authenticated
// PUT /api/bodies/:id  — admin/mod/speaker: update a body

app.get("/api/bodies", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT id, data FROM bodies_data ORDER BY sort_order ASC, id ASC");
    res.json({ bodies: rows.map((r) => ({ id: r.id, ...r.data })) });
  } catch (e) { console.error("[GET /api/bodies]", e); res.status(500).json({ error: "Server error" }); }
});

app.put("/api/bodies/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const body = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO bodies_data (id, data, sort_order)
       VALUES ($1, $2::jsonb, COALESCE((SELECT sort_order FROM bodies_data WHERE id=$1), 0))
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING id`,
      [req.params.id, JSON.stringify(body)]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { console.error("[PUT /api/bodies/:id]", e); res.status(500).json({ error: "Server error" }); }
});

// ── Papers / Newspaper Articles API ──────────────────────────────────────────
// GET  /api/papers                     — authenticated: get all papers with articles
// POST /api/papers/:key/articles       — admin/mod: create article in a paper
// PATCH /api/papers/:key/articles/:id  — admin/mod: update article
// DELETE /api/papers/:key/articles/:id — admin/mod: delete article

app.get("/api/papers", crudReadLimit, async (req, res) => {
  try {
    if (!requireAuth(req, res)) return;
    const { rows } = await pool.query("SELECT paper_key, id, headline, text, byline_name, image_url, sim_date, created_at FROM newspaper_articles ORDER BY created_at DESC");
    // Group by paper_key
    const byPaper = {};
    for (const r of rows) {
      byPaper[r.paper_key] ??= [];
      byPaper[r.paper_key].push({ id: r.id, headline: r.headline, text: r.text, bylineName: r.byline_name, imageUrl: r.image_url, simDate: r.sim_date, createdAt: r.created_at });
    }
    res.json({ byPaper });
  } catch (e) { console.error("[GET /api/papers]", e); res.status(500).json({ error: "Server error" }); }
});

app.post("/api/papers/:key/articles", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { id, headline, text = "", bylineName = "", imageUrl = "", simDate = "" } = req.body || {};
    if (!id || !headline) return res.status(400).json({ error: "id and headline required" });
    const { rows } = await pool.query(
      `INSERT INTO newspaper_articles (id, paper_key, headline, text, byline_name, image_url, sim_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, req.params.key, headline, text, bylineName, imageUrl, simDate, req.session.userId]
    );
    if (!rows.length) return res.status(409).json({ error: "Article ID already exists" });
    res.json({ ok: true, id });
  } catch (e) { console.error("[POST /api/papers/:key/articles]", e); res.status(500).json({ error: "Server error" }); }
});

app.patch("/api/papers/:key/articles/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    const { headline, text, bylineName, imageUrl } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE newspaper_articles SET
         headline    = COALESCE($3, headline),
         text        = COALESCE($4, text),
         byline_name = COALESCE($5, byline_name),
         image_url   = COALESCE($6, image_url)
       WHERE id = $2 AND paper_key = $1 RETURNING id`,
      [req.params.key, req.params.id, headline ?? null, text ?? null, bylineName ?? null, imageUrl ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: "Article not found" });
    res.json({ ok: true });
  } catch (e) { console.error("[PATCH /api/papers/:key/articles/:id]", e); res.status(500).json({ error: "Server error" }); }
});

app.delete("/api/papers/:key/articles/:id", crudWriteLimit, async (req, res) => {
  try {
    if (!requireAdminOrMod(req, res)) return;
    await pool.query("DELETE FROM newspaper_articles WHERE id = $1 AND paper_key = $2", [req.params.id, req.params.key]);
    res.json({ ok: true });
  } catch (e) { console.error("[DELETE /api/papers/:key/articles/:id]", e); res.status(500).json({ error: "Server error" }); }
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === "production") {
  const secret = process.env.SESSION_SECRET || "";
  if (!secret || secret === "dev-secret-change-me") {
    console.error(
      "[server] FATAL: SESSION_SECRET is not set or uses the default value. " +
      "Set a strong random secret in the Render environment variables before deploying."
    );
    process.exit(1);
  }
}

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
  })
  .catch((e) => {
    console.error("[server] schema init failed", e);
    process.exit(1);
  });

/**
 * Test helpers for parliamentary integration tests.
 *
 * Creates a minimal but correct database schema (tables in dependency order)
 * for the parliamentary-to-political-state flow tests, seeds the test data
 * needed (users, characters, bills, sim clock), and provides a lightweight
 * HTTP client that manages session cookies and CSRF tokens automatically.
 *
 * Design principles:
 *  - Self-contained: does NOT rely on server/index.js's ensureSchema() to avoid
 *    the fresh-DB FK-ordering issues in that function.
 *  - Minimal: only the tables actually exercised by the integration tests.
 *  - Deterministic: each test run gets its own isolated random IDs.
 */

import http from "node:http";
import { pool } from "./db.js";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Schema bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the minimal set of tables (in FK-dependency order) that the
 * parliamentary integration tests exercise.  All statements are idempotent
 * (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */
export async function createTestSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  // ── users & sessions ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username      TEXT NOT NULL UNIQUE,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      roles         JSONB NOT NULL DEFAULT '[]'::jsonb,
      email_verified    BOOLEAN NOT NULL DEFAULT TRUE,
      email_verified_at TIMESTAMPTZ,
      active_character_id UUID,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // connect-pg-simple creates the sessions table via createTableIfMissing:true on
  // first use, but we pre-create it here so all DDL is in one place.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid    VARCHAR    NOT NULL PRIMARY KEY,
      sess   JSON       NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire);
  `);

  // ── characters ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
      name         TEXT NOT NULL,
      party        TEXT NOT NULL DEFAULT '',
      constituency TEXT NOT NULL DEFAULT '',
      role         TEXT NOT NULL DEFAULT 'backbencher',
      office       TEXT,
      roles        JSONB NOT NULL DEFAULT '[]'::jsonb,
      offices      JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active    BOOLEAN NOT NULL DEFAULT TRUE,
      is_npc       BOOLEAN NOT NULL DEFAULT FALSE,
      whip_status  TEXT NOT NULL DEFAULT 'normal',
      absent       BOOLEAN NOT NULL DEFAULT FALSE,
      delegated_to TEXT,
      rh_ever      BOOLEAN NOT NULL DEFAULT FALSE,
      tpl_ever     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS characters_user_idx    ON characters (user_id);
    CREATE INDEX IF NOT EXISTS characters_active_idx  ON characters (is_active);
  `);
  // FK from users back to characters (active_character_id)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active_character_id UUID REFERENCES characters(id) ON DELETE SET NULL;
  `);

  // ── sim_clock ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sim_clock (
      id                 TEXT PRIMARY KEY,
      sim_current_month  INT  NOT NULL DEFAULT 8,
      sim_current_year   INT  NOT NULL DEFAULT 1997,
      rate               TEXT NOT NULL DEFAULT 'monthly'
    );
    INSERT INTO sim_clock (id, sim_current_month, sim_current_year, rate)
    VALUES ('main', 8, 1997, 'monthly')
    ON CONFLICT (id) DO NOTHING;
  `);

  // ── bills ─────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bills (
      id                  TEXT PRIMARY KEY,
      data                JSONB NOT NULL,
      author_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Idempotent: add column if the table was pre-created without it
  await pool.query(`
    ALTER TABLE bills ADD COLUMN IF NOT EXISTS author_character_id UUID REFERENCES characters(id) ON DELETE SET NULL
  `);

  // ── divisions ─────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS divisions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      title           TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','closed')),
      closes_at       TIMESTAMPTZ,
      closes_at_sim   TEXT,
      npc_votes             JSONB NOT NULL DEFAULT '{}'::jsonb,
      rebels_by_party       JSONB NOT NULL DEFAULT '{}'::jsonb,
      rebels_by_party_choice JSONB NOT NULL DEFAULT '{}'::jsonb,
      outcome         TEXT,
      immutable_result JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── bill_amendments ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_amendments (
      id                TEXT NOT NULL,
      bill_id           TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      article_number    INT,
      amendment_type    TEXT NOT NULL DEFAULT 'replace'
                        CHECK (amendment_type IN ('replace','insert','delete')),
      title             TEXT NOT NULL,
      text              TEXT NOT NULL DEFAULT '',
      proposed_by_id    UUID REFERENCES characters(id) ON DELETE SET NULL,
      proposed_by_name  TEXT,
      proposed_by_party TEXT,
      status            TEXT NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed','accepted','refused','in-division','withdrawn')),
      division_id       UUID REFERENCES divisions(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bill_id, id)
    );
  `);

  // ── bill_amendment_supporters ─────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_amendment_supporters (
      bill_id       TEXT NOT NULL,
      amendment_id  TEXT NOT NULL,
      character_id  UUID REFERENCES characters(id) ON DELETE CASCADE,
      party         TEXT NOT NULL,
      added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bill_id, amendment_id, party),
      FOREIGN KEY (bill_id, amendment_id) REFERENCES bill_amendments(bill_id, id) ON DELETE CASCADE
    );
  `);

  // ── division_votes ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_votes (
      id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      division_id                     UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      character_id                    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      vote                            TEXT NOT NULL CHECK (vote IN ('aye','no','abstain')),
      weight                          INTEGER NOT NULL DEFAULT 1,
      effective_weight                INTEGER NOT NULL DEFAULT 1,
      delegation_source_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      voted_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (division_id, character_id)
    );
  `);

  // ── division_party_instructions ───────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_party_instructions (
      id          BIGSERIAL PRIMARY KEY,
      division_id UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      party_slug  TEXT NOT NULL,
      position    TEXT NOT NULL CHECK (position IN ('aye','no','abstain','free')),
      whip_level  NUMERIC NOT NULL DEFAULT 1,
      set_at_sim  TEXT,
      UNIQUE (division_id, party_slug)
    );
  `);

  // ── division_rebellion_log ────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_rebellion_log (
      id              BIGSERIAL PRIMARY KEY,
      division_id     UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
      character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      party_slug      TEXT,
      party_position  TEXT,
      mp_vote         TEXT,
      whip_level      NUMERIC,
      recorded_at_sim TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── character_political_state ─────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_political_state (
      character_id           UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      capital_current        NUMERIC(8,2) NOT NULL DEFAULT 0,
      capital_trend          NUMERIC(8,2) NOT NULL DEFAULT 0,
      momentum               TEXT NOT NULL DEFAULT 'stable',
      reputation             TEXT NOT NULL DEFAULT 'neutral',
      breakdown              JSONB NOT NULL DEFAULT '[]'::jsonb,
      party_pressure         NUMERIC(5,2) NOT NULL DEFAULT 0,
      constituency_pressure  NUMERIC(5,2) NOT NULL DEFAULT 0,
      media_pressure         NUMERIC(5,2) NOT NULL DEFAULT 0,
      group_pressure         NUMERIC(5,2) NOT NULL DEFAULT 0,
      institutional_pressure NUMERIC(5,2) NOT NULL DEFAULT 0,
      rebellion_risk         NUMERIC(5,2) NOT NULL DEFAULT 0,
      scandal_risk           NUMERIC(5,2) NOT NULL DEFAULT 0,
      pressure_breakdown_json JSONB,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── constituencies (needed by getPartySeatsFromConstituencies & batchGetCharacterDisplayNames) ────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS constituencies (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      nation     TEXT NOT NULL DEFAULT '',
      region     TEXT NOT NULL DEFAULT '',
      party      TEXT NOT NULL DEFAULT '',
      mp_type    TEXT NOT NULL DEFAULT '',
      mp_name    TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // privy_council_members referenced by batchGetCharacterDisplayNames
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privy_council_members (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      appointed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      removed_at   TIMESTAMPTZ,
      UNIQUE (character_id)
    );
  `);

  // ── Supporting tables for recomputeCharacterPoliticalState ───────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS press_items (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      author_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      data                JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandals (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id     UUID REFERENCES characters(id) ON DELETE CASCADE,
      status           TEXT NOT NULL DEFAULT 'open',
      severity_current NUMERIC NOT NULL DEFAULT 1,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_work_plans (
      character_id         UUID PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      last_saved_sim_index INT NOT NULL DEFAULT 0,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parties (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug                     TEXT NOT NULL UNIQUE,
      name                     TEXT NOT NULL,
      leader_character_id      UUID REFERENCES characters(id) ON DELETE SET NULL,
      chairman_character_id    UUID REFERENCES characters(id) ON DELETE SET NULL,
      whip_character_id        UUID REFERENCES characters(id) ON DELETE SET NULL,
      chief_whip_character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      deputy_whip_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS offices (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      spec_id    TEXT,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'parliamentary',
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
  `);
  // affiliations_catalog is referenced by recomputeCharacterPoliticalState for group pressure
  // Note: in production this uses TEXT primary key, matching ensureSchema() line 984.
  // Must be created BEFORE character_affiliations which has a FK to it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS affiliations_catalog (
      id         TEXT PRIMARY KEY,
      category   TEXT NOT NULL DEFAULT 'general',
      name       TEXT NOT NULL,
      active     BOOLEAN NOT NULL DEFAULT TRUE,
      monthly_fee INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_affiliations (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id   UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      affiliation_id TEXT NOT NULL REFERENCES affiliations_catalog(id),
      status         TEXT NOT NULL DEFAULT 'approved'
                     CHECK (status IN ('approved','pending_add','pending_remove','rejected_add','rejected_remove')),
      requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (character_id, affiliation_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS constituency_events (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      constituency_id  TEXT NOT NULL,
      change_type      TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS division_rebel_requests (
      id           BIGSERIAL PRIMARY KEY,
      division_id  UUID REFERENCES divisions(id) ON DELETE CASCADE,
      character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         BIGSERIAL PRIMARY KEY,
      actor_id   TEXT NOT NULL,
      action     TEXT NOT NULL,
      target     TEXT NOT NULL DEFAULT '',
      entity_type TEXT,
      entity_id   TEXT,
      before_data JSONB,
      after_data  JSONB,
      details    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // app_state_current needed by computeCharacterWeight (optional — vote weight falls back to 1)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state_current (
      id          TEXT PRIMARY KEY,
      snapshot_id UUID
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS state_snapshots (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      label      TEXT NOT NULL DEFAULT '',
      data       JSONB NOT NULL
    );
  `);

  // ── Faction tables ────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_factions (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug               TEXT NOT NULL,
      slug                     TEXT NOT NULL,
      name                     TEXT NOT NULL,
      description              TEXT NOT NULL DEFAULT '',
      colour                   TEXT NOT NULL DEFAULT '#888888',
      ideology_tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
      leadership_alignment     TEXT NOT NULL DEFAULT 'neutral',
      rebellion_bias           NUMERIC(4,2) NOT NULL DEFAULT 0,
      media_sensitivity        NUMERIC(4,2) NOT NULL DEFAULT 0,
      constituency_sensitivity NUMERIC(4,2) NOT NULL DEFAULT 0,
      display_order            INTEGER NOT NULL DEFAULT 0,
      active                   BOOLEAN NOT NULL DEFAULT TRUE,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (party_slug, slug)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_faction_allocations (
      faction_id    UUID PRIMARY KEY REFERENCES party_factions(id) ON DELETE CASCADE,
      mp_count      INTEGER NOT NULL DEFAULT 0,
      influence_bonus NUMERIC(4,2) NOT NULL DEFAULT 0,
      notes         TEXT NOT NULL DEFAULT '',
      updated_by    TEXT NOT NULL DEFAULT '',
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS faction_political_state (
      faction_id          UUID PRIMARY KEY REFERENCES party_factions(id) ON DELETE CASCADE,
      internal_power      NUMERIC(5,2) NOT NULL DEFAULT 0,
      momentum            TEXT NOT NULL DEFAULT 'stable',
      leadership_pressure NUMERIC(5,2) NOT NULL DEFAULT 0,
      cohesion            NUMERIC(5,2) NOT NULL DEFAULT 70,
      breakdown           JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Drop all tables created by createTestSchema() in reverse FK order.
 * Called in the test teardown to leave the DB clean.
 */
export async function dropTestSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS
      privy_council_members,
      division_rebel_requests,
      division_rebellion_log,
      division_party_instructions,
      division_votes,
      bill_amendment_supporters,
      bill_amendments,
      character_affiliations,
      affiliations_catalog,
      office_assignments,
      character_work_plans,
      character_political_state,
      scandals,
      press_items,
      offices,
      parties,
      constituency_events,
      faction_political_state,
      party_faction_allocations,
      party_factions,
      constituencies,
      privy_council_members,
      divisions,
      bills,
      characters,
      state_snapshots,
      app_state_current,
      audit_log,
      sessions,
      users,
      sim_clock
    CASCADE;
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test data factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed a verified user + linked character.
 *
 * @param {{ username?, email?, password?, roles?, party?, role?, characterName? }} opts
 * @returns {{ userId, charId, email, password, username }}
 */
export async function seedUserAndCharacter(opts = {}) {
  const suffix        = randomUUID().slice(0, 8);
  const username      = opts.username      ?? `testuser_${suffix}`;
  const email         = opts.email         ?? `${username}@test.local`;
  const password      = opts.password      ?? "Test1234!";
  const roles         = opts.roles         ?? [];
  const party         = opts.party         ?? "Labour";
  const characterRole = opts.role          ?? "backbencher";
  const characterName = opts.characterName ?? `Test Character ${suffix}`;

  const passwordHash = await bcrypt.hash(password, 4); // low rounds — speed in tests (production uses 12)

  const { rows: userRows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, roles, email_verified)
     VALUES ($1, $2, $3, $4::jsonb, TRUE)
     RETURNING id`,
    [username, email, passwordHash, JSON.stringify(roles)]
  );
  const userId = userRows[0].id;

  const { rows: charRows } = await pool.query(
    `INSERT INTO characters (user_id, name, party, role, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id`,
    [userId, characterName, party, characterRole]
  );
  const charId = charRows[0].id;

  // Point user's active_character_id to the new character
  await pool.query(
    `UPDATE users SET active_character_id = $1 WHERE id = $2`,
    [charId, userId]
  );

  return { userId, charId, email, password, username };
}

/**
 * Insert a minimal bill row ready for amendment submission.
 * The bill is in "Second Reading" stage (the stage where amendment window is open).
 *
 * @param {string} authorCharId
 * @param {{ id?, title? }} opts
 * @returns {string} bill id
 */
export async function seedBill(authorCharId, opts = {}) {
  const billId   = opts.id    ?? `BILL-TEST-${randomUUID().slice(0, 8)}`;
  const title    = opts.title ?? "Test Bill";
  const billData = {
    id:     billId,
    title,
    stage:  "Second Reading",  // AMENDMENT_ALLOWED_STAGES allows this stage
    status: "active",
    billText: [
      "ARTICLE 1 — Short Title",
      "This Act may be cited as the Test Act.",
      "",
      "ARTICLE 2 — Main Provision",
      "The provision applies as set out herein.",
    ].join("\n"),
  };

  await pool.query(
    `INSERT INTO bills (id, data, author_character_id) VALUES ($1, $2::jsonb, $3)`,
    [billId, JSON.stringify(billData), authorCharId]
  );
  return billId;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP test client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed N fake constituency rows for a given party.
 * Used to set up a party's MP total so allocation validation has something to check against.
 *
 * @param {string} partySlug  e.g. "Labour"
 * @param {number} count      number of constituency rows to insert
 * @returns {Promise<void>}
 */
export async function seedConstituencies(partySlug, count) {
  for (let i = 0; i < count; i++) {
    const id = `TEST-CONST-${partySlug.replace(/\s+/g, "-").toUpperCase()}-${i}-${randomUUID().slice(0, 6)}`;
    await pool.query(
      `INSERT INTO constituencies (id, name, nation, region, party, mp_type, mp_name)
       VALUES ($1, $2, 'England', 'Test Region', $3, 'MP', 'Test MP')
       ON CONFLICT (id) DO NOTHING`,
      [id, `Test Constituency ${i}`, partySlug]
    );
  }
}

/**
 * Seed a party_factions row (and a default party_faction_allocations row) for tests.
 *
 * @param {{ partySlug, name?, slug?, leadershipAlignment?, rebellionBias?, mpCount?, influenceBonus? }} opts
 * @returns {{ factionId: string }}
 */
export async function seedFaction(opts = {}) {
  const suffix             = randomUUID().slice(0, 8);
  const partySlug          = opts.partySlug          ?? "Labour";
  const name               = opts.name               ?? `Test Faction ${suffix}`;
  const slug               = opts.slug               ?? `test-faction-${suffix}`;
  const leadershipAlignment = opts.leadershipAlignment ?? "neutral";
  const rebellionBias      = opts.rebellionBias      ?? 0.1;
  const mpCount            = opts.mpCount            ?? 0;
  const influenceBonus     = opts.influenceBonus     ?? 0;

  const { rows } = await pool.query(
    `INSERT INTO party_factions
       (party_slug, slug, name, leadership_alignment, rebellion_bias)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [partySlug, slug, name, leadershipAlignment, rebellionBias]
  );
  const factionId = rows[0].id;

  await pool.query(
    `INSERT INTO party_faction_allocations (faction_id, mp_count, influence_bonus, updated_by)
     VALUES ($1, $2, $3, 'test-seed')`,
    [factionId, mpCount, influenceBonus]
  );

  return { factionId };
}

/**
 * Start the Express app on an OS-assigned free port.
 * Returns { server, baseUrl, close }.
 *
 * @param {import('express').Application} app
 * @returns {Promise<{ server: http.Server, baseUrl: string, close: () => Promise<void> }>}
 */
export function startTestServer(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const baseUrl  = `http://127.0.0.1:${port}`;
      const close    = () => new Promise((res) => server.close(res));
      resolve({ server, baseUrl, close });
    });
  });
}

/**
 * Thin HTTP client that maintains a session cookie jar and CSRF token.
 * Uses Node's built-in `fetch` (available since Node 18).
 */
export class TestClient {
  constructor(baseUrl) {
    this.baseUrl    = baseUrl;
    this.cookies    = {};  // name → value
    this.csrfToken  = null;
  }

  /** Merge Set-Cookie headers into the in-memory cookie jar. */
  _storeCookies(response) {
    // getSetCookie() (Node 18.14+) returns one entry per Set-Cookie header — the safe path.
    // The fallback comma-split regex is a best-effort heuristic for older Node versions; it
    // may split incorrectly on Expires dates that contain commas, but connect-pg-simple
    // session cookies don't include an Expires attribute in test mode so this is safe here.
    const rawHeaders = response.headers.getSetCookie
      ? response.headers.getSetCookie()          // Node 18.14+
      : (response.headers.get("set-cookie") || "").split(/,(?=\s*\w+=)/);

    for (const raw of rawHeaders) {
      if (!raw) continue;
      // Each entry is like: rb.sid=Abc123; Path=/; HttpOnly; SameSite=Lax
      const segment = raw.split(";")[0].trim();
      const eqIdx   = segment.indexOf("=");
      if (eqIdx < 0) continue;
      const name  = segment.slice(0, eqIdx).trim();
      const value = segment.slice(eqIdx + 1).trim();
      if (value) this.cookies[name] = value;
      else       delete this.cookies[name];
    }
  }

  /** Build Cookie header from jar. */
  _cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  /**
   * Make an HTTP request.
   * @param {"GET"|"POST"|"PUT"|"DELETE"} method
   * @param {string} path
   * @param {object|null} body   JSON body (for mutations)
   * @returns {Promise<{ status: number, body: any, response: Response }>}
   */
  async request(method, path, body = null) {
    const headers = {
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    };
    if (this.cookies && Object.keys(this.cookies).length) {
      headers["Cookie"] = this._cookieHeader();
    }
    if (this.csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers["X-CSRF-Token"] = this.csrfToken;
    }

    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    this._storeCookies(resp);

    let json;
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      json = await resp.json();
    } else {
      json = await resp.text();
    }

    return { status: resp.status, body: json, response: resp };
  }

  /** Shorthand helpers */
  get(path)             { return this.request("GET",    path); }
  post(path, body)      { return this.request("POST",   path, body); }
  put(path, body)       { return this.request("PUT",    path, body); }
  patch(path, body)     { return this.request("PATCH",  path, body); }
  delete(path)          { return this.request("DELETE", path); }

  /**
   * Log in as the given user and store the session cookie + CSRF token.
   * @returns {Promise<{ ok: boolean, csrfToken: string }>}
   */
  async login(email, password) {
    const { status, body } = await this.post("/api/auth/login", { email, password });
    if (status !== 200 || !body.ok) {
      throw new Error(`Login failed (${status}): ${JSON.stringify(body)}`);
    }
    this.csrfToken = body.csrfToken;
    return body;
  }
}

/**
 * Wait up to `timeoutMs` for `fn` to return a truthy value (polling every `intervalMs`).
 * Useful for waiting on non-blocking background tasks (e.g. recomputeCharacterPoliticalState).
 */
export async function waitFor(fn, { timeoutMs = 2000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

/**
 * Integration tests: POST /api/admin/wipe-with-characters
 *
 * Regression coverage for the user-preservation safety fix.
 *
 * The original implementation used TRUNCATE characters ... CASCADE which
 * cascades through ALL FK constraint definitions pointing at the characters
 * table — including users.active_character_id → characters ON DELETE SET NULL —
 * causing the users table to be truncated and admins to be locked out.
 *
 * These tests verify:
 *  1. wipe-with-characters preserves user rows (core regression test)
 *  2. users.active_character_id is set to NULL after wipe (not the row deleted)
 *  3. characters are deleted after wipe
 *  4. admin can log in and call an admin-only route after wipe (no lockout)
 *  5. wrong confirmation text returns 400
 *  6. non-admin user is rejected with 403
 *
 * Run with:
 *   NODE_ENV=test \
 *   DATABASE_URL=******localhost:5432/rb_test \
 *   SESSION_SECRET=test-secret \
 *   node --test server/wipe-with-characters.integration.test.js
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db.js";
import { app } from "./index.js";
import {
  createTestSchema,
  dropTestSchema,
  seedUserAndCharacter,
  startTestServer,
  TestClient,
} from "./test-helpers.js";

// ─────────────────────────────────────────────────────────────────────────────
// Extended schema: additional tables required by the wipe handler beyond those
// created by createTestSchema().  All statements are idempotent (IF NOT EXISTS).
// Tables are created in FK-dependency order.
// ─────────────────────────────────────────────────────────────────────────────

async function createWipeTestSchema() {
  // budget_data — needed by seedBudgetBaseline(true) called after the wipe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budget_data (
      id             TEXT PRIMARY KEY,
      last_year      JSONB,
      current_year   JSONB,
      admin_controls JSONB NOT NULL DEFAULT '{}'::jsonb,
      archive        JSONB NOT NULL DEFAULT '[]'::jsonb,
      pending        JSONB,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO budget_data (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
  `);

  // group_drafts — needed by UPDATE group_drafts called after the wipe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_drafts (
      group_key  TEXT PRIMARY KEY,
      drafts     JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO group_drafts (group_key) VALUES ('cabinet')       ON CONFLICT (group_key) DO NOTHING;
    INSERT INTO group_drafts (group_key) VALUES ('shadowcabinet') ON CONFLICT (group_key) DO NOTHING;
  `);

  // support_tickets — preserved table with a NO ACTION FK to characters
  // (this FK must be pre-cleared before deleting character rows).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by_user_id      UUID NOT NULL REFERENCES users(id),
      created_by_character_id UUID REFERENCES characters(id),
      subject                 TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'open'
    );
  `);

  // elections + child tables + app_state_elections singleton
  // Needed by initializeScenarioElection() called after the wipe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS elections (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type          TEXT NOT NULL DEFAULT 'general',
      polling_day   DATE NOT NULL,
      label         TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      is_current    BOOLEAN NOT NULL DEFAULT false,
      turnout_total BIGINT NOT NULL DEFAULT 0,
      turnout_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
      finalized_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS election_party_summary (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
      party       TEXT NOT NULL,
      seats       INT NOT NULL DEFAULT 0,
      votes       BIGINT NOT NULL DEFAULT 0,
      vote_share  NUMERIC(5,2) NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (election_id, party)
    );
    CREATE TABLE IF NOT EXISTS election_constituency_changes (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
      constituency_id TEXT NOT NULL,
      party_from      TEXT NOT NULL DEFAULT '',
      party_to        TEXT NOT NULL,
      UNIQUE (election_id, constituency_id)
    );
    CREATE TABLE IF NOT EXISTS app_state_elections (
      id                       TEXT PRIMARY KEY DEFAULT 'main',
      last_general_election_id UUID REFERENCES elections(id) ON DELETE SET NULL,
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO app_state_elections (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
  `);

  // constituency_events — references elections(id) ON DELETE SET NULL
  // (already in createTestSchema but may not have the election_id FK column; use IF NOT EXISTS)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS constituency_events (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      constituency_id TEXT NOT NULL,
      change_type     TEXT NOT NULL DEFAULT '',
      party_from      TEXT NOT NULL DEFAULT '',
      party_to        TEXT NOT NULL DEFAULT '',
      election_id     UUID REFERENCES elections(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // office_assignment_history — references offices(id) and characters(id) CASCADE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS office_assignment_history (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      office_id       UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
      character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      start_sim_month SMALLINT NOT NULL DEFAULT 0,
      start_sim_year  SMALLINT NOT NULL DEFAULT 0
    );
  `);

  // character_positions — references characters(id) CASCADE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS character_positions (
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      position_key TEXT NOT NULL,
      PRIMARY KEY (character_id, position_key)
    );
  `);

  // scandal_templates (referenced by scandal_situations)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_templates (
      id    TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT ''
    );
  `);

  // scandal_opt_in — references characters(id) CASCADE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_opt_in (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  // scandal_situations — references characters(id) CASCADE and scandal_templates
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_situations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      template_id  TEXT REFERENCES scandal_templates(id) ON DELETE SET NULL
    );
  `);

  // scandal_player_choices and scandal_mod_decisions reference scandals(id) CASCADE
  // scandals is in createTestSchema
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scandal_player_choices (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scandal_id         UUID NOT NULL REFERENCES scandals(id) ON DELETE CASCADE,
      actor_character_id UUID REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS scandal_mod_decisions (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scandal_id UUID NOT NULL REFERENCES scandals(id) ON DELETE CASCADE
    );
  `);

  // privy_council_posts — references characters(id) ON DELETE SET NULL
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privy_council_posts (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      post_name    TEXT NOT NULL DEFAULT ''
    );
  `);

  // pending_bio/avatar/profile changes — reference characters CASCADE and users CASCADE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_bio_changes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      proposed_bio TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS pending_avatar_changes (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      proposed_avatar TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS pending_profile_changes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // party_expulsion_requests / whip_withdrawal_requests — reference characters CASCADE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_expulsion_requests (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug      TEXT NOT NULL,
      character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      requested_by_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS whip_withdrawal_requests (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug      TEXT NOT NULL,
      character_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      requested_by_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'pending'
    );
  `);

  // party_leader_elections — winner_character_id references characters SET NULL
  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_leader_elections (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug          TEXT NOT NULL,
      winner_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS party_leader_election_nominations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      election_id  UUID NOT NULL REFERENCES party_leader_elections(id) ON DELETE CASCADE,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS party_leader_election_votes (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      election_id UUID NOT NULL REFERENCES party_leader_elections(id) ON DELETE CASCADE,
      voter_id    UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      nominee_id  UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  // frontbench_reshuffles — declared_by references characters SET NULL
  await pool.query(`
    CREATE TABLE IF NOT EXISTS frontbench_reshuffles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug  TEXT NOT NULL,
      declared_by UUID REFERENCES characters(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // bill_stage_reports — references bills(id) CASCADE and characters SET NULL
  // bill_opposition_quota — references characters CASCADE
  // bills is in createTestSchema
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bill_stage_reports (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
      submitted_by_id UUID REFERENCES characters(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS bill_opposition_quota (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  // Content tables: motions, statements, regulations (no blocking FKs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS motions (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS statements (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS regulations (
      id                  TEXT PRIMARY KEY,
      data                JSONB NOT NULL DEFAULT '{}',
      author_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // questiontime_questions (no blocking FKs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questiontime_questions (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // qt_questions / qt_answers / qt_followups
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qt_questions (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      asked_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      question_text         TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS qt_answers (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id              UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
      answered_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      answer_text              TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS qt_followups (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id           UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
      asked_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      followup_text         TEXT NOT NULL DEFAULT ''
    );
  `);

  // polling_entries (no blocking FKs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS polling_entries (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // news_stories + child tables that reference it (comment/reply tables must be TRUNCATEd first)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_stories (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      headline   TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS news_story_comments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      news_story_id UUID NOT NULL REFERENCES news_stories(id) ON DELETE CASCADE,
      character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      body          TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS news_reply_requests (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      story_id     UUID NOT NULL REFERENCES news_stories(id) ON DELETE CASCADE,
      char_id      UUID REFERENCES characters(id) ON DELETE SET NULL,
      request_text TEXT NOT NULL DEFAULT ''
    );
  `);

  // newspaper_articles + child tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newspaper_articles (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      headline   TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS paper_article_comments (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      article_id   UUID NOT NULL REFERENCES newspaper_articles(id) ON DELETE CASCADE,
      character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      body         TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS paper_submissions (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      paper_key    TEXT NOT NULL,
      text         TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'pending',
      submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
      char_id      UUID REFERENCES characters(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // game_events, red_lion_posts, online_posts (no blocking FKs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_events (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS red_lion_posts (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS online_posts (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // cs_briefings, cs_cases (no blocking FKs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cs_briefings (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cs_cases (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      data       JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // party_internal_tickets and all child tables.
  // party_internal_freeze_snapshots references party_internal_tickets SET NULL, so both
  // must appear in the same TRUNCATE to avoid FK constraint errors without CASCADE.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS party_internal_tickets (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      party_slug         TEXT NOT NULL DEFAULT '',
      title              TEXT NOT NULL DEFAULT '',
      body               TEXT NOT NULL DEFAULT '',
      origin             TEXT NOT NULL DEFAULT 'player',
      ticket_type        TEXT NOT NULL DEFAULT 'policy',
      status             TEXT NOT NULL DEFAULT 'queued_for_freeze',
      to_role            TEXT NOT NULL DEFAULT 'staff',
      created_by_char_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS party_internal_ticket_costing (
      ticket_id         UUID PRIMARY KEY REFERENCES party_internal_tickets(id) ON DELETE CASCADE,
      costed_by_char_id UUID REFERENCES characters(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS party_internal_ticket_approvals (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id           UUID NOT NULL REFERENCES party_internal_tickets(id) ON DELETE CASCADE,
      approval_role       TEXT NOT NULL DEFAULT 'chairman',
      approved_by_char_id UUID REFERENCES characters(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS party_internal_ticket_ignores (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id          UUID NOT NULL REFERENCES party_internal_tickets(id) ON DELETE CASCADE,
      ignored_by_char_id UUID REFERENCES characters(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS party_internal_ticket_outcomes (
      ticket_id           UUID PRIMARY KEY REFERENCES party_internal_tickets(id) ON DELETE CASCADE,
      recorded_by_char_id UUID REFERENCES characters(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS party_internal_messages (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id      UUID NOT NULL REFERENCES party_internal_tickets(id) ON DELETE CASCADE,
      author_char_id UUID REFERENCES characters(id) ON DELETE SET NULL,
      body           TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS party_internal_freeze_snapshots (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id     UUID REFERENCES party_internal_tickets(id) ON DELETE SET NULL,
      snapshot_type TEXT NOT NULL DEFAULT 'freeze',
      payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Drop all tables added by createWipeTestSchema() in reverse FK order.
 */
async function dropWipeTestSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS
      party_internal_freeze_snapshots,
      party_internal_messages,
      party_internal_ticket_outcomes,
      party_internal_ticket_ignores,
      party_internal_ticket_approvals,
      party_internal_ticket_costing,
      party_internal_tickets,
      cs_cases, cs_briefings,
      online_posts, red_lion_posts, game_events,
      paper_submissions, paper_article_comments, newspaper_articles,
      news_reply_requests, news_story_comments, news_stories,
      polling_entries,
      qt_followups, qt_answers, qt_questions,
      questiontime_questions,
      regulations, statements, motions,
      bill_opposition_quota, bill_stage_reports,
      frontbench_reshuffles,
      party_leader_election_votes, party_leader_election_nominations, party_leader_elections,
      whip_withdrawal_requests, party_expulsion_requests,
      pending_profile_changes, pending_avatar_changes, pending_bio_changes,
      privy_council_posts,
      scandal_mod_decisions, scandal_player_choices,
      scandal_situations, scandal_opt_in, scandal_templates,
      character_positions,
      office_assignment_history,
      constituency_events,
      app_state_elections,
      election_constituency_changes, election_party_summary, elections,
      group_drafts,
      support_tickets,
      budget_data
    CASCADE;
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Global setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let baseUrl;
let closeServer;

before(async () => {
  await createTestSchema();
  await createWipeTestSchema();
  const started = await startTestServer(app);
  baseUrl = started.baseUrl;
  closeServer = started.close;
});

after(async () => {
  if (typeof closeServer === "function") {
    try { await closeServer(); } catch { /* ignore */ }
  }
  try { await dropWipeTestSchema(); } catch { /* ignore */ }
  try { await dropTestSchema(); } catch { /* ignore */ }
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function client() { return new TestClient(baseUrl); }

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test("wipe-with-characters returns 400 for wrong confirmation text", async () => {
  const { email, password } = await seedUserAndCharacter({ roles: ["admin"] });
  const c = client();
  await c.login(email, password);

  const res = await c.post("/api/admin/wipe-with-characters", { confirm: "wrong text" });
  assert.equal(res.status, 400);
  assert.equal(res.body?.ok, false);
});

test("wipe-with-characters returns 403 for non-admin user", async () => {
  const { email, password } = await seedUserAndCharacter({ roles: [] });
  const c = client();
  await c.login(email, password);

  const res = await c.post("/api/admin/wipe-with-characters", { confirm: "WIPE WITH CHARACTERS" });
  assert.equal(res.status, 403);
});

test("wipe-with-characters preserves user rows — regression: TRUNCATE CASCADE must not delete users", async () => {
  const adminUser = await seedUserAndCharacter({ roles: ["admin"] });
  const regularUser = await seedUserAndCharacter({ roles: [] });

  // Confirm both users and both characters exist before the wipe
  const { rows: usersBefore } = await pool.query(
    `SELECT id FROM users WHERE id = ANY($1::uuid[])`,
    [[adminUser.userId, regularUser.userId]]
  );
  assert.equal(usersBefore.length, 2, "Both users must exist before wipe");

  const { rows: charsBefore } = await pool.query(
    `SELECT id FROM characters WHERE id = ANY($1::uuid[])`,
    [[adminUser.charId, regularUser.charId]]
  );
  assert.equal(charsBefore.length, 2, "Both characters must exist before wipe");

  // Run the wipe as admin
  const c = client();
  await c.login(adminUser.email, adminUser.password);
  const wipeRes = await c.post("/api/admin/wipe-with-characters", { confirm: "WIPE WITH CHARACTERS" });
  assert.equal(wipeRes.status, 200, `Wipe must succeed: ${JSON.stringify(wipeRes.body)}`);
  assert.equal(wipeRes.body?.ok, true);

  // REGRESSION: both user rows must still exist after the wipe
  const { rows: usersAfter } = await pool.query(
    `SELECT id, active_character_id FROM users WHERE id = ANY($1::uuid[])`,
    [[adminUser.userId, regularUser.userId]]
  );
  assert.equal(
    usersAfter.length,
    2,
    "wipe-with-characters must NOT delete user rows (regression: TRUNCATE characters CASCADE was deleting users)"
  );

  // users.active_character_id must be NULL (not pointing at a deleted character)
  for (const row of usersAfter) {
    assert.equal(
      row.active_character_id,
      null,
      `User ${row.id}: active_character_id must be NULL after wipe, was ${row.active_character_id}`
    );
  }
});

test("wipe-with-characters deletes all character rows", async () => {
  const adminUser = await seedUserAndCharacter({ roles: ["admin"] });
  await seedUserAndCharacter({ roles: [] });

  const c = client();
  await c.login(adminUser.email, adminUser.password);
  const wipeRes = await c.post("/api/admin/wipe-with-characters", { confirm: "WIPE WITH CHARACTERS" });
  assert.equal(wipeRes.status, 200, `Wipe must succeed: ${JSON.stringify(wipeRes.body)}`);

  const { rows: charsAfter } = await pool.query(`SELECT id FROM characters`);
  assert.equal(charsAfter.length, 0, "All character rows must be deleted by wipe-with-characters");
});

test("wipe-with-characters preserves support tickets and nulls created_by_character_id", async () => {
  const adminUser = await seedUserAndCharacter({ roles: ["admin"] });
  const regularUser = await seedUserAndCharacter({ roles: [] });

  await pool.query(
    `INSERT INTO support_tickets (created_by_user_id, created_by_character_id, subject, status)
     VALUES ($1, $2, 'Wipe regression guard', 'open')`,
    [regularUser.userId, regularUser.charId]
  );

  const c = client();
  await c.login(adminUser.email, adminUser.password);
  const wipeRes = await c.post("/api/admin/wipe-with-characters", { confirm: "WIPE WITH CHARACTERS" });
  assert.equal(wipeRes.status, 200, `Wipe must succeed: ${JSON.stringify(wipeRes.body)}`);

  const { rows } = await pool.query(
    `SELECT created_by_user_id, created_by_character_id FROM support_tickets WHERE created_by_user_id = $1`,
    [regularUser.userId]
  );
  assert.equal(rows.length, 1, "Support ticket row should be preserved");
  assert.equal(rows[0].created_by_character_id, null, "Support ticket character pointer must be cleared");
});

test("admin access remains possible after wipe-with-characters — no lockout", async () => {
  const adminUser = await seedUserAndCharacter({ roles: ["admin"] });

  const c = client();
  await c.login(adminUser.email, adminUser.password);

  // Run the wipe
  const wipeRes = await c.post("/api/admin/wipe-with-characters", { confirm: "WIPE WITH CHARACTERS" });
  assert.equal(wipeRes.status, 200, `Wipe must succeed: ${JSON.stringify(wipeRes.body)}`);

  // Log in again with a fresh client (simulates admin returning after the wipe)
  const c2 = client();
  const loginRes = await c2.login(adminUser.email, adminUser.password);
  assert.equal(loginRes.status, 200, "Admin must be able to log in after wipe-with-characters");

  // Confirm admin access by attempting an admin-only route with wrong confirm text.
  // A 400 response means the route authenticated the user as admin and only rejected
  // the confirmation text — proving admin access is intact.
  // A 403 response would mean the admin role was lost (the bug this test guards against).
  const adminCheckRes = await c2.post("/api/admin/wipe-with-characters", { confirm: "wrong" });
  assert.equal(
    adminCheckRes.status,
    400,
    `Admin must receive 400 (wrong confirm) not 403 (lost admin role) after wipe — got: ${adminCheckRes.status}`
  );
});

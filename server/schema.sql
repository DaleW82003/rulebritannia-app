-- Legacy single-row state table (kept for migration; superseded by state_snapshots)
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable versioned snapshots of game state
CREATE TABLE IF NOT EXISTS state_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  label TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL
);

-- Single-row pointer to the active snapshot
CREATE TABLE IF NOT EXISTS app_state_current (
  id TEXT PRIMARY KEY,
  snapshot_id UUID REFERENCES state_snapshots(id)
);

-- Bills (orderPaperCommons items)
CREATE TABLE IF NOT EXISTS bills (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Motions (house and EDM)
CREATE TABLE IF NOT EXISTS motions (
  id          TEXT PRIMARY KEY,
  motion_type TEXT NOT NULL DEFAULT 'house',
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Statements
CREATE TABLE IF NOT EXISTS statements (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Regulations
CREATE TABLE IF NOT EXISTS regulations (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Question Time questions (legacy JSONB cache — kept for backwards compat)
CREATE TABLE IF NOT EXISTS questiontime_questions (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Simulation clock (single authoritative row)
CREATE TABLE IF NOT EXISTS sim_clock (
  id                TEXT PRIMARY KEY,
  sim_current_month INTEGER NOT NULL DEFAULT 8,
  sim_current_year  INTEGER NOT NULL DEFAULT 1997,
  real_last_tick    TIMESTAMPTZ,
  rate              INTEGER NOT NULL DEFAULT 1
);

-- Simulation state (extended: pause flag + canonical year/month)
CREATE TABLE IF NOT EXISTS sim_state (
  id           TEXT PRIMARY KEY DEFAULT 'main',
  year         INTEGER NOT NULL DEFAULT 1997,
  month        INTEGER NOT NULL DEFAULT 8,
  is_paused    BOOLEAN NOT NULL DEFAULT false,
  last_tick_at TIMESTAMPTZ
);

-- Canonical user roles (admin/mod/speaker, party membership, government offices)
CREATE TABLE IF NOT EXISTS user_roles (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role)
);
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles (user_id);

-- Audit log for admin/mod actions (enhanced with entity columns)
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  before_json JSONB,
  after_json  JSONB,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx   ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx  ON audit_log (action);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

-- Characters (player/NPC characters in the simulation)
CREATE TABLE IF NOT EXISTS characters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  party        TEXT NOT NULL DEFAULT '',
  constituency TEXT NOT NULL DEFAULT '',
  roles        JSONB NOT NULL DEFAULT '[]'::jsonb,
  offices      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS characters_user_idx ON characters (user_id);
CREATE INDEX IF NOT EXISTS characters_name_idx ON characters (name);

-- Offices (cabinet, shadow, parliamentary, other)
CREATE TABLE IF NOT EXISTS offices (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'parliamentary'
);

-- Office assignments (character → office)
CREATE TABLE IF NOT EXISTS office_assignments (
  id           BIGSERIAL PRIMARY KEY,
  office_id    TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (office_id, character_id)
);
CREATE INDEX IF NOT EXISTS office_assignments_office_idx    ON office_assignments (office_id);
CREATE INDEX IF NOT EXISTS office_assignments_character_idx ON office_assignments (character_id);

-- Divisions (generic voting engine)
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
CREATE INDEX IF NOT EXISTS divisions_entity_idx ON divisions (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS divisions_status_idx ON divisions (status);

-- Division votes
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

-- Structured Question Time: questions
CREATE TABLE IF NOT EXISTS qt_questions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id             TEXT NOT NULL,
  asked_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  asked_by_name         TEXT NOT NULL DEFAULT '',
  asked_by_role         TEXT NOT NULL DEFAULT 'backbencher',
  text                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open',
  asked_at_sim          TEXT NOT NULL DEFAULT '',
  due_at_sim            TEXT NOT NULL DEFAULT '',
  speaker_demand_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qt_questions_office_idx ON qt_questions (office_id);
CREATE INDEX IF NOT EXISTS qt_questions_status_idx ON qt_questions (status);

-- Structured Question Time: answers
CREATE TABLE IF NOT EXISTS qt_answers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id              UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
  answered_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  answered_by_name         TEXT NOT NULL DEFAULT '',
  text                     TEXT NOT NULL,
  answered_at_sim          TEXT NOT NULL DEFAULT '',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Structured Question Time: follow-ups
CREATE TABLE IF NOT EXISTS qt_followups (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id           UUID NOT NULL REFERENCES qt_questions(id) ON DELETE CASCADE,
  asked_by_character_id UUID REFERENCES characters(id) ON DELETE SET NULL,
  asked_by_name         TEXT NOT NULL DEFAULT '',
  asked_by_role         TEXT NOT NULL DEFAULT 'backbencher',
  text                  TEXT NOT NULL,
  answer                TEXT NOT NULL DEFAULT '',
  answered_by_name      TEXT NOT NULL DEFAULT '',
  asked_at_sim          TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qt_followups_question_idx ON qt_followups (question_id);


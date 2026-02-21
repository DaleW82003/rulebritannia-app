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

-- Question Time questions
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

-- Audit log for admin/mod actions
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx   ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx  ON audit_log (action);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

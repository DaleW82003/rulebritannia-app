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

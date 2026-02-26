-- Migration: 0001_add_discourse_topic_fields
-- Adds canonical discourse_topic_id and discourse_topic_url columns to all
-- parliamentary content tables so that Discourse topic links are stored at
-- the column level (not only inside the JSONB data blob).
--
-- All statements use ADD COLUMN IF NOT EXISTS so the migration is idempotent
-- and safe to run on both fresh and existing databases.

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT,
  ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT;

ALTER TABLE motions
  ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT,
  ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT;

ALTER TABLE statements
  ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT,
  ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT;

ALTER TABLE regulations
  ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT,
  ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT;

ALTER TABLE questiontime_questions
  ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT,
  ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT;

ALTER TABLE press_items
  ADD COLUMN IF NOT EXISTS discourse_topic_id  TEXT,
  ADD COLUMN IF NOT EXISTS discourse_topic_url TEXT;

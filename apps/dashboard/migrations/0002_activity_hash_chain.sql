-- =============================================================================
-- Tamper-evident durable activity chain: schema preparation
-- =============================================================================
-- `pnpm db:migrate` runs the transaction-bound TypeScript data backfill after
-- this SQL and before recording the migration. The backfill hashes existing
-- rows in deterministic (timestamp, id) order, initializes the singleton head,
-- and then makes all three activity chain columns NOT NULL.
-- =============================================================================

ALTER TABLE activity_events
  ADD COLUMN IF NOT EXISTS chain_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS previous_hash TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_chain_sequence
  ON activity_events(chain_sequence);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activity_events_chain_sequence_positive'
      AND conrelid = 'activity_events'::regclass
  ) THEN
    ALTER TABLE activity_events
      ADD CONSTRAINT activity_events_chain_sequence_positive
      CHECK (chain_sequence IS NULL OR chain_sequence > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activity_events_previous_hash_format'
      AND conrelid = 'activity_events'::regclass
  ) THEN
    ALTER TABLE activity_events
      ADD CONSTRAINT activity_events_previous_hash_format
      CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'activity_events_entry_hash_format'
      AND conrelid = 'activity_events'::regclass
  ) THEN
    ALTER TABLE activity_events
      ADD CONSTRAINT activity_events_entry_hash_format
      CHECK (entry_hash IS NULL OR entry_hash ~ '^[0-9a-f]{64}$');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS activity_chain_head (
  scope           TEXT PRIMARY KEY,
  last_sequence   BIGINT NOT NULL,
  last_hash       TEXT NOT NULL,
  last_entry_id   TEXT,
  CONSTRAINT activity_chain_head_global_scope
    CHECK (scope = 'global'),
  CONSTRAINT activity_chain_head_sequence_non_negative
    CHECK (last_sequence >= 0),
  CONSTRAINT activity_chain_head_hash_format
    CHECK (last_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT activity_chain_head_empty_state
    CHECK (
      (last_sequence = 0
        AND last_hash = repeat('0', 64)
        AND last_entry_id IS NULL)
      OR
      (last_sequence > 0 AND last_entry_id IS NOT NULL)
    )
);

INSERT INTO activity_chain_head (
  scope,
  last_sequence,
  last_hash,
  last_entry_id
) VALUES (
  'global',
  0,
  repeat('0', 64),
  NULL
)
ON CONFLICT (scope) DO NOTHING;

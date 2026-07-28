-- =============================================================================
-- GuildPass Dashboard — Activity Guild Scope Migration
-- =============================================================================
-- Adds guild_id to activity_events so activity reads/writes can be scoped by
-- tenant at the repository layer, matching passes/members (see
-- docs/multi-tenancy.md). Idempotent: safe to run multiple times.
--
-- Nullable by design: pre-existing rows predate per-guild tagging and have no
-- reliable guild to backfill to. They remain visible only to unscoped
-- workspace-wide callers; every new write goes through IActivityRepository,
-- which requires guild_id at the application layer.
-- =============================================================================

BEGIN;

ALTER TABLE activity_events
  ADD COLUMN IF NOT EXISTS guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_activity_guild_id
  ON activity_events(guild_id);

CREATE INDEX IF NOT EXISTS idx_activity_guild_type_ts
  ON activity_events(guild_id, type, timestamp DESC);

COMMIT;

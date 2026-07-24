-- =============================================================================
-- GuildPass Dashboard — Initial Schema Migration
-- =============================================================================
-- Idempotent: safe to run multiple times against the same database.
-- All DDL uses IF NOT EXISTS / IF EXISTS guards.
-- =============================================================================

BEGIN;

-- ── Guilds ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guilds (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  member_count  INTEGER NOT NULL DEFAULT 0,
  pass_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Passes ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passes (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('active', 'inactive', 'draft')),
  price           DOUBLE PRECISION,
  max_supply      INTEGER,
  current_supply  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passes_guild_id ON passes(guild_id);
CREATE INDEX IF NOT EXISTS idx_passes_guild_status ON passes(guild_id, status);

-- ── Members ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  guild_id    TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  wallet      TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('active', 'inactive', 'pending')),
  roles       JSONB NOT NULL DEFAULT '[]'::JSONB,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version     INTEGER NOT NULL DEFAULT 1
);

-- Wallet uniqueness is per-guild, not global.
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_guild_wallet
  ON members(guild_id, wallet);

CREATE INDEX IF NOT EXISTS idx_members_guild_id ON members(guild_id);
CREATE INDEX IF NOT EXISTS idx_members_guild_status ON members(guild_id, status);

-- ── Activity Events (append-only audit log) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_events (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  source          TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info',
  actor           JSONB NOT NULL DEFAULT '{}'::JSONB,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description     TEXT NOT NULL DEFAULT '',
  entity          JSONB,
  metadata        JSONB,
  changes         JSONB,
  schema_version  INTEGER NOT NULL DEFAULT 2
);

CREATE INDEX IF NOT EXISTS idx_activity_type_ts
  ON activity_events(type, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_activity_ts
  ON activity_events(timestamp DESC);

-- ── Processed Events (webhook idempotency) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS processed_events (
  event_id      TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS idx_processed_events_expires_at
  ON processed_events(expires_at);

-- ── Settings (singleton row) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  id                        TEXT PRIMARY KEY DEFAULT 'default',
  workspace_name            TEXT NOT NULL DEFAULT 'GuildPass DAO',
  timezone                  TEXT NOT NULL DEFAULT 'UTC',
  display_name              TEXT NOT NULL DEFAULT 'Admin',
  email                     TEXT NOT NULL DEFAULT 'admin@guildpass.xyz',
  webhook_forwarding_secret TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure at least one settings row exists.
INSERT INTO settings (id) VALUES ('default') ON CONFLICT DO NOTHING;

COMMIT;

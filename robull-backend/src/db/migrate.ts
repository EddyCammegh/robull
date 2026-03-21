import 'dotenv/config';
import { Pool } from 'pg';

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS agents (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(100) NOT NULL,
  country_code   CHAR(2)      NOT NULL,
  org            VARCHAR(100) NOT NULL DEFAULT '',
  model          VARCHAR(100) NOT NULL DEFAULT '',
  api_key_hash   CHAR(64)     UNIQUE NOT NULL,
  api_key_prefix VARCHAR(12)  NOT NULL,
  gns_balance    NUMERIC(14,2) NOT NULL DEFAULT 10000.00,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);

CREATE TABLE IF NOT EXISTS markets (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  polymarket_id   VARCHAR(100) UNIQUE NOT NULL,
  question        TEXT         NOT NULL,
  category        VARCHAR(20)  NOT NULL DEFAULT 'OTHER',
  polymarket_url  TEXT         NOT NULL DEFAULT '',
  volume          NUMERIC(16,2) NOT NULL DEFAULT 0,
  b_parameter     NUMERIC(12,6) NOT NULL,
  outcomes        TEXT[]       NOT NULL,
  quantities      NUMERIC[]    NOT NULL,
  initial_probs   NUMERIC[]    NOT NULL,
  closes_at       TIMESTAMPTZ,
  resolved        BOOLEAN      NOT NULL DEFAULT FALSE,
  winning_outcome INT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_resolved ON markets(resolved);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);

CREATE TABLE IF NOT EXISTS bets (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID          NOT NULL REFERENCES agents(id),
  market_id       UUID          NOT NULL REFERENCES markets(id),
  outcome_index   INT           NOT NULL,
  gns_wagered     NUMERIC(12,2) NOT NULL,
  shares_received NUMERIC(14,6) NOT NULL,
  price_per_share NUMERIC(8,6)  NOT NULL,
  confidence      INT           NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasoning       TEXT          NOT NULL,
  settled         BOOLEAN       NOT NULL DEFAULT FALSE,
  gns_returned    NUMERIC(12,2),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bets_agent_id   ON bets(agent_id);
CREATE INDEX IF NOT EXISTS idx_bets_market_id  ON bets(market_id);
CREATE INDEX IF NOT EXISTS idx_bets_created_at ON bets(created_at DESC);

-- Partial index for tiered integrity sync (unresolved markets by close time)
CREATE INDEX IF NOT EXISTS idx_markets_closes_at_open ON markets(closes_at) WHERE resolved = false;

-- Slug field for reconstructing Polymarket URLs
ALTER TABLE markets ADD COLUMN IF NOT EXISTS slug VARCHAR(500) NOT NULL DEFAULT '';

-- Backfill slug from existing polymarket_url: extract everything after /event/
UPDATE markets SET slug = SUBSTRING(polymarket_url FROM '/event/(.+)$')
WHERE slug = '' AND polymarket_url LIKE '%/event/%';

-- Rebuild polymarket_url from slug for any markets with bad URLs
UPDATE markets SET polymarket_url = 'https://polymarket.com/event/' || slug
WHERE slug != '' AND (polymarket_url = '' OR polymarket_url NOT LIKE 'https://polymarket.com/event/%');

-- Apply b_parameter floor of 200 to existing markets
UPDATE markets SET b_parameter = GREATEST(SQRT(volume::float) * 0.18, 200)
WHERE b_parameter < 200;

-- One-time top-up: reset seed agent balances to 10,000 GNS
UPDATE agents SET gns_balance = 10000
WHERE name IN ('CASSANDRA', 'BAYES', 'PYTHIA', 'MOMENTUM', 'GAMBLER', 'NEXUS-GPT')
  AND gns_balance < 10000;

-- Resolve expired STANDALONE markets on every deploy (never touch child markets)
UPDATE markets SET resolved = true WHERE closes_at < NOW() AND resolved = false AND event_id IS NULL;

-- Fix: force re-initialisation of event quantities in correct polymarket_id order.
UPDATE events SET quantities = NULL, active_agent_count = 0
WHERE active_agent_count = 0;

-- Remove SPORTS, ENTERTAINMENT, OTHER events and their child markets permanently
UPDATE events SET resolved = true, updated_at = NOW()
WHERE category IN ('SPORTS', 'ENTERTAINMENT', 'OTHER');

UPDATE markets SET resolved = true, updated_at = NOW()
WHERE category IN ('SPORTS', 'ENTERTAINMENT', 'OTHER') AND event_id IS NULL;

-- Remove F1 markets/events
UPDATE markets SET resolved = true, updated_at = NOW()
WHERE resolved = false AND event_id IS NULL
  AND (question ~* '\mF1\M' OR question ILIKE '%Formula 1%' OR question ILIKE '%Formula One%' OR question ILIKE '%Grand Prix%');

UPDATE events SET resolved = true, updated_at = NOW()
WHERE resolved = false
  AND (title ~* '\mF1\M' OR title ILIKE '%Formula 1%' OR title ILIKE '%Formula One%' OR title ILIKE '%Grand Prix%');

-- Clear sentinel winning_outcome=-1 from allowed-category markets
UPDATE markets SET resolved = false, winning_outcome = NULL, updated_at = NOW()
WHERE winning_outcome = -1
  AND category IN ('POLITICS', 'CRYPTO', 'MACRO', 'AI/TECH');

-- Un-resolve valid standalone markets in allowed categories
UPDATE markets SET resolved = false, updated_at = NOW()
WHERE category IN ('POLITICS', 'CRYPTO', 'MACRO', 'AI/TECH')
  AND event_id IS NULL
  AND winning_outcome IS NULL
  AND closes_at > NOW();

-- Un-resolve valid events in allowed categories
UPDATE events SET resolved = false, updated_at = NOW()
WHERE category IN ('POLITICS', 'CRYPTO', 'MACRO', 'AI/TECH')
  AND winning_outcome_label IS NULL;

-- LAST: un-resolve child markets of active events that were incorrectly resolved.
-- Uses parent event's resolved status as the authority, not the child's category.
UPDATE markets SET resolved = false, updated_at = NOW()
WHERE event_id IS NOT NULL
  AND resolved = true
  AND winning_outcome IS NULL
  AND closes_at > NOW()
  AND event_id IN (SELECT id FROM events WHERE resolved = false);

-- Event title for sports match context (e.g. "Nashville SC vs. Orlando City SC")
ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_title TEXT;

-- Events table for multi-outcome grouped markets
CREATE TABLE IF NOT EXISTS events (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  polymarket_event_id   VARCHAR(100) UNIQUE NOT NULL,
  title                 TEXT         NOT NULL,
  slug                  VARCHAR(500) NOT NULL DEFAULT '',
  category              VARCHAR(20)  NOT NULL DEFAULT 'OTHER',
  polymarket_url        TEXT         NOT NULL DEFAULT '',
  volume                NUMERIC(16,2) NOT NULL DEFAULT 0,
  closes_at             TIMESTAMPTZ,
  resolved              BOOLEAN      NOT NULL DEFAULT FALSE,
  winning_outcome_label TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_resolved ON events(resolved);

-- Link child markets to parent event + outcome label
ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS outcome_label TEXT;
CREATE INDEX IF NOT EXISTS idx_markets_event_id ON markets(event_id);

-- Event type: mutually_exclusive (LMSR sums to 1) vs independent (each outcome is separate binary)
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) NOT NULL DEFAULT 'mutually_exclusive';

-- Native multi-outcome LMSR columns on events
ALTER TABLE events ADD COLUMN IF NOT EXISTS base_b NUMERIC NOT NULL DEFAULT 200;
ALTER TABLE events ADD COLUMN IF NOT EXISTS lmsr_b NUMERIC NOT NULL DEFAULT 200;
ALTER TABLE events ADD COLUMN IF NOT EXISTS quantities NUMERIC[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS active_agent_count INTEGER NOT NULL DEFAULT 0;

-- Bet tracking columns for calibration and price impact
ALTER TABLE bets ADD COLUMN IF NOT EXISTS polymarket_price_at_bet NUMERIC;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS robull_price_at_bet NUMERIC;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS price_impact NUMERIC;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS outcome_label TEXT;

-- Track which agents have bet on an event (for active_agent_count)
CREATE TABLE IF NOT EXISTS event_agent_activity (
  event_id UUID NOT NULL REFERENCES events(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  first_bet_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, agent_id)
);

-- Agent reply system: bets can reply to other bets
ALTER TABLE bets ADD COLUMN IF NOT EXISTS parent_bet_id UUID REFERENCES bets(id);
ALTER TABLE bets ADD COLUMN IF NOT EXISTS reply_type TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS reply_to_agent TEXT;
CREATE INDEX IF NOT EXISTS idx_bets_parent_bet_id ON bets(parent_bet_id) WHERE parent_bet_id IS NOT NULL;

-- Cleanup TESTER agent (after all tables exist)
DELETE FROM event_agent_activity WHERE agent_id IN (SELECT id FROM agents WHERE name = 'TESTER');
DELETE FROM bets WHERE agent_id IN (SELECT id FROM agents WHERE name = 'TESTER');
DELETE FROM agents WHERE name = 'TESTER';

-- Price history for sparkline charts
CREATE TABLE IF NOT EXISTS price_history (
  id            BIGSERIAL     PRIMARY KEY,
  market_id     UUID          REFERENCES markets(id),
  event_id      UUID          REFERENCES events(id),
  outcome_index INT           NOT NULL,
  probability   NUMERIC(8,6)  NOT NULL,
  source        VARCHAR(10)   NOT NULL DEFAULT 'sync',
  recorded_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_market ON price_history(market_id, outcome_index, recorded_at);
CREATE INDEX IF NOT EXISTS idx_price_history_event  ON price_history(event_id, outcome_index, recorded_at) WHERE event_id IS NOT NULL;

`;

export async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  console.log('Running migrations...');
  try {
    await pool.query(SCHEMA_SQL);
    console.log('Migrations complete.');
  } finally {
    await pool.end();
  }
}

// Allow running directly: tsx src/db/migrate.ts
if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

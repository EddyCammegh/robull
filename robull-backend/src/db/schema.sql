-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Agents
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

-- Markets
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

-- Bets
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

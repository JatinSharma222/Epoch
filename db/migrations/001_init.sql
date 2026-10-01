CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS indexer_cursor (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_signature text,
  last_slot      bigint
);

-- Append-only source of truth for derived tables
CREATE TABLE IF NOT EXISTS events_raw (
  signature   text     NOT NULL,
  ix_index    integer  NOT NULL,
  event_index integer  NOT NULL,
  slot        bigint   NOT NULL,
  block_time  timestamptz,
  name        text     NOT NULL,
  data        jsonb    NOT NULL,
  PRIMARY KEY (signature, ix_index, event_index)
);
CREATE INDEX IF NOT EXISTS events_raw_slot_idx ON events_raw (slot);
CREATE INDEX IF NOT EXISTS events_raw_name_idx ON events_raw (name);

CREATE TABLE IF NOT EXISTS batches (
  batch_id            bigint PRIMARY KEY,
  status              text   NOT NULL CHECK (status IN ('CLEARED','VOID','SETTLED')),
  clear_slot          bigint NOT NULL,
  clear_signature     text   NOT NULL,
  oracle_price        bigint,
  oracle_conf         bigint,
  clearing_offset_bps integer,
  clearing_price      bigint,
  matched_lots        bigint NOT NULL DEFAULT 0,
  num_orders          integer NOT NULL DEFAULT 0,
  void_reason         text,
  ticks_reconstructed boolean NOT NULL DEFAULT false,
  settled_slot        bigint,
  indexed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_ticks (
  batch_id bigint   NOT NULL REFERENCES batches (batch_id) ON DELETE CASCADE,
  tick     smallint NOT NULL,
  bid_qty  bigint   NOT NULL,
  ask_qty  bigint   NOT NULL,
  PRIMARY KEY (batch_id, tick)
);

CREATE TABLE IF NOT EXISTS orders (
  batch_id         bigint   NOT NULL,
  user_pubkey      text     NOT NULL,
  slot_id          smallint NOT NULL,
  side             text     NOT NULL CHECK (side IN ('BUY','SELL')),
  tick             smallint NOT NULL,
  lots             bigint   NOT NULL,
  filled_lots      bigint   NOT NULL DEFAULT 0,
  revisions        integer  NOT NULL DEFAULT 1,
  cancelled        boolean  NOT NULL DEFAULT false,
  placed_slot      bigint   NOT NULL,
  placed_signature text     NOT NULL,
  PRIMARY KEY (batch_id, user_pubkey, slot_id)
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_pubkey, batch_id DESC);

CREATE TABLE IF NOT EXISTS fills (
  batch_id         bigint NOT NULL,
  user_pubkey      text   NOT NULL,
  fill_lots        bigint NOT NULL,
  price            bigint NOT NULL,
  notional         bigint NOT NULL,
  fee              bigint NOT NULL,
  settle_slot      bigint NOT NULL,
  settle_signature text   NOT NULL,
  PRIMARY KEY (batch_id, user_pubkey)
);
CREATE INDEX IF NOT EXISTS fills_user_idx ON fills (user_pubkey, batch_id DESC);

CREATE TABLE IF NOT EXISTS funding (
  batch_id      bigint PRIMARY KEY,
  funding_index numeric(40,0) NOT NULL,
  rate_bps      numeric       NOT NULL
);

CREATE TABLE IF NOT EXISTS liquidations (            -- stretch
  batch_id    bigint NOT NULL,
  user_pubkey text   NOT NULL,
  penalty     bigint NOT NULL,
  bad_debt    bigint NOT NULL DEFAULT 0,
  signature   text   NOT NULL,
  PRIMARY KEY (batch_id, user_pubkey)
);

-- Written by the keeper (and load generator). Feeds the Evidence page.
CREATE TABLE IF NOT EXISTS tx_log (
  signature    text PRIMARY KEY,
  kind         text NOT NULL,          -- e.g. clear_batch, settle_users, place_order, landing_test
  source       text NOT NULL,          -- keeper | loadgen | landing_test
  network      text NOT NULL,          -- devnet | mainnet | local
  method       text,                   -- e.g. public_rpc, priority_fee
  submit_slot  bigint,
  landed_slot  bigint,
  cu_consumed  integer,
  success      boolean NOT NULL,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW v_landing_stats AS
SELECT network, kind, method, count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY landed_slot - submit_slot) AS p50_slots,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY landed_slot - submit_slot) AS p90_slots,
       max(landed_slot - submit_slot) AS max_slots
FROM tx_log
WHERE success AND submit_slot IS NOT NULL AND landed_slot IS NOT NULL
GROUP BY network, kind, method;

CREATE OR REPLACE VIEW v_cu_stats AS
SELECT network, kind, count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY cu_consumed) AS p50_cu,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY cu_consumed) AS p90_cu,
       max(cu_consumed) AS max_cu
FROM tx_log
WHERE success AND cu_consumed IS NOT NULL
GROUP BY network, kind;

INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT DO NOTHING;

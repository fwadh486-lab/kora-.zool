CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  subscription TEXT NOT NULL,
  preferences TEXT NOT NULL,
  updated INTEGER NOT NULL,
  last_test INTEGER NOT NULL DEFAULT 0,
  test_due INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS match_state (
  fixture_id TEXT PRIMARY KEY,
  match_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_json TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  sent INTEGER NOT NULL,
  PRIMARY KEY (event_id, device_id)
);
CREATE INDEX IF NOT EXISTS events_created ON events(created);
CREATE INDEX IF NOT EXISTS match_state_updated ON match_state(updated);
CREATE INDEX IF NOT EXISTS deliveries_sent ON deliveries(sent);
CREATE TABLE IF NOT EXISTS service_state (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

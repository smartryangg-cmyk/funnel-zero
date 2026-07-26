CREATE TABLE asset_upload_parts (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK(part_number BETWEEN 1 AND 10000),
  etag TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(asset_id, part_number)
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  anonymous_id TEXT,
  offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
  funnel_id TEXT REFERENCES funnels(id) ON DELETE SET NULL,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  name TEXT,
  email TEXT,
  consent INTEGER NOT NULL DEFAULT 0 CHECK(consent IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_offer_time ON leads(offer_id, created_at DESC);

CREATE TABLE integration_diagnostics (
  id TEXT PRIMARY KEY,
  offer_id TEXT REFERENCES offers(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok', 'warning', 'error')),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_integration_diagnostics_offer ON integration_diagnostics(offer_id, last_checked_at DESC);

INSERT OR IGNORE INTO installation_settings(key, value_json) VALUES
  ('domain_provider', '{"configured":false,"accountId":"","workerName":""}'),
  ('tracking', '{"anonymize":true,"batchSize":20,"retentionDays":90}'),
  ('custom_scripts', '{"enabled":false,"acknowledgedRisk":false}');

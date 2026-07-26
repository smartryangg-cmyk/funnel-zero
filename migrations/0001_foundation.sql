PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK(password_iterations >= 100000),
  role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner', 'admin', 'editor', 'analyst')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  disabled_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent_hash TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_sessions_user_active ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_token ON sessions(token_hash);

CREATE TABLE setup_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);
CREATE INDEX idx_setup_tokens_active ON setup_tokens(expires_at) WHERE used_at IS NULL;

CREATE TABLE installation_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  identity_hash TEXT NOT NULL,
  succeeded INTEGER NOT NULL DEFAULT 0 CHECK(succeeded IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts_window ON login_attempts(identity_hash, created_at);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
  checkout_url TEXT,
  pixel_config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(pixel_config_json)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_offers_status ON offers(status, updated_at);

CREATE TABLE funnels (
  id TEXT PRIMARY KEY,
  offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
  graph_version INTEGER NOT NULL DEFAULT 1,
  graph_json TEXT NOT NULL DEFAULT '{"version":1,"nodes":[],"edges":[]}' CHECK(json_valid(graph_json)),
  published_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_funnels_offer_status ON funnels(offer_id, status);

CREATE TABLE funnel_nodes (
  id TEXT PRIMARY KEY,
  funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metrics_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_funnel_nodes_funnel ON funnel_nodes(funnel_id);

CREATE TABLE funnel_edges (
  id TEXT PRIMARY KEY,
  funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES funnel_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES funnel_nodes(id) ON DELETE CASCADE,
  label TEXT,
  config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(funnel_id, source_node_id, target_node_id)
);
CREATE INDEX idx_funnel_edges_funnel ON funnel_edges(funnel_id);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  funnel_id TEXT REFERENCES funnels(id) ON DELETE CASCADE,
  offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  page_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
  published_version_id TEXT,
  published_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(funnel_id, slug)
);
CREATE INDEX idx_pages_public_route ON pages(funnel_id, slug, status);

CREATE TABLE page_drafts (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE page_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(page_id, version_number)
);
CREATE INDEX idx_page_versions_page ON page_versions(page_id, version_number DESC);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  is_system INTEGER NOT NULL DEFAULT 1 CHECK(is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'document')),
  mime_type TEXT NOT NULL,
  extension TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  sha256 TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK(upload_status IN ('pending', 'uploading', 'ready', 'failed', 'deleting')),
  multipart_upload_id TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_assets_offer_status ON assets(offer_id, upload_status);
CREATE INDEX idx_assets_hash ON assets(sha256) WHERE deleted_at IS NULL;

CREATE TABLE domains (
  id TEXT PRIMARY KEY,
  funnel_id TEXT REFERENCES funnels(id) ON DELETE SET NULL,
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'validating', 'active', 'failed')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
  provider_config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provider_config_json)),
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tracking_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  anonymous_id TEXT,
  session_key TEXT,
  offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
  funnel_id TEXT REFERENCES funnels(id) ON DELETE SET NULL,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  variant_id TEXT,
  source TEXT,
  campaign TEXT,
  utm_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(utm_json)),
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(properties_json)),
  dedupe_key TEXT UNIQUE
);
CREATE INDEX idx_tracking_events_funnel_time ON tracking_events(funnel_id, occurred_at);
CREATE INDEX idx_tracking_events_offer_type_time ON tracking_events(offer_id, event_type, occurred_at);
CREATE INDEX idx_tracking_events_anonymous ON tracking_events(anonymous_id, occurred_at);

CREATE TABLE tracking_aggregates (
  bucket_date TEXT NOT NULL,
  offer_id TEXT NOT NULL DEFAULT '',
  funnel_id TEXT NOT NULL DEFAULT '',
  variant_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  unique_count INTEGER NOT NULL DEFAULT 0,
  value_sum REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(bucket_date, offer_id, funnel_id, variant_id, event_type)
);

CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'running', 'paused', 'completed')),
  winning_variant_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE experiment_variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK(weight BETWEEN 0 AND 10000),
  page_version_id TEXT REFERENCES page_versions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_experiment_variants_experiment ON experiment_variants(experiment_id, status);

CREATE TABLE checkout_integrations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  parameter_map_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(parameter_map_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  checkout_integration_id TEXT NOT NULL REFERENCES checkout_integrations(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  last_event_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted', 'rejected', 'duplicate')),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(webhook_id, external_event_id)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_logs_time ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);

INSERT INTO installation_settings(key, value_json) VALUES
  ('installation', '{"installed":false,"version":"0.1.0","installedAt":null}'),
  ('free_only', '{"enabled":true,"storageLimitBytes":10737418240,"fileLimitBytes":524288000,"alerts":[70,85,95]}'),
  ('retention', '{"trackingDays":90,"auditDays":365}');

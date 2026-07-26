PRAGMA foreign_keys = ON;

CREATE TABLE password_recovery_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);

CREATE INDEX idx_password_recovery_tokens_active
  ON password_recovery_tokens(user_id, expires_at)
  WHERE used_at IS NULL;

CREATE UNIQUE INDEX idx_users_single_active_owner
  ON users(role)
  WHERE role = 'owner' AND disabled_at IS NULL;

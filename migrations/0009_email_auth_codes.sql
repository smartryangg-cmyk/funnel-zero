-- Migration 0009: Email Auth Codes & Password Reset
CREATE TABLE IF NOT EXISTS email_auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  code_display TEXT,
  used_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_auth_codes_email ON email_auth_codes(email);

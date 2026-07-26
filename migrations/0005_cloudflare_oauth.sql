CREATE TABLE cloudflare_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_verifier_ciphertext TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/domains',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cloudflare_oauth_states_expiry
  ON cloudflare_oauth_states(expires_at, used_at);

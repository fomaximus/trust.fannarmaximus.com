CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  creator_token TEXT NOT NULL UNIQUE,
  invitee_token TEXT NOT NULL UNIQUE,
  creator_name TEXT NOT NULL,
  invitee_name TEXT NOT NULL,
  creator_scores TEXT NOT NULL,
  invitee_scores TEXT,
  invitee_submitted_at INTEGER,
  creator_ip_hash TEXT NOT NULL
);
CREATE INDEX sessions_ip_created ON sessions (creator_ip_hash, created_at);
CREATE INDEX sessions_expires ON sessions (expires_at);

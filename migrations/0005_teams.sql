CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revealed_at INTEGER
);
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  token TEXT UNIQUE,
  nickname TEXT NOT NULL,
  is_creator INTEGER NOT NULL DEFAULT 0,
  scores TEXT,
  submitted_at INTEGER
);
CREATE INDEX members_team ON members (team_id);
CREATE INDEX teams_expires ON teams (expires_at);
-- Anonymised team ratings: one row per answered member, grouped by a random key.
CREATE TABLE team_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_key TEXT NOT NULL,
  day TEXT NOT NULL,
  size INTEGER NOT NULL,
  c INTEGER NOT NULL, r INTEGER NOT NULL, i INTEGER NOT NULL, s INTEGER NOT NULL,
  t REAL NOT NULL
);

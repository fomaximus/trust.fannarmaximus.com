-- Two-team mode replaces the one-team tables, which never held real data.
DROP TABLE IF EXISTS team_stats;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS teams;

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revealed_at INTEGER,
  b_captain_token TEXT UNIQUE
);
CREATE INDEX matches_expires ON matches (expires_at);

CREATE TABLE sides (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  label TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE INDEX sides_match ON sides (match_id);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  side_id TEXT NOT NULL,
  token TEXT UNIQUE,
  nickname TEXT NOT NULL,
  is_captain INTEGER NOT NULL DEFAULT 0,
  scores TEXT,
  submitted_at INTEGER
);
CREATE INDEX members_side ON members (side_id);

-- Anonymised ratings: one row per answered member; side is the rater's side.
CREATE TABLE match_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key TEXT NOT NULL,
  side TEXT NOT NULL,
  day TEXT NOT NULL,
  size INTEGER NOT NULL,
  c INTEGER NOT NULL, r INTEGER NOT NULL, i INTEGER NOT NULL, s INTEGER NOT NULL, t REAL NOT NULL,
  pc INTEGER NOT NULL, pr INTEGER NOT NULL, pi INTEGER NOT NULL, ps INTEGER NOT NULL, pt REAL NOT NULL
);

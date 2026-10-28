-- Creation log for the per-address rate limit. Deleting a session does not touch it; rows are pruned by age.
CREATE TABLE creations (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX creations_ip_created ON creations (ip_hash, created_at);

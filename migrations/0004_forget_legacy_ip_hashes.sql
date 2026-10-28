-- Sessions created before the creation log existed still hold an ip hash; forget it.
UPDATE sessions SET creator_ip_hash = '' WHERE creator_ip_hash != '';

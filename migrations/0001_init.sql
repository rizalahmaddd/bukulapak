CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  shard INTEGER NOT NULL DEFAULT 0,
  migrate_until INTEGER,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  google_sub TEXT UNIQUE,
  google_email TEXT,
  pw_salt TEXT,
  pw_verifier TEXT,
  recovery_verifier TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, tenant_id)
) WITHOUT ROWID;

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  tenant_id TEXT,
  role TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- seq doubles as the pull cursor; AUTOINCREMENT keeps it monotonic after deletes
CREATE TABLE records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX records_tenant_id ON records (tenant_id, id);
CREATE INDEX records_tenant_seq ON records (tenant_id, seq);

CREATE TABLE usage (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  entries INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
) WITHOUT ROWID;

CREATE TABLE system (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

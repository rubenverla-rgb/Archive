-- Archive: databaseschema voor Cloudflare D1 (SQLite)

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  salt        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  prefs       TEXT NOT NULL DEFAULT '{}',
  ws_rev      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Beperkt pogingen (inloggen/registreren)
CREATE TABLE IF NOT EXISTS throttle (
  key       TEXT PRIMARY KEY,
  n         INTEGER NOT NULL,
  reset_at  INTEGER NOT NULL
);

-- Persoonlijke gegevens per gebruiker: collections, media, notes, quotes, reading, groups (JSON per soort)
CREATE TABLE IF NOT EXISTS workspace (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  data     TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- Gedeelde collecties (meerdere gebruikers)
CREATE TABLE IF NOT EXISTS shared_collections (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  desc        TEXT NOT NULL DEFAULT '',
  cover       TEXT NOT NULL DEFAULT '',
  ln          TEXT NOT NULL DEFAULT '',
  rev         INTEGER NOT NULL DEFAULT 1,
  media       TEXT NOT NULL DEFAULT '[]',
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_owner ON shared_collections(owner_id);

CREATE TABLE IF NOT EXISTS members (
  collection_id  TEXT NOT NULL REFERENCES shared_collections(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS invites (
  token          TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES shared_collections(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_email ON invites(email);
CREATE INDEX IF NOT EXISTS invites_col ON invites(collection_id);

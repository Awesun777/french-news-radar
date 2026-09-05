// Shared Postgres pool + schema for News Radar.
const { Pool } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. On Railway, add a Postgres database and a\n" +
      'variable reference DATABASE_URL = ${{Postgres.DATABASE_URL}} on this service.'
  );
  process.exit(1);
}

// Railway's internal network and local dev need no TLS; the public proxy does,
// but with a cert that isn't in the default trust store.
const ssl = /railway\.internal|localhost|127\.0\.0\.1/.test(url)
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({ connectionString: url, ssl });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feeds (
  name         text PRIMARY KEY,
  generated_at text
);
CREATE TABLE IF NOT EXISTS digest_days (
  feed        text NOT NULL REFERENCES feeds(name),
  date        text NOT NULL,
  index_entry jsonb NOT NULL,
  day_meta    jsonb NOT NULL,
  PRIMARY KEY (feed, date)
);
CREATE TABLE IF NOT EXISTS items (
  feed     text NOT NULL,
  date     text NOT NULL,
  position int  NOT NULL,
  item_id  text,
  data     jsonb NOT NULL,
  PRIMARY KEY (feed, date, position),
  FOREIGN KEY (feed, date) REFERENCES digest_days(feed, date) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS documents (
  key  text PRIMARY KEY,
  data jsonb NOT NULL
);
`;

async function migrate() {
  await pool.query(SCHEMA);
}

module.exports = { pool, migrate };

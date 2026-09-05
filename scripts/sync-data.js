// Imports the JSON digest files (news/, builders/, jobs/) into Postgres.
// Idempotent: upserts by (feed, date), so re-running after new digests are
// committed just adds/refreshes those days. Runs automatically on server
// boot and manually via `npm run sync`.
const fs = require("fs");
const path = require("path");
const { pool, migrate } = require("./db");

const ROOT = path.join(__dirname, "..");
const FEEDS = ["news", "builders", "jobs"];
const DOCUMENTS = ["jobs/status.json", "jobs/watchlist.json"];

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

async function syncFeed(client, feed) {
  const dir = path.join(ROOT, feed);
  if (!fs.existsSync(path.join(dir, "index.json"))) return 0;
  const index = readJSON(`${feed}/index.json`);

  await client.query(
    `INSERT INTO feeds (name, generated_at) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET generated_at = EXCLUDED.generated_at`,
    [feed, index.generatedAt || null]
  );

  let days = 0;
  for (const entry of index.digests || []) {
    const dayPath = path.join(dir, `${entry.date}.json`);
    if (!fs.existsSync(dayPath)) {
      console.warn(`  ! ${feed}/${entry.date}.json listed in index but missing, skipped`);
      continue;
    }
    const day = readJSON(`${feed}/${entry.date}.json`);
    const { items = [], ...dayMeta } = day;

    await client.query(
      `INSERT INTO digest_days (feed, date, index_entry, day_meta)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (feed, date) DO UPDATE
         SET index_entry = EXCLUDED.index_entry, day_meta = EXCLUDED.day_meta`,
      [feed, entry.date, entry, dayMeta]
    );
    await client.query(`DELETE FROM items WHERE feed = $1 AND date = $2`, [feed, entry.date]);
    for (let i = 0; i < items.length; i++) {
      await client.query(
        `INSERT INTO items (feed, date, position, item_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [feed, entry.date, i, items[i].id || null, items[i]]
      );
    }
    days++;
  }
  return days;
}

async function syncData() {
  await migrate();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const feed of FEEDS) {
      const days = await syncFeed(client, feed);
      console.log(`  synced ${feed}: ${days} day(s)`);
    }
    for (const rel of DOCUMENTS) {
      if (!fs.existsSync(path.join(ROOT, rel))) continue;
      await client.query(
        `INSERT INTO documents (key, data) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
        [rel, readJSON(rel)]
      );
      console.log(`  synced document: ${rel}`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { syncData };

if (require.main === module) {
  syncData()
    .then(() => pool.end())
    .then(() => console.log("Sync complete."))
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}

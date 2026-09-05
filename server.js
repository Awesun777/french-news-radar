// News Radar server: serves the frontend and answers every data request
// from Postgres. The JSON files in news/, builders/ and jobs/ are only the
// ingest source — on each boot they are synced into the database, and the
// database is what the site serves.
const express = require("express");
const path = require("path");
const { pool, migrate } = require("./scripts/db");
const { syncData } = require("./scripts/sync-data");

const app = express();
const PORT = process.env.PORT || 8080;
const FEEDS = new Set(["news", "builders", "jobs"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.disable("x-powered-by");

// Digest JSON changes daily; make sure browsers revalidate.
function sendJSON(res, body) {
  res.set("Cache-Control", "no-cache").json(body);
}

app.get("/api/health", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT feed, count(*)::int AS days FROM digest_days GROUP BY feed ORDER BY feed`
    );
    res.json({ ok: true, database: "connected", days: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Singleton documents (jobs/status.json, jobs/watchlist.json).
app.get(["/jobs/status.json", "/jobs/watchlist.json"], async (req, res, next) => {
  try {
    const key = req.path.slice(1);
    const { rows } = await pool.query(`SELECT data FROM documents WHERE key = $1`, [key]);
    if (!rows.length) return res.status(404).json({ error: "not found" });
    sendJSON(res, rows[0].data);
  } catch (err) {
    next(err);
  }
});

// Feed catalog: rebuilt from the database in the exact index.json shape.
app.get("/:feed/index.json", async (req, res, next) => {
  if (!FEEDS.has(req.params.feed)) return next();
  try {
    const feed = req.params.feed;
    const meta = await pool.query(`SELECT generated_at FROM feeds WHERE name = $1`, [feed]);
    if (!meta.rows.length) return res.status(404).json({ error: "unknown feed" });
    const { rows } = await pool.query(
      `SELECT index_entry FROM digest_days WHERE feed = $1 ORDER BY date DESC`,
      [feed]
    );
    sendJSON(res, {
      generatedAt: meta.rows[0].generated_at,
      digests: rows.map((r) => r.index_entry),
    });
  } catch (err) {
    next(err);
  }
});

// One day's digest: day metadata + its items, in the day-file shape.
app.get("/:feed/:date.json", async (req, res, next) => {
  const { feed, date } = req.params;
  if (!FEEDS.has(feed) || !DATE_RE.test(date)) return next();
  try {
    const day = await pool.query(
      `SELECT day_meta FROM digest_days WHERE feed = $1 AND date = $2`,
      [feed, date]
    );
    if (!day.rows.length) return res.status(404).json({ error: "no digest for that date" });
    const items = await pool.query(
      `SELECT data FROM items WHERE feed = $1 AND date = $2 ORDER BY position`,
      [feed, date]
    );
    sendJSON(res, { ...day.rows[0].day_meta, items: items.rows.map((r) => r.data) });
  } catch (err) {
    next(err);
  }
});

// Frontend assets (index.html, app.js, styles.css). Registered after the
// data routes so the database always wins over any JSON file on disk.
app.use(express.static(path.join(__dirname), { extensions: ["html"], dotfiles: "ignore" }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

async function main() {
  await migrate();
  console.log("Syncing digest files into the database…");
  await syncData();
  app.listen(PORT, () => console.log(`News Radar listening on port ${PORT}`));
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});

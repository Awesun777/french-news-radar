# 📡 News Radar

A standalone web app — Express + Postgres on Railway — that shows a **daily curated radar** of:

- **Models & APIs** — new LLM / voice / video model releases and pricing that could improve or cheapen an AI voice tutor (OpenAI Realtime, Gemini Live, DeepSeek, ElevenLabs, Cartesia, Deepgram, Tavus, HeyGen, …).
- **Language Apps** — product launches and new features from Duolingo, Babbel, Busuu, Speak, ELSA, and interesting newcomers.
- **Build Inspiration** — techniques and in-between products (avatar video, real-time translation, latency tricks) worth stealing.

Each item has a plain-English summary, a **"why it matters for the French tutor"** hook, a clickable source link, and optional image/video.

Built to inspire and de-risk the [French voice tutor](https://romaintalk.com) project. **This is a separate project** — it does not touch the tutor codebase.

## How it works

- [`server.js`](./server.js) — an Express server that serves the frontend and answers every data request **from Postgres**.
- The JSON files in [`news/`](./news), [`builders/`](./builders) and [`jobs/`](./jobs) are the *ingest source*: on every boot the server syncs them into the database ([`scripts/sync-data.js`](./scripts/sync-data.js), idempotent upserts), and the database is what the site serves. The frontend URLs are unchanged (`news/index.json`, `news/<date>.json`, …) — they're now API routes backed by SQL.
- [`app.js`](./app.js) renders the date-grouped feed with live search and category filters.
- `GET /api/health` reports database status and per-feed day counts.
- Hosted on **Railway** ([`Dockerfile`](./Dockerfile) + [`railway.json`](./railway.json)) with the **Railway Postgres** add-on.

## Deploying on Railway

One-time setup:

1. Go to [railway.com/new](https://railway.com/new) → **Deploy from GitHub repo** → pick this repo (authorize GitHub access if prompted).
2. In the project canvas, click **+ Create → Database → Add PostgreSQL**.
3. On the app service → **Variables**, add a variable reference: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
4. Redeploy if needed. On boot the server creates its tables and imports every digest into Postgres automatically — that's the data migration.
5. In the service's **Settings → Networking**, click **Generate Domain** for the public URL.

Every push to the deployed branch redeploys and re-syncs — so the digest skills (`/news-digest`, `/jobs-digest`, `/builders-digest`) keep working unchanged: they commit + push JSON, Railway redeploys, the boot sync upserts the new day into the database.

## Adding a digest

Run the project skill from this directory in Claude Code:

```
/news-digest
```

It researches the day's news, writes `news/<today>.json`, updates `news/index.json`, commits, and pushes — GitHub Pages redeploys automatically. See [`.claude/skills/news-digest/SKILL.md`](./.claude/skills/news-digest/SKILL.md).

## Preview locally

Needs a local Postgres to point at:

```sh
npm install
DATABASE_URL=postgres://localhost:5432/radar npm start   # then open http://localhost:8080
```

The server creates its tables and imports the JSON digests on first boot. `npm run sync` re-imports without starting the server.

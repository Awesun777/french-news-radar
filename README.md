# 📡 News Radar

A standalone, static web app that shows a **daily curated radar** of:

- **Models & APIs** — new LLM / voice / video model releases and pricing that could improve or cheapen an AI voice tutor (OpenAI Realtime, Gemini Live, DeepSeek, ElevenLabs, Cartesia, Deepgram, Tavus, HeyGen, …).
- **Language Apps** — product launches and new features from Duolingo, Babbel, Busuu, Speak, ELSA, and interesting newcomers.
- **Build Inspiration** — techniques and in-between products (avatar video, real-time translation, latency tricks) worth stealing.

Each item has a plain-English summary, a **"why it matters for the French tutor"** hook, a clickable source link, and optional image/video.

Built to inspire and de-risk the [French voice tutor](https://romaintalk.com) project. **This is a separate project** — it does not touch the tutor codebase.

## How it works

- Pure static site — no build, no server, no database.
- Data lives as JSON in [`news/`](./news): `index.json` is the catalog; one `YYYY-MM-DD.json` per day holds that day's items.
- [`app.js`](./app.js) loads the JSON and renders a date-grouped feed with live search and category filters.
- Hosted on **GitHub Pages**.

## Adding a digest

Run the project skill from this directory in Claude Code:

```
/news-digest
```

It researches the day's news, writes `news/<today>.json`, updates `news/index.json`, commits, and pushes — GitHub Pages redeploys automatically. See [`.claude/skills/news-digest/SKILL.md`](./.claude/skills/news-digest/SKILL.md).

## Preview locally

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```
(`fetch()` needs a server — opening `index.html` via `file://` won't load the JSON.)

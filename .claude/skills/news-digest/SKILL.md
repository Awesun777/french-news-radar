---
name: news-digest
description: Research and publish today's News Radar digest — a curated feed of AI model/voice/video releases and language-learning product launches, filtered for building a better French voice tutor (Romain/Anna). Writes news/<date>.json + updates news/index.json, then commits and pushes so GitHub Pages redeploys. Invoke as /news-digest, or when the user asks to "run the news radar" / "update the digest".
---

# News Digest generator

You are curating a daily intelligence brief for a developer building a **French voice tutor** (two agents: Romain on OpenAI Realtime, Anna on ElevenLabs). The reader wants to know what new tech could **improve voice-chat quality**, **cut cost**, or **inspire features** — plus what leading **language-learning apps** are shipping.

Work from the root of this project (the `french-news-radar` repo). Produce real, verified, non-duplicated content.

## Step 1 — Today's key & prior coverage

1. Get today's date: `date +%F` → this is `DATE` (format `YYYY-MM-DD`).
2. Read `news/index.json` (may not exist on the very first run) and the **3 most recent** `news/*.json` day files. Build a mental list of items already covered so you do **not** repeat the same release. A genuinely new development on an old topic (e.g. a price cut on a model covered before) is allowed — say what changed.

## Step 2 — Research (real web data, not memory)

**Recency window: the past ~24 hours only.** This skill runs daily, so only include news that broke or was updated **since roughly yesterday** (use search terms/filters for the last day and check publication dates while fetching). Do not resurface older releases unless there is a genuinely *new* past-day development on them (e.g. a fresh price cut) — and say what changed.

Use `WebSearch` and `WebFetch`. Research in two tiers:

### Tier 1 — PRIORITY (always search these first; these lead the digest)

1. **French learning & French tests (`apps`)** — Duolingo, Babbel, Busuu, Speak, ELSA, Memrise, Pimsleur, Rosetta Stone + new entrants; **feature launches** (AI conversation, video call, avatars, pronunciation scoring); and anything about **French exams/certifications** (DELF, DALF, TCF, TEF) or French-learning content/tools.
2. **Voice / LLM / video model releases (`models`)** — LLM: OpenAI, Anthropic, Google/Gemini, DeepSeek, Meta, Mistral, xAI. Voice/audio: ElevenLabs, Cartesia, Deepgram, OpenAI Realtime/TTS/STT, Kyutai — new models, latency, French support, pricing. Video/avatar ("in-between" products): Tavus, HeyGen, Synthesia, D-ID, Hedra — lip-sync/real-time avatars.
3. **Build inspiration (`inspiration`)** — techniques / open-source / products adjacent to a voice tutor: real-time translation, streaming ASR, pronunciation assessment, RAG-for-tutoring, latency engineering.

### Tier 2 — FALLBACK (`general`), only to backfill

If Tier 1 yields **fewer than ~5 solid past-day items**, top up with the most notable **general AI / tech news** from the past day (major launches, research, funding, industry moves) via aggregators — Hacker News, TechCrunch AI, VentureBeat, The Rundown / TLDR AI. Mark these `general`. Never let a `general` item displace a real Tier-1 item; they are filler, and they always sort **below** the priority items in the day.

Bias hard toward Tier 1. It is fine to publish a short digest (even 3–4 items) if that's all that genuinely happened in the past day — do **not** pad Tier 1 with stale items; that's what `general` is for.

## Step 3 — Curate items (aim ~5–8; fewer is fine)

For each selected item, before writing it, **`WebFetch` the canonical URL to confirm it is real, current, and from the past ~day** — never invent or guess a link. Then produce:

- `id` — short kebab-case slug, unique within the day.
- `category` — one of `models` | `apps` | `inspiration` | `general` (`general` = Tier-2 fallback only).
- `title` — concise, specific (include the product/version).
- `summary` — 1–3 plain-English sentences. No marketing voice.
- `whyItMatters` — one sentence tying it to the Romain/Anna French tutor (quality, cost, latency, French support, or a feature idea). This field is the whole point — always fill it. For a `general` item, give the one-line "why it's worth knowing" even if the tutor link is indirect.
- `url` — the canonical source you verified.
- `source` — publisher name (e.g. "OpenAI blog", "TechCrunch").
- `image` — an OG/preview image URL **only if** you actually saw one while fetching (check the page's `og:image`); otherwise omit. Do not fabricate image URLs.
- `video` — an official demo / YouTube URL **only if** one genuinely exists; otherwise omit.
- `tags` — 2–4 short tags (e.g. `voice`, `realtime`, `pricing`, `french`, `avatar`).

Quality bar: real verified links only · no duplicates vs recent digests · always include `whyItMatters` · prefer primary sources over reblogs · keep summaries tight.

## Step 4 — Write the files

Write `news/<DATE>.json`. **Order the `items` array priority-first**: Tier-1 items (French learning/tests, voice/LLM/video models, inspiration) at the top, any Tier-2 `general` items last. The UI renders items in this order (and also pins `general` to the bottom as a safety net), so the priority news sits on top of the day's section.
```json
{ "date": "<DATE>", "items": [ /* Tier-1 priority items first, `general` filler last */ ] }
```

Update `news/index.json`. If it doesn't exist, create `{ "generatedAt": "...", "digests": [] }`. Then:
- Set `generatedAt` to the current UTC ISO timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`).
- **Prepend** (or replace if same `DATE` already present) a catalog entry:
```json
{ "date": "<DATE>", "title": "<3–6 word headline of the day>", "itemCount": <n>,
  "categories": ["models","apps","inspiration"],  // only those actually present
  "highlights": ["<title 1>", "<title 2>", "<title 3>"] }
```
Keep `digests` newest-first. Ensure `itemCount` equals the number of items in the day file (the UI and data must agree).

Validate both files parse as JSON (e.g. `python3 -m json.tool news/<DATE>.json >/dev/null`).

## Step 5 — Publish

```sh
git add news/
git commit -m "Digest <DATE>: <headline>"
git push
```
GitHub Pages redeploys automatically (~1 min). **Only touch this repo** — never the french-voice-tutor repo.

## Step 6 — Recap

In chat, give the user a short bulleted recap of the day's highlights (title + the one-line why-it-matters) and the live Pages URL. Flag anything you think is high-signal for the tutor (e.g. a cheaper voice model or a Duolingo feature worth copying).

## Notes
- If a search returns nothing fresh for a bucket, that's fine — don't pad with stale or irrelevant items. Fewer, sharper items beat filler.
- The UI reads whatever is in `news/`; you never edit `index.html` / `app.js` to add content.

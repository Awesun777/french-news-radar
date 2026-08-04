---
name: builders-digest
description: Build and publish today's AI Builders digest — what the people actually building AI said on X and in podcasts, remixed bilingually (EN + 中文). Writes builders/<date>.json + updates builders/index.json, then commits and pushes so GitHub Pages redeploys. Invoke as /builders-digest, or when the user asks to "run the builders digest" / "update AI Builders".
---

# AI Builders digest generator

This is the **second section** of the News Radar site (`#builders`), a sibling to
`/news-digest`. Same repo, same website, same nightly run — the two sections just
read different feeds. Radar is *what shipped*; this is *what the builders think*.

Work from the root of this project (the `french-news-radar` repo).

Unlike `/news-digest`, **you do no web research here.** All content arrives
pre-fetched in one JSON blob from the `follow-builders` skill's prepare script.
Your job is to remix it — never to browse, search, or invent.

## Step 1 — Today's key & prior coverage

1. `date +%F` → `DATE` (`YYYY-MM-DD`).
2. If `builders/<DATE>.json` already exists, today's digest is done. Say so and
   **stop** — do not regenerate.
3. Read `builders/index.json` and the **3 most recent** `builders/*.json` day
   files, and collect their item `url`s. The upstream feed is a rolling window,
   so the same tweet can appear on consecutive days; anything whose `url` you
   already published must be dropped.

## Step 2 — Fetch (deterministic, no browsing)

```sh
node /Users/chen/.claude/skills/follow-builders/scripts/prepare-digest.js 2>/dev/null
```

That path is outside this repo — it belongs to the globally-installed
`follow-builders` skill. If the file is missing or the command emits no JSON,
stop and report that the skill needs reinstalling (`git clone
https://github.com/zarazhangrui/follow-builders.git
~/.claude/skills/follow-builders && cd ~/.claude/skills/follow-builders/scripts
&& npm install`). Do **not** fall back to researching the content yourself — a
half-real digest is worse than none.

The blob contains `config`, `podcasts`, `x`, `blogs`, `prompts`, `stats`,
`errors`. Ignore `errors`; it is non-fatal noise.

## Step 3 — Check for content

If, after removing already-published URLs (Step 1), nothing is left, write
nothing, commit nothing, and report "no new builder content today". A missing day
is normal and the UI handles gaps fine — an empty day file is not.

## Step 4 — Remix

Follow the prompts carried inside the blob: `prompts.summarize_tweets`,
`prompts.summarize_podcast`, `prompts.summarize_blogs`, `prompts.translate`.

Hard rules, inherited from the upstream skill:

- **Never invent content.** Only what is in the JSON. No guessed quotes, no
  speculation about what someone might have meant, no commentary on silence.
- **Every item needs its real `url`.** No URL means the item does not exist —
  drop it. Never reconstruct a link from a handle and an ID.
- **Never guess a job title.** Use the `bio` field, or the person's name alone.
- **Skip the thin stuff** — mundane personal posts, retweets without comment,
  promo, engagement bait. A builder with nothing substantive is omitted entirely
  rather than padded with filler.
- Write 2–4 sentences per builder. Lead with the bold or contrarian claim.
- Podcasts get a 200–400 word remix, a one-sentence takeaway, and at least one
  real quote pulled from the transcript.

**Language: bilingual.** Every `summary` gets a `summaryZh`, every `takeaway` a
`takeawayZh`. Translate rather than transliterate — follow `prompts.translate`.
The site's EN / 中文 / Both toggle reads these fields, so a missing `summaryZh`
leaves a card blank in 中文 mode.

## Step 5 — Write the files

Write `builders/<DATE>.json`. Order: X items first, the podcast last (the UI
also enforces this, but keep the data honest).

```json
{ "date": "<DATE>", "items": [ /* kind:"x" first, kind:"podcast" last */ ] }
```

Item schema — note it differs from a Radar item:

| field | required | notes |
|---|---|---|
| `id` | yes | kebab-case, unique within the day |
| `kind` | yes | `x` \| `podcast` \| `blog` |
| `author` | yes | person for `x`, show name for `podcast` |
| `role` | no | from `bio`; omit rather than guess |
| `title` | podcasts | episode title, verbatim from the JSON |
| `takeaway` / `takeawayZh` | podcasts | one sentence |
| `summary` / `summaryZh` | yes | both languages, always |
| `url` | yes | the real source link |
| `tags` | yes | 2–4 short tags |

Update `builders/index.json` (create as `{ "generatedAt": "...", "digests": [] }`
if absent):

- `generatedAt` → `date -u +%Y-%m-%dT%H:%M:%SZ`
- **Prepend** (or replace, if `DATE` is already present) a catalog entry:

```json
{ "date": "<DATE>", "title": "<short headline of the day>", "itemCount": <n>,
  "kinds": ["x","podcast"], "highlights": ["<point 1>", "<point 2>", "<point 3>"] }
```

Keep `digests` newest-first, and make `itemCount` match the day file exactly —
the footer count is read from here and will disagree visibly if it drifts.

Validate both:

```sh
python3 -m json.tool builders/<DATE>.json >/dev/null
python3 -m json.tool builders/index.json >/dev/null
```

## Step 6 — Publish

```sh
git add builders/
git commit -m "Builders <DATE>: <headline>"
git push
```

Stage **only `builders/`**. The nightly run does the Radar digest in a separate
pass, and a stray `git add -A` here would sweep its in-progress work into this
commit. **Only touch this repo** — never `french-voice-tutor`.

## Step 7 — Recap

A short bulleted recap: who said what, plus the live URL
https://awesun777.github.io/french-news-radar/#builders

## Notes
- The UI reads whatever is in `builders/`; never edit `index.html` / `app.js` to
  add content.
- Scheduling is shared with the Radar — one LaunchAgent at 2:23 AM local runs
  both (`~/.local/bin/news-radar-digest.sh`). Don't add a second schedule.
- The upstream feed regenerates roughly daily; on a quiet day a 3-item digest is
  a correct outcome, not a failure.

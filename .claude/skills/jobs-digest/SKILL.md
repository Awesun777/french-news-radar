---
name: jobs-digest
description: Check the watched companies' career pages for new job postings and publish them to the News Radar Jobs tab. Reads jobs/watchlist.json (syncing any newer copy from ~/Downloads first), diffs against jobs/state.json, writes jobs/<date>.json + index, then commits and pushes. Invoke as /jobs-digest, or when the user asks to "check the job watchlist" / "run the jobs monitor".
---

# Jobs Digest — career-page monitor

You are monitoring the official career pages of companies on the user's watchlist and reporting **new postings only**. Work from the root of the `french-news-radar` repo. Only ever modify files under `jobs/`.

## Step 0 — Date

`date +%F` → `DATE` (format `YYYY-MM-DD`).

## Step 1 — Sync the watchlist from ~/Downloads

The site's Jobs tab lets the user edit the watchlist in the browser and press **"Sync to agent"**, which downloads a merged `watchlist.json` into `~/Downloads`. Pick it up:

1. `ls -t ~/Downloads/watchlist*.json 2>/dev/null | head -1` → newest candidate (browsers may have renamed it `watchlist (1).json` etc.).
2. If one exists, decide by the `updatedAt` field INSIDE the JSON — never by file mtime (`git pull` refreshes the repo file's mtime every run, which would make the repo always look newer). Import when the Downloads copy's `updatedAt` is later than the repo file's `updatedAt` (a `null`/missing repo `updatedAt` counts as older; identical content = skip):
   - Validate it parses as JSON and has a `companies` array whose entries have `company` and `careersUrl` string fields. If invalid, leave the repo file alone and note the problem in your output.
   - If valid and newer: copy it over `jobs/watchlist.json`, then delete ALL `~/Downloads/watchlist*.json` copies so stale ones can't be re-imported later. Also delete the Downloads copies when they matched the repo content exactly.
3. Read `jobs/watchlist.json`. If `companies` is empty, stop here — print "watchlist empty, nothing to monitor" and (if Step 1 changed the watchlist) still commit that change as `Jobs: watchlist update`.

## Step 2 — Load known-postings state

Read `jobs/state.json` if it exists — shape:
`{ "seen": { "<posting-url>": { "company": "...", "title": "...", "firstSeen": "YYYY-MM-DD", "lastSeen": "YYYY-MM-DD" } } }`
Missing file = first run = empty state. **On a first run for a company, everything it lists counts as new** — that is correct and expected; the feed's first day for a company is its current openings snapshot.

## Step 3 — Fetch each company's postings

For each watchlist entry `{ company, careersUrl, roles }`:

1. Try the structured route first — many careers pages are JS-rendered and WebFetch sees nothing. Recognize the ATS from the URL and hit its public JSON API via `curl` (Bash):
   - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/<org>/jobs` (org = path segment of the board URL)
   - Lever: `https://api.lever.co/v0/postings/<org>?mode=json`
   - Ashby: `https://api.ashbyhq.com/posting-api/job-board/<org>`
   - Workday: the `myworkdayjobs.com` CXS endpoint (`.../wday/cxs/<tenant>/<site>/jobs`, POST `{"limit":20,"offset":0,"searchText":""}`)
2. Otherwise `WebFetch` the careers URL (and an obvious "open positions" subpage if the landing page has one) and extract postings.
3. If a page yields nothing either way, record the company as **unreachable** in your output — do NOT guess or invent postings, and do NOT treat its previously-seen postings as gone.
4. Match against `roles`: split the user's roles string on commas into keywords; a posting matches if its title contains any keyword (case-insensitive, substring). **An empty `roles` string means watch everything.** Record which keywords matched as `matchedRoles`.
5. For every matched posting keep: `title`, absolute `url`, `location` (if listed), `team`/department (if listed).

## Step 4 — Diff and update state

- **New** = matched postings whose `url` is not in `state.seen`.
- Update `state.seen`: add new entries with `firstSeen: DATE, lastSeen: DATE`; set `lastSeen: DATE` on every posting seen in this run. Never delete entries for companies that were unreachable this run.
- Write `jobs/state.json` (pretty-printed).

## Step 5 — Publish

If there are new postings:

- Write `jobs/DATE.json`:
  `{ "date": DATE, "generatedAt": "<UTC ISO now>", "items": [ { "id": "<company-slug>-<n>", "company", "title", "url", "location", "team", "matchedRoles": [...] } ] }`
  Omit `location`/`team` keys when unknown. Order items by company name.
- Update `jobs/index.json`: prepend (or replace same-date) `{ "date": DATE, "itemCount": N, "companies": [unique company names] }` in `digests`, set `generatedAt`. Ensure `itemCount` matches.
- Validate both files parse: `python3 -m json.tool`.

If there are **no** new postings, do not write a day file — `state.json` (and possibly the watchlist) are still worth committing.

## Step 6 — Commit and push

`git config user.name 'Awesun777' && git config user.email 'anthonysunchen@gmail.com'` (if unset), then
`git add jobs/ && git commit -m "Jobs DATE: N new postings (Company A, Company B)" && git push`
(or `"Jobs DATE: no new postings"` when only state/watchlist changed; skip the commit entirely if nothing under `jobs/` changed).

## Rules

- Touch ONLY files under `jobs/` in ONLY this repo.
- Never invent or guess a posting URL — every published URL must come from a fetched page or API response.
- A short day file (even 1 item) is fine; zero new postings is a normal, successful outcome.
- If `git push` fails on auth, stop and report that the Claude GitHub App likely needs write access on Awesun777/french-news-radar.

---
name: jobs-digest
description: Check the watched companies' career pages for new job postings and publish them to the News Radar Jobs tab. Reads jobs/watchlist.json (syncing any newer copy from ~/Downloads first), diffs against jobs/state.json, writes jobs/<date>.json + index, then commits and pushes. Invoke as /jobs-digest, or when the user asks to "check the job watchlist" / "run the jobs monitor".
---

# Jobs Digest — career-page monitor

You are monitoring the official career pages of companies on the user's watchlist and reporting **new postings only**. Work from the root of the `french-news-radar` repo. Only ever modify files under `jobs/`.

## Step 0 — Date

`date +%F` → `DATE` (format `YYYY-MM-DD`).

## Step 1 — Sync the watchlist from ~/Downloads

The site's Jobs tab lets the user edit the watchlist in the browser and press **"Sync to agent"**, which saves a merged pending file. Pick it up:

1. Candidates, newest first: `ls -t ~/JobSearch/watchlist*.json jobs/watchlist.pending*.json ~/Downloads/watchlist*.json 2>/dev/null | head -1`. **`~/JobSearch/` is the primary drop point** (the Sync button saves there via the browser's file picker; the folder is private, outside this repo, and launchd-readable). The repo-local `jobs/watchlist.pending.json` and `~/Downloads` are fallbacks — note **macOS TCC blocks launchd-context runs from reading ~/Downloads entirely**, so finding nothing there proves nothing when running from the LaunchAgent. Never commit a pending/synced file — delete it after import (`README.txt` in ~/JobSearch is not a candidate; only `watchlist*.json`).
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
   - SuccessFactors (e.g. `jobs.scotiabank.com`, `careers.nomura.com` — SAP career sites with `/search/?q=` or `/go/<name>/<id>/` URLs): the list is server-rendered; job rows are `<a class="jobTitle-link" href=...>` with a nearby `class="jobLocation"` span, paginated by appending `&startrow=N` (N += 25) until a page adds nothing new. Job URLs are relative — join against the site root.
   - Radancy (e.g. `jobs.citi.com` — `/search-jobs/` URLs with numeric path segments): the page itself is JS-rendered and embeds nothing, but `GET /search-jobs/results?CurrentPage=1&RecordsPerPage=25&Keywords=<kw>&SortCriteria=0&SortDirection=0` (accept: application/json) returns `{"results": "<html>"}` — extract `href="(/job/[^"]+)"` + link text, paginate CurrentPage until no new links. Its location facet is unreliable: take the city from the `/job/<city>/...` path segment and filter countries yourself.
   - Phenom People (e.g. `jobs.rbc.com`): `curl` the search-results URL itself with a browser User-Agent — the page embeds the results server-side. Extract the `"jobs":[...]` array (inside `eagerLoadRefineSearch`) with `json.JSONDecoder().raw_decode` from the `"jobs":[` offset. Each job carries `title`, `cityStateCountry`, `dateCreated`, and an `applyUrl` (often a Workday link) — use `applyUrl` as the posting URL.
   - Cornerstone / `*.csod.com` (e.g. World Bank): two-step —
     1. `curl -c jar.txt '<careersite home URL>' -A 'Mozilla/5.0' -o page.html`, extract the JWT from the page: `grep -oE '"token":"[^"]+"' page.html | head -1`.
     2. `curl -b jar.txt -X POST 'https://<tenant>.csod.com/services/x/career-site/v1/search' -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -A 'Mozilla/5.0'` with body `{"careerSiteId":1,"careerSitePageId":1,"pageNumber":1,"pageSize":25,"cultureId":1,"searchText":"<keyword>","cultureName":"en-US","states":[],"countryCodes":["us"],"cities":[],"placeID":"","radius":null,"postingsWithinDays":null,"customFieldCheckboxKeys":[],"customFieldDropdowns":[],"customFieldRadios":[]}` (take careerSiteId and country from the watchlist URL's path/query). Jobs are in `data.requisitions` with `displayJobTitle` and `requisitionId`; posting URL = `https://<tenant>.csod.com/ux/ats/careersite/<careerSiteId>/requisition/<requisitionId>?c=<tenant>`. Run one search per role keyword and merge.
2. Otherwise `WebFetch` the careers URL (and an obvious "open positions" subpage if the landing page has one) and extract postings.
3. **LinkedIn** (needs the `linkedin` MCP server tools — skip this route silently if they're unavailable):
   - A watchlist entry whose `careersUrl` is a `linkedin.com/jobs` search URL is served entirely by MCP: call `search_jobs` with the entry's role keywords (and country as location), then `get_job_details` for anything that needs a canonical URL or posting date.
   - A company whose own careers page is **unreachable** gets ONE LinkedIn fallback: `search_jobs` for `<role keyword> <company>` and keep only results actually posted by that company.
   - Budget: stay under ~10 LinkedIn tool calls per run total — automated access can get accounts restricted, so LinkedIn is a targeted fallback, not the primary crawler. If a call fails with an auth/session error, note that the session needs re-importing (`uvx mcp-server-linkedin@latest --import-from-browser chrome`) and move on.
4. If a page yields nothing any way, record the company as **unreachable** in your output — do NOT guess or invent postings, and do NOT treat its previously-seen postings as gone.
5. Match against `roles`: split the user's roles string on commas into keywords; a posting matches if its title contains any keyword (case-insensitive, substring). **An empty `roles` string means watch everything.** Record which keywords matched as `matchedRoles`.
6. Filter by `countries` if the entry has one (comma-separated country names): keep a posting when its location contains any listed country (case-insensitive substring; accept common variants like "United States" ⇄ "USA"/"US" and treat "Remote" as its own match). Prefer passing the country to the ATS API where it has a parameter. **A posting with no discernible location is kept**, never silently dropped.
7. For every matched posting keep: `title`, absolute `url`, `location` (if listed), `team`/department (if listed), and `postedAt` (ISO `YYYY-MM-DD`) when the ATS exposes a posting/creation date (Phenom `dateCreated`, Greenhouse `updated_at`, Lever `createdAt`, Cornerstone posting date). Omit `postedAt` when unknown — never guess it.

## Step 4 — Diff and update state

- **New** = matched postings whose `url` is not in `state.seen`.
- Update `state.seen`: add new entries with `firstSeen: DATE, lastSeen: DATE`; set `lastSeen: DATE` on every posting seen in this run. Never delete entries for companies that were unreachable this run.
- Write `jobs/state.json` (pretty-printed).

## Step 5 — Publish

If there are new postings:

- Write `jobs/DATE.json`:
  `{ "date": DATE, "generatedAt": "<UTC ISO now>", "items": [ { "id": "<company-slug>-<n>", "company", "title", "url", "location", "team", "postedAt", "matchedRoles": [...] } ] }`
  Omit `location`/`team`/`postedAt` keys when unknown. Order items by company name.
- Update `jobs/index.json`: prepend (or replace same-date) `{ "date": DATE, "itemCount": N, "companies": [unique company names] }` in `digests`, set `generatedAt`. Ensure `itemCount` matches.
- Validate both files parse: `python3 -m json.tool`.

If there are **no** new postings, do not write a day file — `state.json` (and possibly the watchlist) are still worth committing.

**Always** (new postings or not) write `jobs/status.json` — the site's Jobs monitor banner renders it:
`{ "lastRunAt": "<UTC ISO now>", "outcome": "new-postings" | "no-new-postings", "newCount": N, "detail": "<one short human line, e.g. '1 new posting (Rbc)'>", "dayFile": "<DATE of most recent day file>", "companies": { "<company>": "ok" | "unreachable", ... } }`
(The nightly wrapper script re-stamps `lastRunAt`/`outcome` after you exit, so a crashed run still leaves a record — your job is the rich per-company detail.)

## Step 6 — Commit and push

`git config user.name 'Awesun777' && git config user.email 'anthonysunchen@gmail.com'` (if unset), then
`git add jobs/ && git commit -m "Jobs DATE: N new postings (Company A, Company B)" && git push`
(or `"Jobs DATE: no new postings"` when only state/watchlist changed; skip the commit entirely if nothing under `jobs/` changed).

## Rules

- Touch ONLY files under `jobs/` in ONLY this repo.
- Never invent or guess a posting URL — every published URL must come from a fetched page or API response.
- A short day file (even 1 item) is fine; zero new postings is a normal, successful outcome.
- If `git push` fails on auth, stop and report that the Claude GitHub App likely needs write access on Awesun777/french-news-radar.

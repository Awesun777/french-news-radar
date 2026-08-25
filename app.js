// News Radar — vanilla ES module.
// Loads news/index.json (catalog), then each day's file, and renders a
// date-grouped feed with client-side search + category filtering.

const CATEGORIES = [
  { id: "all", label: "All", dot: null },
  { id: "models", label: "Models & APIs", dot: "var(--accent-models)" },
  { id: "apps", label: "Language Apps", dot: "var(--accent-apps)" },
  { id: "inspiration", label: "Build Inspiration", dot: "var(--accent-inspiration)" },
  { id: "general", label: "General AI", dot: "var(--accent-general)" },
];

// Priority buckets (French learning/tests + voice/LLM/video models + tutor
// inspiration) render first; `general` AI-tech filler is always pinned last.
const GENERAL = "general";

// The two sections behave the same way — same search box, same date navigator,
// same card grid — but read different feeds and filter on different axes, so
// each keeps its own slice of state and they never clobber each other's
// filters when you switch tabs.
const SECTIONS = {
  radar: {
    label: "Radar",
    dir: "news",
    tagline: "AI models · voice · video · language-learning — curated for the French tutor",
    empty: "No digests yet. Run the /news-digest skill to generate the first one.",
    skill: "/news-digest",
  },
  builders: {
    label: "AI Builders",
    dir: "builders",
    tagline: "What the people actually building AI are saying — from X and podcasts",
    empty: "No builder digests yet. Run the /follow-builders skill to generate the first one.",
    skill: "/follow-builders",
  },
  // The journal is local-only: entries come from localStorage, never the repo —
  // this site is public, and market thoughts shouldn't be.
  journal: {
    label: "Journal",
    local: true,
    tagline: "Daily market thoughts — private to this browser",
    empty: "No entries yet. Press “New entry” and start dictating.",
  },
  jobs: {
    label: "Jobs",
    dir: "jobs",
    tagline: "New postings from watched career pages — checked nightly",
    empty: "No postings yet. Add companies to the watchlist above — the nightly agent checks their career pages and new roles land here.",
    skill: "/jobs-digest",
  },
  // Live feed, not repo JSON: the Job Tracker sheet's Apps Script serves the
  // applications logged through the Smart JobFill extension, grouped by the
  // sheet's own category rows.
  applications: {
    label: "Applications",
    live: true,
    tagline: "Applications logged via the Smart JobFill extension — live from the tracker sheet",
    empty: "No applications logged yet. Save a job in the extension and add it to the sheet.",
    skill: "Smart JobFill → Job Tracker sheet",
  },
};

const APPS_WEBHOOK =
  "https://script.google.com/macros/s/AKfycbx8UQW40PMfKpi8_mwJGkicY-jGEow5Op2s8lNku2vzcWvjKX-dZhI_lEMknbSbrKmo/exec";
// Reads are token-gated server-side; the token lives only in this browser.
const APPS_TOKEN_KEY = "nr_apps_token";
const appsToken = () => localStorage.getItem(APPS_TOKEN_KEY) || "";
const appKeyOf = (company, position) =>
  (String(company) + "|" + String(position)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ── Application identity ─────────────────────────────────────────────────────
// Three writers describe the same job: the hand-edited tracker sheet, the
// extension's saved JD context, and the outreach rows. appKey is a slug of
// company|position, so any drift between them silently orphans a job's JD and
// its drafted notes — "MIGA | Operation Analyst" in the tracker vs "MIGA |
// Operations Analyst" from the posting cost us a finished outreach note twice,
// with no visible symptom beyond the note appearing to be gone.
//
// aliasKeyOf is a deliberately lossy SECOND key used only to reunite strays:
// ATS hostnames, legal suffixes and plurals all collapse into it. Nothing ever
// writes this key — it exists purely to repair joins at render time, and a
// stray is adopted only when exactly one tracker row claims its alias, so an
// ambiguous match stays unlinked rather than risk hanging a drafted note on the
// wrong application.
const LEGAL_SUFFIX = /\b(inc|llc|ltd|plc|corp|corporation|co|sa|nv|ag|gmbh|securities|holdings|branch)\b/g;
const stemWord = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const normWords = (s) => String(s || "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase()
  .split(/\s+/).filter(Boolean).map(stemWord).join(" ");
function normCompany(c) {
  let s = String(c || "").trim().toLowerCase();
  // "mufgub.wd3.myworkdayjobs.com" and "linkedin.com" are ATS pages the
  // extension captured as the employer — keep only the leading label.
  if (!/\s/.test(s) && s.includes(".")) s = s.split(".")[0];
  return normWords(s.replace(/[.,]/g, " ").replace(LEGAL_SUFFIX, " "));
}
const aliasKeyOf = (company, position) => {
  const c = normCompany(company), pos = normWords(position);
  return c && pos ? c + "|" + pos : "";   // an empty half identifies nothing
};
async function appsPost(body) {
  const res = await fetch(APPS_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, token: appsToken() }),
  });
  return res.json();
}

// Builders items are filtered by source kind rather than by news category.
const KINDS = [
  { id: "all", label: "All", dot: null },
  { id: "x", label: "X / Twitter", dot: "var(--accent-models)" },
  { id: "podcast", label: "Podcasts", dot: "var(--accent-apps)" },
  { id: "blog", label: "Blogs", dot: "var(--accent-inspiration)" },
];

const LANGS = [
  { id: "en", label: "EN" },
  { id: "zh", label: "中文" },
  { id: "both", label: "Both" },
];

function blankSection() {
  return { items: [], meta: null, dates: [], activeDate: "all", loaded: false, failed: false };
}

const state = {
  section: "radar",
  query: "",                 // shared: searching persists across tabs
  activeCat: "all",          // radar only
  activeKind: "all",         // builders only
  activeCompany: "all",      // jobs only
  activeAppCat: "all",       // applications only
  appsDetail: null,          // #applications/<appKey> sub-route
  lang: "en",                // builders only
  radar: blankSection(),
  builders: blankSection(),
  journal: blankSection(),
  jobs: blankSection(),
  applications: blankSection(),
};

// Shorthand for the currently-visible section's slice.
const cur = () => state[state.section];

const el = {
  status: document.getElementById("status"),
  feed: document.getElementById("feed"),
  catNav: document.getElementById("cat-nav"),
  langToggle: document.getElementById("langtoggle"),
  sections: document.getElementById("sections"),
  search: document.getElementById("search"),
  dateNav: document.getElementById("date-nav"),
  datePrev: document.getElementById("date-prev"),
  dateNext: document.getElementById("date-next"),
  footerMeta: document.getElementById("footer-meta"),
  footerGen: document.getElementById("footer-gen"),
  jobsWatch: document.getElementById("jobs-watch"),
  jobsMonitor: document.getElementById("jobs-monitor"),
  jobsAddBtn: document.getElementById("jobs-add-btn"),
  jobsSync: document.getElementById("jobs-sync"),
  jobsForm: document.getElementById("jobs-form"),
  jobsUrl: document.getElementById("jobs-url"),
  jobsCompany: document.getElementById("jobs-company"),
  jobsRoles: document.getElementById("jobs-roles"),
  jobsCountries: document.getElementById("jobs-countries"),
  jobsSave: document.getElementById("jobs-save"),
  jobsCancel: document.getElementById("jobs-cancel"),
  jobsWatchlist: document.getElementById("jobs-watchlist"),
  compose: document.getElementById("journal-compose"),
  journalNew: document.getElementById("journal-new"),
  journalExport: document.getElementById("journal-export"),
  journalEditor: document.getElementById("journal-editor"),
  journalText: document.getElementById("journal-text"),
  journalSave: document.getElementById("journal-save"),
  journalCancel: document.getElementById("journal-cancel"),
};

// ---------- date helpers ----------
const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
// Local-time YYYY-MM-DD (matches the `date +%F` keys the skill writes; avoids a
// UTC/local off-by-one that would mislabel today's digest as "Yesterday").
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Explicit calendar date, always shown at the top of each day's section.
function fmtFullDate(key) {
  if (!isDateKey(key)) return key;
  return new Date(key + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
// Relative pill ("Today"/"Yesterday") shown next to the explicit date, if applicable.
function relLabel(key) {
  if (!isDateKey(key)) return "";
  const today = ymd(new Date());
  const yest = ymd(new Date(Date.now() - 86400000));
  if (key === today) return "Today";
  if (key === yest) return "Yesterday";
  return "";
}
function sortKeyDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ---------- journal storage ----------
const JOURNAL_KEY = "news-radar-journal-v1";
function journalRead() {
  try {
    const a = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function journalWrite(entries) { localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries)); }

// ---------- jobs: dismissed postings ----------
// Deleting a posting card is per-browser: the feed is static JSON in a public
// repo, so "delete" means hide-forever here, keyed by posting URL.
const JOBS_DISMISSED_KEY = "news-radar-jobs-dismissed-v1";
function dismissedRead() {
  try {
    const a = JSON.parse(localStorage.getItem(JOBS_DISMISSED_KEY) || "[]");
    return new Set(Array.isArray(a) ? a : []);
  } catch { return new Set(); }
}
function dismissPosting(url) {
  const s = dismissedRead();
  s.add(url);
  localStorage.setItem(JOBS_DISMISSED_KEY, JSON.stringify([...s]));
}

// ---------- jobs watchlist ----------
// Source of truth is jobs/watchlist.json in the repo — that's what the nightly
// agent reads. The browser can't commit, so edits live in a localStorage
// overlay until "Sync to agent" downloads the merged file, which the nightly
// skill picks up from ~/Downloads and commits. Once an edit shows up in the
// fetched repo copy, reconcilePending drops it from the overlay automatically.
const WATCH_PENDING_KEY = "news-radar-jobs-pending-v1";
let repoWatchlist = [];

function pendingRead() {
  try {
    const p = JSON.parse(localStorage.getItem(WATCH_PENDING_KEY) || "{}");
    return { added: Array.isArray(p.added) ? p.added : [], removed: Array.isArray(p.removed) ? p.removed : [] };
  } catch { return { added: [], removed: [] }; }
}
function pendingWrite(p) { localStorage.setItem(WATCH_PENDING_KEY, JSON.stringify(p)); }

function reconcilePending() {
  const p = pendingRead();
  const repoByUrl = new Map(repoWatchlist.map((c) => [c.careersUrl, c]));
  const same = (a, b) =>
    a && b && a.company === b.company &&
    (a.roles || "") === (b.roles || "") &&
    (a.countries || "") === (b.countries || "");
  const next = {
    // A pending add has only "landed" once the repo entry MATCHES it in
    // content — an edit keeps the original's URL, so URL presence alone would
    // wrongly drop the edited version while its removal survives.
    added: p.added.filter((c) => !same(repoByUrl.get(c.careersUrl), c)),
    removed: p.removed.filter((url) => repoByUrl.has(url)),
  };
  if (JSON.stringify(next) !== JSON.stringify(p)) pendingWrite(next);
  return next;
}

function effectiveWatchlist() {
  const p = reconcilePending();
  const removed = new Set(p.removed);
  return [...repoWatchlist.filter((c) => !removed.has(c.careersUrl)), ...p.added];
}

/** Best-effort company name from a careers URL; always editable in the form. */
function companyFromUrl(url) {
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // ATS boards put the company in the path, not the host.
    if (/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|myworkdayjobs\.com|jobvite\.com/.test(host)) {
      return cap((u.pathname.split("/").filter(Boolean)[0] || "").replace(/[-_]/g, " "));
    }
    const parts = host.split(".");
    const sub = ["careers", "jobs", "boards", "apply", "work", "join"];
    const base = parts.length > 2 && sub.includes(parts[0]) ? parts[1] : parts[parts.length - 2];
    return cap(base);
  } catch { return ""; }
}

/**
 * Monitor banner — when the agent last fetched and how it went, rendered from
 * jobs/status.json. The nightly wrapper stamps that file even when the skill
 * run crashes, so silence here means the run never started (asleep Mac), not
 * that a failure went unrecorded.
 */
async function loadJobsStatus() {
  let s = null;
  try { s = await getJSON("./jobs/status.json"); } catch { /* no run recorded */ }
  el.jobsMonitor.hidden = false;
  if (!s || !s.lastRunAt) {
    el.jobsMonitor.className = "jobs-monitor warn";
    el.jobsMonitor.innerHTML = `<span class="jm-icon">🛰</span><span>No fetch recorded yet — the nightly agent hasn't run since the monitor was added.</span>`;
    return;
  }
  const t = new Date(s.lastRunAt);
  const hours = (Date.now() - t.getTime()) / 36e5;
  const rel = hours < 1 ? "just now" : hours < 24 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} d ago`;
  const when = t.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const stale = hours > 36;
  const cls = s.outcome === "error" ? "err" : stale ? "warn" : "ok";
  const outcomeText =
    s.outcome === "error" ? (s.detail || "last run failed") :
    s.outcome === "new-postings" ? (s.detail || `${s.newCount ?? "?"} new posting${s.newCount === 1 ? "" : "s"}`) :
    "no new postings";
  const companies = Object.entries(s.companies || {})
    .map(([name, st]) => `<span class="jm-chip ${st === "ok" ? "" : "jm-bad"}">${st === "ok" ? "✓" : "⚠"} ${esc(name)}</span>`)
    .join("");
  el.jobsMonitor.className = `jobs-monitor ${cls}`;
  el.jobsMonitor.innerHTML =
    `<span class="jm-icon">🛰</span>` +
    `<span><b>Last checked ${esc(when)}</b> (${rel})${stale ? " — overdue; the nightly run hasn't completed since" : ""} · ${esc(outcomeText)}</span>` +
    (companies ? `<span class="jm-chips">${companies}</span>` : "");
}

async function loadWatchlist() {
  try {
    const data = await getJSON("./jobs/watchlist.json");
    repoWatchlist = Array.isArray(data.companies) ? data.companies : [];
  } catch { repoWatchlist = []; }
  renderWatchlist();
}

/** careersUrl of the row currently in inline-edit mode, or null. */
let watchEditing = null;

function renderWatchlist() {
  const p = reconcilePending();
  const removed = new Set(p.removed);
  const pendingUrls = new Set(p.added.map((c) => c.careersUrl));
  const list = effectiveWatchlist();

  el.jobsSync.hidden = p.added.length === 0 && p.removed.length === 0;

  if (!list.length && !removed.size) {
    el.jobsWatchlist.innerHTML = `<p class="watch-empty">No companies watched yet.</p>`;
    return;
  }
  el.jobsWatchlist.innerHTML = list.map((c) => {
    if (c.careersUrl === watchEditing) {
      return `<div class="watch-row watch-editing" data-url="${esc(c.careersUrl)}">
        <div class="jobs-form-grid watch-edit-grid">
          <input class="we-url" type="url" value="${esc(c.careersUrl)}" placeholder="Careers page URL" spellcheck="false" />
          <div class="jobs-form-row">
            <input class="we-company" type="text" value="${esc(c.company)}" placeholder="Company" />
            <input class="we-roles" type="text" value="${esc(c.roles || "")}" placeholder="Positions to watch — comma-separated" />
          </div>
          <input class="we-countries" type="text" value="${esc(c.countries || "")}" placeholder="Countries — comma-separated, blank = anywhere" />
        </div>
        <div class="journal-actions">
          <button class="journal-btn primary watch-save" type="button" data-url="${esc(c.careersUrl)}">Save</button>
          <button class="journal-btn watch-cancel" type="button">Cancel</button>
        </div>
      </div>`;
    }
    const pending = pendingUrls.has(c.careersUrl);
    let host = c.careersUrl;
    try { host = new URL(c.careersUrl).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
    return `<div class="watch-row">
      <div class="watch-main">
        <span class="watch-company">${esc(c.company)}</span>
        ${pending ? `<span class="watch-pending">pending sync</span>` : ""}
        <a class="watch-link" href="${esc(c.careersUrl)}" target="_blank" rel="noopener">${esc(host)}</a>
      </div>
      ${c.roles ? `<span class="watch-roles">${esc(c.roles)}</span>` : ""}
      ${c.countries ? `<span class="tag">🌍 ${esc(c.countries)}</span>` : ""}
      <button class="watch-edit" type="button" data-url="${esc(c.careersUrl)}" title="Edit this entry">✎</button>
      <button class="watch-remove" type="button" data-url="${esc(c.careersUrl)}" title="Stop watching">×</button>
    </div>`;
  }).join("");
}

/**
 * An edit is a replace: pending adds mutate in place; repo entries become a
 * pending removal of the original plus a pending add of the edited version —
 * the same overlay the sync/download path already understands.
 */
function applyWatchEdit(originalUrl, entry) {
  const taken = effectiveWatchlist().some(
    (c) => c.careersUrl !== originalUrl && c.careersUrl === entry.careersUrl
  );
  if (taken) return false;
  const p = pendingRead();
  const idx = p.added.findIndex((c) => c.careersUrl === originalUrl);
  if (idx !== -1) {
    p.added[idx] = { ...p.added[idx], ...entry };
  } else {
    if (!p.removed.includes(originalUrl)) p.removed.push(originalUrl);
    p.added.push({ ...entry, addedAt: new Date().toISOString() });
  }
  pendingWrite(p);
  return true;
}

async function downloadWatchlist() {
  const payload = { updatedAt: new Date().toISOString(), companies: effectiveWatchlist() };
  const text = JSON.stringify(payload, null, 2) + "\n";
  // Preferred: save into ~/JobSearch via the save-file picker (Chrome
  // remembers the last-used folder per site, so it's one navigation ever).
  // ~/Downloads is TCC-locked on macOS — the nightly launchd agent can't read
  // files dropped there; ~/JobSearch has no such wall and stays private.
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "watchlist.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return;
    } catch (e) {
      if (e?.name === "AbortError") return; // user cancelled — don't double-save
      // fall through to the plain download on any other failure
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "watchlist.pending.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- fetch ----------
async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Load one section's feed. Sections load lazily — opening the site only fetches
// the Radar, and the Builders files are pulled the first time you switch to it.
async function loadSection(name) {
  const conf = SECTIONS[name];
  const slice = state[name];
  if (conf.local) {
    // Re-derived on every visit — mutations (log/delete) go straight to
    // localStorage and this is the single place items are rebuilt from it.
    slice.items = journalRead()
      .map((e) => ({ ...e, date: ymd(new Date(e.ts)) }))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    slice.loaded = true;
    slice.failed = false;
    return;
  }
  if (slice.loaded || slice.failed) return;

  if (conf.live) {
    // One fetch from the tracker sheet; category order is the sheet's own.
    slice.needToken = false;
    if (!appsToken()) { slice.failed = true; slice.needToken = true; return; }
    try {
      const res = await fetch(`${APPS_WEBHOOK}?action=workspace&token=${encodeURIComponent(appsToken())}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "feed error");
      const w = data.workspace || {};
      // Full application history: every tracker row (for the calendar and
      // date lookups) plus any extension-saved context without a row yet.
      const appdata = w.appdata || {};
      const seen = new Set();
      slice.items = [];
      (w.sections || []).forEach((sec) => (sec.jobs || []).forEach((j) => {
        // A stored key wins when the sheet supplies one; recomputing is the
        // fallback for rows typed straight into the tracker.
        const k = j.appKey || appKeyOf(j.company, j.position);
        seen.add(k);
        slice.items.push({
          appKey: k, company: j.company, position: j.position,
          status: j.status || "", appliedDate: j.appliedDate || "",
          postedDate: j.postedDate || "", category: sec.category,
          hasContext: false,
        });
      }));
      // Alias index over tracker rows. An alias claimed by two rows is poisoned
      // to null: better to leave a note unlinked and visible than to attach it
      // to the wrong job.
      const aliasIndex = new Map();
      slice.items.forEach((it) => {
        const a = aliasKeyOf(it.company, it.position);
        if (!a) return;
        aliasIndex.set(a, aliasIndex.has(a) ? null : it.appKey);
      });
      const linkMap = {};   // stray appKey -> tracker appKey it belongs to
      Object.values(appdata).forEach((ctx) => {
        if (seen.has(ctx.appKey)) return;
        const a = aliasKeyOf(ctx.company, ctx.position);
        const owner = a ? aliasIndex.get(a) : null;
        if (owner) linkMap[ctx.appKey] = owner;
      });
      const owners = new Set(Object.values(linkMap));
      slice.items.forEach((it) => {
        it.hasContext = !!appdata[it.appKey] || owners.has(it.appKey);
      });
      // Context that still belongs to no tracker row keeps its own card, and is
      // flagged so renderApplications can surface it. Before this flag existed
      // such a card had no applied date, so it was filtered out of the recent
      // list and every calendar day — saved JDs and drafted notes became
      // invisible rather than merely unsorted.
      Object.values(appdata).forEach((ctx) => {
        if (seen.has(ctx.appKey) || linkMap[ctx.appKey]) return;
        slice.items.push({
          appKey: ctx.appKey, company: ctx.company, position: ctx.position,
          status: "", appliedDate: "", postedDate: ctx.postDate || "",
          category: "Uncategorized", hasContext: true, unlinked: true,
        });
      });
      slice.meta = { sections: w.sections || [], appdata, outreach: w.outreach || [], linkMap };
      slice.loaded = true;
      if (!slice.items.length) slice.failed = true;
    } catch {
      slice.failed = true;
      slice.needToken = !appsToken();
    }
    return;
  }

  let index;
  try {
    index = await getJSON(`./${conf.dir}/index.json`);
  } catch {
    slice.failed = true;
    return;
  }
  slice.meta = index;
  const digests = Array.isArray(index.digests) ? [...index.digests].sort(sortKeyDesc) : [];
  if (!digests.length) { slice.failed = true; return; }

  // Fetch every day's file in parallel; tolerate individual failures.
  const days = await Promise.all(
    digests.map((d) =>
      getJSON(`./${conf.dir}/${d.date}.json`)
        .then((day) => (day.items || []).map((it) => ({ ...it, date: it.date || d.date })))
        .catch(() => [])
    )
  );
  slice.items = days.flat();
  slice.loaded = true;
  if (!slice.items.length) slice.failed = true;
}

// Show a section: load on demand, then repaint every control that depends on it.
async function showSection(name) {
  if (!SECTIONS[name]) name = "radar";
  const conf = SECTIONS[name];
  state.section = name;
  document.title = `${conf.label} · News Radar — ${conf.tagline}`;
  el.footerGen.innerHTML = conf.local
    ? "Private journal — entries are stored only in this browser"
    : `Generated by the <code>${conf.skill}</code> skill`;
  for (const b of el.sections.querySelectorAll(".section-tab")) {
    const on = b.dataset.section === name;
    b.dataset.active = String(on);
    if (on) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
  // The language toggle is meaningful only for the bilingual builders feed;
  // the composer only for the journal; the watchlist only for jobs.
  el.langToggle.hidden = name !== "builders";
  el.compose.hidden = name !== "journal";
  el.jobsWatch.hidden = name !== "jobs";
  // Applications have no per-day files; the date navigator means nothing there.
  el.dateNav.closest(".datenav").hidden = name === "applications";
  if (name === "jobs") { loadWatchlist(); loadJobsStatus(); }

  const slice = state[name];
  if (conf.local) {
    await loadSection(name);
  } else if (!slice.loaded && !slice.failed) {
    el.feed.hidden = true;
    el.status.hidden = false;
    el.status.textContent = "Loading…";
    await loadSection(name);
  }

  if (slice.failed || !slice.items.length) {
    el.feed.hidden = true;
    el.status.hidden = false;
    if (name === "applications" && slice.needToken) {
      // First visit on this browser: ask for the access token once.
      el.status.innerHTML = `<div class="token-gate">
        <p>This dashboard is private. Enter the access token to unlock it on this browser.</p>
        <input type="password" id="apps-token-input" placeholder="Access token" autocomplete="off" />
        <button id="apps-token-save" type="button">Unlock</button>
      </div>`;
      document.getElementById("apps-token-save").addEventListener("click", () => {
        const v = document.getElementById("apps-token-input").value.trim();
        if (!v) return;
        localStorage.setItem(APPS_TOKEN_KEY, v);
        slice.failed = false;
        slice.needToken = false;
        showSection("applications");
      });
    } else {
      el.status.textContent = SECTIONS[name].empty;
    }
    renderChips();
    renderLangToggle();
    el.footerMeta.textContent = "";
    syncHeadHeight();
    return;
  }

  el.status.hidden = true;
  el.feed.hidden = false;
  renderChips();
  renderLangToggle();
  buildDateNav();
  renderFooter();
  render();
  syncHeadHeight();
}

// ---------- rendering ----------
// Categories used to be a row of five chips, which cost a whole header line.
// As a select they collapse to one control, and the active filter still reads
// at a glance because the closed select shows its own label.
function renderChips() {
  // The journal has no category axis — hide the filter select entirely.
  el.catNav.hidden = state.section === "journal";
  if (el.catNav.hidden) return;
  // Jobs filter by company, derived from whatever the feed actually contains.
  if (state.section === "jobs") {
    const companies = [...new Set(cur().items.map((i) => i.company).filter(Boolean))].sort();
    el.catNav.innerHTML = [`<option value="all">All companies</option>`]
      .concat(companies.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`))
      .join("");
    if (state.activeCompany !== "all" && !companies.includes(state.activeCompany)) state.activeCompany = "all";
    el.catNav.value = state.activeCompany;
    el.catNav.dataset.active = String(state.activeCompany !== "all");
    return;
  }
  // Applications filter by the sheet's category rows.
  if (state.section === "applications") {
    const cats = (cur().meta?.sections || []).map((x) => x.category);
    el.catNav.innerHTML = [`<option value="all">All categories</option>`]
      .concat(cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`))
      .join("");
    if (state.activeAppCat !== "all" && !cats.includes(state.activeAppCat)) state.activeAppCat = "all";
    el.catNav.value = state.activeAppCat;
    el.catNav.dataset.active = String(state.activeAppCat !== "all");
    return;
  }
  const builders = state.section === "builders";
  const list = builders ? KINDS : CATEGORIES;
  const active = builders ? state.activeKind : state.activeCat;
  el.catNav.innerHTML = list
    .map((c) => `<option value="${c.id}">${c.id === "all" ? (builders ? "All sources" : "All categories") : esc(c.label)}</option>`)
    .join("");
  el.catNav.value = active;
  // A non-default filter is worth flagging, since the control is now small.
  el.catNav.dataset.active = String(active !== "all");
}

function renderLangToggle() {
  el.langToggle.innerHTML = "";
  if (state.section !== "builders") return;
  for (const l of LANGS) {
    const b = document.createElement("button");
    b.className = "lang-chip";
    b.type = "button";
    b.dataset.active = String(state.lang === l.id);
    b.textContent = l.label;
    b.addEventListener("click", () => { state.lang = l.id; renderLangToggle(); render(); });
    el.langToggle.appendChild(b);
  }
}

// Date navigator: a dropdown of every available day (newest-first) + prev/next arrows.
function buildDateNav() {
  const s = cur();
  const dates = [...new Set(s.items.map((i) => i.date))].filter(isDateKey).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  s.dates = dates;
  if (s.activeDate !== "all" && !dates.includes(s.activeDate)) s.activeDate = "all";
  const opts = [`<option value="all">All dates (${dates.length})</option>`].concat(
    dates.map((d) => {
      const rel = relLabel(d);
      return `<option value="${d}">${esc(fmtFullDate(d))}${rel ? ` · ${rel}` : ""}</option>`;
    })
  );
  el.dateNav.innerHTML = opts.join("");
  el.dateNav.value = s.activeDate;
  const only = dates.length <= 1;
  el.datePrev.disabled = only;
  el.dateNext.disabled = only;
}

// Step the navigator through the (newest-first) date list. dir +1 = older, -1 = newer.
function stepDate(dir) {
  const s = cur();
  if (!s.dates.length) return;
  let idx = s.dates.indexOf(s.activeDate);
  if (idx === -1) idx = 0; // coming from "All dates" → jump to the newest day
  else idx = Math.min(s.dates.length - 1, Math.max(0, idx + dir));
  s.activeDate = s.dates[idx];
  el.dateNav.value = s.activeDate;
  render();
}

// Keep the sticky per-day date header aligned just below the (variable-height) site header.
function syncHeadHeight() {
  const h = document.querySelector(".site-header")?.offsetHeight || 150;
  document.documentElement.style.setProperty("--head-h", `${h}px`);
}

function renderFooter() {
  const s = cur();
  const n = s.items.length;
  if (state.section === "applications") {
    const cats = (s.meta?.sections || []).filter((x) => (x.jobs || []).length).length;
    el.footerMeta.textContent = `${n} application${n === 1 ? "" : "s"} across ${cats} categor${cats === 1 ? "y" : "ies"} · live from the tracker sheet`;
    return;
  }
  // The journal has no index.json — count its days from the entries themselves.
  const days = s.meta?.digests?.length ?? new Set(s.items.map((i) => i.date)).size;
  const gen = s.meta?.generatedAt ? new Date(s.meta.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  el.footerMeta.textContent = `${n} item${n === 1 ? "" : "s"} across ${days} day${days === 1 ? "" : "s"}` + (gen ? ` · updated ${gen}` : "");
}

function matches(it) {
  if (state.section !== "applications" && cur().activeDate !== "all" && it.date !== cur().activeDate) return false;
  const builders = state.section === "builders";
  const journal = state.section === "journal";
  const jobs = state.section === "jobs";
  if (builders) {
    if (state.activeKind !== "all" && (it.kind || "x") !== state.activeKind) return false;
  } else if (jobs) {
    if (dismissedRead().has(it.url)) return false;
    if (state.activeCompany !== "all" && it.company !== state.activeCompany) return false;
  } else if (state.section === "applications") {
    if (state.activeAppCat !== "all" && it.category !== state.activeAppCat) return false;
  } else if (!journal && state.activeCat !== "all" && it.category !== state.activeCat) {
    return false;
  }
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  // Chinese text is searchable too, so a 中文 query finds the same card.
  const hay = journal
    ? String(it.text || "").toLowerCase()
    : state.section === "applications"
    ? [it.company, it.position, it.category, it.status].join(" ").toLowerCase()
    : jobs
    ? [it.company, it.title, it.location, it.team, ...(it.matchedRoles || [])].join(" ").toLowerCase()
    : builders
    ? [it.author, it.role, it.title, it.takeaway, it.summary, it.summaryZh, it.takeawayZh, ...(it.tags || [])].join(" ").toLowerCase()
    : [it.title, it.summary, it.whyItMatters, it.source, ...(it.tags || [])].join(" ").toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

function youtubeEmbed(url) {
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname.includes("youtu.be")) id = u.pathname.slice(1);
    else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2];
    else id = u.searchParams.get("v") || "";
    return id ? `https://www.youtube.com/embed/${id}` : null;
  } catch { return null; }
}

function cardHTML(it, opts = {}) {
  const cat = ["models", "apps", "inspiration", "general"].includes(it.category) ? it.category : "models";
  const catLabel = { models: "Models & APIs", apps: "Language App", inspiration: "Inspiration", general: "General AI" }[cat];
  const thumb = it.image
    ? `<div class="card-thumb"><img src="${esc(it.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>`
    : "";
  const dateBadge = opts.showDate ? `<span class="result-date-badge">${esc(fmtFullDate(it.date))}</span>` : "";
  const tags = (it.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const why = it.whyItMatters
    ? `<div class="why"><b>Why it matters</b><span>${esc(it.whyItMatters)}</span></div>` : "";
  const embed = it.video ? youtubeEmbed(it.video) : null;
  let video = "";
  if (embed) video = `<div class="video-wrap"><iframe src="${embed}" title="video" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  else if (it.video) video = `<div style="margin-top:10px"><a href="${esc(it.video)}" target="_blank" rel="noopener" class="tag" style="color:var(--primary)">▶ Watch demo</a></div>`;

  const titleInner = it.url
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);

  return `<article class="card" data-cat="${cat}">
    <div class="card-top">
      <div class="card-body">
        <div class="card-meta">
          <span class="cat-tag" data-cat="${cat}">${catLabel}</span>
          ${it.source ? `<span class="source">${esc(it.source)}</span>` : ""}
          ${dateBadge}
        </div>
        <h3>${titleInner}</h3>
        ${it.summary ? `<p class="summary">${esc(it.summary)}</p>` : ""}
        ${why}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        ${video}
      </div>
      ${thumb}
    </div>
  </article>`;
}

// Builders cards lead with the person, not the headline — you scan this feed by
// "who said something today", so the author and their role are the anchor and
// the summary hangs underneath.
function builderCardHTML(it, opts = {}) {
  const kind = ["x", "podcast", "blog"].includes(it.kind) ? it.kind : "x";
  const kindLabel = { x: "X / Twitter", podcast: "Podcast", blog: "Blog" }[kind];
  const dateBadge = opts.showDate ? `<span class="result-date-badge">${esc(fmtFullDate(it.date))}</span>` : "";
  const tags = (it.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");

  const wantEn = state.lang === "en" || state.lang === "both";
  const wantZh = state.lang === "zh" || state.lang === "both";
  // Fall back to whichever language exists, so a card is never blank.
  const en = it.summary || it.summaryZh || "";
  const zh = it.summaryZh || it.summary || "";
  const takeEn = it.takeaway || it.takeawayZh || "";
  const takeZh = it.takeawayZh || it.takeaway || "";

  const takeaway = takeEn
    ? `<div class="why takeaway">
        <b>The Takeaway</b>
        <span>${wantEn ? esc(takeEn) : ""}${wantEn && wantZh ? "<br>" : ""}${wantZh ? esc(takeZh) : ""}</span>
      </div>`
    : "";

  let body = "";
  if (wantEn && en) body += `<p class="summary">${esc(en)}</p>`;
  if (wantZh && zh) body += `<p class="summary summary-zh" lang="zh">${esc(zh)}</p>`;

  // Podcasts get a real title line; tweets are titled by their author.
  const heading = kind === "podcast" && it.title
    ? `<h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>`
    : "";
  const embed = kind === "podcast" ? youtubeEmbed(it.url) : null;
  const video = embed
    ? `<div class="video-wrap"><iframe src="${embed}" title="${esc(it.title || "episode")}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`
    : "";

  return `<article class="card builder-card" data-kind="${kind}">
    <div class="card-top">
      <div class="card-body">
        <div class="card-meta">
          <span class="cat-tag" data-kind="${kind}">${kindLabel}</span>
          ${dateBadge}
        </div>
        <div class="builder-who">
          <span class="builder-name">${esc(it.author || "")}</span>
          ${it.role ? `<span class="builder-role">${esc(it.role)}</span>` : ""}
        </div>
        ${heading}
        ${takeaway}
        ${body}
        ${video}
        ${it.url ? `<div class="builder-link"><a href="${esc(it.url)}" target="_blank" rel="noopener">${kind === "podcast" ? "Watch episode" : "Read on X"} →</a></div>` : ""}
        ${tags ? `<div class="tags">${tags}</div>` : ""}
      </div>
    </div>
  </article>`;
}

// Journal entries are freeform dictation: paragraphs (blank-line separated)
// become <p>s, single newlines stay as line breaks, and the timestamp plus a
// delete button are the only chrome.
function journalCardHTML(it, opts = {}) {
  const dateBadge = opts.showDate ? `<span class="result-date-badge">${esc(fmtFullDate(it.date))}</span>` : "";
  const paras = String(it.text || "")
    .split(/\n{2,}/)
    .map((p) => `<p class="summary">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<article class="card journal-card">
    <div class="card-top">
      <div class="card-body">
        <div class="card-meta">
          <span class="cat-tag journal-tag">Journal</span>
          <span class="source">${fmtTime(it.ts)}</span>
          ${dateBadge}
          <button class="journal-del" type="button" data-id="${esc(it.id)}" title="Delete entry">×</button>
        </div>
        ${paras}
      </div>
    </div>
  </article>`;
}

// One new posting per card: company leads (you scan this feed by employer),
// the title links to the live posting, chips carry location and matched roles.
function jobCardHTML(it, opts = {}) {
  const dateBadge = opts.showDate ? `<span class="result-date-badge">${esc(fmtFullDate(it.date))}</span>` : "";
  const posted = it.postedAt
    ? `<span class="tag">🗓 posted ${esc(fmtFullDate(String(it.postedAt).slice(0, 10)))}</span>` : "";
  const chips = [
    posted,
    it.location ? `<span class="tag">📍 ${esc(it.location)}</span>` : "",
    it.team ? `<span class="tag">${esc(it.team)}</span>` : "",
    ...(it.matchedRoles || []).map((r) => `<span class="tag job-role-tag">${esc(r)}</span>`),
  ].filter(Boolean).join("");
  return `<article class="card job-card">
    <div class="card-top">
      <div class="card-body">
        <div class="card-meta">
          <span class="cat-tag job-tag">New posting</span>
          <span class="source">${esc(it.company || "")}</span>
          ${dateBadge}
          <button class="journal-del job-del" type="button" data-url="${esc(it.url)}" title="Remove this posting">×</button>
        </div>
        <h3><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
        ${chips ? `<div class="tags">${chips}</div>` : ""}
      </div>
    </div>
  </article>`;
}

// One tracked application: company leads, position under it, both dates as
// quiet badges. Same card chrome as the rest of the site.
function fmtSheetDate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /\d{4}/.test(s)) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return s;
}

function appCardHTML(it) {
  const applied = it.appliedDate
    ? `<span class="result-date-badge">applied ${esc(it.appliedDate)}</span>` : "";
  const posted = it.postedDate
    ? `<span class="source">posted ${esc(fmtSheetDate(it.postedDate))}</span>` : "";
  const status = it.status
    ? `<span class="cat-tag" data-cat="apps">${esc(it.status)}</span>` : "";
  return `<article class="card app-card" data-cat="inspiration" data-appkey="${esc(it.appKey || "")}">
    <div class="card-top"><div class="card-body">
      <div class="card-meta">${status}${applied}${posted}</div>
      <h3>${esc(it.company)}</h3>
      ${it.position ? `<p class="summary">${esc(it.position)}</p>` : ""}
    </div></div>
  </article>`;
}

// The per-application workspace: full JD context, the outreach contact list
// and generated drafts. Everything sensitive sits behind the token-gated
// workspace fetch; mutations go through appsPost (token attached).
let appsDraftCache = {};

function statusChip(st) {
  const s = String(st || "").toLowerCase();
  const tone = s === "drafted" ? "inspiration" : s === "error" ? "apps" : "general";
  return `<span class="cat-tag" data-cat="${tone}">${esc(st || "queued")}</span>`;
}

function renderAppDetail(key) {
  const m = cur().meta || {};
  const item = cur().items.find((i) => i.appKey === key);
  const link = m.linkMap || {};
  const ctx = (m.appdata || {})[key]
    || Object.values(m.appdata || {}).find((c) => link[c.appKey] === key);
  const contacts = (m.outreach || []).filter((c) => c.appKey === key || link[c.appKey] === key);
  appsDraftCache = {};

  const head = item
    ? `<h2>${esc(item.company)}</h2>
       <p class="summary">${esc(item.position)} · ${esc(item.category)}${item.appliedDate ? ` · applied ${esc(item.appliedDate)}` : ""}${item.status ? ` · ${esc(item.status)}` : ""}</p>`
    : `<h2>${esc(key)}</h2>`;

  // Everything on this page that arrived through the alias repair rather than a
  // real key match. The repair is recomputed on every load, so offer to make it
  // permanent by writing this row's key onto the strays.
  const strayKeys = [...new Set([
    ...(ctx && ctx.appKey !== key ? [ctx.appKey] : []),
    ...contacts.filter((c) => c.appKey !== key).map((c) => c.appKey),
  ])];
  const relinkHtml = strayKeys.length
    ? `<p class="summary">🔗 Matched by spelling, not by key — the tracker row and the saved data disagree on the company or title.
       <button class="oc-btn oc-primary" type="button" data-act="relink" data-to="${esc(key)}"
         data-from="${esc(strayKeys.join(","))}">Make this link permanent</button></p>`
    : "";
  // An unlinked card is saved data with no tracker row at all — let it be
  // attached to one by hand, since no alias could work it out.
  const pickerHtml = item && item.unlinked
    ? `<p class="summary">This is saved data with no matching tracker row. Attach it to one:
       <select id="relink-target">${cur().items.filter((i) => !i.unlinked)
         .sort((a, b) => (a.company + a.position).localeCompare(b.company + b.position))
         .map((i) => `<option value="${esc(i.appKey)}">${esc(i.company)} — ${esc(i.position)}</option>`).join("")}</select>
       <button class="oc-btn oc-primary" type="button" data-act="relink-pick" data-from="${esc(key)}">Attach</button></p>`
    : "";

  const ctxHtml = ctx
    ? `${ctx.url ? `<p><a href="${esc(ctx.url)}" target="_blank" rel="noopener">Open the original posting ↗</a></p>` : ""}
       <details class="jd-details" open><summary>Job description${ctx.postDate ? ` · posted ${esc(fmtSheetDate(ctx.postDate))}` : ""}</summary>
       <pre class="jd-pre">${esc(ctx.description || "(no description captured)")}</pre></details>`
    : `<p class="summary">No saved context for this application yet — save it through the Smart JobFill extension (💼 Save job → Add to Sheet) and it will appear here.</p>`;

  const contactsHtml = contacts.map((c) => {
    let drafts = null;
    try { drafts = c.draftsJson ? JSON.parse(c.draftsJson) : null; } catch { drafts = null; }
    if (drafts) appsDraftCache[c.id] = drafts;
    const draftBlocks = drafts
      ? ["connect", "message", "email"].filter((f) => drafts[f]).map((f) => `
          <details class="draft-details"><summary>${{ connect: "Connect note", message: "LinkedIn message", email: "Email" }[f]}</summary>
            <pre class="jd-pre">${esc(drafts[f].draft || drafts[f])}</pre>
            <button class="oc-btn" type="button" data-act="copy-draft" data-id="${esc(c.id)}" data-fmt="${f}">Copy</button>
            ${f === "email" ? `<button class="oc-btn oc-primary" type="button" data-act="gmail-draft" data-id="${esc(c.id)}">Open in Gmail ↗</button>` : ""}
          </details>`).join("")
      : "";
    const guess = drafts && drafts.emailGuess && (drafts.emailGuess.candidates || []).length
      ? `<p class="summary">✉ Guessed email (unverified): ${drafts.emailGuess.candidates.map((g) =>
          `<button class="oc-btn" type="button" data-act="copy-text" data-text="${esc(g)}">${esc(g)}</button>`).join(" ")}
          <span class="source">${esc(drafts.emailGuess.rationale || "")}</span></p>`
      : "";
    const sims = c.similarities ? `<p class="summary">🧭 ${esc(c.similarities)}</p>` : "";
    const err = String(c.status).toLowerCase() === "error" && c.error ? `<p class="summary">⚠ ${esc(c.error)}</p>` : "";
    return `<article class="card" data-cat="models"><div class="card-body">
      <div class="card-meta">${statusChip(c.status)}
        <a class="source" href="${esc(c.linkedinUrl)}" target="_blank" rel="noopener">${esc(c.linkedinUrl)}</a>
        <button class="oc-btn oc-del" type="button" data-act="del-contact" data-id="${esc(c.id)}" title="Remove">✕</button>
      </div>
      ${sims}${err}${guess}${draftBlocks}
    </div></article>`;
  }).join("");

  el.feed.innerHTML = `
    <p><a href="#applications">← All applications</a></p>
    ${head}
    ${relinkHtml}${pickerHtml}
    ${ctxHtml}
    <div class="date-head" style="margin-top:24px"><h2>Team contacts</h2>
      <span class="count">${contacts.length} · drafts auto-generate within ~30 min of queueing</span></div>
    <div class="oc-add">
      <input type="url" id="oc-url" placeholder="https://www.linkedin.com/in/…" />
      <button class="oc-btn oc-primary" type="button" data-act="add-contact" data-key="${esc(key)}">Add &amp; queue</button>
      <button class="oc-btn" type="button" data-act="refresh-apps">Refresh</button>
    </div>
    ${contactsHtml || `<p class="summary">No contacts yet. Paste LinkedIn URLs of people on this team (or adjacent teams) — the local outreach agent fetches each profile and drafts a connect note, message and email using this JD and your resume.</p>`}
  `;
}

el.feed.addEventListener("click", async (e) => {
  const actEl = e.target.closest("[data-act]");
  if (actEl) {
    const act = actEl.dataset.act;
    if (act === "add-contact") {
      const input = document.getElementById("oc-url");
      const url = input.value.trim();
      if (!url.includes("linkedin.com/")) { input.focus(); return; }
      actEl.disabled = true;
      const res = await appsPost({ type: "addContact", appKey: actEl.dataset.key, linkedinUrl: url });
      if (res.ok) { state.applications.loaded = false; state.applications.failed = false; await showSection("applications"); }
      else { actEl.disabled = false; alert(res.error || "failed"); }
    }
    if (act === "relink" || act === "relink-pick") {
      const pick = document.getElementById("relink-target");
      const from = act === "relink" ? actEl.dataset.from.split(",") : [actEl.dataset.from];
      const to = act === "relink" ? actEl.dataset.to : (pick && pick.value);
      if (!to) return;
      actEl.disabled = true;
      const res = await appsPost({ type: "relink", from, to });
      if (res.ok) {
        state.applications.loaded = false;
        state.applications.failed = false;
        const target = `#applications/${to}`;
        // hashchange re-renders on its own; only drive it manually when the
        // route is already correct (the "make permanent" case stays put).
        if (location.hash === target) await showSection("applications");
        else location.hash = target;
      } else {
        actEl.disabled = false;
        alert(res.error === "unknown type"
          ? "The sheet script doesn't know 'relink' yet — redeploy the Apps Script web app to pick it up."
          : (res.error || "relink failed"));
      }
    }
    if (act === "del-contact") {
      actEl.disabled = true;
      const res = await appsPost({ type: "removeContact", id: actEl.dataset.id });
      if (res.ok) { state.applications.loaded = false; state.applications.failed = false; await showSection("applications"); }
    }
    if (act === "refresh-apps") {
      state.applications.loaded = false;
      state.applications.failed = false;
      await showSection("applications");
    }
    if (act === "cal-clear") {
      e.preventDefault();
      appsSelectedDay = null;
      render();
    }
    if (act === "star-app") {
      toggleAppStar(actEl.dataset.appkey);
      render();
    }
    if (act === "del-app") {
      const d = actEl.dataset;
      if (!confirm(`Delete "${d.company} — ${d.position}" from the tracker sheet?`)) return;
      actEl.disabled = true;
      const res = await appsPost({
        type: "removeTrackerRow",
        company: d.company, position: d.position,
        appliedDate: d.applied, appKey: d.appkey,
      });
      if (res.ok) {
        state.applications.loaded = false;
        state.applications.failed = false;
        await showSection("applications");
      } else {
        actEl.disabled = false;
        alert(res.error || "Delete failed");
      }
    }
    if (act === "copy-draft") {
      const d = (appsDraftCache[actEl.dataset.id] || {})[actEl.dataset.fmt];
      if (d) { await navigator.clipboard.writeText(d.draft || d); actEl.textContent = "Copied ✓"; setTimeout(() => { actEl.textContent = "Copy"; }, 1200); }
    }
    if (act === "copy-text") {
      await navigator.clipboard.writeText(actEl.dataset.text);
      const orig = actEl.textContent;
      actEl.textContent = "Copied ✓";
      setTimeout(() => { actEl.textContent = orig; }, 1200);
    }
    if (act === "gmail-draft") {
      const drafts = appsDraftCache[actEl.dataset.id] || {};
      const raw = String(drafts.email?.draft || drafts.email || "");
      // First line carries "Subject: ..." per the engine's format spec.
      const mSub = raw.match(/^\s*Subject:\s*(.+)$/im);
      const subject = mSub ? mSub[1].trim() : "";
      const body = mSub ? raw.replace(mSub[0], "").trim() : raw.trim();
      const to = drafts.emailGuess?.candidates?.[0] || "";
      window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
    }
    return;
  }
  // Calendar day click → filter the list to that date (toggle).
  if (state.section === "applications" && !state.appsDetail) {
    const cell = e.target.closest(".cal-cell.cal-has");
    if (cell) {
      appsSelectedDay = cell.dataset.day === appsSelectedDay ? null : cell.dataset.day;
      render();
      return;
    }
    // Card click → per-application workspace.
    const card = e.target.closest(".card[data-appkey]");
    if (card) location.hash = `applications/${encodeURIComponent(card.dataset.appkey)}`;
  }
});

let appsSelectedDay = null;

// Starred applications pin to the top of the list (browser-local, like the
// token and Journal — no sheet writes).
const APPS_STARS_KEY = "nr_apps_stars";
const appStars = () => new Set(JSON.parse(localStorage.getItem(APPS_STARS_KEY) || "[]"));
function toggleAppStar(k) {
  const s = appStars();
  if (s.has(k)) s.delete(k); else s.add(k);
  localStorage.setItem(APPS_STARS_KEY, JSON.stringify([...s]));
}

function parseAppliedDate(v) {
  const str = String(v || "").trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

const calYmd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// GitHub-style contribution calendar of applications over the last 12 months.
// Green opacity scales with that day's count; today is blue; clicking a day
// with activity filters the list below to that date.
function appsCalendarHTML(counts) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 364 - today.getDay());
  const max = Math.max(1, ...counts.values());
  const weeks = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || !weeks.length) weeks.push([]);
    weeks[weeks.length - 1].push(new Date(d));
  }
  const todayKey = calYmd(today);
  const grid = weeks.map((week) => `<div class="cal-week">${week.map((d) => {
    const k = calYmd(d);
    const c = counts.get(k) || 0;
    const isToday = k === todayKey;
    const op = (0.25 + 0.75 * (c / max)).toFixed(2);
    const cls = `cal-cell${c ? " cal-has" : ""}${isToday ? " cal-today" : ""}${k === appsSelectedDay ? " cal-sel" : ""}`;
    const bg = c && !isToday ? ` style="background:rgba(47,158,68,${op})"` : "";
    return `<i class="${cls}" data-day="${k}"${bg} title="${k} · ${c} applied"></i>`;
  }).join("")}</div>`).join("");
  const labels = weeks.map((week) => {
    const first = week.find((d) => d.getDate() === 1);
    return `<span class="cal-ml">${first ? first.toLocaleDateString("en-US", { month: "short" }) : ""}</span>`;
  }).join("");
  return `<div class="cal-wrap"><div class="cal-scroll"><div class="cal-months">${labels}</div><div class="cal-grid">${grid}</div></div></div>`;
}

function thinAppCardHTML(it) {
  const d = parseAppliedDate(it.appliedDate);
  const applied = d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const starred = appStars().has(it.appKey);
  return `<article class="card app-card app-thin${starred ? " app-starred" : ""}" data-appkey="${esc(it.appKey)}">
    <div class="card-body app-thin-row">
      <div class="app-thin-main"><button class="oc-btn star-btn${starred ? " on" : ""}" type="button" data-act="star-app" data-appkey="${esc(it.appKey)}" title="${starred ? "Unstar" : "Pin to top"}">${starred ? "★" : "☆"}</button><b>${esc(it.company)}</b><span class="app-thin-pos">${esc(it.position)}</span></div>
      <div class="app-thin-meta">
        ${it.status ? `<span class="cat-tag" data-cat="general">${esc(it.status)}</span>` : ""}
        <span class="source">${esc(it.category)}</span>
        ${it.postedDate ? `<span class="source">posted ${esc(fmtSheetDate(it.postedDate))}</span>` : ""}
        ${applied ? `<span class="source">applied ${esc(applied)}</span>` : ""}
        <button class="oc-btn oc-del" type="button" data-act="del-app" data-appkey="${esc(it.appKey)}"
          data-company="${esc(it.company)}" data-position="${esc(it.position)}" data-applied="${esc(it.appliedDate || "")}"
          title="Delete this application from the tracker sheet">✕</button>
      </div>
    </div></article>`;
}

function renderApplications(visible) {
  const counts = new Map();
  for (const it of visible) {
    const d = parseAppliedDate(it.appliedDate);
    if (!d) continue;
    const k = calYmd(d);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const stars = appStars();
  const dateDesc = (a, b) => (parseAppliedDate(b.appliedDate) || 0) - (parseAppliedDate(a.appliedDate) || 0);
  let list, heading;
  if (appsSelectedDay) {
    list = visible.filter((it) => {
      const d = parseAppliedDate(it.appliedDate);
      return d && calYmd(d) === appsSelectedDay;
    }).sort((a, b) => (stars.has(b.appKey) - stars.has(a.appKey)) || dateDesc(a, b));
    const [y, mo, da] = appsSelectedDay.split("-").map(Number);
    const label = new Date(y, mo - 1, da).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    heading = `<h2>${label}</h2><span class="count">${list.length} applied · <a href="#applications" data-act="cal-clear">show recent</a></span>`;
  } else {
    // Starred pins float above the recent-10, whatever their date.
    const starred = visible.filter((it) => stars.has(it.appKey)).sort(dateDesc);
    const rest = visible
      .filter((it) => !stars.has(it.appKey) && parseAppliedDate(it.appliedDate))
      .sort(dateDesc)
      .slice(0, 10);
    list = [...starred, ...rest];
    heading = `<h2>Recent applications</h2><span class="count">${starred.length ? `${starred.length} pinned + ` : ""}latest ${rest.length} of ${visible.length} · click a day above to filter</span>`;
  }
  // Saved context with no tracker row has no applied date, so it can never
  // reach the recent list or a calendar day. It gets its own group instead of
  // silently disappearing.
  const strays = appsSelectedDay ? [] : visible.filter((it) => it.unlinked && !stars.has(it.appKey));
  const straysHtml = strays.length
    ? `<div class="date-head" style="margin-top:24px"><h2>Saved, not in the tracker</h2>
       <span class="count">${strays.length} · JD or outreach notes saved, but no tracker row matches — check the company and title spelling</span></div>
       ${strays.map(thinAppCardHTML).join("")}`
    : "";
  el.feed.innerHTML = `
    ${appsCalendarHTML(counts)}
    <div class="date-head">${heading}</div>
    ${list.map(thinAppCardHTML).join("") || `<p class="summary">Nothing applied on this day.</p>`}
    ${straysHtml}
  `;
}

function render() {
  const isBuilders = state.section === "builders";
  const isJournal = state.section === "journal";
  const isJobs = state.section === "jobs";
  const card = isJournal ? journalCardHTML : isJobs ? jobCardHTML : isBuilders ? builderCardHTML : cardHTML;
  const visible = cur().items.filter(matches);
  const searching = !!state.query.trim();

  if (!visible.length) {
    el.feed.innerHTML = `<div class="status">No results${searching ? ` for “${esc(state.query.trim())}”` : ""}.</div>`;
    return;
  }

  if (state.section === "applications") {
    if (state.appsDetail) return renderAppDetail(state.appsDetail);
    return renderApplications(visible);
  }

  if (searching) {
    // Flat, newest-first, with a date badge on each card.
    const flat = [...visible].sort(sortKeyDesc);
    el.feed.innerHTML = `<div class="date-group">${flat.map((it) => card(it, { showDate: true })).join("")}</div>`;
    return;
  }

  // Grouped by date, newest first.
  const groups = new Map();
  for (const it of visible) {
    if (!groups.has(it.date)) groups.set(it.date, []);
    groups.get(it.date).push(it);
  }
  const keys = [...groups.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  el.feed.innerHTML = keys.map((k) => {
    const items = groups.get(k);
    // Radar pins `general` AI filler last; builders lead with X and close with
    // the long-form podcast, which reads better than the authored order.
    // Journal entries are already newest-first; jobs group naturally by company.
    const ordered = isJournal || isJobs
      ? items
      : isBuilders
      ? [...items.filter((it) => (it.kind || "x") !== "podcast"), ...items.filter((it) => it.kind === "podcast")]
      : [...items.filter((it) => it.category !== GENERAL), ...items.filter((it) => it.category === GENERAL)];
    const rel = relLabel(k);
    return `<section class="date-group">
      <div class="date-head">
        <h2>${esc(fmtFullDate(k))}</h2>
        ${rel ? `<span class="date-rel">${rel}</span>` : ""}
        <span class="count">${ordered.length} item${ordered.length === 1 ? "" : "s"}</span>
      </div>
      ${ordered.map((it) => card(it)).join("")}
    </section>`;
  }).join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- events ----------
let searchTimer;
el.search.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => { state.query = v; render(); }, 90);
});

el.catNav.addEventListener("change", (e) => {
  if (state.section === "builders") state.activeKind = e.target.value;
  else if (state.section === "jobs") state.activeCompany = e.target.value;
  else if (state.section === "applications") state.activeAppCat = e.target.value;
  else state.activeCat = e.target.value;
  renderChips();
  render();
});
el.dateNav.addEventListener("change", (e) => { cur().activeDate = e.target.value; render(); });
el.datePrev.addEventListener("click", () => stepDate(1));   // older
el.dateNext.addEventListener("click", () => stepDate(-1));  // newer
window.addEventListener("resize", syncHeadHeight);

// Sections are hash-routed so a tab is linkable and survives a refresh.
el.sections.addEventListener("click", (e) => {
  const btn = e.target.closest(".section-tab");
  if (!btn) return;
  const name = btn.dataset.section;
  if (name === state.section) return;
  location.hash = name === "radar" ? "" : `#${name}`;
  showSection(name);
});

// ---------- journal composer ----------
function closeEditor() {
  el.journalEditor.hidden = true;
  el.journalNew.hidden = false;
  el.journalText.value = "";
}
el.journalNew.addEventListener("click", () => {
  el.journalNew.hidden = true;
  el.journalEditor.hidden = false;
  // Focus so VoiceOS dictation lands straight in the box.
  el.journalText.focus();
});
el.journalCancel.addEventListener("click", closeEditor);

function saveEntry() {
  const text = el.journalText.value.trim();
  if (!text) { closeEditor(); return; }
  const entries = journalRead();
  entries.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    ts: new Date().toISOString(),
    text,
  });
  journalWrite(entries);
  closeEditor();
  showSection("journal");
}
el.journalSave.addEventListener("click", saveEntry);
el.journalText.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveEntry();
});

// Deleting is two-tap (× → “Delete?”) instead of a blocking confirm dialog.
// Shared by journal entries and job postings; jobs "delete" hides the posting
// in this browser (the feed itself is static, published JSON).
el.feed.addEventListener("click", (e) => {
  const btn = e.target.closest(".journal-del");
  if (!btn) return;
  if (btn.dataset.armed !== "true") {
    btn.dataset.armed = "true";
    btn.textContent = "Delete?";
    setTimeout(() => { btn.dataset.armed = "false"; btn.textContent = "×"; }, 2600);
    return;
  }
  if (btn.classList.contains("job-del")) {
    dismissPosting(btn.dataset.url);
    renderChips();
    render();
    renderFooter();
    return;
  }
  journalWrite(journalRead().filter((en) => en.id !== btn.dataset.id));
  showSection("journal");
});

// Backup: every entry as one Markdown file, oldest day first.
el.journalExport.addEventListener("click", () => {
  const entries = journalRead().sort((a, b) => (a.ts < b.ts ? -1 : 1));
  if (!entries.length) return;
  let md = "# Market Journal\n";
  let day = "";
  for (const en of entries) {
    const d = ymd(new Date(en.ts));
    if (d !== day) { md += `\n## ${fmtFullDate(d)}\n`; day = d; }
    md += `\n### ${fmtTime(en.ts)}\n\n${en.text}\n`;
  }
  const blob = new Blob([md], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "market-journal.md";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- jobs watchlist form ----------
function closeJobsForm() {
  el.jobsForm.hidden = true;
  el.jobsAddBtn.hidden = false;
  el.jobsUrl.value = "";
  el.jobsCompany.value = "";
  el.jobsRoles.value = "";
  el.jobsCountries.value = "";
}
el.jobsAddBtn.addEventListener("click", () => {
  el.jobsAddBtn.hidden = true;
  el.jobsForm.hidden = false;
  el.jobsUrl.focus();
});
el.jobsCancel.addEventListener("click", closeJobsForm);
// Auto-detect the company as soon as the URL is pasted; never overwrite a
// name the user has already typed themselves.
el.jobsUrl.addEventListener("input", () => {
  if (!el.jobsCompany.value.trim() || el.jobsCompany.dataset.auto === "true") {
    const guess = companyFromUrl(el.jobsUrl.value.trim());
    if (guess) { el.jobsCompany.value = guess; el.jobsCompany.dataset.auto = "true"; }
  }
});
el.jobsCompany.addEventListener("input", () => { el.jobsCompany.dataset.auto = "false"; });

el.jobsSave.addEventListener("click", () => {
  const careersUrl = el.jobsUrl.value.trim();
  const company = el.jobsCompany.value.trim() || companyFromUrl(careersUrl);
  const roles = el.jobsRoles.value.trim();
  try { new URL(careersUrl); } catch { el.jobsUrl.focus(); return; }
  if (!company) { el.jobsCompany.focus(); return; }
  if (effectiveWatchlist().some((c) => c.careersUrl === careersUrl)) { closeJobsForm(); return; }
  const p = pendingRead();
  p.added.push({
    id: company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    company,
    careersUrl,
    roles,
    countries: el.jobsCountries.value.trim(),
    addedAt: new Date().toISOString(),
  });
  p.removed = p.removed.filter((u) => u !== careersUrl);
  pendingWrite(p);
  closeJobsForm();
  renderWatchlist();
});

el.jobsWatchlist.addEventListener("click", (e) => {
  const edit = e.target.closest(".watch-edit");
  if (edit) {
    watchEditing = edit.dataset.url;
    renderWatchlist();
    el.jobsWatchlist.querySelector(".watch-editing .we-company")?.focus();
    return;
  }
  const cancel = e.target.closest(".watch-cancel");
  if (cancel) {
    watchEditing = null;
    renderWatchlist();
    return;
  }
  const save = e.target.closest(".watch-save");
  if (save) {
    const row = save.closest(".watch-row");
    const get = (cls) => row.querySelector(cls)?.value.trim() ?? "";
    const careersUrl = get(".we-url");
    const company = get(".we-company");
    try { new URL(careersUrl); } catch { row.querySelector(".we-url")?.focus(); return; }
    if (!company) { row.querySelector(".we-company")?.focus(); return; }
    const ok = applyWatchEdit(save.dataset.url, {
      id: company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      company,
      careersUrl,
      roles: get(".we-roles"),
      countries: get(".we-countries"),
    });
    if (!ok) { row.querySelector(".we-url")?.focus(); return; }
    watchEditing = null;
    renderWatchlist();
    return;
  }
  const btn = e.target.closest(".watch-remove");
  if (!btn) return;
  const url = btn.dataset.url;
  const p = pendingRead();
  if (p.added.some((c) => c.careersUrl === url)) {
    p.added = p.added.filter((c) => c.careersUrl !== url);
  } else if (!p.removed.includes(url)) {
    p.removed.push(url);
  }
  pendingWrite(p);
  if (watchEditing === url) watchEditing = null;
  renderWatchlist();
});

el.jobsSync.addEventListener("click", downloadWatchlist);

function sectionFromHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, sub] = h.split("/");
  state.appsDetail = name === "applications" && sub ? decodeURIComponent(sub) : null;
  return SECTIONS[name] ? name : "radar";
}

window.addEventListener("hashchange", () => {
  // Always re-show: the section may be unchanged while the
  // #applications/<appKey> sub-route changed.
  showSection(sectionFromHash());
});

showSection(sectionFromHash());

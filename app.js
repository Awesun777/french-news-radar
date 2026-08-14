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
};

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
  lang: "en",                // builders only
  radar: blankSection(),
  builders: blankSection(),
  journal: blankSection(),
  jobs: blankSection(),
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
  const repoUrls = new Set(repoWatchlist.map((c) => c.careersUrl));
  const next = {
    added: p.added.filter((c) => !repoUrls.has(c.careersUrl)),
    removed: p.removed.filter((url) => repoUrls.has(url)),
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

async function loadWatchlist() {
  try {
    const data = await getJSON("./jobs/watchlist.json");
    repoWatchlist = Array.isArray(data.companies) ? data.companies : [];
  } catch { repoWatchlist = []; }
  renderWatchlist();
}

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
      <button class="watch-remove" type="button" data-url="${esc(c.careersUrl)}" title="Stop watching">×</button>
    </div>`;
  }).join("");
}

function downloadWatchlist() {
  const payload = { updatedAt: new Date().toISOString(), companies: effectiveWatchlist() };
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "watchlist.json";
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
  if (name === "jobs") loadWatchlist();

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
    el.status.textContent = SECTIONS[name].empty;
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
  // The journal has no index.json — count its days from the entries themselves.
  const days = s.meta?.digests?.length ?? new Set(s.items.map((i) => i.date)).size;
  const gen = s.meta?.generatedAt ? new Date(s.meta.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  el.footerMeta.textContent = `${n} item${n === 1 ? "" : "s"} across ${days} day${days === 1 ? "" : "s"}` + (gen ? ` · updated ${gen}` : "");
}

function matches(it) {
  if (cur().activeDate !== "all" && it.date !== cur().activeDate) return false;
  const builders = state.section === "builders";
  const journal = state.section === "journal";
  const jobs = state.section === "jobs";
  if (builders) {
    if (state.activeKind !== "all" && (it.kind || "x") !== state.activeKind) return false;
  } else if (jobs) {
    if (dismissedRead().has(it.url)) return false;
    if (state.activeCompany !== "all" && it.company !== state.activeCompany) return false;
  } else if (!journal && state.activeCat !== "all" && it.category !== state.activeCat) {
    return false;
  }
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  // Chinese text is searchable too, so a 中文 query finds the same card.
  const hay = journal
    ? String(it.text || "").toLowerCase()
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
  renderWatchlist();
});

el.jobsSync.addEventListener("click", downloadWatchlist);

function sectionFromHash() {
  const h = location.hash.replace(/^#\/?/, "");
  return SECTIONS[h] ? h : "radar";
}

window.addEventListener("hashchange", () => {
  const name = sectionFromHash();
  if (name !== state.section) showSection(name);
});

showSection(sectionFromHash());

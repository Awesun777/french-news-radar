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
  lang: "en",                // builders only
  radar: blankSection(),
  builders: blankSection(),
  journal: blankSection(),
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
  // the composer only for the journal.
  el.langToggle.hidden = name !== "builders";
  el.compose.hidden = name !== "journal";

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
  if (builders) {
    if (state.activeKind !== "all" && (it.kind || "x") !== state.activeKind) return false;
  } else if (!journal && state.activeCat !== "all" && it.category !== state.activeCat) {
    return false;
  }
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  // Chinese text is searchable too, so a 中文 query finds the same card.
  const hay = journal
    ? String(it.text || "").toLowerCase()
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

function render() {
  const isBuilders = state.section === "builders";
  const isJournal = state.section === "journal";
  const card = isJournal ? journalCardHTML : isBuilders ? builderCardHTML : cardHTML;
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
    // Journal entries are already newest-first within the day.
    const ordered = isJournal
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
el.feed.addEventListener("click", (e) => {
  const btn = e.target.closest(".journal-del");
  if (!btn) return;
  if (btn.dataset.armed !== "true") {
    btn.dataset.armed = "true";
    btn.textContent = "Delete?";
    setTimeout(() => { btn.dataset.armed = "false"; btn.textContent = "×"; }, 2600);
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

function sectionFromHash() {
  const h = location.hash.replace(/^#\/?/, "");
  return SECTIONS[h] ? h : "radar";
}

window.addEventListener("hashchange", () => {
  const name = sectionFromHash();
  if (name !== state.section) showSection(name);
});

showSection(sectionFromHash());

// News Radar — vanilla ES module.
// Loads news/index.json (catalog), then each day's file, and renders a
// date-grouped feed with client-side search + category filtering.

const CATEGORIES = [
  { id: "all", label: "All", dot: null },
  { id: "models", label: "Models & APIs", dot: "var(--accent-models)" },
  { id: "apps", label: "Language Apps", dot: "var(--accent-apps)" },
  { id: "inspiration", label: "Build Inspiration", dot: "var(--accent-inspiration)" },
];

const state = {
  items: [],        // flattened, each carries .date
  activeCat: "all",
  query: "",
  meta: null,
};

const el = {
  status: document.getElementById("status"),
  feed: document.getElementById("feed"),
  chips: document.getElementById("chips"),
  search: document.getElementById("search"),
  footerMeta: document.getElementById("footer-meta"),
};

// ---------- date helpers ----------
const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
// Local-time YYYY-MM-DD (matches the `date +%F` keys the skill writes; avoids a
// UTC/local off-by-one that would mislabel today's digest as "Yesterday").
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDateLabel(key) {
  if (!isDateKey(key)) return key;
  const today = ymd(new Date());
  const yest = ymd(new Date(Date.now() - 86400000));
  if (key === today) return "Today";
  if (key === yest) return "Yesterday";
  return new Date(key + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function sortKeyDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }

// ---------- fetch ----------
async function getJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function load() {
  let index;
  try {
    index = await getJSON("./news/index.json");
  } catch (e) {
    el.status.textContent = "No digests yet. Run the /news-digest skill to generate the first one.";
    return;
  }
  state.meta = index;
  const digests = Array.isArray(index.digests) ? [...index.digests].sort(sortKeyDesc) : [];
  if (!digests.length) {
    el.status.textContent = "No digests yet. Run the /news-digest skill to generate the first one.";
    return;
  }

  // Fetch every day's file in parallel; tolerate individual failures.
  const days = await Promise.all(
    digests.map((d) =>
      getJSON(`./news/${d.date}.json`)
        .then((day) => (day.items || []).map((it) => ({ ...it, date: it.date || d.date })))
        .catch(() => [])
    )
  );
  state.items = days.flat();

  if (!state.items.length) {
    el.status.textContent = "Digests are listed but no items could be loaded.";
    return;
  }

  el.status.hidden = true;
  el.feed.hidden = false;
  renderChips();
  renderFooter();
  render();
}

// ---------- rendering ----------
function renderChips() {
  el.chips.innerHTML = "";
  for (const c of CATEGORIES) {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.cat = c.id;
    b.dataset.active = String(state.activeCat === c.id);
    b.innerHTML = (c.dot ? `<span class="dot" style="background:${c.dot}"></span>` : "") + c.label;
    b.addEventListener("click", () => { state.activeCat = c.id; renderChips(); render(); });
    el.chips.appendChild(b);
  }
}

function renderFooter() {
  const n = state.items.length;
  const days = state.meta?.digests?.length ?? 0;
  const gen = state.meta?.generatedAt ? new Date(state.meta.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  el.footerMeta.textContent = `${n} item${n === 1 ? "" : "s"} across ${days} day${days === 1 ? "" : "s"}` + (gen ? ` · updated ${gen}` : "");
}

function matches(it) {
  if (state.activeCat !== "all" && it.category !== state.activeCat) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [it.title, it.summary, it.whyItMatters, it.source, ...(it.tags || [])].join(" ").toLowerCase();
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
  const cat = ["models", "apps", "inspiration"].includes(it.category) ? it.category : "models";
  const catLabel = { models: "Models & APIs", apps: "Language App", inspiration: "Inspiration" }[cat];
  const thumb = it.image
    ? `<div class="card-thumb"><img src="${esc(it.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>`
    : "";
  const dateBadge = opts.showDate ? `<span class="result-date-badge">${esc(fmtDateLabel(it.date))}</span>` : "";
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

function render() {
  const visible = state.items.filter(matches);
  const searching = !!state.query.trim();

  if (!visible.length) {
    el.feed.innerHTML = `<div class="status">No results${searching ? ` for “${esc(state.query.trim())}”` : ""}.</div>`;
    return;
  }

  if (searching) {
    // Flat, newest-first, with a date badge on each card.
    const flat = [...visible].sort(sortKeyDesc);
    el.feed.innerHTML = `<div class="date-group">${flat.map((it) => cardHTML(it, { showDate: true })).join("")}</div>`;
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
    return `<section class="date-group">
      <div class="date-head"><h2>${esc(fmtDateLabel(k))}</h2><span class="count">${items.length} item${items.length === 1 ? "" : "s"}</span></div>
      ${items.map((it) => cardHTML(it)).join("")}
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

load();

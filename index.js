/* ================================================================
   Shared helpers + state
================================================================ */
const pad = n => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const now = new Date();
const TODAY_ISO = isoOf(now.getFullYear(), now.getMonth(), now.getDate());

const fmtLong = isoStr => {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};

const state = { date: TODAY_ISO, category: null };

function setState(patch) {
  Object.assign(state, patch);
  document.dispatchEvent(new CustomEvent("statechange", { detail: { ...state } }));
  applyFilters();
}

/* Show/hide blurb-card hosts based on the active date + optional category */
function applyFilters() {
  let visible = 0, dayTotal = 0;
  for (const b of document.querySelectorAll("blurb-card")) {
    const matchDate = b.getAttribute("date") === state.date;
    if (matchDate) dayTotal++;
    const matchCat = !state.category ||
                     b.getAttribute("category") === state.category;
    const show = matchDate && matchCat;
    b.hidden = !show;
    if (show) visible++;
  }
  document.getElementById("header-date").textContent = fmtLong(state.date);
  document.getElementById("header-count").textContent = state.category
    ? `${visible} of ${dayTotal} brief${dayTotal === 1 ? "" : "s"} · ${state.category}`
    : `${dayTotal} brief${dayTotal === 1 ? "" : "s"} for this day`;
  const empty = document.getElementById("empty-state");
  empty.hidden = visible > 0;
  empty.textContent = dayTotal
    ? `No ${state.category} briefs on this date.`
    : "No briefs for this date.";
  const end = document.getElementById("feed-end");
  end.hidden = dayTotal === 0;
  end.textContent = `End of briefs for ${fmtLong(state.date)}`;
}

/* ================================================================
   Calendar directory: calendar/<YYYY-MM>.json
   Each file maps day-of-month -> link to that day's blurb collection.
   Months without a file offer no selectable days.
================================================================ */
/* "YYYY-MM" -> Map(dayNumber -> link), or an empty Map if no file */
const monthLinks = new Map();
const monthPromises = new Map();
/* months whose calendar file was missing — the boundary of published data */
const monthMissing = new Set();

function ensureMonth(key) {
  if (!monthPromises.has(key)) {
    monthPromises.set(key, (async () => {
      let map = new Map();
      try {
        const res = await fetch(`calendar/${key}.json`, { cache: "reload" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        map = new Map(Object.entries(data.days || {}));
      } catch (err) {
        console.warn(`No calendar file for ${key}:`, err.message);
        monthMissing.add(key);
      }
      monthLinks.set(key, map);
      document.dispatchEvent(new CustomEvent("monthloaded", { detail: { key } }));
    })());
  }
  return monthPromises.get(key);
}

/* link to the blurb collection for a date, or undefined if none */
function linkFor(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return monthLinks.get(`${y}-${pad(m)}`)?.get(String(d));
}

/* Nearest date with briefs before/after `iso` (delta: -1 or +1).
   Walks day by day, loading month maps on demand; stops at a month
   whose calendar file is missing (nothing published beyond it). */
async function stepDate(iso, delta) {
  const [y0, m0, d0] = iso.split("-").map(Number);
  const d = new Date(y0, m0 - 1, d0);
  for (let i = 0; i < 800; i++) {           // ~2 years safety cap
    d.setDate(d.getDate() + delta);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    if (monthMissing.has(key)) return null;
    await ensureMonth(key);
    if (monthLinks.get(key)?.has(String(d.getDate())))
      return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
    if (monthMissing.has(key)) return null; // 404 discovered while awaiting
  }
  return null;
}

/* ================================================================
   Feed loading: fetch the blurb collection linked from the calendar
================================================================ */
const feed = document.querySelector(".feed-scroll");
const emptyEl = document.getElementById("empty-state");
let loadedDate = null;

function blurbCardEl(brief, iso) {
  const el = document.createElement("blurb-card");
  // The feed date drives calendar selection. The event date belongs to the source.
  el.setAttribute("date", iso);
  if (brief.eventDate) el.setAttribute("event-date", brief.eventDate);
  el.setAttribute("heading", brief.heading || "");
  el.setAttribute("category", brief.category || "");
  el.setAttribute("source", brief.source || "");
  if (brief.sourceType) el.setAttribute("source-type", brief.sourceType);
  if (brief.sourceUrl) el.setAttribute("source-url", brief.sourceUrl);
  el.textContent = brief.summary || "";
  return el;
}

async function loadDay(iso) {
  /* remove previous day's cards, keep the placeholder elements */
  feed.querySelectorAll("blurb-card").forEach(el => el.remove());

  let briefs = [];
  await ensureMonth(`${iso.slice(0, 7)}`);
  const link = linkFor(iso);
  if (link) {
    try {
      const res = await fetch(link, { cache: "reload" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      briefs = await res.json();
    } catch (err) {
      console.warn(`Could not load ${link}:`, err.message);
    }
  }

  if (state.date !== iso) return; // user already picked another date

  for (const brief of briefs)
    feed.insertBefore(blurbCardEl(brief, iso), emptyEl);

  applyFilters();
  /* let the calendar refresh its category counts */
  document.dispatchEvent(new CustomEvent("statechange", { detail: { ...state } }));
}

/* changing the date in the calendar loads that day's blurb collection */
document.addEventListener("statechange", e => {
  if (e.detail.date !== loadedDate) {
    loadedDate = e.detail.date;
    loadDay(e.detail.date);
  }
});

/* ================================================================
   <blurb-card date event-date heading category source source-url source-type>
     ...summary text...
   </blurb-card>
================================================================ */
const ICON_PENCIL = `<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const ICON_SPEECH = `<svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v12H5.2L4 17.2Z"/><path d="M8 9h8"/><path d="M8 12h5"/></svg>`;

/* Tag colors per category. Categories found in a day's JSON drive the
   list everywhere (desktop category rows, mobile dropdown); colors come
   from this map when defined, otherwise auto-assigned from a palette
   by hashing the name so any new category just works. */
const TAG_COLORS = {
  "Sun Prairie City Council": ["var(--tag-council)", "var(--tag-council-bg)"],
  "Sun Prairie School Board": ["var(--tag-school)", "var(--tag-school-bg)"],
  "State": ["var(--tag-state)", "var(--tag-state-bg)"]
};
const TAG_PALETTE = [
  ["#2451b3", "#eaf0fc"], // blue
  ["#0d7a5f", "#e6f4ef"], // green
  ["#7a3d9c", "#f3ecf9"], // purple
  ["#b25e09", "#fdf0e7"], // orange
  ["#0672a3", "#e5f5fb"], // teal
  ["#b42318", "#fdeceb"]  // red
];
function tagColorsFor(category) {
  if (!category) return [null, null];
  if (TAG_COLORS[category]) return TAG_COLORS[category];
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

customElements.define("blurb-card", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display: block; }
        :host([hidden]) { display: none; }

        article {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 18px 20px;
          margin-bottom: 14px;
          transition: border-color 0.12s, box-shadow 0.12s;
        }
        article:hover {
          border-color: #c8d4ea;
          box-shadow: 0 2px 10px rgba(26, 42, 74, 0.06);
        }

        .blurb-top { margin-bottom: 8px; }
        h3 { font-size: 15.5px; font-weight: 650; line-height: 1.35; }
        .summary { font-size: 14px; color: #3f4756; margin: 4px 0 10px 0; }

        .meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 12.5px;
          color: var(--text-muted);
        }
        .tag {
          font-size: 11.5px;
          font-weight: 600;
          padding: 2px 9px;
          border-radius: 20px;
          white-space: nowrap;
          color: var(--text-faint);
          background: #f2f4f7;
        }
        .event-date { color: #475467; }
        /* tag colors are assigned in JS from the category name —
           any category in a day's JSON gets a color automatically */

        .source { display: inline-flex; align-items: center; gap: 5px; }
        .source .icon { flex-shrink: 0; opacity: 0.6; }
        .source a[href] {
          color: var(--accent);
          text-decoration: none;
          font-weight: 500;
        }
        .source a[href]:hover { text-decoration: underline; }
        :host([source-type="release"]) .icon-pencil { display: none; }
        :host(:not([source-type="release"])) .icon-speech { display: none; }
      </style>
      <article>
        <div class="blurb-top">
          <h3></h3>
        </div>
        <p class="summary"></p>
        <div class="meta">
          <span class="tag"></span>
          <time class="tag event-date" hidden></time>
          <span class="source">
            ${ICON_PENCIL.replace('class="icon"', 'class="icon icon-pencil"')}
            ${ICON_SPEECH.replace('class="icon"', 'class="icon icon-speech"')}
            <span class="src-name"></span>
          </span>
        </div>
      </article>`;

    const s = this.shadowRoot;
    s.querySelector("h3").textContent = this.getAttribute("heading") || "";
    s.querySelector(".summary").textContent = this.textContent.trim();
    const tag = s.querySelector(".tag");
    tag.textContent = this.getAttribute("category") || "";
    const [tagColor, tagBg] = tagColorsFor(this.getAttribute("category"));
    if (tagColor) { tag.style.color = tagColor; tag.style.background = tagBg; }

    const eventDate = this.getAttribute("event-date");
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      const [y, m, d] = eventDate.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      if (isoOf(date.getFullYear(), date.getMonth(), date.getDate()) === eventDate) {
        const time = s.querySelector(".event-date");
        time.dateTime = eventDate;
        time.textContent = date.toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric"
        });
        time.hidden = false;
      }
    }

    /* source text; with a source-url it becomes a link that opens in a new tab */
    const srcText = this.getAttribute("source") || "";
    const srcUrl = this.getAttribute("source-url");
    const srcEl = s.querySelector(".src-name");
    srcEl.textContent = srcText;
    if (srcUrl) {
      const a = document.createElement("a");
      a.href = srcUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = srcText;
      srcEl.replaceWith(a);
    }
  }
});

/* ================================================================
   <date-calendar> — month grid driven by calendar/<YYYY-MM>.json
   Only days listed in the month's file are selectable (bold + dot).
================================================================ */
customElements.define("date-calendar", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        .cal-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .cal-nav h2 { font-size: 14.5px; font-weight: 650; }
        .cal-nav button {
          width: 26px; height: 26px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          color: var(--text-muted);
          font-size: 14px;
          cursor: pointer;
          line-height: 1;
          transition: background 0.12s;
        }
        .cal-nav button:hover { background: var(--accent-softer); }
        .cal-nav button:disabled { opacity: 0.3; cursor: default; }
        .cal-nav button:disabled:hover { background: var(--surface); }

        .grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 2px;
          text-align: center;
        }
        .dow {
          font-size: 10.5px;
          font-weight: 700;
          color: var(--text-faint);
          text-transform: uppercase;
          padding: 4px 0 6px;
        }
        .day {
          position: relative;
          font-size: 13px;
          color: var(--text-muted);
          padding: 7px 0 10px;
          border-radius: 7px;
          font-family: inherit;
        }
        span.day { cursor: default; }
        .day.muted { color: #cfd4dc; }
        .day.future { color: #cfd4dc; }  /* hasn't happened yet */
        button.day {
          cursor: pointer;
          border: none;
          background: none;
          transition: background 0.12s;
        }
        button.day:hover { background: var(--accent-softer); color: var(--text); }
        .day.has-events { font-weight: 600; color: var(--text); }
        .day.has-events::after {
          content: "";
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--accent);
        }
        .day.selected { box-shadow: inset 0 0 0 2px var(--accent); color: var(--accent); font-weight: 700; }
        .day.today { background: var(--accent); color: #fff; font-weight: 700; }
        .day.today::after { background: #fff; }

        .glance {
          margin-top: 18px;
          border-top: 1px solid var(--border);
          padding-top: 14px;
        }
        .glance h3 {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--text-faint);
          margin-bottom: 8px;
        }
        .glance ul { list-style: none; padding: 0; margin: 0; }
        .glance li {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          padding: 5px 8px;
          margin: 0 -8px;
          border-radius: 6px;
          color: var(--text-muted);
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .glance li:hover { background: var(--accent-softer); }
        .glance li.active,
        .glance li.active strong { color: var(--accent); font-weight: 600; }
        .glance li strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
          color: var(--text);
        }
        .glance li span { flex-shrink: 0; }
      </style>
      <div class="cal-nav">
        <button class="prev" aria-label="Previous month">&lsaquo;</button>
        <h2></h2>
        <button class="next" aria-label="Next month">&rsaquo;</button>
      </div>
      <div class="grid"></div>
      <div class="glance">
        <h3>Briefs by Category</h3>
        <ul></ul>
      </div>`;

    /* initial view month follows the selected date (today) */
    const [y, m] = state.date.split("-").map(Number);
    this.view = { y, m: m - 1 };

    this.shadowRoot.querySelector(".prev").addEventListener("click", () => this.shiftMonth(-1));
    this.shadowRoot.querySelector(".next").addEventListener("click", () => this.shiftMonth(1));
    this.shadowRoot.querySelector(".grid").addEventListener("click", e => {
      const iso = e.target.closest("button[data-iso]")?.dataset.iso;
      if (!iso) return;
      const [cy, cm] = iso.split("-").map(Number);
      this.view = { y: cy, m: cm - 1 };
      setState({ date: iso });
    });
    /* Category rows filter the feed. "All Sources" clears the filter. */
    this.shadowRoot.querySelector(".glance ul").addEventListener("click", e => {
      const li = e.target.closest("li[data-cat]");
      if (!li) return;
      setState({ category: li.dataset.cat || null });
    });

    document.addEventListener("statechange", () => {
      /* keep the visible month on the selected date's month
         (matters when the date is set programmatically, e.g. on boot) */
      const [y, m] = state.date.split("-").map(Number);
      if (this.view.y !== y || this.view.m !== m - 1) this.view = { y, m: m - 1 };
      this.render();
    });
    document.addEventListener("monthloaded", e => {
      if (e.detail.key === this.currentKey()) this.render();
    });
    this.render();
  }

  currentKey() {
    return `${this.view.y}-${pad(this.view.m + 1)}`;
  }

  async shiftMonth(delta) {
    if (this.navBusy) return;
    this.navBusy = true;
    const d = new Date(this.view.y, this.view.m + delta, 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    await ensureMonth(key);
    this.navBusy = false;
    /* months without a calendar file have no published data — can't go there */
    if (monthMissing.has(key)) return;
    this.view = { y: d.getFullYear(), m: d.getMonth() };
    this.render();
  }

  render() {
    const s = this.shadowRoot;
    const key = this.currentKey();
    ensureMonth(key); // async; re-renders via "monthloaded" when the file lands

    s.querySelector("h2").textContent =
      new Date(this.view.y, this.view.m, 1)
        .toLocaleDateString("en-US", { month: "long", year: "numeric" });

    /* days offered for selection come only from the month's file */
    const dayLinks = monthLinks.get(key) || new Map();

    /* leading/trailing days from adjacent months; 6 rows to keep height stable */
    const startDow = new Date(this.view.y, this.view.m, 1).getDay();
    const dim = new Date(this.view.y, this.view.m + 1, 0).getDate();
    const dimPrev = new Date(this.view.y, this.view.m, 0).getDate();

    let cells = "";
    for (let i = 0; i < 42; i++) {
      const raw = i - startDow + 1;
      let day, y, m, muted;
      if (raw < 1) {
        day = dimPrev + raw; m = this.view.m - 1; y = this.view.y; muted = true;
        if (m < 0) { m = 11; y--; }
      } else if (raw > dim) {
        day = raw - dim; m = this.view.m + 1; y = this.view.y; muted = true;
        if (m > 11) { m = 0; y++; }
      } else {
        day = raw; m = this.view.m; y = this.view.y; muted = false;
      }
      const iso = isoOf(y, m, day);
      const selectable = !muted && dayLinks.has(String(day));
      const classes = ["day"];
      if (muted) classes.push("muted");
      if (!muted && iso > TODAY_ISO) classes.push("future");  // hasn't happened yet
      if (selectable) classes.push("has-events");
      if (selectable && iso === state.date && iso !== TODAY_ISO) classes.push("selected");
      if (selectable && iso === TODAY_ISO) classes.push("today");
      cells += selectable
        ? `<button class="${classes.join(" ")}" data-iso="${iso}">${day}</button>`
        : `<span class="${classes.join(" ")}">${day}</span>`;
    }
    s.querySelector(".grid").innerHTML =
      ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
        .map(d => `<span class="dow">${d}</span>`).join("") + cells;

    /* prev/next month arrows: disabled when the adjacent month has no
       calendar file (nothing published there yet) */
    const viewKey = key;
    [["prev", -1], ["next", 1]].forEach(([which, delta]) => {
      const d = new Date(this.view.y, this.view.m + delta, 1);
      const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      ensureMonth(k).then(() => {
        if (this.currentKey() === viewKey)
          s.querySelector(`.cal-nav .${which}`).disabled = monthMissing.has(k);
      });
    });

    /* Category counts from the currently loaded cards.
       rows act as category filters for the feed */
    const cards = [...document.querySelectorAll("blurb-card")]
      .filter(b => b.getAttribute("date") === state.date);
    const byCat = {};
    for (const c of cards) {
      const cat = c.getAttribute("category");
      byCat[cat] = (byCat[cat] || 0) + 1;
    }
    const rows = [
      { name: "All Sources", count: cards.length, cat: null },
      ...Object.entries(byCat).map(([cat, n]) => ({ name: cat, count: n, cat }))
    ];
    const ul = s.querySelector(".glance ul");
    ul.innerHTML = cards.length
      ? rows.map(r =>
          `<li data-cat="${r.cat ?? ""}" class="${state.category === r.cat ? "active" : ""}" title="Show ${r.name === "All Sources" ? "all briefs" : r.name + " briefs only"}">` +
          `<strong>${r.name}</strong><span>${r.count}</span></li>`)
          .join("")
      : `<li><span>No briefs for this day</span></li>`;
  }
});

/* ================================================================
   <date-nav> — day navigation in the desktop header and mobile date bar.
   Arrows step to the nearest date that has briefs.
================================================================ */
customElements.define("date-nav", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
        }
        button {
          flex: 0 0 auto;
          width: 36px; height: 36px;
          border: 1px solid var(--border);
          background: var(--surface);
          border-radius: 8px;
          color: var(--accent);
          font-size: 19px;
          line-height: 1;
          cursor: pointer;
          transition: background 0.12s, opacity 0.12s;
        }
        button:hover:not(:disabled) { background: var(--accent-softer); }
        button:disabled { opacity: 0.3; cursor: default; }
        .label {
          flex: 1 1 auto;
          text-align: center;
          color: var(--text);
          font-weight: 600;
          font-size: 14.5px;
          white-space: nowrap;
        }
        :host([desktop]) .label {
          box-sizing: border-box;
          flex: none;
          width: 17rem;
          padding-inline: 4px;
        }
        :host([desktop]) { width: max-content; }
        :host([desktop]) button:disabled {
          opacity: 1;
          color: var(--text-muted);
          background: var(--bg);
        }
      </style>
      <button type="button" class="prev" aria-label="Previous day with briefs" title="Previous day with briefs">&lsaquo;</button>
      <span class="label"></span>
      <button type="button" class="next" aria-label="Next day with briefs" title="Next day with briefs">&rsaquo;</button>`;

    this.busy = false;
    this.shadowRoot.querySelector(".prev").addEventListener("click", () => this.step(-1));
    this.shadowRoot.querySelector(".next").addEventListener("click", () => this.step(1));
    document.addEventListener("statechange", () => this.render());
    this.render();
  }

  async step(delta) {
    if (this.busy) return;
    this.busy = true;
    const from = state.date;
    try {
      const target = await stepDate(from, delta);
      if (target && state.date === from) setState({ date: target });
    } finally {
      this.busy = false;
    }
  }

  render() {
    const s = this.shadowRoot;
    const iso = state.date;
    s.querySelector(".label").textContent = this.hasAttribute("desktop")
      ? fmtLong(iso)
      : new Date(...iso.split("-").map((n, i) => n - (i === 1 ? 1 : 0)))
        .toLocaleDateString("en-US",
          { weekday: "short", month: "short", day: "numeric", year: "numeric" });

    /* enable/disable arrows based on whether an adjacent day with briefs exists */
    stepDate(iso, -1).then(prev => {
      if (state.date === iso) s.querySelector(".prev").disabled = !prev;
    });
    stepDate(iso, 1).then(next => {
      if (state.date === iso) s.querySelector(".next").disabled = !next;
    });
  }
});

/* ================================================================
   <category-select> — mobile-only category dropdown.
   Hidden on desktop (CSS); mirrors the calendar's category filters
   category rows as a simple <select> that filters the feed.
================================================================ */
customElements.define("category-select", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host { display: block; }
        select {
          width: 100%;
          padding: 9px 10px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
          font-size: 14px;
          font-family: inherit;
          color: var(--text);
          cursor: pointer;
        }
        select:disabled { opacity: 0.55; cursor: default; }
        select:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
      </style>
      <select aria-label="Filter feed by category"></select>`;

    const sel = this.shadowRoot.querySelector("select");
    sel.addEventListener("change", () => {
      setState({ category: sel.value === "all" ? null : sel.value });
    });
    document.addEventListener("statechange", () => this.render());
    this.render();
  }

  render() {
    const sel = this.shadowRoot.querySelector("select");

    /* options come from the categories present on the selected day,
       exactly like the calendar's glance rows */
    const cards = [...document.querySelectorAll("blurb-card")]
      .filter(b => b.getAttribute("date") === state.date);
    const cats = [...new Set(cards.map(c => c.getAttribute("category")).filter(Boolean))];

    /* keep an active-but-unavailable category visible so the selection
       stays truthful (feed will show "No X briefs on this date.") */
    if (state.category && !cats.includes(state.category)) cats.push(state.category);

    const opts = [
      { v: "all", label: `All Sources${cards.length ? ` (${cards.length})` : ""}` },
      ...cats.map(c => ({ v: c, label: `${c} (${cards.filter(b => b.getAttribute("category") === c).length})` }))
    ];
    sel.innerHTML = opts.map(o =>
      `<option value="${o.v}"${o.v === (state.category ?? "all") ? " selected" : ""}>${o.label}</option>`).join("");
    sel.disabled = cards.length === 0 && !state.category;
  }
});

/* ================================================================
   Initial render
   The startup date comes from state.json ("latestDate" = most recent
   date that has briefs, maintained by the content pipeline). Falls
   back to today when the file is missing or malformed.
================================================================ */
(async () => {
  let start = TODAY_ISO;
  try {
    const res = await fetch("state.json", { cache: "reload" });
    if (res.ok) {
      const s = await res.json();
      if (typeof s.latestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.latestDate))
        start = s.latestDate;
    }
  } catch {
    /* no state.json — default to today */
  }
  /* setState fires "statechange", whose listener loads the day's briefs */
  setState({ date: start });
})();

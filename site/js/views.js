// Rendering for the calendar views. Each function returns an HTML string.

import {
  WEEKDAYS, formatDate, weekdayName, weekOf, monthOf, monthRange, toAbs, isHoliday,
} from "./calendar-math.js";

const MAX_LANES = 3;
const MAX_LISTED = 3;

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * A case-insensitive pattern matching `query` at the start of a word, so "orb"
 * finds "orb" and "orbit" but not "Borbon". Returns null for an empty query.
 */
export function searchPattern(query, flags = "i") {
  const q = (query ?? "").trim();
  if (!q) return null;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(/^\w/.test(q) ? `\\b${escaped}` : escaped, flags);
}

/** Escapes text and wraps search matches in <mark>. */
export function marked(text, query) {
  const safe = escapeHtml(text);
  const re = searchPattern(query && escapeHtml(query), "gi");
  return re ? safe.replace(re, (m) => `<mark>${m}</mark>`) : safe;
}

// Wiki links arrive in entry text as [[slug|Display]] markers.
const LINK_MARKER = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;

/** Entry text with link markers replaced by their display text (for search). */
export function plainText(text) {
  return text.replace(LINK_MARKER, (_, slug, display) => display);
}

/** Escaped, search-highlighted text with link markers turned into wiki links. */
export function richText(text, wikiUrl, query) {
  let html = "";
  let last = 0;
  for (const m of text.matchAll(LINK_MARKER)) {
    html += marked(text.slice(last, m.index), query);
    html += wikiLink(m[1], marked(m[2], query), wikiUrl);
    last = m.index + m[0].length;
  }
  return html + marked(text.slice(last), query);
}

function wikiLink(slug, innerHtml, wikiUrl) {
  if (!wikiUrl) return innerHtml;
  const href = wikiUrl + encodeURIComponent(slug);
  return `<a class="wl" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="Open in the BIAS CCR wiki">${innerHtml}</a>`;
}

/** "Suliman / Arico" with each place linked to its wiki page when it has one. */
function placesHtml(e, wikiUrl, query) {
  if (!e.places?.length) return e.location ? marked(e.location, query) : "";
  return e.places
    .map((p) => (p.slug ? wikiLink(p.slug, marked(p.name, query), wikiUrl) : marked(p.name, query)))
    .join(" / ");
}

const pad2 = (n) => String(n).padStart(2, "0");
const isSpan = (e) => e.end.abs > e.start.abs;
const covers = (e, abs) => e.start.abs <= abs && abs <= e.end.abs;

/** "Session 8", "Sessions 54–57", "Sessions 14, 31–32". */
export function sessionLabel(sessions) {
  if (!sessions.length) return "";
  const runs = [];
  for (const n of sessions) {
    const run = runs.at(-1);
    if (run && n === run[1] + 1) run[1] = n;
    else runs.push([n, n]);
  }
  const text = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
  return `${sessions.length === 1 ? "Session" : "Sessions"} ${text}`;
}

function describeDay(day) {
  if (isHoliday(day)) return "Holiday";
  return `${weekdayName(day)} · Week ${weekOf(day)} · Month ${monthOf(day)}`;
}

function relative(abs, currentAbs) {
  const d = abs - currentAbs;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

// ---------- Header ----------

export function renderClock(data) {
  const { day, year, abs } = data.current;
  const next = data.events.find((e) => e.start.abs > abs);
  const nextLine = next
    ? `Next on the log: <b>${escapeHtml(next.title)}</b> · ${formatDate(next.start.day, next.start.year)}, ${relative(next.start.abs, abs)}`
    : "No projected entries on the log.";
  return `
    <div>
      <p class="clock__id">RACONTEUR // IMPERIAL CALENDAR // SECTOR SOLO SIX</p>
      <p class="clock__now"><span class="prompt" aria-hidden="true">&gt;</span>${formatDate(day, year)}<span class="cursor" aria-hidden="true"></span></p>
      <p class="clock__meta">${describeDay(day)}</p>
    </div>
    <p class="clock__next">${nextLine}</p>`;
}

const LEGEND = `
    <ul class="legend" aria-label="Legend">
      <li class="t-party">Party</li><li class="t-news">News</li><li class="t-travel">Travel</li>
      <li class="t-downtime">Downtime</li><li class="t-deadline">Deadline</li><li class="t-finance">Finance</li>
      <li class="l-projected">Projected</li>
    </ul>`;

// ---------- Month view ----------

/** Assigns each span overlapping [fromAbs, toAbs] a lane so strips line up across days. */
function laneSpans(events, fromAbs, toAbs) {
  const spans = events.filter((e) => isSpan(e) && e.end.abs >= fromAbs && e.start.abs <= toAbs);
  const laneEnds = [];
  const lanes = new Map();
  for (const e of spans) {
    let lane = laneEnds.findIndex((end) => end < e.start.abs);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e.end.abs;
    lanes.set(e, lane);
  }
  return lanes;
}

function timeClass(abs, currentAbs) {
  if (abs < currentAbs) return "past";
  return abs === currentAbs ? "today" : "future";
}

function cellHtml(day, year, column, lanes, events, state) {
  const abs = toAbs(day, year);
  const currentAbs = state.data.current.abs;
  const when = timeClass(abs, currentAbs);
  const selected = state.selected.abs === abs;

  const laneHtml = [];
  const laneCount = Math.min(MAX_LANES, Math.max(-1, ...lanes.values()) + 1);
  for (let i = 0; i < laneCount; i++) {
    const span = [...lanes].find(([e, lane]) => lane === i && covers(e, abs))?.[0];
    if (!span) { laneHtml.push(`<div class="lane"></div>`); continue; }
    const first = span.start.abs === abs;
    const last = span.end.abs === abs;
    // The label sits on the first day of the strip in each week row and runs across it.
    const showLabel = first || column === 0;
    const daysInRow = Math.min(span.end.abs - abs + 1, 7 - column);
    const label = showLabel
      ? `<span class="seg__label" style="--n:${daysInRow}">${escapeHtml(span.title)}</span>`
      : "";
    const cls = [
      "seg", `t-${span.type}`, first && "first", last && "last",
      span.start.abs > currentAbs && "projected",
    ].filter(Boolean).join(" ");
    laneHtml.push(
      `<div class="lane"><div class="${cls}" title="${escapeHtml(span.title)}">${label}</div></div>`,
    );
  }

  const singles = events.filter((e) => !isSpan(e) && e.start.abs === abs);
  const hiddenSpans = [...lanes].filter(([e, lane]) => lane >= MAX_LANES && covers(e, abs)).length;
  const listed = singles.slice(0, MAX_LISTED);
  const more = singles.length - listed.length + hiddenSpans;
  const items = listed.map((e) =>
    `<li class="t-${e.type}${e.start.abs > currentAbs ? " projected" : ""}">${escapeHtml(e.title)}</li>`,
  );
  if (more > 0) items.push(`<li class="more">+${more} more</li>`);

  const tag = when === "today" ? "TODAY" : "";
  const label = `${formatDate(day, year)}, ${weekdayName(day)}${singles.length ? `, ${singles.length} entries` : ""}`;
  return `
    <div class="cell ${when}${selected ? " selected" : ""}" role="button" tabindex="0"
         data-abs="${abs}" aria-label="${escapeHtml(label)}" aria-pressed="${selected}"${when === "today" ? ' aria-current="date"' : ""}>
      <div class="cell__head"><span class="num">${String(day).padStart(3, "0")}</span><span class="tag">${tag}</span></div>
      ${laneHtml.join("")}
      ${items.length ? `<ul class="evts">${items.join("")}</ul>` : ""}
    </div>`;
}

export function renderMonth(state) {
  const { year, month, data } = state;
  const { first, last } = monthRange(month);
  const lanes = laneSpans(data.events, toAbs(first, year), toAbs(last, year));

  let holiday = "";
  if (month === 1) {
    const abs = toAbs(1, year);
    const onHoliday = data.events.filter((e) => covers(e, abs));
    holiday = `
      <button class="holiday" data-abs="${abs}">
        <span class="num">001</span><span class="label">HOLIDAY</span>
        <span class="evts">${onHoliday.map((e) => escapeHtml(e.title)).join(" · ") || "No entries"}</span>
      </button>`;
  }

  const cells = [];
  for (let i = 0; i < 28; i++) {
    cells.push(cellHtml(first + i, year, i % 7, lanes, data.events, state));
  }

  return `
    <div class="bar">
      <h2>Month ${pad2(month)} · ${year}</h2>
      <span class="bar__range">Days ${String(first).padStart(3, "0")}–${String(last).padStart(3, "0")} · Weeks ${weekOf(first)}–${weekOf(last)}</span>
      <div class="bar__nav">
        <button class="btn" data-go="prev" title="Previous month (←)">◄ Prev</button>
        <button class="btn" data-go="today" title="Jump to today (T)">Today</button>
        <button class="btn" data-go="next" title="Next month (→)">Next ►</button>
      </div>
    </div>
    ${holiday}
    <div class="grid" aria-label="Month ${month}, ${year}">
      ${WEEKDAYS.map((d) => `<div class="wkday" aria-hidden="true">${d.slice(0, 3)}</div>`).join("")}
      ${cells.join("")}
    </div>
    ${LEGEND}`;
}

// ---------- Day panel ----------

function entryHtml(e, abs, currentAbs, q, wikiUrl) {
  const projected = e.start.abs > currentAbs;
  const span = isSpan(e)
    ? `Day ${abs - e.start.abs + 1} of ${e.end.abs - e.start.abs + 1} · ${formatDate(e.start.day, e.start.year)} to ${formatDate(e.end.day, e.end.year)}`
    : "";
  const paragraphs = e.text
    ? e.text.split("\n\n").map((p) => `<p>${richText(p, wikiUrl, q)}</p>`).join("")
    : "";
  const sessions = sessionLabel(e.sessions);
  return `
    <article class="entry t-${e.type}${projected ? " projected" : ""}">
      <p class="entry__kicker">
        <span class="entry__type">${e.type}</span>
        ${projected ? `<span class="entry__proj">Projected</span>` : ""}
        ${span ? `<span class="entry__span">${span}</span>` : ""}
      </p>
      <h3>${marked(e.title, q)}</h3>
      ${e.location ? `<p class="entry__where">${placesHtml(e, wikiUrl, q)}</p>` : ""}
      ${paragraphs ? `<div class="entry__text">${paragraphs}</div>` : ""}
      ${sessions ? `<span class="chip">${sessions}</span>` : ""}
    </article>`;
}

export function renderDayPanel(state) {
  const { data, selected } = state;
  const currentAbs = data.current.abs;
  const entries = data.events.filter((e) => covers(e, selected.abs));
  // Entries starting today first, then spans that are already running.
  entries.sort((a, b) => (b.start.abs === selected.abs) - (a.start.abs === selected.abs) || a.start.abs - b.start.abs);
  const when = relative(selected.abs, currentAbs);
  return `
    <header class="log__head">
      <p class="log__date">${formatDate(selected.day, selected.year)}</p>
      <p class="log__meta">${describeDay(selected.day)} · ${when}</p>
    </header>
    ${entries.length
      ? entries.map((e) => entryHtml(e, selected.abs, currentAbs, state.query, data.wiki)).join("")
      : `<p class="log__empty">${state.filtered ? "No entries on this day match the filters." : selected.abs > currentAbs ? "Nothing projected for this day." : "No log entries for this day."}</p>`}`;
}

// ---------- View switcher ----------

export function renderViewNav(state) {
  const { year, month, selected, view } = state;
  const links = [
    ["year", "Year", `#/${year}`],
    ["month", "Month", selected ? `#/${selected.year}/${selected.day}` : `#/${year}/m${month}`],
    ["chronicle", "Chronicle", "#/chronicle"],
  ];
  return links.map(([key, label, href]) =>
    `<a class="tab${view === key ? " active" : ""}" href="${href}"${view === key ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("");
}

// ---------- Year view ----------

const TYPES_ORDER = ["party", "news", "travel", "downtime", "deadline", "finance"];

/** Systems visited in order, from the group's own entries, collapsing repeats. */
function routeFor(events, year) {
  const route = [];
  for (const e of events) {
    if (e.start.year !== year || !e.system || !["party", "travel", "downtime"].includes(e.type)) continue;
    if (/^in transit$/i.test(e.system)) continue;
    if (route.at(-1) !== e.system) route.push(e.system);
  }
  return route;
}

function miniDay(day, year, data) {
  const abs = toAbs(day, year);
  const currentAbs = data.current.abs;
  const starting = data.events.filter((e) => e.start.abs === abs);
  const running = data.events.filter((e) => isSpan(e) && covers(e, abs));
  const lead = starting.find((e) => !isSpan(e));
  const strip = running[0];
  const cls = [
    "mini", timeClass(abs, currentAbs), lead && "has", lead && `t-${lead.type}`, strip && "span",
  ].filter(Boolean).join(" ");
  const stripStyle = strip ? ` style="--s: var(--t-${strip.type})"` : "";
  const titles = [...new Set([...starting, ...running])].map((e) => e.title);
  const tip = `${formatDate(day, year)}${titles.length ? ` · ${titles.join(" · ")}` : ""}`;
  return `<a class="${cls}" href="#/${year}/${day}"${stripStyle} title="${escapeHtml(tip)}">${String(day).padStart(3, "0")}</a>`;
}

function monthTile(month, year, data) {
  const { first, last } = monthRange(month);
  const fromAbs = toAbs(first, year);
  const lastAbs = toAbs(last, year);
  const currentAbs = data.current.abs;
  const inMonth = data.events.filter((e) => e.start.abs >= fromAbs && e.start.abs <= lastAbs);
  const isNow = currentAbs >= fromAbs && currentAbs <= lastAbs;

  const days = [];
  for (let d = first; d <= last; d++) days.push(miniDay(d, year, data));

  const shown = inMonth.slice(0, 3).map((e) =>
    `<li class="t-${e.type}${e.start.abs > currentAbs ? " projected" : ""}"><span class="d">${String(e.start.day).padStart(3, "0")}</span>${escapeHtml(e.title)}</li>`,
  );
  if (inMonth.length > 3) shown.push(`<li class="more">+${inMonth.length - 3} more</li>`);

  return `
    <section class="tile${isNow ? " now" : ""}">
      <a class="tile__head" href="#/${year}/m${month}">
        <span class="tile__name">Month ${pad2(month)}</span>
        <span class="tile__range">${String(first).padStart(3, "0")}–${String(last).padStart(3, "0")}</span>
      </a>
      <div class="minigrid">
        ${WEEKDAYS.map((d) => `<span class="mini__wk" aria-hidden="true">${d[0]}</span>`).join("")}
        ${days.join("")}
      </div>
      ${shown.length ? `<ul class="tile__list">${shown.join("")}</ul>` : `<p class="tile__empty">No entries</p>`}
    </section>`;
}

export function renderYear(state) {
  const { year, data } = state;
  const inYear = data.events.filter((e) => e.start.year === year);
  const counts = TYPES_ORDER.map((t) => [t, inYear.filter((e) => e.type === t).length]);
  const sessions = [...new Set(inYear.flatMap((e) => e.sessions))].sort((a, b) => a - b);
  const route = routeFor(data.events, year);
  const logged = inYear.filter((e) => e.start.abs <= data.current.abs).at(-1);

  const holidayAbs = toAbs(1, year);
  const onHoliday = data.events.filter((e) => covers(e, holidayAbs));

  const tiles = [];
  for (let m = 1; m <= 13; m++) tiles.push(monthTile(m, year, data));

  return `
    <div class="bar">
      <h2>Year ${year}</h2>
      <span class="bar__range">${inYear.length} entries${logged ? ` · last logged ${formatDate(logged.start.day, logged.start.year)}` : ""}</span>
      <div class="bar__nav">
        <button class="btn" data-go="prev" title="Previous year (←)">◄ ${year - 1}</button>
        <button class="btn" data-go="today" title="Jump to today (T)">Today</button>
        <button class="btn" data-go="next" title="Next year (→)">${year + 1} ►</button>
      </div>
    </div>
    <a class="holiday" href="#/${year}/1">
      <span class="num">001</span><span class="label">HOLIDAY</span>
      <span class="evts">${onHoliday.map((e) => escapeHtml(e.title)).join(" · ") || "No entries"}</span>
    </a>
    <div class="tiles">
      ${tiles.join("")}
      <section class="tile glance">
        <h3 class="glance__title">${year} at a glance</h3>
        <dl class="glance__counts">
          ${counts.map(([t, n]) => `<div class="t-${t}"><dt>${t}</dt><dd>${n}</dd></div>`).join("")}
        </dl>
        ${sessions.length ? `<p class="glance__line"><span>Sessions</span>${sessionLabel(sessions).replace(/^Sessions? /, "")}</p>` : ""}
        ${route.length ? `<p class="glance__line"><span>Route</span>${route.map(escapeHtml).join(' <b aria-hidden="true">›</b> ')}</p>` : ""}
      </section>
    </div>
    ${LEGEND}`;
}

// ---------- Chronicle ----------

function periodOf(day, year) {
  if (isHoliday(day)) return { key: `${year}-00`, label: `Holiday · ${year}`, href: `#/${year}/1` };
  const m = monthOf(day);
  const { first, last } = monthRange(m);
  return {
    key: `${year}-${pad2(m)}`,
    label: `Month ${pad2(m)} · ${year}`,
    range: `Days ${String(first).padStart(3, "0")}–${String(last).padStart(3, "0")}`,
    href: `#/${year}/m${m}`,
  };
}

function chronicleEntry(e, currentAbs, q, wikiUrl) {
  const projected = e.start.abs > currentAbs;
  const date = isSpan(e)
    ? `${String(e.start.day).padStart(3, "0")}<small>to ${formatDate(e.end.day, e.end.year)}</small>`
    : `${String(e.start.day).padStart(3, "0")}<small>${weekdayName(e.start.day)}</small>`;
  const paragraphs = e.text ? e.text.split("\n\n").map((p) => `<p>${richText(p, wikiUrl, q)}</p>`).join("") : "";
  const sessions = sessionLabel(e.sessions);
  return `
    <article class="rec t-${e.type}${projected ? " projected" : ""}">
      <a class="rec__date" href="#/${e.start.year}/${e.start.day}" title="Open in Month view">${date}</a>
      <div class="rec__body">
        <p class="entry__kicker">
          <span class="entry__type">${e.type}</span>
          ${projected ? `<span class="entry__proj">Projected</span>` : ""}
          ${e.location ? `<span class="entry__span">${placesHtml(e, wikiUrl, q)}</span>` : ""}
        </p>
        <h3>${marked(e.title, q)}</h3>
        ${paragraphs ? `<div class="entry__text">${paragraphs}</div>` : ""}
        ${sessions ? `<span class="chip">${sessions}</span>` : ""}
      </div>
    </article>`;
}

export function renderChronicle(state) {
  const { data, order } = state;
  const currentAbs = data.current.abs;
  const newest = order !== "oldest";
  const events = [...data.events].sort((a, b) => (newest ? b.start.abs - a.start.abs : a.start.abs - b.start.abs));

  const today = `
    <div class="nowline" id="today-line">
      <span>▶ Today · ${formatDate(data.current.day, data.current.year)}</span>
    </div>`;
  const out = [];
  let period = null;
  let todayShown = false;
  for (const e of events) {
    // The divider sits between projected entries and logged ones.
    const future = e.start.abs > currentAbs;
    if (!todayShown && (newest ? !future : future)) {
      out.push(today);
      todayShown = true;
      period = null; // repeat the month heading after the divider
    }
    const p = periodOf(e.start.day, e.start.year);
    if (p.key !== period) {
      period = p.key;
      out.push(`<h3 class="period"><a href="${p.href}">${p.label}</a>${p.range ? `<span>${p.range}</span>` : ""}</h3>`);
    }
    out.push(chronicleEntry(e, currentAbs, state.query, data.wiki));
  }
  if (!todayShown) out.push(today);
  if (!events.length) {
    out.push(`<p class="log__empty">No entries match the filters. <button class="linkbtn" data-clear>Clear filters</button></p>`);
  }

  return `
    <div class="bar">
      <h2>Chronicle</h2>
      <span class="bar__range">${events.length} entries · ${newest ? "newest first" : "oldest first"}</span>
      <div class="bar__nav">
        <a class="btn" href="#/chronicle${newest ? "/oldest" : ""}">${newest ? "Oldest first" : "Newest first"}</a>
        <button class="btn" data-go="today" title="Scroll to today (T)">Today</button>
      </div>
    </div>
    <div class="chron">${out.join("")}</div>
    ${LEGEND}`;
}

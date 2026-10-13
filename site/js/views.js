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
    <ul class="legend" aria-label="Legend">
      <li class="t-party">Party</li><li class="t-news">News</li><li class="t-travel">Travel</li>
      <li class="t-downtime">Downtime</li><li class="t-deadline">Deadline</li><li class="t-finance">Finance</li>
      <li class="l-projected">Projected</li>
    </ul>`;
}

// ---------- Day panel ----------

function entryHtml(e, abs, currentAbs) {
  const projected = e.start.abs > currentAbs;
  const span = isSpan(e)
    ? `Day ${abs - e.start.abs + 1} of ${e.end.abs - e.start.abs + 1} · ${formatDate(e.start.day, e.start.year)} to ${formatDate(e.end.day, e.end.year)}`
    : "";
  const paragraphs = e.text
    ? e.text.split("\n\n").map((p) => `<p>${escapeHtml(p)}</p>`).join("")
    : "";
  const sessions = sessionLabel(e.sessions);
  return `
    <article class="entry t-${e.type}${projected ? " projected" : ""}">
      <p class="entry__kicker">
        <span class="entry__type">${e.type}</span>
        ${projected ? `<span class="entry__proj">Projected</span>` : ""}
        ${span ? `<span class="entry__span">${span}</span>` : ""}
      </p>
      <h3>${escapeHtml(e.title)}</h3>
      ${e.location ? `<p class="entry__where">${escapeHtml(e.location)}</p>` : ""}
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
      ? entries.map((e) => entryHtml(e, selected.abs, currentAbs)).join("")
      : `<p class="log__empty">${selected.abs > currentAbs ? "Nothing projected for this day." : "No log entries for this day."}</p>`}`;
}

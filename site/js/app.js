// Loads the calendar data, keeps the URL hash and the view in sync.
//
// Routes:
//   #/1105/m8    Month 8 of 1105
//   #/1105/207   Day 207 of 1105, shown in its month with the day panel open
//   (none)       Today

import { toAbs, fromAbs, monthOf, monthRange, MONTHS_PER_YEAR, isValidDay } from "./calendar-math.js";
import { renderClock, renderMonth, renderDayPanel } from "./views.js";

const $ = (id) => document.getElementById(id);
const state = { data: null, year: 0, month: 1, selected: null };

const monthForDay = (day) => monthOf(day) ?? 1; // Holiday sits with Month 1

function selectDay(day, year) {
  state.selected = { day, year, abs: toAbs(day, year) };
  state.year = year;
  state.month = monthForDay(day);
}

function applyRoute() {
  const { current } = state.data;
  const m = /^#\/(\d{4})\/(?:m(\d{1,2})|(\d{1,3}))$/.exec(location.hash);
  if (m && m[2] && +m[2] >= 1 && +m[2] <= MONTHS_PER_YEAR) {
    const year = +m[1];
    const month = +m[2];
    const { first, last } = monthRange(month);
    // Keep the selected day if it's in this month; otherwise today if it is, else the month's first day.
    const inMonth = (s) => s && s.year === year && s.day >= first && s.day <= last;
    const keep = inMonth(state.selected) ? state.selected : inMonth(current) ? current : { day: first, year };
    selectDay(keep.day, year);
    state.month = month;
  } else if (m && m[3] && isValidDay(+m[3])) {
    selectDay(+m[3], +m[1]);
  } else {
    selectDay(current.day, current.year);
  }
  render();
}

function render() {
  $("month").innerHTML = renderMonth(state);
  $("log").innerHTML = renderDayPanel(state);
}

function go(hash) {
  if (location.hash === hash) applyRoute();
  else location.hash = hash;
}

function stepMonth(delta) {
  let { year, month } = state;
  month += delta;
  if (month < 1) { month = MONTHS_PER_YEAR; year -= 1; }
  if (month > MONTHS_PER_YEAR) { month = 1; year += 1; }
  go(`#/${year}/m${month}`);
}

function goToday() {
  const { day, year } = state.data.current;
  go(`#/${year}/${day}`);
}

function openDay(abs) {
  const { day, year } = fromAbs(abs);
  go(`#/${year}/${day}`);
}

function wireEvents() {
  $("month").addEventListener("click", (ev) => {
    const nav = ev.target.closest("[data-go]");
    if (nav) {
      const where = nav.dataset.go;
      if (where === "today") goToday();
      else stepMonth(where === "next" ? 1 : -1);
      return;
    }
    const day = ev.target.closest("[data-abs]");
    if (day) openDay(+day.dataset.abs);
  });

  $("month").addEventListener("keydown", (ev) => {
    const day = ev.target.closest(".cell[data-abs]");
    if (day && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      openDay(+day.dataset.abs);
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.target.closest("input, textarea")) return;
    if (ev.key === "ArrowLeft") stepMonth(-1);
    else if (ev.key === "ArrowRight") stepMonth(1);
    else if (ev.key === "t" || ev.key === "T") goToday();
  });

  window.addEventListener("hashchange", applyRoute);
}

async function start() {
  try {
    const res = await fetch("data/calendar.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.statusText);
    state.data = await res.json();
  } catch {
    $("month").innerHTML = `<p class="status">Ship's log unavailable. Reload the page to try again.</p>`;
    return;
  }
  $("clock").innerHTML = renderClock(state.data);
  wireEvents();
  applyRoute();
}

start();

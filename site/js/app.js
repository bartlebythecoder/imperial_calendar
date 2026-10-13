// Loads the calendar data, keeps the URL hash and the view in sync.
//
// Routes:
//   #/1105              Year view of 1105
//   #/1105/m8           Month 8 of 1105
//   #/1105/207          Day 207 of 1105, shown in its month with the day panel open
//   #/chronicle         Chronicle, newest first (#/chronicle/oldest for oldest first)
//   (none)              Today, in Month view

import { toAbs, fromAbs, monthOf, monthRange, MONTHS_PER_YEAR, isValidDay } from "./calendar-math.js";
import {
  renderClock, renderViewNav, renderMonth, renderDayPanel, renderYear, renderChronicle,
} from "./views.js";

const $ = (id) => document.getElementById(id);
const state = { data: null, view: "month", year: 0, month: 1, selected: null, order: "newest" };

const monthForDay = (day) => monthOf(day) ?? 1; // Holiday sits with Month 1

function selectDay(day, year) {
  state.selected = { day, year, abs: toAbs(day, year) };
  state.year = year;
  state.month = monthForDay(day);
}

function applyRoute() {
  const { current } = state.data;
  const hash = location.hash;
  let m;

  if ((m = /^#\/chronicle(?:\/(oldest))?$/.exec(hash))) {
    state.view = "chronicle";
    state.order = m[1] ? "oldest" : "newest";
  } else if ((m = /^#\/(\d{4})$/.exec(hash))) {
    state.view = "year";
    state.year = +m[1];
  } else if ((m = /^#\/(\d{4})\/m(\d{1,2})$/.exec(hash)) && +m[2] >= 1 && +m[2] <= MONTHS_PER_YEAR) {
    const year = +m[1];
    const month = +m[2];
    const { first, last } = monthRange(month);
    // Keep the selected day if it's in this month; otherwise today if it is, else the month's first day.
    const inMonth = (s) => s && s.year === year && s.day >= first && s.day <= last;
    const keep = inMonth(state.selected) ? state.selected : inMonth(current) ? current : { day: first, year };
    selectDay(keep.day, year);
    state.month = month;
    state.view = "month";
  } else if ((m = /^#\/(\d{4})\/(\d{1,3})$/.exec(hash)) && isValidDay(+m[2])) {
    selectDay(+m[2], +m[1]);
    state.view = "month";
  } else {
    selectDay(current.day, current.year);
    state.view = "month";
  }
  render();
}

function render() {
  const { view } = state;
  $("views").innerHTML = renderViewNav(state);
  $("deck").classList.toggle("deck--wide", view !== "month");
  $("log").hidden = view !== "month";

  if (view === "year") {
    $("main").innerHTML = renderYear(state);
    document.title = `Year ${state.year} · Imperial Calendar`;
  } else if (view === "chronicle") {
    $("main").innerHTML = renderChronicle(state);
    document.title = "Chronicle · Imperial Calendar";
  } else {
    $("main").innerHTML = renderMonth(state);
    $("log").innerHTML = renderDayPanel(state);
    document.title = `Month ${state.month} · ${state.year} · Imperial Calendar`;
  }
}

function go(hash) {
  if (location.hash === hash) applyRoute();
  else location.hash = hash;
}

function step(delta) {
  if (state.view === "year") {
    go(`#/${state.year + delta}`);
    return;
  }
  let { year, month } = state;
  month += delta;
  if (month < 1) { month = MONTHS_PER_YEAR; year -= 1; }
  if (month > MONTHS_PER_YEAR) { month = 1; year += 1; }
  go(`#/${year}/m${month}`);
}

function goToday() {
  const { day, year } = state.data.current;
  if (state.view === "chronicle") {
    $("today-line")?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  } else if (state.view === "year") {
    go(`#/${year}`);
  } else {
    go(`#/${year}/${day}`);
  }
}

function wireEvents() {
  $("main").addEventListener("click", (ev) => {
    const nav = ev.target.closest("[data-go]");
    if (nav) {
      const where = nav.dataset.go;
      if (where === "today") goToday();
      else step(where === "next" ? 1 : -1);
      return;
    }
    const day = ev.target.closest(".cell[data-abs], button.holiday[data-abs]");
    if (day) {
      const { day: d, year } = fromAbs(+day.dataset.abs);
      go(`#/${year}/${d}`);
    }
  });

  $("main").addEventListener("keydown", (ev) => {
    const day = ev.target.closest(".cell[data-abs]");
    if (day && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      day.click();
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.target.closest("input, textarea, select")) return;
    const key = ev.key.toLowerCase();
    if (ev.key === "ArrowLeft" && state.view !== "chronicle") step(-1);
    else if (ev.key === "ArrowRight" && state.view !== "chronicle") step(1);
    else if (key === "t") goToday();
    else if (key === "y") go(`#/${state.year}`);
    else if (key === "m") go(`#/${state.selected.year}/${state.selected.day}`);
    else if (key === "c") go("#/chronicle");
  });

  window.addEventListener("hashchange", () => {
    const before = state.view;
    applyRoute();
    // Start each newly opened view at the top; month-to-month browsing keeps its place.
    if (state.view !== before || state.view === "chronicle") window.scrollTo(0, 0);
  });
}

async function start() {
  try {
    const res = await fetch("data/calendar.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.statusText);
    state.data = await res.json();
  } catch {
    $("main").innerHTML = `<p class="status">Ship's log unavailable. Reload the page to try again.</p>`;
    return;
  }
  $("clock").innerHTML = renderClock(state.data);
  wireEvents();
  applyRoute();
}

start();

// Run with: node --test scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseTimeline, DEFAULT_SOURCE } from "./build-calendar.mjs";
import {
  weekdayName, weekOf, monthOf, monthRange, toAbs, fromAbs, parseDate,
} from "../site/js/calendar-math.js";

// --- Calendar arithmetic ---------------------------------------------------

test("Holiday is outside every week and month", () => {
  assert.equal(weekdayName(1), "Holiday");
  assert.equal(weekOf(1), null);
  assert.equal(monthOf(1), null);
});

test("day 002 starts week 1, month 1, on a Sunday", () => {
  assert.equal(weekdayName(2), "Sunday");
  assert.equal(weekOf(2), 1);
  assert.equal(monthOf(2), 1);
});

test("month boundaries fall every 28 days", () => {
  assert.deepEqual(monthRange(1), { first: 2, last: 29 });
  assert.equal(monthOf(29), 1);
  assert.equal(monthOf(30), 2);
  assert.deepEqual(monthRange(13), { first: 338, last: 365 });
});

test("day 365 is the last Saturday of week 52, month 13", () => {
  assert.equal(weekdayName(365), "Saturday");
  assert.equal(weekOf(365), 52);
  assert.equal(monthOf(365), 13);
});

test("212-1105 is Sunday, week 31, month 8", () => {
  assert.equal(weekdayName(212), "Sunday");
  assert.equal(weekOf(212), 31);
  assert.equal(monthOf(212), 8);
});

test("absolute days run continuously across a year end", () => {
  assert.equal(toAbs(1, 1106) - toAbs(365, 1105), 1);
  assert.deepEqual(fromAbs(toAbs(207, 1105)), { day: 207, year: 1105 });
});

test("parseDate rejects out-of-range days", () => {
  assert.deepEqual(parseDate("207-1105"), { day: 207, year: 1105 });
  assert.equal(parseDate("000-1105"), null);
  assert.equal(parseDate("366-1105"), null);
  assert.equal(parseDate("212=1105"), null);
});

// --- Timeline parsing ------------------------------------------------------

const note = (body, frontmatter = "current_date: 100-1105") =>
  `---\n${frontmatter}\n---\nCreated:  2025-01-14 16:43\n\n----\nTimeline  of [[sector_solo_6|Sector Solo Six]]\n\n${body}\n`;

const only = (body) => {
  const r = parseTimeline(note(body));
  assert.deepEqual(r.errors, []);
  assert.equal(r.events.length, 1);
  return r.events[0];
};

test("reads current_date from frontmatter, and --current overrides it", () => {
  assert.deepEqual(parseTimeline(note("")).current, { day: 100, year: 1105, abs: toAbs(100, 1105) });
  assert.equal(parseTimeline(note(""), { current: "212-1105" }).current.day, 212);
});

test("missing or bad current_date is an error", () => {
  assert.equal(parseTimeline(note("", "aliases:")).errors.length, 1);
  assert.equal(parseTimeline(note("", "current_date: 400-1105")).errors.length, 1);
});

test("single day with ' - ' and a location", () => {
  const e = only("022-1105 - Romentino: BIAS CCR departed for Mirassol via 30-hour shuttle.");
  assert.equal(e.id, "1105-022");
  assert.equal(e.location, "Romentino");
  assert.equal(e.text, "BIAS CCR departed for Mirassol via 30-hour shuttle.");
  assert.equal(e.category, "party");
});

test("date followed directly by the location, no dash", () => {
  const e = only("054-1105 Csabai:  The group arrives in the Csabai system");
  assert.equal(e.location, "Csabai");
});

test("entry without a location", () => {
  const e = only("035-1105 - Escape from Mirassol ([[ss6_aar_summary_8]])");
  assert.equal(e.location, null);
  assert.equal(e.text, "Escape from Mirassol");
  assert.deepEqual(e.sessions, [8]);
});

test("range within a year, with the AAR link on the next line", () => {
  const e = only("036-038-1105 - In Transit: A rushed escape. \n([[ss6_aar_summary_9]])");
  assert.equal(e.start.day, 36);
  assert.equal(e.end.day, 38);
  assert.equal(e.text, "A rushed escape.");
  assert.deepEqual(e.sessions, [9]);
});

test("range across a year end", () => {
  const e = only("360-1105-010-1106 - In Transit: Long haul.");
  assert.deepEqual([e.start.day, e.start.year, e.end.day, e.end.year], [360, 1105, 10, 1106]);
});

test("AAR links with paths and session ranges become session numbers", () => {
  const e = only(
    "044-1105 - Romentino: Rescued Paolo ([[03_projects/project_solo_6/ss6_summaries_timelines/ss6_aar_summary_14]], " +
      "[[ss6_aar_summary_31_32]], [[ss6_aar_summary_56-57]]).",
  );
  assert.deepEqual(e.sessions, [14, 31, 32, 56, 57]);
  assert.equal(e.text, "Rescued Paolo.");
});

test("other wiki links become plain text, using the alias when given", () => {
  const e = only("132-1105 Freeport: Went to [[Cafe_Dimitri]] then [[Project_Metropolis|Metropolis Station]].");
  assert.equal(e.text, "Went to Cafe Dimitri then Metropolis Station.");
});

test("a category tag sets the category and is removed from the text", () => {
  const e = only("025-1105 - Nesvorny: Pharr care package announced. #news");
  assert.equal(e.category, "news");
  assert.equal(e.text, "Pharr care package announced.");
});

test("unknown tags are kept and produce a warning", () => {
  const r = parseTimeline(note("025-1105 - Nesvorny: Something. #rumour"));
  assert.equal(r.events[0].category, "party");
  assert.match(r.events[0].text, /#rumour/);
  assert.equal(r.warnings.length, 1);
});

test("an unreadable date line is an error, never silently dropped", () => {
  for (const bad of ["212=1105 - Somewhere: x", "400-1105 - Somewhere: x", "050-040-1105 - Backwards: x"]) {
    const r = parseTimeline(note(bad));
    assert.equal(r.errors.length, 1, bad);
    assert.equal(r.events.length, 0, bad);
  }
});

test("two entries on the same day get distinct ids; events are sorted", () => {
  const r = parseTimeline(note("050-1105 - A: second\n\n010-1105 - B: first\n\n050-1105 - C: third"));
  assert.deepEqual(r.events.map((e) => e.id), ["1105-010", "1105-050", "1105-050-2"]);
});

test("long titles are cut at a word boundary", () => {
  const e = only(`100-1105 - X: ${"word ".repeat(40)}`);
  assert.ok(e.title.length <= 91);
  assert.ok(e.title.endsWith("…"));
});

// --- The real note, read in place (skipped on other machines) -------------

test("the real ss6_timeline.md parses without errors", { skip: !existsSync(DEFAULT_SOURCE) }, () => {
  const r = parseTimeline(readFileSync(DEFAULT_SOURCE, "utf8"), { current: "212-1105" });
  assert.deepEqual(r.errors, []);
  assert.ok(r.events.length >= 48);
});

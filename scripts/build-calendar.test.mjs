// Run with: npm test
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

test("absolute days run continuously across a year end", () => {
  assert.equal(toAbs(1, 1106) - toAbs(365, 1105), 1);
  assert.deepEqual(fromAbs(toAbs(207, 1105)), { day: 207, year: 1105 });
});

test("parseDate rejects malformed and out-of-range dates", () => {
  assert.deepEqual(parseDate("207-1105"), { day: 207, year: 1105 });
  assert.equal(parseDate("000-1105"), null);
  assert.equal(parseDate("366-1105"), null);
  assert.equal(parseDate("212=1105"), null);
});

// --- Timeline format -------------------------------------------------------

const note = (body, frontmatter = "current_date: 100-1105") =>
  `---\n${frontmatter}\n---\nIntro text with [[links]].\n\n> [!info]- How to\n> ## 207-1105 - example inside a callout\n\n# 1105\n\n${body}\n`;

const parse = (body) => parseTimeline(note(body));

const only = (body) => {
  const r = parse(body);
  assert.deepEqual(r.errors, []);
  assert.equal(r.events.length, 1);
  return r.events[0];
};

test("reads current_date from frontmatter, and --current overrides it", () => {
  assert.equal(parse("").current.day, 100);
  assert.equal(parseTimeline(note(""), { current: "212-1105" }).current.day, 212);
});

test("missing or bad current_date is an error", () => {
  assert.equal(parseTimeline(note("", "aliases:")).errors.length, 1);
  assert.equal(parseTimeline(note("", "current_date: 400-1105")).errors.length, 1);
});

test("a full entry", () => {
  const e = only(
    "## 115-1105 - Undercover on Suliman\nwhere: Suliman / Arico\ntype: party\n" +
      "aar: [[ss6_aar_summary_34]], [[ss6_aar_summary_35]]\n\nThe group arrived.\nThey hacked the feeds.\n\nSecond paragraph.",
  );
  assert.equal(e.id, "1105-115");
  assert.equal(e.title, "Undercover on Suliman");
  assert.equal(e.location, "Suliman / Arico");
  assert.equal(e.system, "Arico");
  assert.equal(e.type, "party");
  assert.deepEqual(e.sessions, [34, 35]);
  assert.equal(e.text, "The group arrived. They hacked the feeds.\n\nSecond paragraph.");
});

test("a minimal entry: just a date and title", () => {
  const e = only("## 039-1105 - Meeting Lord Baltimore");
  assert.equal(e.type, "party");
  assert.equal(e.location, null);
  assert.deepEqual(e.sessions, []);
  assert.equal(e.text, "");
});

test("a span, including across a year end", () => {
  const e = only("## 360-1105 to 010-1106 - Long haul\ntype: travel");
  assert.deepEqual([e.start.day, e.start.year, e.end.day, e.end.year], [360, 1105, 10, 1106]);
});

test("callout examples and year headings are not entries", () => {
  assert.equal(parse("").events.length, 0);
});

test("AAR links with paths and session ranges become session numbers", () => {
  const e = only(
    "## 044-1105 - Rescue\naar: [[03_projects/x/ss6_aar_summary_14]], [[ss6_aar_summary_31_32]], [[ss6_aar_summary_56-57]]",
  );
  assert.deepEqual(e.sessions, [14, 31, 32, 56, 57]);
});

test("wiki links become plain text, using the alias when given", () => {
  const e = only("## 132-1105 - Freeport\n\nWent to [[Cafe_Dimitri]] then [[Project_Metropolis|Metropolis Station]].");
  assert.equal(e.text, "Went to Cafe Dimitri then Metropolis Station.");
});

test("a field-like line after the description is kept as text", () => {
  const e = only("## 100-1105 - X\n\nThe log says:\nwhere: nobody knows");
  assert.equal(e.location, null);
  assert.match(e.text, /where: nobody knows/);
});

test("format mistakes are errors, never silently dropped", () => {
  for (const bad of [
    "## 212=1105 - Typo in the date",
    "## Session notes",
    "## 400-1105 - Day out of range",
    "## 050-1105 to 040-1105 - Backwards",
    "## 050-1105",
    "## 050-1105 - Bad type\ntype: rumour",
  ]) {
    const r = parse(bad);
    assert.equal(r.errors.length, 1, bad);
    assert.equal(r.events.length, 0, bad);
  }
});

test("an aar field without AAR links warns", () => {
  const r = parse("## 050-1105 - X\naar: session 12");
  assert.equal(r.warnings.length, 1);
});

test("entries on the same day get distinct ids; events are sorted by date", () => {
  const r = parse("## 050-1105 - second\n\n## 010-1105 - first\n\n## 050-1105 - third");
  assert.deepEqual(r.events.map((e) => e.id), ["1105-010", "1105-050", "1105-050-2"]);
});

// --- The real note in the vault (skipped on machines without it) ----------

test("the vault's ss6_timeline.md parses cleanly", { skip: !existsSync(DEFAULT_SOURCE) }, () => {
  const r = parseTimeline(readFileSync(DEFAULT_SOURCE, "utf8"));
  assert.deepEqual(r.errors, []);
  assert.ok(r.current);
  assert.ok(r.events.length >= 48);
});

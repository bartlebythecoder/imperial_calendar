// Builds site/data/calendar.json from the Obsidian note ss6_timeline.md.
//
// Usage:
//   node scripts/build-calendar.mjs [--source <timeline.md>] [--out <calendar.json>]
//                                   [--current DDD-YYYY] [--check]
//
// --current overrides `current_date` in the note's frontmatter.
// --check parses and reports without writing anything.
// Exits with status 1 if any line can't be understood, so a bad entry is never
// silently dropped.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toAbs, isValidDay, parseDate, formatDate } from "../site/js/calendar-math.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SOURCE =
  "C:/Users/sean/Documents/Necronomicon Reborn/03_projects/project_solo_6/ss6_summaries_timelines/ss6_timeline.md";
export const DEFAULT_OUT = resolve(HERE, "../site/data/calendar.json");

export const CATEGORIES = ["party", "news", "travel", "downtime", "deadline", "finance"];
const TAGGED_CATEGORIES = new Set(CATEGORIES.filter((c) => c !== "party"));

// Date forms at the start of a line, most specific first.
const DATE_FORMS = [
  // 360-1105-010-1106: range across years
  { re: /^(\d{1,3})-(\d{4})-(\d{1,3})-(\d{4})(?!\d)/, parts: (m) => [m[1], m[2], m[3], m[4]] },
  // 023-036-1105: range within a year
  { re: /^(\d{1,3})-(\d{1,3})-(\d{4})(?!\d)/, parts: (m) => [m[1], m[3], m[2], m[3]] },
  // 047-1105: single day
  { re: /^(\d{1,3})-(\d{4})(?!\d)/, parts: (m) => [m[1], m[2], m[1], m[2]] },
];

// Anything starting like a date that fails the forms above is reported as an error.
const DATE_LIKE = /^\d{1,3}\s*[-=–]\s*\d/;

const AAR_LINK = /\[\[[^\]|]*?ss6_aar_summary_(\d+)(?:[_-](\d+))?(?:\|[^\]]*)?\]\]/g;
const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const TAG = /(^|\s)#([A-Za-z][\w-]*)/g;

/** Splits off YAML frontmatter and returns { fields, body, bodyStartLine }. */
function splitFrontmatter(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { fields: {}, lines, offset: 0 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { fields: {}, lines, offset: 0 };
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (m) fields[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { fields, lines: lines.slice(end + 1), offset: end + 1 };
}

function matchDate(line) {
  for (const form of DATE_FORMS) {
    const m = form.re.exec(line);
    if (m) {
      const [sd, sy, ed, ey] = form.parts(m).map(Number);
      return { start: { day: sd, year: sy }, end: { day: ed, year: ey }, length: m[0].length };
    }
  }
  return null;
}

function dateWithAbs({ day, year }) {
  return { day, year, abs: toAbs(day, year) };
}

/** Removes AAR links, returning the cleaned text and the session numbers they named. */
function extractSessions(text) {
  const sessions = new Set();
  const cleaned = text.replace(AAR_LINK, (_, a, b) => {
    const from = Number(a);
    const to = b === undefined ? from : Number(b);
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) sessions.add(n);
    return "";
  });
  return { text: cleaned, sessions: [...sessions].sort((x, y) => x - y) };
}

/** [[path/note_name|Alias]] -> "Alias"; [[path/note_name]] -> "note name". */
function flattenWikiLinks(text) {
  return text.replace(WIKI_LINK, (_, target, alias) =>
    (alias ?? target.split("/").pop()).replace(/_/g, " ").trim(),
  );
}

function tidy(text) {
  return text
    .replace(/\(\s*[,;\s]*\)/g, "") // parentheses left empty after removing AAR links
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstSentence(text, max = 90) {
  const sentence = text.split(/(?<=[.!?])\s/)[0].replace(/[.]$/, "");
  if (sentence.length <= max) return sentence;
  const cut = sentence.lastIndexOf(" ", max);
  return sentence.slice(0, cut > 0 ? cut : max) + "…";
}

/**
 * Parses the timeline note.
 * Returns { current, events, errors, warnings }; `current` is null when the note
 * has no current_date and none was supplied.
 */
export function parseTimeline(markdown, { current: currentOverride } = {}) {
  const errors = [];
  const warnings = [];
  const { fields, lines, offset } = splitFrontmatter(markdown);

  const currentText = currentOverride ?? fields.current_date;
  let current = null;
  if (currentText === undefined) {
    errors.push("No current_date in the note's frontmatter (add a line like `current_date: 212-1105`).");
  } else {
    const parsed = parseDate(currentText);
    if (parsed) current = dateWithAbs(parsed);
    else errors.push(`current_date "${currentText}" is not a valid DDD-YYYY date.`);
  }

  // Group lines into raw entries: a date line plus any continuation lines.
  const raw = [];
  lines.forEach((line, i) => {
    const lineNo = i + offset + 1;
    const trimmed = line.trim();
    const date = matchDate(trimmed);
    if (date) {
      raw.push({ lineNo, date, parts: [trimmed.slice(date.length)] });
    } else if (DATE_LIKE.test(trimmed)) {
      errors.push(`Line ${lineNo}: can't read the date in "${trimmed.slice(0, 40)}".`);
    } else if (trimmed && raw.length) {
      raw.at(-1).parts.push(trimmed);
    }
  });

  const events = [];
  const ids = new Map();
  for (const { lineNo, date, parts } of raw) {
    const { start, end } = date;
    const where = `Line ${lineNo} (${formatDate(start.day, start.year)})`;
    if (!isValidDay(start.day) || !isValidDay(end.day)) {
      errors.push(`${where}: day must be between 001 and 365.`);
      continue;
    }
    if (toAbs(end.day, end.year) < toAbs(start.day, start.year)) {
      errors.push(`${where}: the range ends before it starts.`);
      continue;
    }

    let body = parts.join(" ").replace(/^\s*[-–]\s*/, "");

    // Category tags
    let category = "party";
    body = body.replace(TAG, (whole, lead, tag) => {
      const name = tag.toLowerCase();
      if (!TAGGED_CATEGORIES.has(name)) {
        warnings.push(`${where}: unknown tag #${tag} left in the text.`);
        return whole;
      }
      if (category !== "party") warnings.push(`${where}: several category tags; using #${category}.`);
      else category = name;
      return lead;
    });

    const { text: withoutAars, sessions } = extractSessions(body);
    body = withoutAars;

    // Location: text before the first colon, when it looks like a place name.
    let location = null;
    const loc = /^([^:[\]]{1,40}):\s*(.*)$/.exec(body);
    if (loc) {
      location = tidy(loc[1]);
      body = loc[2];
    }

    const text = tidy(flattenWikiLinks(body));
    if (!text) {
      errors.push(`${where}: entry has no text.`);
      continue;
    }

    const baseId = `${start.year}-${String(start.day).padStart(3, "0")}`;
    const n = (ids.get(baseId) ?? 0) + 1;
    ids.set(baseId, n);

    events.push({
      id: n === 1 ? baseId : `${baseId}-${n}`,
      start: dateWithAbs(start),
      end: dateWithAbs(end),
      location,
      title: firstSentence(text),
      text,
      category,
      sessions,
      line: lineNo,
    });
  }

  events.sort((a, b) => a.start.abs - b.start.abs || a.line - b.line);
  return { current, events, errors, warnings };
}

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, out: DEFAULT_OUT, current: undefined, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--current") args.current = argv[++i];
    else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.source)) {
    console.error(`Timeline not found: ${args.source}`);
    process.exit(1);
  }

  const result = parseTimeline(readFileSync(args.source, "utf8"), { current: args.current });
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  if (result.errors.length) {
    for (const e of result.errors) console.error(`error: ${e}`);
    console.error(`Calendar NOT built: ${result.errors.length} problem(s) in ${args.source}`);
    process.exit(1);
  }

  const { current, events } = result;
  const first = events[0];
  const last = events.at(-1);
  console.log(
    `${events.length} events, ${first ? formatDate(first.start.day, first.start.year) : "-"} to ` +
      `${last ? formatDate(last.end.day, last.end.year) : "-"}; today is ${formatDate(current.day, current.year)}.`,
  );
  if (args.check) return;

  const json = JSON.stringify({ current, events: events.map(({ line, ...e }) => e) }, null, 2) + "\n";
  const previous = existsSync(args.out) ? readFileSync(args.out, "utf8") : null;
  if (json === previous) {
    console.log("No changes.");
    return;
  }
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, json);
  console.log(`Wrote ${args.out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

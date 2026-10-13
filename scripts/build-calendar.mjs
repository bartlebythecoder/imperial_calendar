// Builds site/data/calendar.json from the Obsidian note ss6_timeline.md.
//
// Usage:
//   node scripts/build-calendar.mjs [--source <timeline.md>] [--out <calendar.json>]
//                                   [--current DDD-YYYY] [--check]
//
// --current overrides `current_date` in the note's frontmatter.
// --check parses and reports without writing anything.
//
// The note format (see the "How to write an entry" callout in the note):
//
//   ## 023-1105 to 036-1105 - Short title
//   where: Mirassol
//   type: party
//   aar: [[ss6_aar_summary_1_5]]
//
//   Description, any number of paragraphs.
//
// Exits with status 1 if anything breaks the format, so a bad entry is never
// silently dropped.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toAbs, isValidDay, parseDate, formatDate } from "../site/js/calendar-math.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SOURCE =
  "C:/Users/sean/Documents/Necronomicon Reborn/03_projects/project_solo_6/ss6_summaries_timelines/ss6_timeline.md";
export const DEFAULT_OUT = resolve(HERE, "../site/data/calendar.json");

export const TYPES = ["party", "news", "travel", "downtime", "deadline", "finance"];

const ENTRY_HEADING = /^##\s+(.*)$/;
const OTHER_HEADING = /^#(?!#)\s|^#\s*$/; // "# 1105" year dividers end an entry
const HEADING_DATE =
  /^(\d{1,3})-(\d{4})(?:\s+to\s+(\d{1,3})-(\d{4}))?(?:\s*[-–—:]\s*|\s+|$)(.*)$/;
const FIELD = /^(where|type|aar):\s*(.*)$/i;
const AAR_LINK = /\[\[[^\]|]*?ss6_aar_summary_(\d+)(?:[_-](\d+))?(?:\|[^\]]*)?\]\]/g;
const WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

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

/** [[path/note_name|Alias]] -> "Alias"; [[path/note_name]] -> "note name". */
function flattenWikiLinks(text) {
  return text.replace(WIKI_LINK, (_, target, alias) =>
    (alias ?? target.split("/").pop()).replace(/_/g, " ").trim(),
  );
}

function sessionsFrom(aarField) {
  const sessions = new Set();
  for (const [, a, b] of aarField.matchAll(AAR_LINK)) {
    const from = Number(a);
    const to = b === undefined ? from : Number(b);
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) sessions.add(n);
  }
  return [...sessions].sort((x, y) => x - y);
}

/** Paragraphs separated by blank lines; lines within a paragraph joined with spaces. */
function paragraphs(lines) {
  return lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).join(" ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function dateWithAbs(day, year) {
  return { day, year, abs: toAbs(day, year) };
}

/**
 * Parses the timeline note.
 * Returns { current, events, errors, warnings }; `current` is null when the note
 * has no usable current_date and none was supplied.
 */
export function parseTimeline(markdown, { current: currentOverride } = {}) {
  const errors = [];
  const warnings = [];
  const { fields, lines, offset } = splitFrontmatter(markdown);

  const currentText = currentOverride ?? fields.current_date;
  let current = null;
  if (currentText === undefined) {
    errors.push("No current_date in the note's frontmatter (add a line like `current_date: 200-1105`).");
  } else {
    const parsed = parseDate(currentText);
    if (parsed) current = dateWithAbs(parsed.day, parsed.year);
    else errors.push(`current_date "${currentText}" is not a valid DDD-YYYY date.`);
  }

  // Split into entries: each "## " heading plus the lines up to the next heading.
  const blocks = [];
  let block = null;
  lines.forEach((line, i) => {
    const lineNo = i + offset + 1;
    const heading = ENTRY_HEADING.exec(line);
    if (heading) {
      block = { lineNo, heading: heading[1].trim(), lines: [] };
      blocks.push(block);
    } else if (OTHER_HEADING.test(line)) {
      block = null;
    } else if (block) {
      block.lines.push(line);
    }
  });

  const events = [];
  const ids = new Map();
  for (const { lineNo, heading, lines: body } of blocks) {
    const where = `Line ${lineNo}`;
    const m = HEADING_DATE.exec(heading);
    if (!m) {
      errors.push(`${where}: "## ${heading.slice(0, 40)}" must start with a date like 207-1105.`);
      continue;
    }
    const start = { day: Number(m[1]), year: Number(m[2]) };
    const end = m[3] ? { day: Number(m[3]), year: Number(m[4]) } : start;
    const title = flattenWikiLinks(m[5].trim());

    if (!isValidDay(start.day) || !isValidDay(end.day)) {
      errors.push(`${where}: day must be between 001 and 365.`);
      continue;
    }
    if (toAbs(end.day, end.year) < toAbs(start.day, start.year)) {
      errors.push(`${where}: the span ends before it starts.`);
      continue;
    }
    if (!title) {
      errors.push(`${where}: add a short title after the date.`);
      continue;
    }

    // Field lines come first, directly under the heading (blank lines allowed).
    let i = 0;
    const entryFields = {};
    for (; i < body.length; i++) {
      const line = body[i].trim();
      if (!line) continue;
      const f = FIELD.exec(line);
      if (!f) break;
      const key = f[1].toLowerCase();
      if (key in entryFields) warnings.push(`${where}: "${key}" given twice; using the last one.`);
      entryFields[key] = f[2].trim();
    }

    const type = (entryFields.type || "party").toLowerCase();
    if (!TYPES.includes(type)) {
      errors.push(`${where}: type "${entryFields.type}" must be one of ${TYPES.join(", ")}.`);
      continue;
    }

    const sessions = entryFields.aar ? sessionsFrom(entryFields.aar) : [];
    if (entryFields.aar && !sessions.length) {
      warnings.push(`${where}: no [[ss6_aar_summary_N]] links found in "aar: ${entryFields.aar}".`);
    }

    const location = entryFields.where ? flattenWikiLinks(entryFields.where) : null;
    const system = location ? location.split("/").pop().trim() : null;

    const baseId = `${start.year}-${String(start.day).padStart(3, "0")}`;
    const n = (ids.get(baseId) ?? 0) + 1;
    ids.set(baseId, n);

    events.push({
      id: n === 1 ? baseId : `${baseId}-${n}`,
      start: dateWithAbs(start.day, start.year),
      end: dateWithAbs(end.day, end.year),
      title,
      type,
      location,
      system,
      sessions,
      text: flattenWikiLinks(paragraphs(body.slice(i))),
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

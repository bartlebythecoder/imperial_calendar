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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toAbs, isValidDay, parseDate, formatDate } from "../site/js/calendar-math.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SOURCE =
  "C:/Users/sean/Documents/Necronomicon Reborn/03_projects/project_solo_6/ss6_summaries_timelines/ss6_timeline.md";
export const DEFAULT_OUT = resolve(HERE, "../site/data/calendar.json");
// The players' wiki: Quartz publishes each file in this folder at WIKI_URL + file name.
export const DEFAULT_WIKI_DIR =
  "C:/Users/sean/Documents/Necronomicon Reborn/04_knowledge_wikis/bias_ccr_wiki/wiki";
export const WIKI_URL = "https://bartlebythecoder.github.io/bias_ccr_bot/";

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

// ---------- Wiki links ----------

const normalise = (name) => name.trim().toLowerCase();

/**
 * Builds a lookup from every wiki page's file name, title and aliases to its
 * slug. `pages` is a list of { slug, title, aliases }.
 */
export function makeWikiIndex(pages) {
  const index = new Map();
  // File names first, so a page's own name wins over another page's alias.
  for (const { slug } of pages) index.set(normalise(slug), slug);
  for (const { slug, title, aliases = [] } of pages) {
    for (const name of [title, ...aliases]) {
      if (name && !index.has(normalise(name))) index.set(normalise(name), slug);
    }
  }
  return index;
}

/** Reads titles and aliases from the frontmatter of every page in the wiki folder. */
export function loadWikiIndex(dir) {
  const pages = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const src = readFileSync(join(dir, f), "utf8").replace(/\r/g, "");
      const fm = /^---\n([\s\S]*?)\n---/.exec(src)?.[1] ?? "";
      const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");
      const title = /^title:\s*(.+)$/m.exec(fm)?.[1];
      const block = /^aliases:[ \t]*\n((?:[ \t]+-.*(?:\n|$))+)/m.exec(fm)?.[1] ?? "";
      const aliases = [...block.matchAll(/^[ \t]+-[ \t]*(.+)$/gm)].map((m) => unquote(m[1]));
      return { slug: f.slice(0, -3), title: title && unquote(title), aliases };
    });
  return makeWikiIndex(pages);
}

/** Finds the wiki slug for a link target or place name, or null. */
function lookup(wiki, name) {
  if (!wiki) return null;
  const base = name.split("#")[0].split("/").pop().trim();
  for (const candidate of [base, base.replace(/_/g, " "), base.replace(/[_\s]+/g, "-")]) {
    const slug = wiki.get(normalise(candidate));
    if (slug) return slug;
  }
  return null;
}

/**
 * Rewrites [[links]]. With `keep`, links to wiki pages become [[slug|Display]]
 * markers the site turns into links; everything else becomes plain display
 * text. Names with no wiki page are added to `unlinked`.
 */
function resolveLinks(text, { wiki, keep, unlinked }) {
  return text.replace(WIKI_LINK, (_, target, alias) => {
    const display = (alias ?? target.split("#")[0].split("/").pop()).replace(/_/g, " ").trim();
    const slug = lookup(wiki, target);
    if (!slug) {
      unlinked?.add(target.trim());
      return display;
    }
    return keep ? `[[${slug}|${display}]]` : display;
  });
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
 * Returns { current, events, errors, warnings, unlinked }; `current` is null when
 * the note has no usable current_date and none was supplied. `wiki` (from
 * loadWikiIndex) turns [[links]] and `where:` places into wiki links; without
 * it, links become plain text. `unlinked` lists [[links]] with no wiki page.
 */
export function parseTimeline(markdown, { current: currentOverride, wiki = null } = {}) {
  const errors = [];
  const warnings = [];
  const unlinked = new Set();
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
    const title = resolveLinks(m[5].trim(), { wiki, keep: false, unlinked });

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

    // `where: Place / System`: each part links to its wiki page when there is one.
    const places = entryFields.where
      ? entryFields.where.split("/").map((part) => {
        const name = resolveLinks(part, { wiki, keep: false, unlinked }).trim();
        const linked = /\[\[([^\]|]+)/.exec(part);
        return { name, slug: lookup(wiki, linked ? linked[1] : name) };
      }).filter((p) => p.name)
      : [];
    const location = places.length ? places.map((p) => p.name).join(" / ") : null;
    const system = places.length ? places.at(-1).name : null;

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
      places,
      sessions,
      text: resolveLinks(paragraphs(body.slice(i)), { wiki, keep: true, unlinked }),
      line: lineNo,
    });
  }

  events.sort((a, b) => a.start.abs - b.start.abs || a.line - b.line);
  return { current, events, errors, warnings, unlinked: [...unlinked].sort() };
}

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, out: DEFAULT_OUT, wikiDir: DEFAULT_WIKI_DIR, current: undefined, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") args.check = true;
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--wiki") args.wikiDir = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--current") args.current = argv[++i];
    else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

/**
 * Reads the timeline, reports problems, and (unless `check`) writes the JSON.
 * Returns { ok, changed, current }. Messages go to the console.
 */
export function buildCalendar({
  source = DEFAULT_SOURCE, out = DEFAULT_OUT, wikiDir = DEFAULT_WIKI_DIR, current, check = false,
} = {}) {
  if (!existsSync(source)) {
    console.error(`Timeline not found: ${source}`);
    return { ok: false };
  }

  let wiki = null;
  if (existsSync(wikiDir)) wiki = loadWikiIndex(wikiDir);
  else console.warn(`warning: wiki folder not found (${wikiDir}); building without wiki links.`);

  const result = parseTimeline(readFileSync(source, "utf8"), { current, wiki });
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  if (result.unlinked.length) {
    console.log(`Not on the wiki, shown as plain text: ${result.unlinked.join(", ")}`);
  }
  if (result.errors.length) {
    for (const e of result.errors) console.error(`error: ${e}`);
    console.error(`Calendar NOT built: ${result.errors.length} problem(s) in ${source}`);
    return { ok: false };
  }

  const { events } = result;
  const today = formatDate(result.current.day, result.current.year);
  const first = events[0];
  const last = events.at(-1);
  console.log(
    `${events.length} entries, ${first ? formatDate(first.start.day, first.start.year) : "-"} to ` +
      `${last ? formatDate(last.end.day, last.end.year) : "-"}; today is ${today}.`,
  );
  if (check) return { ok: true, changed: false, current: today };

  const json = JSON.stringify({
    current: result.current,
    wiki: WIKI_URL,
    events: events.map(({ line, ...e }) => e),
  }, null, 2) + "\n";
  const previous = existsSync(out) ? readFileSync(out, "utf8") : null;
  if (json === previous) {
    console.log("No changes.");
    return { ok: true, changed: false, current: today };
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`Wrote ${out}`);
  return { ok: true, changed: true, current: today };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok } = buildCalendar(parseArgs(process.argv.slice(2)));
  if (!ok) process.exit(1);
}

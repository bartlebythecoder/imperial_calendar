// Builds the calendar from the timeline note and, if the data changed,
// commits and pushes it so GitHub Pages redeploys the site.
//
// Run by publish-calendar.bat from the Obsidian publish button. Only
// site/data/calendar.json is ever committed, so unfinished work elsewhere in
// the repo is left alone.

import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCalendar, DEFAULT_OUT } from "./build-calendar.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = relative(REPO, DEFAULT_OUT).replaceAll("\\", "/");

const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function publish() {
  console.log("[calendar] Reading the timeline…");
  const build = buildCalendar();
  if (!build.ok) {
    console.error("[calendar] NOT published. Fix the timeline note and publish again.");
    return 1;
  }

  // Also catches a built-but-never-pushed file from an earlier failed run.
  const pending = git("status", "--porcelain", "--", DATA);
  if (!pending) {
    console.log(`[calendar] Already up to date (today is ${build.current}).`);
    return 0;
  }

  try {
    git("add", "--", DATA);
    git("commit", "-m", `Calendar update to ${build.current}`, "--", DATA);
    git("push");
  } catch (err) {
    console.error(`[calendar] Built, but the upload to GitHub failed:\n${err.stderr || err.message}`);
    console.error("[calendar] Press the publish button again once the connection is back.");
    return 1;
  }
  console.log(`[calendar] Published ${build.current}. The site updates in about a minute.`);
  return 0;
}

process.exitCode = publish();

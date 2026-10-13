# Imperial Calendar: Design & Plan

A read-only, in-universe calendar for the **Sector Solo Six** Traveller campaign, published on GitHub Pages. Players use it to see when things happened and what is coming up. The GM is the only editor and keeps writing events in Obsidian as before.

- **Site:** `https://bartlebythecoder.github.io/imperial_calendar/`
- **Repo:** `bartlebythecoder/imperial_calendar` (this folder)
- **Source of truth:** `Necronomicon Reborn\03_projects\project_solo_6\ss6_summaries_timelines\ss6_timeline.md`

---

## 1. Calendar rules

| Item | Rule |
| --- | --- |
| Year | 365 days, written `DDD-YYYY` (e.g. `207-1105`) |
| Holiday | Day 001. Belongs to no week and no month. |
| Weeks | Days 002–365 form 52 weeks of 7 days |
| Weekdays | Earth names, **Sunday → Saturday**; day 002 is a Sunday |
| Months | 13 numbered months of 4 weeks (28 days) each; Month 1 = 002–029, Month 13 = 338–365 |
| Granularity | Days only, for now. The format leaves room for hours later. |

Formulas for day `d` from 2 to 365:

- `week = ⌊(d−2)/7⌋+1`
- `month = ⌊(d−2)/28⌋+1`
- `weekday = (d−2) mod 7` (0 = Sunday)

Internally, every date is stored as one **absolute day number**, `year × 365 + (d − 1)`. Ranges and cross-year comparisons are then plain arithmetic.

## 2. Source format: `ss6_timeline.md`

The GM keeps writing the note as now, with two additions.

**Frontmatter "today" counter:**

```yaml
---
aliases:
  - SS6 Timeline
current_date: 212-1105
---
```

**Optional category tag at the end of an entry:**

```
025-1105 - Nesvorny: Government announced MCr 45.0 Pharr care package. #news
099-1105 Csabai: The team jumps for Marcolandia. #travel
```

| Tag | Meaning |
| --- | --- |
| *(none)* | **party**: what BIAS CCR did |
| `#news` | Background or in-world news |
| `#travel` | Jumps, transits, arrivals |
| `#downtime` | Long stretches: clinics, layovers |
| `#deadline` | Something due on a date |
| `#finance` | Payments, pay-outs, debts |

Entries dated after `current_date` are shown as **forecasts** automatically. There are no recurring rules, no GM-only filter (everything in the note is player-safe), and no extra markup.

### Parsing rules (written to match the existing note)

- **Each entry starts with a date at the beginning of a line.** It runs until the next date line, so continuation lines such as `([[ss6_aar_summary_9]])` on their own line belong to the previous entry.
- **Accepted date forms:**
  - `047-1105` (single day)
  - `023-036-1105` (range within a year)
  - `360-1105-010-1106` (range across years)
- **The location is optional.** It is the text before the first `:`, as in `Romentino:` or `Suliman/Arico:`. Entries such as `039-1105 - Meet Lord Baltimore` have no location and are still accepted.
- **AAR links** like `[[…/ss6_aar_summary_31_32]]` are not shown as links. They are turned into a **session chip** ("Sessions 31–32"), and the AARs themselves are not published.
- **Other wiki links** (`[[Cafe_Dimitri]]`, `[[sector_solo_6|Sector Solo Six]]`) are shown as plain text, using the alias if there is one. Turning them into wiki links is a later step.
- **Header lines** (`Created:`, `Last modified:`, `Timeline of …`, `----`) are ignored.
- **A date-like line the script can't parse fails the build with a clear message.** A line is never silently dropped.

## 3. Generated data

`node scripts/build-calendar.mjs` reads the note and writes `site/data/calendar.json`:

```json
{
  "current": { "day": 212, "year": 1105, "abs": 403536 },
  "events": [
    {
      "id": "1105-023",
      "start": { "day": 23, "year": 1105, "abs": 403347 },
      "end":   { "day": 36, "year": 1105, "abs": 403360 },
      "location": "Mirassol",
      "title": "BIAS CCR spent 18 local days investigating archaeological site and recovering the…",
      "text": "BIAS CCR spent 18 local days investigating ...",
      "category": "party",
      "sessions": [1, 2, 3, 4, 5]
    }
  ]
}
```

The file has no build timestamp, so if nothing in the note changed, the output is identical and there is nothing to commit. `title` is the first sentence of the text, shortened if needed, for use in calendar cells. The date arithmetic lives in `site/js/calendar-math.js`, which both the build script and the site use.

The site only reads this file. The same file could later feed the BIAS CCR Bot, so it could answer questions like "when did we arrive at Csabai?"

## 4. Views

Every view can be bookmarked or shared through the URL hash, e.g. `#/1105/207`.

**Header ("ship's clock")**, always shown:
- the current date, e.g. `212-1105 · Sunday · Week 31 · Month 8`
- the next forecast event, e.g. "Next: Arrive Baltimore in 3 days"
- buttons to switch views, plus "Jump to today"

| View | URL | Purpose |
| --- | --- | --- |
| **Year** | `#/1105` | Big picture: 13 month grids plus the Holiday cell. Each day is shaded by how many events it has, and range events show as thin bars. The current day glows. Past days are dim; forecast days are outlined. Clicking a day opens it in Month view. |
| **Month** | `#/1105/m8` | 4 × 7 grid with event titles in their category colour and range events as bars across days. Month 1 also shows a **Holiday** banner. |
| **Day panel** | `#/1105/207` | Slides in beside Month or Year view: the full text, location, session chips and category for every event on that day, plus any range covering it. |
| **Chronicle** | `#/chronicle` | A vertical log of everything, newest or oldest first, grouped by month. It includes a "▶ TODAY" divider separating history from forecasts. |

**Available in every view:**
- category filter toggles
- a location filter (built from the locations in the data)
- text search
- keyboard shortcuts:
  - `Y` / `M` / `C` switch views
  - `←` / `→` move to the previous or next period
  - `T` jumps to today

The calendar opens on **Month view containing today**. The year selector covers every year that has events (so far 1104–1105).

## 5. Look & feel: "ship's computer"

- **Colours:** a near-black background with amber phosphor text as the main colour. Category colours are muted terminal tones, all readable against the dark background.
- **Text:** a monospaced font (e.g. *JetBrains Mono* or *IBM Plex Mono*), with uppercase labels and wide letter spacing for headers.
- **Effects:** subtle and switchable: faint scanlines, a soft glow on the current day, and a brief "boot" sweep on load.
- **Forecasts:** dashed outlines with a `PROJECTED` label.
- **Screen sizes:** designed for desktops and laptops. Year view shows all 13 months in a 5 × 3 grid at ≥1200 px. Below 700 px it falls back to one column, with Year view becoming a vertical list of months.
- **Search engines:** `noindex, nofollow`, matching the wiki.

## 6. Technology

- **Site:** plain HTML, CSS and JavaScript, with no framework and nothing to install. GitHub Pages serves the `site/` folder through a small Pages workflow, or `/docs` on `main`.
- **Build script:** a single Node script (Node 24 is already installed) with no dependencies, plus a small test file run against the real timeline.

```
imperial_calendar/
  docs/DESIGN.md
  scripts/build-calendar.mjs     # timeline.md → calendar.json
  scripts/build-calendar.test.mjs
  scripts/publish-calendar.bat   # build, commit and push if changed
  site/
    index.html
    css/calendar.css
    js/{calendar-math,views,app}.js
    data/calendar.json           # generated
```

## 7. Publishing with one button

The Obsidian **Shell Commands** plugin already runs `quartz-publish\run_sync.bat`. That file will get one more line:

```bat
call "C:\Users\sean\Documents\github\imperial_calendar\scripts\publish-calendar.bat"
```

`publish-calendar.bat` does three things:

1. builds `calendar.json` from the timeline;
2. if the result changed, commits it ("Calendar update to 212-1105") and pushes;
3. if the build fails, prints the reason and still lets the wiki sync finish.

GitHub Pages redeploys about a minute later.

**GM workflow after a session:**
1. Add entries to `ss6_timeline.md`.
2. Change `current_date`.
3. Press the existing publish button.

## 8. Build plan

| Phase | Work | Done when |
| --- | --- | --- |
| **0. Setup** | Run `git init`, create the GitHub repo, enable Pages, add a placeholder page and the noindex tag | The placeholder is live at the URL |
| **1. Parser** | Write `build-calendar.mjs` and tests against the real `ss6_timeline.md`, including its odd lines (no location, wrapped AAR links, ranges) | Every current entry parses; the JSON is checked by eye |
| **2. Core view** | Header, Month view, Day panel, URL routing, past/forecast styling, the ship's-computer theme | Month 8 of 1105 can be browsed correctly |
| **3. Zoom out** | Year view and Chronicle | All four views work and link together |
| **4. Finding things** | Category and location filters, search, keyboard shortcuts | Filters work in every view |
| **5. Publish** | `publish-calendar.bat` and the line added to `run_sync.bat` | The Obsidian button updates both sites |

**GM tasks** (the vault is read-only to Claude, so these are yours):
- Add `current_date` to the timeline's frontmatter.
- Tag the existing entries. I can provide a suggested list of tags per line.
- Add the events from 189 to 212, since the note currently ends at 188-1105.

## 9. Later

- **Hours:** `207-1105 1600` in entries and in `current_date`, plus an hourly day view.
- **Wiki links:** `[[sarik]]` → `bartlebythecoder.github.io/bias_ccr_bot/sarik`, and a Calendar link in the wiki's menu.
- **Bot:** the BIAS CCR Bot reads `calendar.json`.
- **AARs:** publish them and link them from session chips.
- **Recurring entries:** automatic recurring finance entries.

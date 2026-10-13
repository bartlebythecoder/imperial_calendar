# Imperial Calendar

An in-universe calendar for the **Sector Solo Six** Traveller campaign, at
<https://bartlebythecoder.github.io/imperial_calendar/>.

This repo is public, and so is everything in `site/`.

- `scripts/build-calendar.mjs` reads the GM's Obsidian timeline note and writes `site/data/calendar.json`.
- `site/` is the static site. GitHub Pages deploys it on every push to `main`.
- `docs/DESIGN.md` describes the design and build plan.

```
npm run check   # parse the timeline and report problems, writing nothing
npm run build   # regenerate site/data/calendar.json
npm test        # calendar maths and parser tests
```

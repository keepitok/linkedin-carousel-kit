---
name: linkedin-carousel-kit
description: Build a LinkedIn carousel (swipeable document post) — scaffold a post folder, design 1080×1080 HTML slides on a shared design-token stylesheet, render them to PNG with Playwright, and bundle a LinkedIn-ready PDF. Use whenever the user wants to create/design a LinkedIn carousel, slide deck, or multi-slide image post for LinkedIn (including app-mockup "I wish this existed" jokes).
---

# LinkedIn Carousel Kit

A LinkedIn "carousel" is a **document post**: a PDF whose pages LinkedIn renders as swipeable
slides. This skill designs the slides as HTML (one file per slide, shared `slide.css`), screenshots
each to a **1080×1080 PNG** via Playwright, then combines them into a PDF to upload.

A complete worked example lives in `example/weather/` — an app-mockup joke (copy a sunny day,
paste it over the whole week). Read its slides to see the patterns in context.

## Workflow

### 1. Scaffold a new post
Copy the toolkit from this skill's `assets/` into a new post folder:

```bash
POST="my-topic"                           # any slug
mkdir -p "$POST/slides" "$POST/png"
SK="$(dirname "$0")/assets"               # or the skill's assets/ path
cp "$SK"/{render.mjs,pdf.mjs,package.json} "$POST/"
cp "$SK"/{slide.css,dom-mover.js} "$POST/slides/"
cp "$SK/slide-template.html" "$POST/slides/01-cover.html"
( cd "$POST" && npm install )             # Playwright; Chromium cached after first install
```

### 2. Author the slides
Create `slides/01-*.html`, `02-*.html`, … Each links `slide.css` and ends with
`<script src="dom-mover.js"></script>`. Build from the components in
`references/components.md` — **read it before writing markup**. Two layouts:
- **Text slide** — `<div class="slide">` with `.head` / `.body` / `.foot`.
- **App-mockup slide** — `<div class="slide center">` wrapping a `.window`, with `.ctx-menu` /
  `.cursor` for interaction jokes.

Keep every slide the **same size**, update the `.counter` (`01 / 05`), and hold content inside the
108px safe zone.

### 3. Render → review → iterate
```bash
cd "$POST"
node render.mjs          # all slides → png/*.png   (node render.mjs 02  = just slide 02)
```
**Always open the PNGs to visually verify** (read the image files): line breaks, that menus/cursor
land on the right target, and nothing clips the edge. To place a menu or cursor, open the slide's
HTML in a browser — `dom-mover.js` lets you drag elements and read back `left/top`, which you bake
into the inline `style`. `render.mjs` blocks that script from the export, so its editing UI never
shows in the PNG.

### 4. Bundle the PDF
```bash
node pdf.mjs             # png/*.png → <post>-carousel.pdf, each page 1080×1080
```
Upload that PDF to LinkedIn via **Start a post → Document**. The script prints a confirmation with
the page count.

## What's in this skill
- `assets/slide.css` — design tokens + component library (source of truth for the look).
- `assets/render.mjs` — HTML → 1080² PNG (screenshots `.slide`; blocks `dom-mover.js`).
- `assets/pdf.mjs` — PNG → single square-page PDF, auto-named after the post folder.
- `assets/dom-mover.js` — in-browser drag tool for positioning absolute elements.
- `assets/slide-template.html`, `assets/package.json` — starters.
- `references/components.md` — token table, slide skeletons, every component with example markup,
  and size/positioning notes. **Read this when writing slides.**
- `example/weather/` — a runnable 3-slide carousel.

## Tips
- **Theme per topic:** change `--accent`/`--accent-strong`/`--accent-soft` (and optionally the font
  `@import`) in the post's `slide.css` copy for a fresh palette; everything else follows.
- **Per-post components** (custom UI, tiles, charts) go at the bottom of that post's `slide.css`
  copy — the weather-week tiles are a worked example to adapt.
- **Icons/logos:** prefer inline SVG (self-contained, crisp) as in the weather example; or drop
  image files in an `assets/` folder beside `slides/` and reference `../assets/...`.
- Fonts load from Google Fonts at render time, so keep network access when running `render.mjs`.

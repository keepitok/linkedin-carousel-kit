# Component & spec reference

All classes live in `assets/slide.css`. Slides are **1080×1080**; `render.mjs` screenshots the
`.slide` element. Keep meaningful content inside the `--safe` (108px) padding so LinkedIn's feed
crop never clips it.

## Design tokens (`:root` in slide.css)

| Token | Value | Use |
|---|---|---|
| `--ink` / `--text` / `--muted` | `#18181b` / `#3f3f46` / `#71717a` | headings / body / captions |
| `--accent` / `--accent-strong` / `--accent-soft` | `#4f46e5` / `#4338ca` / `#eef2ff` | primary accent — **swap the hue per topic** |
| `--success` / `--success-soft` | `#0d9488` / `#f0fdfa` | positive callouts, check bullets |
| `--pop` / `--pop-soft` | `#e11d48` / `#fff1f2` | pull-quote rule / emphasis |
| `--sun*` / `--rain*` | ambers / slate | warm/cool tile tints (weather example) |
| `--surface` / `--canvas` / `--border` | white / `#fbfbfd` / `#e4e4e7` | cards / page bg / hairlines |
| `--safe` | `108px` | LinkedIn ~10% safe zone |
| `--radius*`, `--shadow*` | — | corners & elevation |

Type scale: `h1` 74px · `h2` 56px · `.lede` 33px · `ul.facts li` 31px · `.chip` 26px · `.counter` 15px.
Font: **Inter** (loaded via Google Fonts `@import`; needs network at render time).

## Slide skeleton (text layout)

```html
<div class="slide">
  <div class="head"><div class="counter"><b>01</b> / 05</div></div>
  <div class="body"> …title, lists, cards, chips… </div>
  <div class="foot"><div class="src">Source · <b>Author</b></div></div>
</div>
```
`.body` is top-anchored (`padding-top:72px`) so every slide's title starts at the same height.

## Text components

- **`.eyebrow`** — uppercase accent kicker above a headline.
- **`h1` / `h2`** — headline (use `<br>` for deliberate line breaks; `.accent` to color a span).
- **`.lede`** — large intro paragraph; `<strong>` darkens to `--ink`.
- **`ul.facts`** — square accent bullets. **`ul.checks`** — green check bullets.
- **`.card`** (+`.card.idea` highlighted, `.grid2` two-up) — boxed statements.
- **`.chip`** (+`.chips`, `.chips.stack`) — pill labels, optional inline `<img>` logo + `.q` quote.
- **`.quote`** — `--pop` left-rule pull quote. **`.pill-note`** — success summary pill.
- **`.logostrip`** — centered tool logos with `.sep` dividers (cover slides).

## UI-mockup module (app-window jokes)

`.slide.center` centers a single `.window`:

```html
<div class="slide center">
  <div class="window">
    <div class="titlebar">
      <div class="dots"><span class="r"></span><span class="y"></span><span class="g"></span></div>
      <div class="win-title">App — Title</div>
    </div>
    <div class="win-body"> …UI… </div>
  </div>
</div>
```

- **`.window` / `.titlebar` / `.dots` / `.win-title`** — macOS-style chrome. `.win-body` is
  `position:relative`, the anchor for absolutely-positioned menus/cursor.
- **`.ctx-menu`** with **`.ctx-item`** (`.hi` = highlighted, `.disabled` = greyed), **`.ctx-sep`**,
  optional `.key` shortcut. Position with inline `style="left:…;top:…"` (px from `.win-body` top-left).
- **`.cursor`** — inline-SVG pointer; the arrow **tip is the top-left** of its 34px box, so set
  `left/top` to the point it should indicate.

### Positioning menus & cursor
Load `dom-mover.js` (already in the template) and open the HTML in a browser to **drag elements and
read back their coordinates**, then bake the final `left/top` into the inline `style`. `render.mjs`
blocks `dom-mover.js` so its editing UI never appears in the export.

## Per-post components
Add post-specific CSS at the bottom of that post's `slide.css` copy. The **weather example**
(`example/weather/`) ships the tiles `.week`, `.day.sun`, `.day.rain`, `.rain-pct`, `.selected` and
a `.forecast-h` header — copy and adapt them. Its weather icons are inline SVGs (sun, rain-cloud,
droplet) — no image assets.

## Rendering & PDF
- `node render.mjs` → `png/<slide>.png` (1080²). `node render.mjs 01 03` renders a subset by filename.
- `node pdf.mjs` → `<post>-carousel.pdf` (each page 1080×1080). Upload as a **document post**.
- Sizes: square **1080×1080** (this kit) is safe everywhere; portrait **1080×1350 (4:5)** claims more
  mobile space (would require editing the `SIZE`/viewport in the scripts and the `.slide` height).

/**
 * Render each slide HTML to a 1080×1080 PNG for the LinkedIn carousel.
 *
 * Usage:
 *   node render.mjs            # render every slide in ./slides
 *   node render.mjs 03 06      # render only matching slides (by filename prefix/substring)
 *
 * Requires Playwright (globally available: `npx playwright --version`).
 * Output: ./png/<slide-name>.png  (+ a combined ./png/carousel.pdf)
 */
import { chromium } from 'playwright';
import { readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDES_DIR = join(__dirname, 'slides');
const OUT_DIR = join(__dirname, 'png');
const SIZE = 1080;

const filters = process.argv.slice(2);

const files = (await readdir(SLIDES_DIR))
  .filter((f) => f.endsWith('.html'))
  .filter((f) => filters.length === 0 || filters.some((q) => f.includes(q)))
  .sort();

if (files.length === 0) {
  console.error('No matching .html slides found in', SLIDES_DIR);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1, // export at LinkedIn's 1080×1080 document-post size
});
// The slides load dom-mover.js (an interactive layout-editing tool) — block it
// so its editing UI never appears in the exported PNGs.
await page.route('**/dom-mover.js', (route) => route.abort());

for (const file of files) {
  const url = pathToFileURL(join(SLIDES_DIR, file)).href;
  await page.goto(url, { waitUntil: 'networkidle' });
  // make sure web fonts are painted before the screenshot
  await page.evaluate(() => document.fonts && document.fonts.ready);
  const el = await page.$('.slide');
  const out = join(OUT_DIR, basename(file, '.html') + '.png');
  await el.screenshot({ path: out });
  console.log('✓', basename(out));
}

await browser.close();
console.log(`\nDone — ${files.length} PNG(s) in ${OUT_DIR}`);

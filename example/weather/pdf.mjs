/**
 * Combine the rendered slide PNGs into a single LinkedIn-ready PDF.
 *
 * Usage:
 *   node render.mjs        # first render the PNGs
 *   node pdf.mjs           # then bundle png/*.png → <post>-carousel.pdf
 *
 * LinkedIn "carousels" are document posts: upload this PDF via the document
 * option. Each page is exactly 1080×1080 to match the square slides.
 */
import { chromium } from 'playwright';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PNG_DIR = join(__dirname, 'png');
// Name the PDF after the post folder. Works for either layout:
//   …/my-post/           → my-post-carousel.pdf
//   …/my-post/carousel/  → my-post-carousel.pdf (skips generic wrapper names)
const here = basename(__dirname);
const postName = /^(carousel|slides|dist|build)$/i.test(here) ? basename(dirname(__dirname)) : here;
const OUT_PDF = join(__dirname, `${postName}-carousel.pdf`);
const SIZE = 1080;

const pngs = (await readdir(PNG_DIR)).filter((f) => f.endsWith('.png')).sort();
if (pngs.length === 0) {
  console.error('No PNGs found in', PNG_DIR, '— run `node render.mjs` first.');
  process.exit(1);
}

// Inline each PNG as a data URI so the print page needs no file access.
const pages = await Promise.all(
  pngs.map(async (f) => {
    const b64 = (await readFile(join(PNG_DIR, f))).toString('base64');
    return `<div class="page"><img src="data:image/png;base64,${b64}"></div>`;
  }),
);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  @page{size:${SIZE}px ${SIZE}px;margin:0}
  html,body{width:${SIZE}px}
  .page{width:${SIZE}px;height:${SIZE}px;display:block;page-break-after:always}
  .page:last-child{page-break-after:auto}
  img{width:${SIZE}px;height:${SIZE}px;display:block}
</style></head><body>${pages.join('')}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.pdf({
  path: OUT_PDF,
  width: `${SIZE}px`,
  height: `${SIZE}px`,
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();

console.log(`✓ ${pngs.length} slides → ${OUT_PDF}`);

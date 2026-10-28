// Doc builder: renders the #cine overlay alone (index.html's styles and markup, no WebGL) with a
// title card, a lower-third and a narrator subtitle over a still, to check the lettering cheaply.
// Usage: node tools/doc-overlay.mjs [out.png] [bg.png]
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out = 'tools/out/doc-overlay.png', bg = ''] = process.argv.slice(2);
const html = fs.readFileSync('index.html', 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const cine = html.slice(html.indexOf('<div id="cine"'), html.indexOf('<script type="module"'));
const bgCss = bg ? `background: #10141c url(data:image/png;base64,${fs.readFileSync(bg).toString('base64')}) center / cover;` : 'background: radial-gradient(ellipse at 50% 70%, #6f8fa4, #1d2b3a 70%);';
const page = await (await chromium.launch()).newPage({ viewport: { width: 640, height: 360 } });
await page.setContent(`<!doctype html><html><head>${head}</head><body style="${bgCss}">${cine}</body></html>`, { waitUntil: 'networkidle' }).catch(() => {});
await page.evaluate(() => {
  const c = document.getElementById('cine');
  c.classList.add('lb');
  c.querySelector('.card .kicker').textContent = 'SEASON ONE · DAY 1 · 05:40';
  c.querySelector('.card .title').textContent = 'The Spiral Maelstrom';
  c.querySelector('.lower .place').textContent = '';
  c.querySelector('.lower .name').textContent = 'Skysong whale';
  c.querySelector('.lower .sci').textContent = 'Cetocaelum cantor · calf, 0 days';
  c.querySelector('.sub').textContent = 'Out. Four metres long, and it has never seen light.';
  for (const s of ['.card', '.lower', '.sub']) c.querySelector(s).classList.add('on');
});
await page.waitForTimeout(3500);
await page.screenshot({ path: out });
console.log('wrote', out);
process.exit(0);

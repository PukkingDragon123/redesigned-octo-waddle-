// Story builder screenshot: the page (canvas plus the cinematic overlay: letterbox, title cards).
// Usage: node tools/story-shot.mjs "<query>" <warp> out.png [frames]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [query = 'act=2', warp = '5', out = 'tools/out/story-shot.png', frames = '3'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?debug&${query}&auto&dt=0.05&warp=${warp}&frames=${frames}${process.env.EXTRA || ''}`, { waitUntil: 'load' });
await page.waitForFunction((n) => window.__skysongError || (window.__skysong && (window.__skysong.halted)), +frames, { timeout: 900000, polling: 500 }).catch(() => errs.push('timeout'));
await page.waitForTimeout(2500); // let the card's CSS fade finish
const st = await page.evaluate(() => { const s = window.__skysong.story; return { state: s.state, act: s.act, stage: s.life.stage, card: s.cine.cardText, cine: s.cine.active }; });
await page.screenshot({ path: out, timeout: 600000 });
console.log(query, warp, JSON.stringify(st), errs.slice(0, 4).join(' | '));
await browser.close();

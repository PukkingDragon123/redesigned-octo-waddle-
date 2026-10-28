// Story builder check: runs a life-cycle act (or chapter) headless with the autopilot and reports
// the life-cycle stage log, the cinematic state and errors. Usage:
//   node tools/story-acts.mjs <act 2|3|4 or chapter=N> <warp seconds> [shot.png]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [which = '2', warp = '60', shot = ''] = process.argv.slice(2);
const q = which.includes('=') ? which : `act=${which}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('script error')) errs.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 300)));
const t0 = Date.now();
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?debug&${q}&auto&dt=0.05&warp=${warp}&frames=1${process.env.EXTRA || ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skysongError || (window.__skysong && window.__skysong.halted), null, { timeout: 900000, polling: 500 }).catch(() => errs.push('timeout'));
const st = await page.evaluate(() => {
  const g = window.__skysong; if (!g || !g.story) return { err: window.__skysongError };
  const s = g.story, h = s.herd, L = s.life;
  return {
    t: Math.round(g.time), state: s.state, act: s.act, chapter: s.chapterIndex, stage: L.stage, log: L.stageLog,
    player: h.calf.name, py: Math.round(h.calf.pos.y), herdS: Math.round(h.s), cine: s.cine.active, card: s.cine.cardText && s.cine.cardText.title,
    mirrors: L.mirrors, calls: L.calls, tasks: s.script.tasks.map((t) => t.name), err: window.__skysongError,
  };
});
console.log(`${q} warp ${warp} (${Math.round((Date.now() - t0) / 1000)}s):`, JSON.stringify(st), errs.length ? '\n  ERRORS: ' + errs.slice(0, 6).join('\n  ') : '');
if (shot) await page.screenshot({ path: shot, timeout: 600000 }).catch((e) => console.log('screenshot failed', e.message.slice(0, 80)));
await browser.close();

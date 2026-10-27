// Runs a chapter with the real AudioSystem in headless Chromium (autoplay allowed) and reports audio health.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const chapter = process.argv[2] || '4';
const seconds = +(process.argv[3] || 40);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 240)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5173/'}?debug&chapter=${chapter}&auto&dt=0.05`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__skysongError || (window.__skysong && window.__skysong.story && window.__skysong.story.chapterIndex >= 0), null, { timeout: 600000, polling: 500 });
const started = await page.evaluate(async () => {
  const a = window.__skysong.story.audio;
  try { await a.start(); } catch (e) { return 'start failed: ' + e.message; }
  return { ready: a.ready, state: a.ctx && a.ctx.state };
});
console.log('start', JSON.stringify(started));
const samples = [];
for (let t = 0; t < seconds; t += 10) {
  await page.waitForTimeout(10000);
  samples.push(await page.evaluate(() => {
    const g = window.__skysong, a = g.story.audio;
    const k = a.getKey ? a.getKey() : null;
    return { gameT: g.time.toFixed(1), frame: g.frame, mood: k && k.mood, chord: k && k.chordName, intensity: k && +k.intensity.toFixed(2), stats: a.stats ? JSON.stringify(a.stats).slice(0, 300) : null, voices: g.story.voices.size, err: window.__skysongError || null, ctxT: a.ctx && a.ctx.currentTime.toFixed(1) };
  }));
}
for (const s of samples) console.log(JSON.stringify(s));
console.log('errors/warnings:', errs.slice(0, 12));
await browser.close();

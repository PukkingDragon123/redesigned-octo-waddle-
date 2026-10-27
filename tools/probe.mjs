// Like shot.mjs but logs everything and checks context state.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [query = '', out = 'tools/out/probe.png', waitFrames = '3', width = '480', height = '270'] = process.argv.slice(2);
const url = `http://127.0.0.1:5173/?${query}&frames=${waitFrames}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +width, height: +height } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text().slice(0, 600)}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction((n) => window.__skysongError || (window.__skysong && (window.__skysong.frame >= n || window.__skysong.halted)), +waitFrames, { timeout: 600000, polling: 500 }).catch((e) => console.log('timeout', e.message));
const expr = process.env.EVAL || 'null';
const st = await page.evaluate((expr) => {
  if (window.__skysongError) return { error: window.__skysongError };
  const g = window.__skysong; const gl = g.engine.renderer.getContext();
  let extra = null;
  try { extra = eval(expr); } catch (e) { extra = 'ERR ' + e.message; }
  return { lost: gl.isContextLost(), err: gl.getError(), frame: g.frame, extra };
}, expr);
console.log(JSON.stringify(st));
const durl = await page.evaluate(() => { try { return document.getElementById('c').toDataURL('image/png'); } catch (e) { return null; } });
if (durl && durl.length > 1000) {
  const fs = await import('fs');
  fs.writeFileSync(out, Buffer.from(durl.split(',')[1], 'base64'));
} else {
  await page.screenshot({ path: out, timeout: 600000 });
}
await browser.close();

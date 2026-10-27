// Audio verification for SKYSONG. Opens the dev bench (?debug&test=audio) in headless
// Chromium and renders every mood, the whale voices, the stingers, the ambience and each
// sfx through an OfflineAudioContext *inside the page*, using the real AudioSystem code
// path. Reports peak / RMS (dBFS) per render and flags clipping (> -1 dBFS), NaNs, silent
// output and exceptions. Also probes the live AudioContext: per-frame update() cost and
// the longest main-thread slice while the instrument bank is built.
//
// Usage: node tools/audio-check.mjs [--wav] [--only=flight,storm] [--seconds=18] [--skip-sfx]
//   --wav writes tools/out/audio-<name>.wav for spot checks.
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const arg = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1];
const WAV = args.includes('--wav');
const ONLY = (arg('only') || '').split(',').filter(Boolean);
const SECONDS = +arg('seconds') || 18;
const PORT = process.env.PORT || 5173;
const URL = `http://127.0.0.1:${PORT}/?debug&test=audio&autostart&norender&quality=low`;
fs.mkdirSync('tools/out', { recursive: true });

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
// Other agents edit the repo while this runs: mute Vite's HMR socket (it opens, but never
// delivers a reload) so the bench page is not reloaded mid-render.
if (page.routeWebSocket) await page.routeWebSocket(/.*/, () => {});
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.addInitScript(() => {
  window.__longtasks = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) { /* unsupported */ }
});

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__audioTest && window.__audio && window.__audio.ready, null, { timeout: 180000, polling: 100 });
const boot = await page.evaluate(() => {
  const a = window.__audio;
  return {
    ctxState: a.ctx.state,
    sampleRate: a.ctx.sampleRate,
    bankBuildMs: Math.round(a.stats.buildMs),
    bankWaitAfterStartMs: Math.round(a.stats.waitMs || 0),
    longestSliceMs: Math.round(a.stats.maxSliceMs * 10) / 10,
    slowestStep: `${a.stats.maxStepLabel} ${Math.round((a.stats.maxStepMs || 0) * 10) / 10} ms`,
    longTasksMs: window.__longtasks.map((t) => Math.round(t.dur)),
  };
});
console.log(`boot ${Date.now() - t0} ms`, JSON.stringify(boot));

const rows = [];
const fails = [];
function check(name, r) {
  const issues = [];
  if (r.errors && r.errors.length) issues.push(`errors: ${r.errors[0].slice(0, 200)}`);
  if (r.sysErrors) issues.push(`system errors: ${r.sysErrors} (${(r.lastError || '').slice(0, 160)})`);
  if (r.nan) issues.push(`${r.nan} NaN samples`);
  if (r.peakDb > -1) issues.push(`peak ${r.peakDb} dBFS > -1`);
  if (!(r.rmsDb > -60)) issues.push(`silent (rms ${r.rmsDb})`);
  rows.push({ name, peak: r.peakDb, rms: r.rmsDb, rms400: r.maxRms400Db, silent: Math.round(r.silentFrac * 100), render: r.renderMs, upd: r.avgUpdateMs, updMax: r.maxUpdateMs, ok: issues.length ? 'FAIL' : 'ok' });
  if (issues.length) fails.push(`${name}: ${issues.join('; ')}`);
}

async function run(name, expr, payload) {
  const r = await page.evaluate(expr, payload);
  if (r.wav) {
    fs.writeFileSync(`tools/out/audio-${name.replace(/[^a-z0-9.]+/gi, '-')}.wav`, Buffer.from(r.wav, 'base64'));
    delete r.wav;
  }
  check(name, r);
  const last = rows[rows.length - 1];
  console.log(`${name.padEnd(22)} peak ${String(last.peak).padStart(7)} dBFS  rms ${String(last.rms).padStart(7)}  rms400 ${String(last.rms400).padStart(7)}  silent ${String(last.silent).padStart(3)}%  ${last.ok}`);
  return r;
}

const moods = (await page.evaluate(() => window.__audioTest.moods)).filter((m) => m !== 'silence');
const wanted = (n) => !ONLY.length || ONLY.includes(n);

console.log('\n-- moods (intensity 0.2 -> 0.55 -> 0.95) --');
for (const m of moods) {
  if (!wanted(m)) continue;
  await run(`mood:${m}`, ([m, s, wav]) => window.__audioTest.renderMood(m, s, { wav }), [m, SECONDS, WAV]);
}

console.log('\n-- scenes --');
const scenes = { transitions: 34, voices: 24, song: 20, stingers: 20, ambience: 21, busy: 12 };
for (const [s, sec] of Object.entries(scenes)) {
  if (!wanted(s)) continue;
  await run(`scene:${s}`, ([s, sec, wav]) => window.__audioTest.renderScene(s, sec, { wav }), [s, sec, WAV]);
}

if (!args.includes('--skip-sfx')) {
  // each effect at the distance it is typically heard from (listener at 0,150,0 looking -z)
  const DIST = {
    boom: 30, boomSmall: 8, gulp: 9, sparkle: 10, bonk: 8, wingbeat: 9, whoosh: 10, thunder: 1200,
    lightningCrack: 150, falconScreech: 60, falconWing: 25, splash: 30, chime: 12,
  };
  console.log('\n-- sfx (gain 1 at typical distance) --');
  const names = await page.evaluate(() => window.__audioTest.sfxNames);
  for (const n of names) {
    if (!wanted(n) && !wanted('sfx')) continue;
    const d = DIST[n] ?? 20;
    const pos = { x: d * 0.3, y: 150 + d * 0.1, z: -d * 0.95 };
    await run(`sfx:${n}@${d}m`, ([n, wav, pos, sec]) => window.__audioTest.renderSfx(n, sec, { wav, position: pos }), [n, WAV, pos, n === 'thunder' ? 12 : 5]);
  }
  // loudest plausible calls: a close boom at the integration's gain, a close thunder
  await run('sfx:boom@8m g1.2', () => window.__audioTest.renderSfx('boom', 6, { gain: 1.2, position: { x: 0, y: 150, z: -8 } }), null);
  await run('sfx:thunder@100m', () => window.__audioTest.renderSfx('thunder', 8, { gain: 1, position: { x: 50, y: 200, z: -80 } }), null);
}

console.log('\n-- API safety (before start, bad arguments, concurrent start) --');
const safety = await page.evaluate(async () => {
  const { AudioSystem } = await import('/src/audio/AudioSystem.js');
  const errs = [];
  const tryit = (name, f) => {
    try { f(); } catch (e) { errs.push(`${name}: ${e.message}`); }
  };
  const a = new AudioSystem(window.__skysong);
  const v = a.createVoice();
  const battery = (tag) => {
    tryit(`${tag} ready`, () => a.ready);
    tryit(`${tag} update`, () => a.update(0.016));
    tryit(`${tag} update NaN`, () => a.update(NaN));
    tryit(`${tag} setVolumes`, () => a.setVolumes(0.7, 'x'));
    tryit(`${tag} setMood`, () => a.setMood('flight'));
    tryit(`${tag} setMood bad`, () => a.setMood('nope', null));
    tryit(`${tag} setMood none`, () => a.setMood());
    tryit(`${tag} setIntensity`, () => a.setIntensity('abc'));
    tryit(`${tag} stinger`, () => a.stinger('discover'));
    tryit(`${tag} stinger bad`, () => a.stinger(undefined));
    tryit(`${tag} getKey`, () => {
      const k = a.getKey();
      if (!k || k.scale.length !== 7 || !Number.isFinite(k.beat) || !Number.isFinite(k.nextBeatTime) || !k.chord.length) throw new Error('bad key ' + JSON.stringify(k));
    });
    tryit(`${tag} createVoice weird`, () => a.createVoice({ base: 'x', formant: null }).hum(NaN));
    tryit(`${tag} voice.setPosition`, () => v.setPosition(null));
    tryit(`${tag} voice.setPosition NaN`, () => v.setPosition({ x: NaN, y: 1, z: 2 }));
    tryit(`${tag} voice.hum`, () => v.hum(60, undefined, { glideFrom: 'x', gain: -3, vibrato: 1e9 }));
    tryit(`${tag} voice.hum NaN`, () => v.hum(NaN, NaN, null));
    tryit(`${tag} voice.release`, () => v.release(-1));
    tryit(`${tag} voice.call`, () => v.call('chirp'));
    tryit(`${tag} voice.call bad`, () => v.call({}));
    tryit(`${tag} voice.setChargeLevel`, () => v.setChargeLevel(0.5));
    tryit(`${tag} voice.setChargeLevel NaN`, () => v.setChargeLevel(NaN));
    tryit(`${tag} sfx`, () => a.sfx('boom', { position: { x: 1, y: 2, z: 3 }, gain: 'loud', pitch: 0 }));
    tryit(`${tag} sfx bad`, () => a.sfx('nope'));
    tryit(`${tag} sfx null opts`, () => a.sfx('thunder', null));
    tryit(`${tag} sfx NaN pos`, () => a.sfx('splash', { position: { x: NaN, y: 0, z: 0 } }));
    tryit(`${tag} setAmbience`, () => a.setAmbience({ wind: 2, speed: -5, waterfall: { pos: null } }));
    tryit(`${tag} setAmbience null`, () => a.setAmbience(null));
    tryit(`${tag} duck`, () => a.duck('a', 'b'));
  };
  battery('before');
  const [r1, r2] = await Promise.all([a.start(), a.start()]);
  battery('after');
  for (const n of AudioSystem.sfxNames) tryit(`sfx ${n}`, () => a.sfx(n, { position: { x: 3, y: 150, z: -10 } }));
  for (const s of AudioSystem.stingers) tryit(`stinger ${s}`, () => a.stinger(s));
  for (const m of AudioSystem.moods) tryit(`mood ${m}`, () => { a.setMood(m, { fade: 0 }); a.update(0.016); });
  for (const k of ['chirp', 'coo', 'answer', 'warn', 'yawn', 'play', 'roar']) tryit(`call ${k}`, () => v.call(k));
  for (let i = 0; i < 30; i++) tryit('update loop', () => a.update(1 / 60));
  const res = { errs, start: [r1, r2], ready: a.ready, caught: a.stats.errors, lastError: a.lastError ? String(a.lastError) : null };
  a.dispose();
  return res;
});
console.log(JSON.stringify(safety));
if (safety.errs.length) fails.push(`API threw: ${safety.errs.slice(0, 3).join(' | ')}`);
if (!safety.ready) fails.push('second AudioSystem never became ready');
if (safety.caught) fails.push(`API caught ${safety.caught} internal errors: ${safety.lastError}`);

console.log('\n-- master chain & live context --');
const gain = await page.evaluate(() => window.__audioTest.chainGain(-30));
console.log(`master chain static gain at -30 dBFS: ${gain} dB`);
const perf = await page.evaluate(() => window.__audioTest.perf(6));
console.log('live perf', JSON.stringify(perf));
if (perf.maxMs > 4) fails.push(`live update() max ${perf.maxMs} ms`);
if (perf.avgMs > 1) fails.push(`live update() avg ${perf.avgMs} ms`);
if (perf.errors) fails.push(`live errors ${perf.errors}: ${perf.lastError}`);
if (boot.longestSliceMs > 40) fails.push(`bank build slice ${boot.longestSliceMs} ms > 40`);

const summary = { boot, chainGainDb: gain, perf, rows, fails, logs: logs.slice(0, 30) };
fs.writeFileSync('tools/out/audio-check.json', JSON.stringify(summary, null, 2));
console.log(`\n${fails.length ? 'FAILURES' : 'ALL OK'} (${rows.length} renders)`);
for (const f of fails) console.log('  - ' + f);
if (logs.length) {
  console.log('\nconsole:');
  for (const l of logs.slice(0, 20)) console.log('  ' + l);
}
await browser.close();
process.exit(fails.length ? 1 : 0);

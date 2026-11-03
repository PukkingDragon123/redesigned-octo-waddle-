// Recorded sounds (CC0 / public domain, credited in CREDITS.md): ambience beds, one-shot
// effects and humpback song units, in public/audio/{amb,sfx}/ as Ogg Vorbis. They are fetched
// and decoded after the first user gesture (AudioSystem._init), a few at a time and never
// blocking: beds first, then effects, then voices. Every user falls back to the synthesis while
// a group is missing (still loading, a failed fetch, or a browser that cannot decode Vorbis).
//
//   lib.has('splashBig')            -> true once at least one take decoded
//   lib.pick('splashBig', rng)      -> a random take (never the same one twice in a row)
//   lib.info('w_moan1')             -> { buffer, f0 } (f0: the unit's fundamental in Hz)
//
// AudioBuffers are context-independent, so decoded takes are shared by every AudioSystem
// (the dev bench's offline renders included).

const A = (n) => `audio/amb/${n}.ogg`;
const S = (n) => `audio/sfx/${n}.ogg`;
const range = (pre, n) => Array.from({ length: n }, (_, i) => `${pre}${i + 1}`);

/** Group name -> file names (without extension). Order = load priority. */
export const GROUPS = {
  // beds (seamless loops)
  seaCalm: [A('sea_calm')],
  seaRough: [A('sea_rough')],
  wind: [A('wind')],
  gale: [A('gale')],
  storm: [A('storm')],
  rain: [A('rain')],
  under: [A('under')],
  swarm: [A('swarm')],
  // one-shots
  splashSmall: range('splash_s', 3).map(S),
  splashBig: range('splash_b', 3).map(S),
  thunderNear: ['thunder1', 'thunder2'].map(S),
  thunderFar: ['thunder3', 'thunder4'].map(S),
  whoosh: range('whoosh', 4).map(S),
  thump: range('thump', 3).map(S),
  blastNear: [S('blast_near')],
  blastFar: [S('blast_far')],
  wing: range('wing', 3).map(S),
  bubbles: range('bubbles', 3).map(S),
  crunch: range('crunch', 3).map(S),
  glug: range('glug', 2).map(S),
  breath: range('breath', 4).map(S),
  gull: range('gull', 5).map(S),
  // humpback song units (NOAA): calls, the hum's sustain loop, and the distant song bed
  wChirp: ['w_chirp1', 'w_chirp2'].map(S),
  wCoo: ['w_coo1', 'w_coo2', 'w_coo3'].map(S),
  wMoan: ['w_moan1', 'w_moan3', 'w_moan4', 'w_moan5'].map(S),
  wLong: [S('w_moan2')],
  wGrunt: [S('w_grunt')],
  wHum: [S('w_hum')],
  whaleSong: [A('whalesong')],
};

/** Measured fundamentals (Hz) of the humpback units, so calls can be retuned to the score. */
export const F0 = {
  w_chirp1: 193, w_chirp2: 145, w_coo1: 213, w_coo2: 290, w_coo3: 328, w_grunt: 149,
  w_moan1: 141, w_moan2: 159, w_moan3: 149, w_moan4: 280, w_moan5: 244, w_hum: 149,
};

const decoded = new Map(); // url -> Promise<AudioBuffer|null>
const CONCURRENCY = 4;

function fetchDecode(ctx, url) {
  let p = decoded.get(url);
  if (p) return p;
  p = (async () => {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (type.includes('text/html')) return null; // a dev server's fallback page
      const data = await res.arrayBuffer();
      if (data.byteLength < 256) return null;
      return await new Promise((resolve) => {
        try {
          const r = ctx.decodeAudioData(data, resolve, () => resolve(null));
          if (r && r.then) r.then(resolve, () => resolve(null));
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      return null;
    }
  })();
  decoded.set(url, p);
  return p;
}

export class SampleLib {
  constructor(sys) {
    this.sys = sys;
    this.g = {}; // group -> [{ buffer, name, f0 }]
    this.last = {};
    this.loading = null;
    this.stats = { files: 0, failed: 0, ms: 0 };
  }

  has(group) {
    const a = this.g[group];
    return !!(a && a.length);
  }

  /** A random take of `group` (avoiding an immediate repeat), or null. */
  pick(group, rng = Math.random) {
    const a = this.g[group];
    if (!a || !a.length) return null;
    if (a.length === 1) return a[0];
    let i = Math.floor(rng() * a.length) % a.length;
    if (i === this.last[group]) i = (i + 1 + Math.floor(rng() * (a.length - 1))) % a.length;
    this.last[group] = i;
    return a[i];
  }

  /** Fetch and decode every group (resolves when all have settled; never rejects). */
  load() {
    if (this.loading) return this.loading;
    const ctx = this.sys.ctx;
    if (!ctx || typeof fetch === 'undefined') return (this.loading = Promise.resolve(false));
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const jobs = [];
    for (const [group, urls] of Object.entries(GROUPS)) for (const url of urls) jobs.push({ group, url });
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const { group, url } = jobs[next++];
        const buffer = await fetchDecode(ctx, url);
        if (!buffer) {
          this.stats.failed++;
          continue;
        }
        const name = url.slice(url.lastIndexOf('/') + 1, url.lastIndexOf('.'));
        (this.g[group] || (this.g[group] = [])).push({ buffer, name, f0: F0[name] || 0 });
        this.stats.files++;
      }
    };
    this.loading = Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
      if (t0) this.stats.ms = Math.round(performance.now() - t0);
      return this.stats.files > 0;
    }).catch(() => false);
    return this.loading;
  }
}

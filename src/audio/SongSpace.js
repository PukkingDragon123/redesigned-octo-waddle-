// The song space: one long, dark, slowly drifting hall shared by every whale voice, so a sung
// note rings on like a call across open water or under a sky-high vault. Cheap by design: two
// allpass smears into four long feedback delay lines (lowpassed every pass, so the tail darkens
// as it dies), panned in pairs, their lengths gently modulated for a chorus shimmer.
// Voices send to it from their own air filter (src/audio/WhaleVoice.js, more for bigger
// whales and more from far away). It returns through the voices bus, so the sound volume,
// the cloud and underwater muffling all apply to it.

const LINES = [
  { t: 0.317, pan: 0 },
  { t: 0.449, pan: 1 },
  { t: 0.613, pan: 0 },
  { t: 0.797, pan: 1 },
];
const T60 = 7.5; // seconds for the tail to fall 60 dB

/** The shared song space of an AudioSystem (built on first use). Returns { input }. */
export function songSpace(sys) {
  if (sys._songSpace) return sys._songSpace;
  const ctx = sys.ctx;
  const G = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const F = (type, f, q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const input = G(1);
  const hp = F('highpass', 150, 0.6);
  const lp = F('lowpass', 3600, 0.6);
  const ap1 = F('allpass', 420, 0.8);
  const ap2 = F('allpass', 1300, 0.9);
  const pre = ctx.createDelay(0.2);
  pre.delayTime.value = 0.05;
  input.connect(hp); hp.connect(lp); lp.connect(ap1); ap1.connect(ap2); ap2.connect(pre);
  const merge = ctx.createChannelMerger(2);
  const out = G(0.42);
  merge.connect(out);
  out.connect(sys.bus.voices);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoA = G(0.0024);
  const lfoB = G(-0.0017);
  lfo.connect(lfoA);
  lfo.connect(lfoB);
  const nodes = [input, hp, lp, ap1, ap2, pre, merge, out, lfo, lfoA, lfoB];
  LINES.forEach((L, i) => {
    const d = ctx.createDelay(2);
    d.delayTime.value = L.t;
    const damp = F('lowpass', 2300 - i * 260, 0.5);
    const fb = G(Math.pow(10, (-3 * L.t) / T60) * 0.97);
    pre.connect(d);
    d.connect(damp);
    damp.connect(fb);
    fb.connect(d);
    damp.connect(merge, 0, L.pan);
    (i % 2 ? lfoB : lfoA).connect(d.delayTime);
    nodes.push(d, damp, fb);
  });
  lfo.start();
  sys._songSpace = { input, out, nodes };
  return sys._songSpace;
}

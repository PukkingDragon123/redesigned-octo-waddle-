// Individual whale genomes of Vur Sok. Each adult has its own silhouette, horns, markings, scars
// and voice, so the herd reads as a family of individuals rather than copies.
//
// Variant fields (docs/VUR_SOK.md 4.3): scars 0..1, barnacles 0..1, tornWing 'L' | 'R' | null,
// notchedFluke 'L' | 'R' | null, alpha. Horns: { style: swept | straight | curl | forward | gnarled |
// elegant | nub, snap: 'L' | 'R' | null } plus any shape overrides (len, baseR, rings, ...).
// Skin: back / belly_c (countershading), mark2 (pale flank bars, scars), bars 0..1, streaks 0..1
// (pale streak network), mottle 0..1, eyePatch { size, len, angle, dark }, algae 0..1.
// Organs: hornBase / hornTip, plate, crestIn, membrane / finTip, finMark + finMarkAmt (pale flippers).

export const CALF = {
  name: 'calf', calf: true, length: 4.2, seed: 7,
  back: '#3e5a7e', belly_c: '#f4eee4', mark: '#5a7698', mark2: '#faf6ee',
  pattern: { spots: 0.4 }, bars: 0.35, streaks: 0.15, mottle: 0.35,
  eyePatch: { size: 0.9, len: 0.8, angle: 0.1, dark: 0.45 },
  scars: 0.0, barnacles: 0.0, tornWing: null, notchedFluke: null,
  horns: { style: 'nub' }, hornBase: '#7a8696', hornTip: '#ece2d0',
  plate: '#5f7fa0', crestIn: '#e48e9a', crestScale: 1.0,
  arm: '#3e5a7e', membrane: '#587494', finTip: '#97a8bc', ray: '#4e6a8c', finMark: '#f2ede4', finMarkAmt: 0.2,
  iris: '#e8aa3a', iris2: '#4a2508', lid: '#3e5a7e', sclera: '#cfc6b8',
  frond: '#ff9d98', frondTip: '#ffd6c6', gill: '#ff8f8a', mouth: '#a45666',
  furShade: 0.84, furTip: 1.16, furScale: 1.0, girth: 1.0, finScale: 1.0, frondScale: 1.0,
  skinRes: 1536,
  voice: { base: 72, formant: 1.35, breath: 0.25 },
};

export const MOTHER = {
  name: 'mother', length: 22, seed: 21,
  back: '#233c58', belly_c: '#f0e8d8', mark: '#3c5c7c', mark2: '#f6f2e8',
  pattern: { stripes: 0.55, crescent: 0.0, blaze: 0.35 }, bars: 1.0, streaks: 0.45, mottle: 0.4,
  eyePatch: { size: 1.1, len: 1.3, angle: 0.2, dark: 0.7 },
  scars: 0.25, barnacles: 0.25, tornWing: null, notchedFluke: null,
  horns: { style: 'elegant' }, hornBase: '#3a2e26', hornTip: '#efe2c6',
  plate: '#2a4152', crestIn: '#cc5262',
  arm: '#233c58', membrane: '#3e5670', finTip: '#7a8e9e', ray: '#23405a', finMark: '#ece6da', finMarkAmt: 0.5,
  iris: '#e6a834', iris2: '#4a2408', lid: '#22445a', sclera: '#cbbfae',
  frond: '#d97690', frondTip: '#f2b3c0', gill: '#e07a86', mouth: '#8c4458',
  furShade: 0.74, furTip: 1.14, girth: 1.02, finScale: 1.05,
  skinRes: 1536,
  voice: { base: 50, formant: 1.0, breath: 0.2 },
};

export const ELDER = {
  name: 'elder', length: 34, seed: 99,
  back: '#5e6668', belly_c: '#e6dccb', mark: '#7a8282', mark2: '#f0ece2',
  pattern: { stripes: 0.35, blaze: 0.2 }, bars: 0.45, streaks: 0.7, mottle: 0.75, algae: 0.6,
  eyePatch: { size: 1.0, len: 1.0, angle: 0.25, dark: 0.55 },
  scars: 0.85, barnacles: 1.0, wornTubercles: true, tornWing: null, notchedFluke: null,
  horns: { style: 'gnarled' }, hornBase: '#3b2f24', hornTip: '#e2d4b4', hornScale: 1.08,
  plate: '#4a5050', crestIn: '#b85a64', plateThick: 1.25,
  arm: '#5e6668', membrane: '#6a7270', finTip: '#969a94', ray: '#4c5250', finMark: '#eee8dc', finMarkAmt: 0.35,
  iris: '#d0a04a', iris2: '#3a2410', lid: '#565e60', sclera: '#c8bca8',
  frond: '#b86d82', frondTip: '#e0a8b6', gill: '#c26a7a', mouth: '#7a3e4e',
  furShade: 0.7, furTip: 1.1, girth: 1.08, finScale: 1.1, furScale: 1.25,
  skinRes: 1536,
  voice: { base: 38, formant: 0.85, breath: 0.25 },
};

// The adults of the herd. ADULTS[0] is the alpha: the largest male, his left wing torn with
// ragged holes and a split, a notched fluke, heavy rake scars, darker, one horn tip snapped off.
export const ADULTS = [
  {
    name: 'alpha', length: 28, seed: 31, alpha: true,
    back: '#18202c', belly_c: '#d8d0c2', mark: '#2d3a4c', mark2: '#ece6dc',
    pattern: { stripes: 0.7 }, bars: 0.75, streaks: 0.35, mottle: 0.55,
    eyePatch: { size: 1.25, len: 1.5, angle: 0.05, dark: 0.85 },
    scars: 1.0, barnacles: 0.45, tornWing: 'L', notchedFluke: 'R',
    horns: { style: 'swept', snap: 'R', len: 0.31, baseR: 0.026 }, hornBase: '#1e1a17', hornTip: '#dccdb0',
    plate: '#1e2733', crestIn: '#c63e4e', plateThick: 1.15, crestScale: 1.1,
    arm: '#18202c', membrane: '#383e50', finTip: '#5c5a6c', ray: '#151c26', finMark: '#dcd6cc', finMarkAmt: 0.12,
    iris: '#f2b232', iris2: '#4c2206', lid: '#18202c', sclera: '#c4b8a6',
    frond: '#e48b7e', frondTip: '#f7c2a8',
    girth: 1.06, finScale: 1.04, skinRes: 1024,
    voice: { base: 44, formant: 0.92, breath: 0.22 },
  },
  {
    name: 'dusk', length: 24, seed: 41,
    back: '#33395a', belly_c: '#ece6e2', mark: '#4e5478', mark2: '#f2eeea',
    pattern: { stripes: 0.4, blaze: 0.5 }, bars: 0.6, streaks: 0.55, mottle: 0.3,
    eyePatch: { size: 0.9, len: 1.8, angle: 0.3, dark: 0.75 },
    scars: 0.35, barnacles: 0.2,
    horns: { style: 'straight' }, hornBase: '#2a2428', hornTip: '#dccfc0',
    plate: '#30354f', crestIn: '#cc5672',
    arm: '#33395a', membrane: '#4c5272', finTip: '#7e8298', ray: '#2c3150', finMark: '#ece4ee', finMarkAmt: 0.3,
    iris: '#e0a642', iris2: '#3a2010', lid: '#33395a',
    frond: '#e6879e', frondTip: '#f6c0cc',
    girth: 1.05, finScale: 1.08,
    voice: { base: 47, formant: 0.95, breath: 0.2 },
  },
  {
    name: 'sand', length: 19, seed: 53,
    back: '#5c5246', belly_c: '#f2e8d6', mark: '#7a6e5e', mark2: '#f6efe2',
    pattern: { spots: 0.35, stripes: 0.3 }, bars: 0.3, streaks: 0.25, mottle: 0.9,
    eyePatch: { size: 0.8, len: 0.7, angle: 0.0, dark: 0.5 },
    scars: 0.3, barnacles: 0.35,
    horns: { style: 'curl' }, hornBase: '#30271e', hornTip: '#e0d2b4',
    plate: '#4e463c', crestIn: '#c85e58',
    arm: '#5c5246', membrane: '#706656', finTip: '#9a8e7c', ray: '#4c4438', finMark: '#f2e8d6', finMarkAmt: 0.55,
    iris: '#c8942e', iris2: '#3a2410', lid: '#5c5246',
    frond: '#f09a86', frondTip: '#fcd0b8',
    girth: 0.98, finScale: 0.95,
    voice: { base: 58, formant: 1.1, breath: 0.22 },
  },
  {
    name: 'storm', length: 26, seed: 67,
    back: '#183456', belly_c: '#e4e4de', mark: '#2e5076', mark2: '#eef0f2',
    pattern: { stripes: 0.6 }, bars: 0.9, streaks: 0.6, mottle: 0.35,
    eyePatch: { size: 1.1, len: 1.1, angle: -0.15, dark: 0.8 },
    scars: 0.55, barnacles: 0.3,
    horns: { style: 'forward' }, hornBase: '#1f1d1d', hornTip: '#d0c6b6',
    plate: '#1a3050', crestIn: '#c04a5e',
    arm: '#183456', membrane: '#3a5676', finTip: '#6e8ca8', ray: '#16304e', finMark: '#e2e8ee', finMarkAmt: 0.2,
    iris: '#d89a34', iris2: '#2a1808', lid: '#183252',
    frond: '#c87a94', frondTip: '#eab0c2',
    girth: 1.1, finScale: 1.1,
    voice: { base: 43, formant: 0.9, breath: 0.22 },
  },
  {
    name: 'fern', length: 21, seed: 79,
    back: '#2a4648', belly_c: '#ecebde', mark: '#466464', mark2: '#f2f2e8',
    pattern: { spots: 0.4, blaze: 0.4 }, bars: 0.5, streaks: 0.3, mottle: 0.6, algae: 0.25,
    eyePatch: { size: 1.0, len: 0.9, angle: 0.4, dark: 0.6 },
    scars: 0.25, barnacles: 0.4,
    horns: { style: 'swept', len: 0.23, rings: 20 }, hornBase: '#2a2a22', hornTip: '#d8d0b4',
    plate: '#283f40', crestIn: '#c6605e',
    arm: '#2a4648', membrane: '#40605e', finTip: '#7a9290', ray: '#243e40', finMark: '#e8ecdc', finMarkAmt: 0.4,
    iris: '#d4a03a', iris2: '#2c2410', lid: '#2a4648',
    frond: '#e89a7e', frondTip: '#f8cfae',
    girth: 1.0, finScale: 1.02,
    voice: { base: 52, formant: 1.0, breath: 0.2 },
  },
  {
    name: 'ash', length: 23, seed: 89,
    back: '#4e5a6a', belly_c: '#f0ece4', mark: '#6a7888', mark2: '#f4f2ec',
    pattern: { stripes: 0.5 }, bars: 0.7, streaks: 0.8, mottle: 0.25,
    eyePatch: { size: 1.3, len: 1.2, angle: 0.1, dark: 0.9 },
    scars: 0.45, barnacles: 0.25,
    horns: { style: 'curl', curl: 2.6, len: 0.25 }, hornBase: '#26221e', hornTip: '#e2dccc',
    plate: '#465262', crestIn: '#ca5666',
    arm: '#4e5a6a', membrane: '#6c7888', finTip: '#9ca6b4', ray: '#465262', finMark: '#eeeae6', finMarkAmt: 0.25,
    iris: '#cf8c32', iris2: '#2a1810', lid: '#4a5666',
    frond: '#d48896', frondTip: '#efbcc6',
    girth: 1.0, finScale: 1.0,
    voice: { base: 49, formant: 0.97, breath: 0.2 },
  },
];

// Other calves in the herd (playmates).
export const CALVES = [
  {
    name: 'pip', calf: true, length: 3.9, seed: 103,
    back: '#6c5e98', belly_c: '#f6eef4', mark: '#a294c6', mark2: '#faf4f8',
    pattern: { spots: 0.6 }, bars: 0.5, streaks: 0.1, mottle: 0.5,
    eyePatch: { size: 0.8, len: 1.1, angle: 0.25, dark: 0.5 },
    scars: 0.05, barnacles: 0, horns: { style: 'nub' }, hornBase: '#8a7ea0', hornTip: '#eee2e6',
    plate: '#7c6ea4', crestIn: '#ee8eaa',
    arm: '#6c5e98', membrane: '#a296c4', finTip: '#cac0de', ray: '#7a6ca2', finMark: '#f6eff6', finMarkAmt: 0.3,
    iris: '#d89a3a', iris2: '#4a2a10', lid: '#8072a8', mouth: '#a45666',
    frond: '#ff9fb6', frondTip: '#ffd6e2',
    furShade: 0.8, furTip: 1.16, skinRes: 768,
    voice: { base: 76, formant: 1.4, breath: 0.25 },
  },
  {
    name: 'moss', calf: true, length: 4.4, seed: 113,
    back: '#527e6c', belly_c: '#f4f4e6', mark: '#8cb4a2', mark2: '#f8f8ee',
    pattern: { spots: 0.7 }, bars: 0.2, streaks: 0.15, mottle: 0.75,
    eyePatch: { size: 1.0, len: 0.8, angle: 0.0, dark: 0.55 },
    scars: 0.05, barnacles: 0, horns: { style: 'nub' }, hornBase: '#748a7e', hornTip: '#e8e8d6',
    plate: '#628c7a', crestIn: '#e2887a',
    arm: '#527e6c', membrane: '#90b2a2', finTip: '#bcd0c2', ray: '#5e8876', finMark: '#f2f4e8', finMarkAmt: 0.45,
    iris: '#c89434', iris2: '#3a2410', lid: '#668e7e', mouth: '#a45666',
    frond: '#ffa98e', frondTip: '#ffdcc4',
    furShade: 0.8, furTip: 1.16, skinRes: 768,
    voice: { base: 69, formant: 1.3, breath: 0.25 },
  },
  {
    name: 'ember', calf: true, length: 4.0, seed: 127,
    back: '#98604a', belly_c: '#faeee0', mark: '#c8947c', mark2: '#fcf4ea',
    pattern: { spots: 0.65 }, bars: 0.4, streaks: 0.1, mottle: 0.55,
    eyePatch: { size: 0.9, len: 0.9, angle: 0.15, dark: 0.45 },
    scars: 0.1, barnacles: 0, horns: { style: 'nub' }, hornBase: '#9a7464', hornTip: '#f2e2d2',
    plate: '#a46e58', crestIn: '#ea8274',
    arm: '#98604a', membrane: '#c8988a', finTip: '#e0bcaa', ray: '#a06a56', finMark: '#f8eee4', finMarkAmt: 0.3,
    iris: '#dc9c38', iris2: '#4c2a0e', lid: '#a8725c', mouth: '#a45666',
    frond: '#ff9a88', frondTip: '#ffd2c0',
    furShade: 0.8, furTip: 1.16, skinRes: 768,
    voice: { base: 74, formant: 1.38, breath: 0.25 },
  },
];

// ---- the life cycle (src/game/life) ---------------------------------------------------------
// The player's whale grows up between the acts. Each stage keeps the calf's own colouring (the
// deep blue back, the pale spotting, the soft eye patch) so it is recognisably the same whale.

/** Act II and III: the calf grown into a young adult; its horns have come in, sleek and swept. */
export const YOUNG = {
  name: 'young', length: 15, seed: 7,
  back: '#36557f', belly_c: '#f4ece0', mark: '#55769f', mark2: '#faf5ec',
  pattern: { spots: 0.3, stripes: 0.3 }, bars: 0.65, streaks: 0.3, mottle: 0.35,
  eyePatch: { size: 0.95, len: 1.0, angle: 0.1, dark: 0.55 },
  scars: 0.08, barnacles: 0.05, tornWing: null, notchedFluke: null,
  horns: { style: 'swept', len: 0.22 }, hornBase: '#2e2a2a', hornTip: '#efe4cc',
  plate: '#3b5878', crestIn: '#de7486', crestScale: 1.05,
  arm: '#36557f', membrane: '#5d7aa2', finTip: '#a8b8d0', ray: '#335276', finMark: '#f6f1ea', finMarkAmt: 0.35,
  iris: '#e8aa3a', iris2: '#4a2508', lid: '#36557f', sclera: '#cfc6b8',
  frond: '#f39a9c', frondTip: '#ffd2c6', gill: '#f08a8c', mouth: '#9a5064',
  furShade: 0.8, furTip: 1.16, furScale: 1.1, girth: 0.98, finScale: 1.04,
  skinRes: 1024,
  voice: { base: 57, formant: 1.12, breath: 0.22 },
};

/** Act II: the mate who answers at golden hour (warm sand and rose, elegant curled horns). */
export const MATE = {
  name: 'mate', length: 14, seed: 141,
  back: '#7a4e5e', belly_c: '#f8ece6', mark: '#a8707e', mark2: '#fcf2ee',
  pattern: { spots: 0.5, blaze: 0.4 }, bars: 0.55, streaks: 0.25, mottle: 0.4,
  eyePatch: { size: 0.9, len: 1.5, angle: 0.3, dark: 0.6 },
  scars: 0.05, barnacles: 0.05, tornWing: null, notchedFluke: null,
  horns: { style: 'elegant', len: 0.2 }, hornBase: '#3a2a2a', hornTip: '#f6e8d4',
  plate: '#6a4452', crestIn: '#f07a96', crestScale: 1.1,
  arm: '#7a4e5e', membrane: '#b07c8a', finTip: '#e2bcc4', ray: '#6c4452', finMark: '#fbf1ee', finMarkAmt: 0.5,
  iris: '#f0b440', iris2: '#4a2508', lid: '#7a4e5e', sclera: '#d4c8b8',
  frond: '#ffa0b4', frondTip: '#ffd8e0', gill: '#f48ca0', mouth: '#a45666',
  furShade: 0.82, furTip: 1.2, furScale: 1.1, girth: 0.96, finScale: 1.06,
  skinRes: 1024,
  voice: { base: 62, formant: 1.2, breath: 0.24 },
};

/** Act III: the newborn, smaller and softer than the calf you were (a blend of both parents). */
export const NEWBORN = {
  name: 'newborn', calf: true, length: 3.2, seed: 151,
  back: '#5a5f8e', belly_c: '#fbf3ee', mark: '#8a88b6', mark2: '#fdf8f4',
  pattern: { spots: 0.55 }, bars: 0.25, streaks: 0.05, mottle: 0.3,
  eyePatch: { size: 0.85, len: 0.9, angle: 0.15, dark: 0.4 },
  scars: 0, barnacles: 0, tornWing: null, notchedFluke: null,
  horns: { style: 'nub' }, hornBase: '#8a86a0', hornTip: '#f2e8e8',
  plate: '#6a6c9a', crestIn: '#f294a8',
  arm: '#5a5f8e', membrane: '#8e8eba', finTip: '#cfcce2', ray: '#64689a', finMark: '#f8f2f4', finMarkAmt: 0.25,
  iris: '#ecb044', iris2: '#4a2a10', lid: '#5a5f8e', sclera: '#d4cabc', mouth: '#a45666',
  frond: '#ffa6b4', frondTip: '#ffdce2',
  furShade: 0.86, furTip: 1.2, furScale: 1.1, skinRes: 768,
  voice: { base: 79, formant: 1.45, breath: 0.28 },
};

/** Act IV: you, the elder of the herd: the largest, scarred, barnacled, horns huge and gnarled. */
export const ELDER_SELF = {
  name: 'elderSelf', length: 32, seed: 7,
  back: '#3a4a60', belly_c: '#e4dccc', mark: '#5a6a80', mark2: '#f0ebe0',
  pattern: { spots: 0.25, stripes: 0.4 }, bars: 0.55, streaks: 0.75, mottle: 0.7, algae: 0.45,
  eyePatch: { size: 1.0, len: 1.1, angle: 0.1, dark: 0.6 },
  scars: 0.9, barnacles: 0.9, wornTubercles: true, tornWing: null, notchedFluke: 'L',
  horns: { style: 'gnarled' }, hornBase: '#332a22', hornTip: '#e6d8b8', hornScale: 1.1,
  plate: '#3a4656', crestIn: '#c05a6a', plateThick: 1.25, crestScale: 1.05,
  arm: '#3a4a60', membrane: '#5a6a7c', finTip: '#9aa2ae', ray: '#384656', finMark: '#ece6da', finMarkAmt: 0.3,
  iris: '#d8a448', iris2: '#3a2410', lid: '#3a4a60', sclera: '#c8bca8',
  frond: '#c27488', frondTip: '#e6aebc', gill: '#c46c7c', mouth: '#7a3e4e',
  furShade: 0.72, furTip: 1.1, girth: 1.08, finScale: 1.1, furScale: 1.25,
  skinRes: 1536,
  voice: { base: 40, formant: 0.86, breath: 0.26 },
};

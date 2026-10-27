// Individual skywhale genomes. Each adult has its own silhouette, markings and voice so
// the herd reads as a family of individuals rather than copies.

export const CALF = {
  name: 'calf', calf: true, length: 4.2, seed: 7,
  back: '#e9e4dc', belly_c: '#fffaf2', mark: '#c3d2ea', mark2: '#b4c6e6',
  pattern: { spots: 0.75, blaze: 0.0 },
  arm: '#e6e0d8', membrane: '#f6c7b8', finTip: '#f0a9a0', ray: '#e2b2a6',
  iris: '#47c3cf', iris2: '#13283f', lid: '#e4ded6', sclera: '#f6f1e8',
  frond: '#ff9d98', frondTip: '#ffd6c6', gill: '#ff8f8a', mouth: '#b4566a',
  furShade: 0.78, furTip: 1.08, girth: 1.0, finScale: 1.0, frondScale: 1.0,
  voice: { base: 72, formant: 1.35, breath: 0.25 },
};

export const MOTHER = {
  name: 'mother', length: 22, seed: 21,
  back: '#6e86aa', belly_c: '#efe5d6', mark: '#c4d3e6', mark2: '#f7f1e6',
  pattern: { stripes: 0.55, crescent: 1.0, blaze: 0.35 },
  arm: '#7189ab', membrane: '#dcb7c8', finTip: '#c99ab4', ray: '#7c8fb0',
  iris: '#e2a948', iris2: '#3a2414', lid: '#6c84a8', sclera: '#eee6d8',
  frond: '#d97690', frondTip: '#f2b3c0', gill: '#e07a86', mouth: '#8c4458',
  furShade: 0.74, furTip: 1.12, girth: 1.02, finScale: 1.05,
  voice: { base: 50, formant: 1.0, breath: 0.2 },
};

export const ELDER = {
  name: 'elder', length: 34, seed: 99,
  back: '#56677f', belly_c: '#ddd3c2', mark: '#8ea0b6', mark2: '#e6ded0',
  pattern: { stripes: 0.35, blaze: 0.2 },
  arm: '#5a6b83', membrane: '#b7a9b8', finTip: '#9a8aa2', ray: '#5d6c85',
  iris: '#c8b07a', iris2: '#2a2218', lid: '#56677f', sclera: '#e2dbcf',
  frond: '#b86d82', frondTip: '#e0a8b6', gill: '#c26a7a', mouth: '#7a3e4e',
  garden: true, furShade: 0.7, furTip: 1.06, girth: 1.08, finScale: 1.12, furScale: 1.3,
  voice: { base: 38, formant: 0.85, breath: 0.25 },
};

// A palette of adults; the herd picks from these.
export const ADULTS = [
  {
    name: 'sage', length: 20, seed: 31,
    back: '#6b8f8c', belly_c: '#efe8d8', mark: '#a9c6bd', mark2: '#f2eee2',
    pattern: { stripes: 0.7 }, arm: '#6b8f8c', membrane: '#cfd9b8', finTip: '#a9c08f', ray: '#6d8f86',
    iris: '#9fd36a', iris2: '#1c2e18', lid: '#688a87', frond: '#e48b7e', frondTip: '#f7c2a8',
    girth: 0.95, finScale: 1.0, voice: { base: 55, formant: 1.05, breath: 0.2 },
  },
  {
    name: 'dusk', length: 24, seed: 41,
    back: '#8a7aa0', belly_c: '#f1e6e2', mark: '#c4b5d6', mark2: '#f6eef2',
    pattern: { stripes: 0.4, blaze: 0.5 }, arm: '#857799', membrane: '#e3b9c9', finTip: '#c991b0', ray: '#8a7ba0',
    iris: '#f0b860', iris2: '#3a2010', lid: '#86779c', frond: '#e6879e', frondTip: '#f6c0cc',
    girth: 1.05, finScale: 1.08, voice: { base: 47, formant: 0.95, breath: 0.2 },
  },
  {
    name: 'sand', length: 19, seed: 53,
    back: '#b0977a', belly_c: '#f6eee0', mark: '#d8c4a6', mark2: '#fbf4e6',
    pattern: { spots: 0.35, stripes: 0.3 }, arm: '#a99075', membrane: '#f0ccb0', finTip: '#d9a68a', ray: '#a88e72',
    iris: '#64b8d8', iris2: '#14283a', lid: '#ab9277', frond: '#f09a86', frondTip: '#fcd0b8',
    girth: 0.98, finScale: 0.95, voice: { base: 58, formant: 1.1, breath: 0.22 },
  },
  {
    name: 'storm', length: 26, seed: 67,
    back: '#4f6a86', belly_c: '#e8e2d8', mark: '#8fa8c4', mark2: '#eef0f4',
    pattern: { stripes: 0.6, crescent: 0.4 }, arm: '#4f6a86', membrane: '#a9bcd4', finTip: '#7f97b8', ray: '#526d89',
    iris: '#9ad0e6', iris2: '#132233', lid: '#4d6884', frond: '#c87a94', frondTip: '#eab0c2',
    girth: 1.1, finScale: 1.1, voice: { base: 43, formant: 0.9, breath: 0.22 },
  },
  {
    name: 'fern', length: 21, seed: 79,
    back: '#7f9a72', belly_c: '#f2eedc', mark: '#b7cc9e', mark2: '#f4f2e2',
    pattern: { spots: 0.4, blaze: 0.4 }, arm: '#7a956d', membrane: '#e6d2a8', finTip: '#c8b07c', ray: '#7b9570',
    iris: '#e8c060', iris2: '#2c2410', lid: '#7b966e', frond: '#e89a7e', frondTip: '#f8cfae',
    girth: 1.0, finScale: 1.02, voice: { base: 52, formant: 1.0, breath: 0.2 },
  },
  {
    name: 'ash', length: 23, seed: 89,
    back: '#8d939e', belly_c: '#f3eee6', mark: '#c2c8d4', mark2: '#faf7f0',
    pattern: { stripes: 0.5 }, arm: '#8a909b', membrane: '#d8c2c6', finTip: '#b49aa4', ray: '#8a909c',
    iris: '#d68a5c', iris2: '#2a1810', lid: '#888e99', frond: '#d48896', frondTip: '#efbcc6',
    girth: 1.0, finScale: 1.0, voice: { base: 49, formant: 0.97, breath: 0.2 },
  },
];

// Other calves in the herd (playmates).
export const CALVES = [
  {
    name: 'pip', calf: true, length: 3.9, seed: 103,
    back: '#d9c9e4', belly_c: '#fbf6fa', mark: '#b9a7d4', mark2: '#c8b8e0',
    pattern: { spots: 0.6 }, arm: '#d6c6e0', membrane: '#f4c2d0', finTip: '#e8a2b8', ray: '#d2b4cc',
    iris: '#e8b048', iris2: '#2e1c0e', lid: '#d4c4de', frond: '#ff9fb6', frondTip: '#ffd6e2',
    furShade: 0.78, voice: { base: 76, formant: 1.4, breath: 0.25 },
  },
  {
    name: 'moss', calf: true, length: 4.4, seed: 113,
    back: '#cfe0cf', belly_c: '#fbfbf2', mark: '#a9c8ad', mark2: '#b3d2b6',
    pattern: { spots: 0.7 }, arm: '#cbdccb', membrane: '#f2d6b2', finTip: '#e8b88e', ray: '#c6d6be',
    iris: '#58b8e0', iris2: '#10263a', lid: '#c8d8c8', frond: '#ffa98e', frondTip: '#ffdcc4',
    furShade: 0.78, voice: { base: 69, formant: 1.3, breath: 0.25 },
  },
  {
    name: 'ember', calf: true, length: 4.0, seed: 127,
    back: '#ecd2bc', belly_c: '#fff8f0', mark: '#ddb79a', mark2: '#e4c0a2',
    pattern: { spots: 0.65 }, arm: '#e8cfb9', membrane: '#f8c0a8', finTip: '#f0a088', ray: '#e0b8a0',
    iris: '#6ad0c0', iris2: '#10302a', lid: '#e6ccb6', frond: '#ff9a88', frondTip: '#ffd2c0',
    furShade: 0.78, voice: { base: 74, formant: 1.38, breath: 0.25 },
  },
];

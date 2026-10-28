// Bird-reptiles of Vur Sok (skimmers and coilwings). Placeholder while the full system is built.
export class ReptileSystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.flocks = [];
    this.birds = [];
    this.stats = { birds: 0, tris: 0 };
  }
  addFlock() { return null; }
  update() {}
  shock() {}
  clear() { this.flocks.length = 0; this.birds.length = 0; }
  prune() {}
  dispose() {}
}

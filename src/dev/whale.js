// Dev scene: static calf + mother for model/shader inspection.
// ?debug&test=whale&view=side|front|top|back|q|close|under|mom|momq|momtop|calftop&shells=N&time=...
import { WhaleModel } from '../creatures/WhaleModel.js';
import { CALF, MOTHER } from '../creatures/WhaleTypes.js';

export default async function (game) {
  const s = game.engine.scene;
  const p = game.params;
  const calf = new WhaleModel(CALF);
  const mom = new WhaleModel(MOTHER);
  calf.group.position.set(0, 100, 0);
  mom.group.position.set(-16, 98, -22);
  s.add(calf.group, mom.group);
  calf.castShadows(game.engine.shadows);
  mom.castShadows(game.engine.shadows);
  const whales = [calf, mom];
  if (p.has('shells')) for (const w of whales) w.setFurShells(+p.get('shells'));
  if (p.has('furscale')) for (const w of whales) w.u.uFurLen.value *= +p.get('furscale');
  window.__whales = whales;
  const views = {
    side: [[7.5, 101.5, 3.5], [0, 100, 0.2]],
    front: [[2.5, 100.8, 6.5], [0, 100.2, 1]],
    top: [[3, 106, -1], [0, 100, 0]],
    back: [[-3, 102.5, -8], [0, 100, 0]],
    q: [[6, 103.5, 7], [0, 100, 0]],
    close: [[3.2, 101.2, 3.4], [0, 100.2, 0.3]],
    under: [[4, 96, 5], [0, 100, 0]],
    mom: [[14, 108, 10], [-14, 98, -20]],
    momq: [[10, 112, 12], [-16, 98, -22]],
    momtop: [[-16, 140, -22.01], [-16, 98, -22]],
    calftop: [[0, 109, 0.01], [0, 100, 0]],
  };
  const v = views[p.get('view') || 'side'] || views.side;
  game.cameraRig.setCinematic({ pos: { x: 0 }, look: {} }, 1);
  const cam = game.engine.camera;
  game.cameraRig.update = () => {
    cam.position.set(...v[0]);
    cam.lookAt(...v[1]);
  };
  game.focus.set(-6, 100, -10);
}

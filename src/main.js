import { Game } from './game/Game.js';

const canvas = document.getElementById('c');
const veil = document.getElementById('veil');

function fail(err, message = 'SKYSONG needs WebGL 2. Please try a recent desktop browser.') {
  console.error(err);
  window.__skysongError = String(err && err.stack || err);
  if (document.getElementById('skysong-fail')) return;
  // Even failure is communicated without UI chrome: a quiet line of text.
  const p = document.createElement('p');
  p.id = 'skysong-fail';
  p.textContent = message;
  p.style.cssText = 'position:fixed;left:16px;right:16px;top:45%;margin:0;text-align:center;color:#cfd6ea;font:300 20px "Cormorant Garamond",Georgia,serif;letter-spacing:.12em;z-index:2';
  document.body.appendChild(p);
}

try {
  // Probe on a throwaway canvas so the real context keeps the renderer's attributes.
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const game = new Game(canvas, { veil, onError: (e) => fail(e, 'The sky could not be built. Please reload the page.') });
  window.__skysong = game;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fail(new Error('WebGL context lost'), 'The sky slipped away for a moment. Please reload the page.');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // three has rebuilt its state by now; the scene target must not render to texture directly
    document.getElementById('skysong-fail')?.remove();
    game.engine.renderer.properties.get(game.engine.rt).__useRenderToTexture = false;
  });
  game.start();
} catch (e) {
  fail(e);
}

import { Game } from './game/Game.js';

const canvas = document.getElementById('c');
const veil = document.getElementById('veil');

function fail(err) {
  console.error(err);
  window.__skysongError = String(err && err.stack || err);
  // Even failure is communicated without UI chrome: a quiet line of text.
  const p = document.createElement('p');
  p.textContent = 'SKYSONG needs WebGL 2. Please try a recent desktop browser.';
  p.style.cssText = 'position:fixed;left:0;right:0;top:45%;text-align:center;color:#cfd6ea;font:300 20px "Cormorant Garamond",Georgia,serif;letter-spacing:.12em';
  document.body.appendChild(p);
}

try {
  // Probe on a throwaway canvas so the real context keeps the renderer's attributes.
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const game = new Game(canvas, { veil });
  window.__skysong = game;
  game.start();
} catch (e) {
  fail(e);
}

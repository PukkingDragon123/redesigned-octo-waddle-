# SKYSONG

*A cinematic 3D fantasy adventure about being a tiny sky-whale calf on its first migration.*

You wake at sunrise beside your mother, in a herd of enormous furry sky whales drifting
above an endless ocean of cloud. The great migration to the legendary **Oasis** is about to
begin. Fly with your family through floating valleys, glowing krill fields, a cloud forest
of giant trees, a golden-hour herd song, a night of stars, a violent thunderstorm and the
hunt of a gigantic falcon, then through the clouds into the Oasis.

The game has **no UI at all**: no HUD, no meters, no prompts, no markers. Everything is
told through the world: your mother's movements and voice, your calf's breathing and
body language, the music, the weather, the light.

Everything you see and hear is generated in code: every creature, island, tree, cloud,
waterfall, every note of the score and every whale voice. There are no models, textures or
audio files.

---

## Play

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # static build in dist/ (open with any static file server)
```

A browser with WebGL 2 is required (recent Chrome, Edge, Firefox or Safari). A dedicated
GPU is recommended. Quality steps down on its own if frames run slow; you can also pick it
in **Settings**.

### Controls

| | Keyboard and mouse | Gamepad |
|---|---|---|
| Look and steer (you swim where you look) | Mouse (click once to capture it; or drag) | Right stick |
| Turn / rise / dive | A D / Space C (or the arrow keys) | Left stick, A / B |
| Swim | W or left click | RT |
| Slow down / hover | S | LT |
| Surge | Shift | L3 |
| Barrel roll | Q / E | LB / RB |
| Hum (hold to sing) | F (or H, middle click) | X |
| Sonic boom: hold to gather, release | R or right click | Y |
| Pause | Esc | Start |

On a touch screen: drag to look (you swim while touching), two fingers to hum, double-tap
and hold to gather a sonic boom, flick sideways to roll, three-finger tap to pause.

Controls are also listed under **Settings → Controls** in the floating title menu. That
menu is the only place text ever appears.

### Things to try

- Fly close to your mother and nuzzle her.
- Hum. She always answers. Tilt your nose up while humming to sing higher.
- Swim through a krill swarm with your mouth open when you are tired.
- Carve tunnels through clouds, skim the cloud ocean, roll through waterfall spray.
- When the herd sings, watch your mother breathe in before each note, and answer her.
- In the storm, fly in your mother's lee: her body breaks the wind.
- When the falcon comes, get between the adults.

---

## The journey

| Chapter | Light | What happens |
|---|---|---|
| Dawn Cradle | sunrise | Waking, following your mother, learning to fly |
| Floating Valleys | morning | Islands, waterfalls, call and answer, the Great Arch |
| Krill Fields | late morning | Feeding grounds, mother demonstrates a lunge, sky rays |
| Cloud Forest | afternoon | Giant trees, sky jellies, playmates invite you to a chase |
| The Herd Song | golden hour | Call-and-response singing with the whole herd |
| Night Passage | night | Stars, the giant planet, glowing krill |
| The Storm | storm | Gales, rain, lightning; a downdraft tears you away |
| The Falcon | stormy dawn | A huge shadow, a hunt, a living shelter of whales |
| The Cloud Wall | whiteout | Climbing blind through cloud, following her voice |
| The Oasis | morning | Floating lakes, the Mother Tree, the gathering, the final song |

Progress is saved at each chapter. **Continue** in the title menu resumes from there.

---

## How it is made

- **Renderer** (`src/render`): Three.js WebGL 2 with a custom pipeline. Shadow map, MSAA
  HDR opaque pass, a raymarched cloud-ocean pass, sorted transparent pass, then post:
  restrained bloom, crepuscular rays, sonic-boom lens distortion, in-cloud veil, grading
  and a neutral tone map. All lighting goes through one stylized model
  (`render/shaders/common.js`): a soft cel ramp, tinted shadows, a warm terminator band,
  sky/bounce ambient, rim light and translucency.
- **Skywhales** (`src/creatures/Whale*.js`): procedural lofted bodies with a real mouth
  cut (palate, floor and filter combs). Each has a ~25-bone skeleton with smooth skin
  weights, shell-texture fur that moves with wind and inertia, cambered membrane wing-fins
  with bony rays, a fluke, expressive eyes with painted lids, and feathery gill fronds.
  The animator is procedural and spring-driven: asymmetric wingbeats with elbow lag and
  feathering, a tail wave, overlapping action, breathing, throat resonator vibration, and
  expressions.
- **Sky and clouds** (`src/world`): a painted sky dome with horizon cumulus banks, cirrus,
  a ringed gas giant, stars and a moon. Cumulus is built from lit impostor puffs that part
  around the calf, blow apart in booms and ripple with song. The cloud ocean is a
  raymarched heightfield with billows, silver linings and real cast shadows.
- **World**: one migration spline with ten chapters. Floating islands with banded
  strata, painted meadows, instanced stylized trees (including giant trees and the Mother
  Tree), waterfalls, floating lakes and the Great Arch, built time-sliced behind the menu.
- **Herd and story** (`src/game`): herd formation and behaviours, the mother's care AI,
  the coroutine-scripted story director, the singing game, weather, sonic booms and the
  floating menu.
- **Ecosystem and falcon** (`src/creatures/Ecosystem.js`, `Falcon.js`): plankton, krill
  swarms, sky rays, sky jellies and puffbirds, plus the storm falcon. Its anatomy is
  hexapod: four wings and two talons.
- **Audio** (`src/audio`): a Web Audio score synthesized at runtime (piano, celesta,
  strings, choir, harp, flute, drums and brass), adaptive moods, spatial whale voices tuned
  to the current key, and ambience.

The visual and audio research behind all of this is in
[`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md).

### Debug parameters

Add `?debug` to the URL, then optionally:
- `&chapter=N` to jump to a chapter (0-9), `&intro` to play the opening.
- `&auto` for an autopilot that follows the mother; `&dt=0.05&warp=30` to simulate ahead.
- `&test=fly|whale|islands|world` (dev scenes in `src/dev/`), `&time=dawn|morning|…`.
- `&quality=high|medium|low`, `&nobloom`, `&norays`, `&noshadow`, `&nosea`.

### Headless checks

All of these drive headless Chromium against the dev server (`npm run dev`):

| Command | What it checks |
|---|---|
| `node tools/chapters.mjs 0,1,2 25 [shots]` | Runs chapters with the autopilot and reports state and errors (and screenshots) |
| `node tools/probe.mjs "<query>" out.png <frames> <w> <h>` | Captures a frame; `EVAL="<js>"` prints an expression (`g` is the game) |
| `node tools/falcon-run.mjs 150` | Plays the falcon encounter and logs every falcon event and the herd's shelter |
| `node tools/audio-check.mjs` | Renders every mood, voice and effect offline: no NaNs, nothing silent, gain staging |
| `node tools/audio-game.mjs 4 40` | Runs a chapter with live audio and reports the mood, chords and audio errors |
| `node tools/touch-check.mjs` | Phone viewport: taps New Game on the floating menu with a touch event |

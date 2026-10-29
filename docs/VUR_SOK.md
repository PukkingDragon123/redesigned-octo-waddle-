# Vur Sok: the redesign contract

SKYSONG now takes place on **Vur Sok**, an ocean planet. There are no floating islands: spiral islands rise
from a living ocean, some still forming. The herd of winged whales flies low over the sea, and the calf can
dive beneath the surface to feast on fish. This document is the shared design and interface contract for
everyone building it. Read it fully before touching code.

## 0. Latest user direction (newest; overrides anything below and any task prompt that conflicts)

The user added two requests while the build was running. Where a task prompt says otherwise (for example
"No fur"), this section wins.

### 0.1 Whales: fluffy fur, Monster Hunter horns, tulkun-level detail
User: *"The whale have fur more fluffy have horns to monster hunter style design / avatar level detail"*,
with the tulkun data-file page from *Avatar: The Way of Water* as the reference.
- **Fur stays and gets fluffier.** Do not remove the shell fur: upgrade it. `setFurShells(n)` / `maxShells`
  must really work, and Whale.animate's fur LOD (projected size) must keep working. The fur should be thick,
  long, soft and wind-blown, with clumping, curl, tapered strand tips, lighter tips and translucent rim light
  against the sun. It reacts to wind, flight inertia and bumps.
  - Where it grows: a lion-like mane over the nape, throat and shoulders; a dorsal ridge of fur between the
    back plates running down to the tail stock; tufts at the wing roots and along each wing's leading edge;
    a fringe on the tail stock and flukes.
  - The calf is the fluffiest, with soft down all over.
  - Keep the face around the eyes, the crest interior, the plate tops, the wing membranes and the throat
    bellows mostly bare, so the skin detail reads.
  - Fur colour follows the skin pattern.
- **Horns, Monster Hunter style.**
  - Shape: a pair of big swept-back horns rising from the skull behind the upper eyes, curving back and
    out over the shoulders.
  - Material: ridged keratin with growth rings, chips and cracks; a dark base fading to pale worn tips.
  - Smaller secondary horns and spikes run along the brow, cheek and jaw.
  - The big horns double as the hollow voice resonance horns: vents along their undersides flare when
    the whale sings or charges the boom.
  - Variants:

    | Whale | Horns |
    |---|---|
    | Alpha | Largest, with one tip snapped off |
    | Elder | Huge, gnarled, heavily ringed and curling |
    | Mother | Elegant and smooth |
    | Other adults | Each different: straight, curled, forward-swept |
    | Calf | Soft rounded nubs |

- **Tulkun-level detail**, from the reference:
  - **Back:** massive armoured back plates, thick and cracked like slate, with seams and a fine network of
    pale streak lines across the dark skin.
  - **Sensor crest:** a big crest on the head that rises like a fin and flares open to show a red-pink
    fleshy interior lined with sensor pits. This is now the main singing organ: it flares and vibrates
    when the whale hums, sings and charges the sonic boom, together with the horn vents and the throat
    bellows.
  - **Eyes:** FOUR small eyes, two on each side of the head, with golden-amber irises. Each whale has its
    own dark eye-patch markings. The eyes stay small relative to the body.
    - Keep `eyes.R` / `eyes.L` as the primary pair the game drives.
    - Add the second pair as `eyes.R2` / `eyes.L2`, following the same lids, gaze and pupil.
  - **Fins:** six in total: the long front wing flippers, a smaller rear pair and the flukes.
  - **Skin:**
    - Strong countershading: a dark back and a pale belly.
    - Bold white bars along the flank behind the head, and ventral pleats.
    - Wet glossy skin with mottling and scars.
  - **Sensor whips:** barbels trailing beneath the mouth that move with the wind.
- Still true: real-whale anatomy (a rorqual / humpback / tulkun mix), the alpha's torn wing and scars, the
  other variants, and small eyes.

### 0.2 Painterly world, alien plants, realistic rocks, Tiny Glade-like shading
User: *"Make game look more like a painting and less tree more alien plant moving and rocks looks super
detail realistic add shaders like tiny glades etc"*
- **Rendering like Tiny Glade.**
  - Lighting: soft warm light, soft wide-penumbra shadows, ambient occlusion in creases (screen-space AO
    plus baked cavity AO), warm bounce light from sunlit ground, sky-tinted shade, and gentle depth of
    field in the distance.
  - Post filter: a painterly pass (an anisotropic Kuwahara / brush filter subtle enough to keep detail),
    canvas grain, soft vignette, and grading toward harmonious painted palettes.
- **Fewer trees, more moving alien plants.** Replace most trees with animated alien flora. Keep a few trees
  as accents; the Mother Tree stays.
  - Giant spiral fiddleheads that coil and uncoil.
  - Tube and bell plants that pulse and breathe.
  - Anemone-like fronds that sway and close up when whales pass.
  - Kelp-like ribbon plants streaming in the wind.
  - Glassy fan corals on the shores.
  - Spore puffballs.
- **Rocks: super detailed and realistic**, the realistic anchor in the painted world.
  - Triplanar macro, meso and micro detail normals, and strata that follow the spiral.
  - Cavity and crevice AO, and sharp edge wear.
  - Lichen and moss in the crevices.
  - A wet dark band at the waterline, with barnacles and algae in the tidal zone.
- Owners: ocean (PostFX, the lighting in common.js) and world (plants, rocks, materials.js). The lead runs a
  follow-up pass for whatever the first build did not cover.
- Already built (do not rebuild): `src/flora/` (AlienFlora, nine animated alien plant species) and
  `src/render/painterly/` (GTAO, anisotropic Kuwahara strokes, canvas, DOF). The lead wires both in.

### 0.3 Build coordination (read this first if you are a builder)
- Update: the "build-vur-sok" workflow has been stopped. Its whale and wildlife work continues with two
  time-boxed finishers that own the same files. Newest user direction: *"Make game look beautiful have custom
  2d for the grass make it fluffy the whale model and shader make it like painting handrawn but also
  beautiful also finish work faster"*. That means fluffy hand-painted 2D grass (world2) and hand-painted,
  hand-drawn whale shading (the whale finisher).
- WHALES and WILDLIFE builders already at work: this note does not concern you. Carry on.
- To go faster, the HERD role is now built by a dedicated agent launched directly by the lead. That agent's
  task prompt contains the code word **TIDEWATER**.
- If your role is HERD and your task prompt does NOT contain the code word TIDEWATER (that is, you were
  launched by the "build-vur-sok" workflow as build:herd), the role is already taken. Edit nothing. Finish at
  once with the single-line report "superseded: herd is built by a dedicated agent".
- The OCEAN and WORLD builders have finished. Their files now belong to two new follow-up roles. From now on
  ownership is as follows (it replaces section 3 where they differ):

| Role | Owns |
|---|---|
| whales (running) | src/creatures/WhaleModel.js, whaleShaders.js, WhaleTypes.js, WhaleAnimator.js, Whale.js (model and LOD parts), src/creatures/whale/, src/dev/whale.js, src/dev/fly.js |
| wildlife (running) | src/creatures/Ecosystem.js, src/creatures/eco/, src/dev/ecosystem.js |
| herd | src/game/Herd.js, src/game/WhalePhysics.js, src/game/HerdBehaviors.js, src/dev/herd.js |
| look (painterly integration, lighting, ocean and sky) | src/render/Engine.js (painterly wiring and quality hooks only), src/render/PostFX.js, src/render/painterly/, src/render/shaders/common.js, src/render/Shadows.js, src/render/Globals.js, src/render/Particles.js, src/world/Ocean.js, src/world/Atmosphere.js, src/world/Sky.js, src/dev/painterly.js, src/dev/ocean.js |
| world2 (world polish) | the rest of src/world/ (WorldBuilder, Islands, Spirals, Seabed, Flora, Painted, Backdrop, Trees, Landmarks, MigrationPath, Water, Clouds, shaders/), src/render/materials.js, src/flora/, src/dev/islands.js, src/dev/world.js, src/dev/flora.js |
| lead | src/game/ (Game, Story, Weather, Swim, CameraRig, Menu, PlayerController, SonicBoom, SongGame, Script), src/audio/, src/core/, src/main.js, Falcon files, README.md, docs/ |

### 0.5 Make it a whole life, cinematic and never boring (newest)
User: *"make game don't feel boring and use new font more fantasy and cool ... add more controls and things to
do while flying like a flying bug you can catch and eat, or cinematic camera scene moments, a lot of them; the
intro shows you starting this season's migration; add underwater too, make underwater have a really cool
underwater effect and absolutely stunning fauna like kelps etc and weird fishes, crabs, alien Avatar-like, you
can eat, interact with etc; make it have like skip to you more grown too; make this game show the whole life
cycle of this creature: singing, mating, birthing and rest; make it super cool, interactive, not boring, and
polish; have some text, cinematic, but make it feel cinematic."*

**Length: the whole game is about 30 minutes** from New Game to the final title, cinematics included.
That means ACT I (the first migration) runs about 16-18 minutes and Acts II-IV about 4 minutes each.

Three builders work on this in parallel:

| Role | Owns |
|---|---|
| story (life cycle, cinematics, title cards, fonts) | src/game/Story.js, Script.js, CameraRig.js, Menu.js, SongGame.js, Weather.js, new src/game/Cinematics.js and src/game/life/, src/world/MigrationPath.js, src/creatures/WhaleTypes.js, src/audio/moods.js, index.html, src/main.js |
| moves (controls, tricks, flying bugs) | src/core/Input.js, src/game/PlayerController.js, src/game/SonicBoom.js, new src/game/Activities.js (already hooked: Story creates it and calls update(dt) and reset()), new src/game/Moves.js, new src/creatures/bugs/, src/dev/bugs.js, src/audio/Sfx.js, src/audio/AudioSystem.js |
| underwater (effects, fauna, kelp forests) | src/creatures/Ecosystem.js, src/creatures/eco/, src/dev/ecosystem.js, src/world/Ocean.js, src/world/Seabed.js, src/render/PostFX.js, src/render/Particles.js, src/flora/, src/dev/ocean.js, new src/dev/underwater.js |

Everything else belongs to the lead. Never edit files you do not own; put needed changes in your report.

### 0.6 Hand-drawn lines, less blur (newest rule, applies to everyone)
User: *"never use straight line in game for like the crack or texture, make everything feel hand-drawn, and make
the blur effect less"*.
- **No ruler-straight lines anywhere:** cracks, joints, strata, plate seams, scars, ink contours, ripples, and
  procedural textures (cell or Voronoi edges, stripes, bands).
  - Every line wobbles like a hand-drawn stroke: domain-warp the coordinates that make it, vary its width along
    its length, taper its ends, break it into strokes, and let it overshoot or fade a little.
  - Organic curves over polygons.
- **Less blur:** keep depth of field light and the far softening subtle; never smear what the player looks at;
  keep fog and underwater haze clear enough to read shapes. The DOF presets have been toned down.

A "lines" builder sweeps the existing shaders for this. It owns:
- src/world/shaders/, src/world/Islands.js, Spirals.js, Painted.js, Grass.js, Trees.js, Flora.js, Clouds.js;
- src/render/materials.js, src/render/shaders/common.js, src/render/painterly/;
- src/creatures/whale/ (its shaders and skin bake).

The story, moves and underwater builders apply the rule to their own work.

### 0.7 A nature documentary of a life, hatched in a whirlpool (newest)
User: *"make the cinematic cooler, feel like a nature documentary show: you are being hatched; your species is
born from an embryo-like egg in the middle of a whirlpool; the males guard while the female lays the egg and
finds food; and make all fauna and creatures super detailed, polished models that look really good and
realistic, not just everywhere."*
- **Lore:** each season the herd returns to a whirlpool nursery, the Spiral Maelstrom, a slow sea vortex.
  - The female lays a single embryo-like egg in its calm eye: translucent, glowing, the curled embryo visible
    inside, a heartbeat pulse. She then leaves to find food.
  - The males circle and guard the egg against predators.
  - The calf hatches, swims out of the egg and rises to its first breath.
- **Where it plays:** ACT I opens with your hatching. In ACT III you are the male who guards the egg in the
  maelstrom while your mate lays it and goes to feed; then your calf hatches.
- **Documentary language:**
  - Camera: long-lens observational shots, slow pans, aerial drone moves, macro close-ups, time-lapse and slow
    motion.
  - Text: lower-third captions naming places and species (with invented scientific names), and sparse
    narrator subtitles.
  - No real broadcaster's name or branding.
- **Creatures:** every creature gets a super-detailed, polished, realistic model (silhouette, anatomy, eyes,
  skin, scales, membranes, animation). They live where they would really live, in believable numbers, not
  sprinkled everywhere.
- **Lettering:** the user chose **Almendra SC**, widely letter-spaced, for the SKYSONG logo, the act and
  chapter titles, the kickers and the menu. Cormorant Garamond italic stays for subtitle and narration lines.

Builders:

| Role | Owns |
|---|---|
| doc (story) | src/game/Story.js, Cinematics.js, src/game/life/, Menu.js, CameraRig.js, SongGame.js, src/creatures/WhaleTypes.js, src/audio/moods.js, index.html |
| maelstrom | src/world/Ocean.js, new src/creatures/egg/, src/dev/hatch.js |
| fauna | src/creatures/Ecosystem.js, eco/, bugs/, Falcon.js, falcon/, src/game/Activities.js, src/dev/ecosystem.js, src/dev/underwater.js, src/dev/bugs.js, src/dev/falcon.js |
| whale detail | src/creatures/whale/, Whale.js, WhaleAnimator.js, WhaleModel.js, whaleShaders.js, src/dev/whale.js, src/dev/fly.js |

Maelstrom API, which doc builds against with defensive fallbacks:
- `game.ocean.setWhirlpool(id, { center, radius, depth, spin })` and `game.ocean.clearWhirlpool(id)`. The vortex
  dips the surface into a spiral funnel with foam arms, and `heightAt` / `normalAt` include it.
- `new WhaleEgg(game, opts)` from `src/creatures/egg/WhaleEgg.js`, with:
  - `.group`, added to the scene by the egg itself;
  - `.position`, `.update(dt)`, `.setGlow(k)`, `.setPulse(rate)` and `.crack(k 0..1)`;
  - `.hatch()`, which bursts the shell and leaves fragments, fluid and bubbles;
  - `.embryo`, the curled calf inside, which can twitch with `.kick()`;
  - `.dispose()`.

### 0.8 Film quality, no text, shorter, seamless (newest; overrides 0.7's text and pacing)
User: *"remove all the text and polish the game and graphics; it feels weird and too long and feels AI; make
it more smooth, human-made, film quality, seamless"*.
- **No text in the game at all.** No title cards, datelines, lower-thirds, narration, subtitles or skip hints.
  The only text left is the floating title menu: the SKYSONG logo and New Game / Continue / Settings, plus the
  settings pages. Its subtitle line goes too.
- **Shorter: about 15 minutes in total.** Cinematics are rare, short and seamless: in-engine camera moves that
  blend from and back to the play camera, with no hard cuts, no letterbox popping in and out, and no black
  dips. Time skips are soft dissolves. Everything stays skippable by holding any input, with no text shown.
- **Film quality, human-made, not "AI":**
  - Post: much less oil-paint smear (the Kuwahara filter reads as a cheap filter); a natural filmic tone map
    and grade without magenta casts; gentle halation, grain and vignette; crisp detail.
  - Readable night and storm.
  - Clouds that are soft masses, not balls.
  - Whales: the calf reads as a soft baby whale, not a blue pom-pom; adult wings read as living membranes, not
    flat white boards.
  - Camera: steady, smooth framing on the calf, with adults never filling the frame or blocking it.

Builders:

| Role | Owns |
|---|---|
| seamless (story, camera, herd spacing) | src/game/Story.js, Cinematics.js, src/game/life/, Menu.js, CameraRig.js, Herd.js, HerdBehaviors.js, index.html |
| film (grade, light, sky, clouds) | src/render/ (PostFX, painterly/, shaders/common.js, Globals, Engine look settings), src/world/Atmosphere.js, Sky.js, Clouds.js, Ocean.js shading |
| whale look | src/creatures/whale/, Whale.js, WhaleAnimator.js, src/creatures/WhaleTypes.js, src/dev/whale.js, src/dev/fly.js |

### 0.9 Ultra-realistic particles (newest; overrides the 2D particle style)
User: *"I hate the new particles. All particles: I want realistic, ultra-realistic particles."*
- **No 2D or hand-drawn look for particles:** no outlines, no scalloped cartoon puffs, no drawn wind strokes or
  arcs, no stars. (Section 0.6's hand-drawn rule still applies to lines in textures, not to particles.)
- **Physically based look,** like a high-end nature film or a modern AAA game:
  - Spray and splashes: whitewater sheets breaking into thousands of fine droplets and mist.
  - Droplets: refractive, catching the sun.
  - Mist and breath: soft volumetric vapour lit with forward scattering and silver linings, dissipating
    naturally.
  - Bubbles: transparent with fresnel rims, internal reflection and a specular highlight; they wobble, rise
    and pop at the surface.
  - Rain: thin streaks with splash rings.
  - Glows: soft bokeh-like bioluminescence.
  - Sonic boom: a realistic condensation flash or vapour cone that dissipates in a moment.
- Keep them grounded in the natural film grade, and never veil the camera.

### 0.10 Real effects systems, a hunting whale (newest)
User: *"Remove the giant tree, and fix the weird puff particle, I hate that particle. Make a new system for
splash and wind line effects and wind effects etc instead. Remove the weird red dot on the mouth too, it's a
little weird. Make the whale eat and be able to be hostile, and remove crabs."*
- **Giant trees:** removed (done by the lead).
- **No puff particles:** the round vapour puffs are gone everywhere. They are replaced by purpose-built effect
  systems:
  - a splash system: water sheets, crowns, droplets and foam on the sea;
  - wind lines: thin flowing streamlines that show the wind and the whale's speed;
  - wind effects: gusts over the sea, spray blown off crests, and the like.
- **Whale mouth:** no red dot.
- **Hunting:** the whale can hunt, bite and eat, and can be hostile to other creatures, which react with fear.
- **No crabs.**

## 1. Art direction (supersedes the earlier anime direction where they conflict)

- **Cinematic stylized realism**, in the spirit of Avatar: The Way of Water (tulkun, Pandora's seas) and
  Monster Hunter creature design: believable anatomy, functional organs, rich material detail
  (keratin, scars, barnacles, wet skin), painterly lighting. Not photoreal mush and not flat anime.
- **Spirals are the planet's signature**: coiled islands, helical sea stacks, ammonite-like ridges,
  spiral atolls, spiral-twisted tree trunks, spiral crests on animals, the spiral galaxy at night,
  the spiral bubble-net hunt. Use them deliberately, not as random decoration.
- **Mix 2D with 3D** for the environment: 3D forms (rock, trunks, whales) with hand-painted 2D elements
  (foliage cards, grass tufts, distant painted backdrop layers), so the world reads like a living painting.
- Restraint: no excessive bloom, no random glowing decorations. Natural light sources only
  (sun, moons, lightning, bioluminescent plankton at night, lava glow in forming islands).
- Detail budget: "super detailed" means layered detail at every distance (silhouette, mid forms, fine
  surface), not noise everywhere. Every material gets macro/meso/micro variation.

## 2. World conventions

- **Sea level is y = 0.** World units are metres. Gravity is down (-y).
- The herd's normal flight altitude is **20-120 m** above the sea. The migration route (MigrationPath)
  keeps the herd over open water and between islands. Whales may dive below y = 0 to feed.
- Chapters keep their ids, order, `start` arc lengths, `time` presets and `mood` names (audio depends on
  them). New display names and themes:

| # | id | name | theme |
|---|---|---|---|
| 0 | cradle | Dawn Lagoon | dawn inside a sheltering spiral atoll, glassy water, the herd resting on the surface |
| 1 | valleys | The Spiral Reach | an archipelago of coiled islands and helical sea stacks, waterfalls into the sea |
| 2 | krill | The Feasting Shoals | open sea with huge fish bait balls; the herd dives and lunges; bubble-net spirals |
| 3 | forest | The Coil Forest | giant spiral-trunk trees on coiled islands, bird-reptile rookeries |
| 4 | song | The Herd Song | golden hour, a ring of sea stacks around calm water |
| 5 | night | Night Passage | bioluminescent sea, spiral galaxy and moons, glowing plankton wakes |
| 6 | storm | The Storm | towering waves, spray, rain, lightning |
| 7 | falcon | The Falcon | stormy dawn over heaving sea, the storm falcon hunts |
| 8 | wall | The Fog Wall | a sea-fog bank (whiteout), following mother's voice |
| 9 | oasis | The Oasis | a vast spiral atoll: turquoise lagoon, the Mother Tree on the central coiled island, countless fish and whales |

## 3. Ownership (who edits what; never edit files you do not own)

| Owner | Files |
|---|---|
| **ocean** | `src/world/Ocean.js` (new, replaces CloudSea), `src/world/CloudSea.js` (may delete after Ocean exists), `src/render/PostFX.js`, `src/render/Globals.js`, `src/render/shaders/common.js`, `src/world/Sky.js`, `src/world/Atmosphere.js`, `src/world/Clouds.js`, `src/render/Particles.js`, `src/dev/ocean.js` (new) |
| **world** | `src/world/Islands.js`, `src/world/Trees.js`, `src/world/WorldBuilder.js`, `src/world/MigrationPath.js`, `src/world/Water.js`, `src/world/Landmarks.js`, `src/render/materials.js`, new files under `src/world/` (e.g. `Spirals.js`, `Painted.js`, `Backdrop.js`), `src/dev/islands.js`, `src/dev/world.js` |
| **whales** | `src/creatures/WhaleModel.js`, `src/creatures/whaleShaders.js`, `src/creatures/WhaleTypes.js`, `src/creatures/WhaleAnimator.js`, `src/creatures/Whale.js` (model/LOD parts only), new files under `src/creatures/whale/`, `src/dev/whale.js`, `src/dev/fly.js` |
| **wildlife** | `src/creatures/Ecosystem.js`, everything under `src/creatures/eco/`, new species files, `src/dev/ecosystem.js` |
| **herd** | `src/game/Herd.js`, new `src/game/WhalePhysics.js`, new `src/game/HerdBehaviors.js`, `src/dev/herd.js` (new) |
| **lead** | `src/game/Game.js`, `src/game/Story.js`, `src/game/PlayerController.js`, `src/game/CameraRig.js`, `src/game/SonicBoom.js`, `src/game/Weather.js`, `src/game/SongGame.js`, `src/game/Menu.js`, `src/core/*`, `src/render/Engine.js`, `src/main.js`, `src/audio/*`, `src/creatures/Falcon.js`, `src/creatures/falcon/*` |

Need a change in a file you do not own? Make your module work without it (defensive `?.` calls,
fallbacks) and describe the exact change in your final report; the lead applies it.

Shared GLSL helpers you need but do not own: put them in your own module (e.g. `src/world/shaders/foliage.js`).
Only the ocean owner edits `common.js` and `Globals.js`.

## 4. Interfaces

### 4.1 Ocean (`game.ocean`, owner: ocean)
```js
const ocean = new Ocean(game);        // adds itself to the scene/passes; lead swaps it in for CloudSea in Game.js
ocean.level                           // 0
ocean.heightAt(x, z)                  // CPU wave height at the current time, matching the shader to ~5 cm
ocean.normalAt(x, z, out)             // CPU surface normal
ocean.setSeaState(k, { dur })         // 0 glassy .. 0.3 calm .. 0.6 lively .. 1 storm; eased over dur seconds
ocean.splash(pos, strength, radius)   // foam ring + spray burst + wave ring (whale lunges, breaches, slaps)
ocean.wake(pos, vel, width)           // per-frame wake contribution for things moving at the surface
ocean.setQuality(q)                   // 0..1 like the old cloud sea
ocean.enabled
ocean.uniforms                        // exposed for debug
```
- Globals the ocean adds to `G`: `uSeaLevel`, `uSeaState`, `uUnderwater` (0..1 camera submersion),
  `uWaterTint` (absorption colour), plus whatever it needs. Every ShaderMaterial built with
  `Object.assign({}, G, ...)` gets them automatically.
- `common.js` gains `waterColumnFog(col, P)` or folds it into `applyFog` so geometry below y = 0 seen from
  above is tinted by the water column, and an underwater branch when the camera is submerged. Caustics on
  submerged surfaces and shallow sea floors. Keep `applyFog(col, P)`'s signature.
- PostFX gains an underwater mode (fog, colour absorption, light shafts, Snell's window when looking up).
- Night: bioluminescent plankton in wakes, splashes and breaking crests.
- Storm (sea state 1): 6-12 m swells, wind-blown spray, foam streaks.

### 4.2 World (`story.world`, owner: world)
Keep the existing public API that Story uses (all must keep working):
`build(onProgress)`, `buildChapter(id)`, `built`, `done`, `spawns`, `distance(p, maxCheck)`, `collide(p, r, out)`,
`raycast(from, to)`, `nearestWaterfall(p)`, `updateVisibility(s)`, `waterfalls`, `lakes`, `motherTree`,
`songCenter`, `lightningSpots`, `archInfo`, `islands`.
New:
- `world.perches`: `[{ p: Vector3, n: Vector3, chapter }]` rock tops, ledges and branches where bird-reptiles land.
- `world.seabedAt(x, z)`: height of the sea floor (shallow reefs and lagoons around islands; -200 in open sea).
- `world.spawns.fish`: `[{ pos, species, count, chapter }]` with species `'glintfin' | 'spiralback' | 'lanternjack'`.
- `world.spawns.reptiles`: `[{ pos, species, count, chapter }]` with species `'skimmer' | 'coilwing'`.
- Keep `spawns.plankton` (night sea glow) if useful; drop `krill`, `rays`, `jellies`, `birds` spawns.
- The MigrationPath keeps chapter `start` values and the total length (~11.8 km); POINTS move to sea-level
  altitudes (20-120 m; the Feasting Shoals path at 15-30 m so the herd skims the sea).

### 4.3 Whales (owner: whales)
Keep every API the game uses: `new WhaleModel(genome)`; `group`; `bones` with the existing names
(root, spine1, spine2, tail1..3, fluke, chest, neck, head, jaw, finR1..3, finL1..3, rearR, rearL; add more freely);
`boneAbs`; `meshes` (shadow casters) and `castShadows(shadows)`; `prof(t) -> { hw, top, bot, cy, z }`;
`eyes.{R,L}.{ mesh, u.uLids, u.uGaze, u.uPupil }`; `fins.{R,L}`, `flukes`, `rear`; `u` uniforms the animator drives
(`uSac, uThroat, uVib, uGill, uBreath, uAirflow, uInertia`, add more); `L`; the geometry cache.
`setFurShells(n)` and `maxShells` must keep working: the fur stays and gets fluffier (section 0.1).
Eyes: `eyes.R` / `eyes.L` stay the primary pair; the second pair is `eyes.R2` / `eyes.L2` (section 0.1).
Whale (entity) keeps `nearestOnBody(p, out)` (body-axis collision proxy) and its physics API.
WhaleAnimator must add:
- `anim.bump(worldDir, strength)`: a body squash-and-stretch / jiggle response on a spring (strength 0..2),
  a blink and a surprised-then-happy expression; called by the collision solver on every whale contact.
- `anim.gesture(name)` for social play: `'tailSlap'`, `'finSlap'`, `'spyhop'`, `'nuzzle'`, `'happyWiggle'`,
  `'breachArch'`, `'rollOver'`; each a short layered pose the herd behaviours trigger.
WhaleTypes keeps its exports (`CALF`, `MOTHER`, `ELDER`, `ADULTS`, `CALVES`). `ADULTS[0]` becomes **the alpha**:
largest male, torn wing membrane, notched fluke, scars. Genome fields for variants: `scars`, `barnacles`,
`tornWing: 'L' | 'R' | null`, `notchedFluke`, `alpha`.

### 4.4 Wildlife (`story.eco`, owner: wildlife)
Keep the facade names the game calls: `update(dt)`, `eat(mouthPos, r, dt, owner)` (returns how much was eaten),
`nearestSwarm(pos)` (nearest fish school: `{ pos, dist, ... }`), `scatter(center, radius, strength, speed)`,
`threat`, `songFocus`, `songRadius`, `feeders`, `roosts`, `clear()`, `prune(center, radius)`.
New: `addFishSchool(pos, species, count, opts)`, `addReptileFlock(pos, species, count, opts)`,
`perches` (set by the game from `world.perches`), `ocean` (set to `game.ocean`; fall back to a flat sea at y = 0).
Species:
- **glintfin**: small silver schooling fish in thousands; bait balls that tighten and flash when threatened.
- **spiralback**: mid-size banded fish that swim in twisting spiral columns; leap clear of the water in arcs.
- **lanternjack**: large solitary/paired predator fish with fin-lures; patrols below bait balls, breaches.
- **skimmer**: bird-reptile, pterosaur-like with a spiral head crest; skims the sea, plunges for fish, nests on ledges.
- **coilwing**: small four-winged feathered lizard in flocks; murmurations around spires, roosts in trees and on whales.
Fish are visible from above through the water and all around when the calf dives. Whales and bird-reptiles eat them.

### 4.5 Herd physics and behaviours (owner: herd)
- `WhalePhysics`: collisions between **all** whales (calf, playmates, adults, gathering whales): capsule/body-axis
  contacts via `nearestOnBody`, mass by size (calves bounce off adults, adults barely move), restitution
  (bouncy but soft), friction, angular response (a glancing bump spins/rolls), and `anim.bump` on contact.
  Players feel it: bump into mother, she sways and turns to look; bump a playmate, both bounce and it chases you.
- `HerdBehaviors`: smarter social life: play (calves bump-tag, chase, roll together, breach together),
  care (mother nuzzles, escorts, lifts the calf to the surface), adults (spyhop, tail slaps, fin slaps,
  synchronized breaching, resting log-like at the surface), reactions to the player (bump back playfully, follow
  the calf's lead, answer gestures), and the **spiral bubble-net hunt** at the Feasting Shoals.
  Behaviours steer whales through Herd and must never break the story's control (`motherScript`, herd modes).

## 5. Technical rules

- Three.js 0.186, WebGL2, only custom `ShaderMaterial`s; global uniforms from `G` via `Object.assign({}, G, {...})`.
- Shadow casters re-render with a `DEPTH_PASS` define: fragment shaders early-return and never sample the
  shadow map there; alpha-tested casters must still discard in that pass.
- Passes: shadow -> opaque MSAA HDR (`engine.scene`) -> transparent (`engine.sceneT`, sorted by renderOrder;
  the old cloud sea was renderOrder -100) -> PostFX. `G.uDepthTex` is the resolved opaque depth.
- `Engine.precompile` compiles everything behind the title; do not create materials lazily mid-game.
- Budgets at 1080p "high" on a mid-range discrete GPU: 60 fps; under 600 draw calls and 4 M triangles per frame;
  each system under ~3 ms CPU per frame. Use instancing, LOD and impostors.
- No per-frame allocations in hot loops. No `Math.random()` in anything that must be deterministic per seed.
- Debug: `?debug&test=<dev scene>` runs your dev scene (src/dev/*.js); tools in README "Headless checks".
  Headless rendering is SwiftShader: slow, so test with small viewports and few frames.
- Do not commit; the lead commits. Report what you built, how to view it, measured costs, and open issues.

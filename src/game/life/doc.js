// The film journal's words: lower-third labels (places and species, with invented scientific names)
// and the cameraman's sparse voice-over. Concrete, dated, restrained; short sentences. Shown only at
// cinematic moments (Cinematics.lower / say). No real broadcaster's name or branding.

/** Species labels: { name, sci } set as "NAME" over "Scientific name · note". */
export const SPECIES = {
  whale: { name: 'Skysong whale', sci: 'Cetocaelum cantor · adult male, 26 m' },
  egg: { name: 'Skysong whale', sci: 'Cetocaelum cantor · egg, day 1' },
  calf: { name: 'Skysong whale', sci: 'Cetocaelum cantor · calf, 0 days' },
  mother: { name: 'Skysong whale', sci: 'Cetocaelum cantor · female, his mother' },
  males: { name: 'Skysong whale', sci: 'Cetocaelum cantor · males on guard, seven' },
  mate: { name: 'Skysong whale', sci: 'Cetocaelum cantor · female, 14 m' },
  newborn: { name: 'Skysong whale', sci: 'Cetocaelum cantor · calf, 0 days' },
  elder: { name: 'Skysong whale', sci: 'Cetocaelum cantor · male, 31 years' },
  glintfin: { name: 'Glintfin', sci: 'Argentichthys spiralis · schooling, 12 cm' },
  spiralback: { name: 'Spiralback', sci: 'Helicopisces torquatus · 60 cm' },
  lanternjack: { name: 'Lanternjack', sci: 'Lucernodon abyssalis · hunts by light, 3 m' },
  skimmer: { name: 'Skimmer', sci: 'Pteroserra helicocrista · wingspan 4 m' },
  coilwing: { name: 'Coilwing', sci: 'Tetrapteryx volutus · four wings, 40 cm' },
  crab: { name: 'Reef crab', sci: 'Carcinella vursokensis' },
  jelly: { name: 'Bell jelly', sci: 'Campanomedusa lucens' },
  ray: { name: 'Veil ray', sci: 'Velobatis aurorae' },
  moth: { name: 'Lumen moth', sci: 'Noctiluca papilio' },
  bug: { name: 'Drift beetle', sci: 'Aerocoleus vagans' },
  falcon: { name: 'Storm falcon', sci: 'Tempestaquila rex · wingspan 60 m' },
  plankton: { name: 'Sea-glow', sci: 'Photoplankta vursokii · bioluminescent' },
  tree: { name: 'The Mother Tree', sci: 'Arbor matrix spiralis · about 900 years' },
};

/** Place labels: { place (journal dateline), name, sci (a measured detail) }. */
export const PLACES = {
  maelstrom: { place: 'VUR SOK · DAY 1 · 05:40', name: 'The Spiral Maelstrom', sci: 'a slow vortex, 1.2 km across' },
  maelstrom3: { place: 'YEAR 11 · DAY 1 · 06:05', name: 'The Spiral Maelstrom', sci: 'the same eye, eleven years on' },
  oasis: { place: 'DAY 63 · 10:00', name: 'The Oasis', sci: 'an atoll 9 km across' },
};

/** Chapter id -> its place label sci note (the dateline comes from text.js CHAPTER_DATES). */
export const CHAPTER_NOTES = {
  cradle: 'inside the atoll, 4 km from the maelstrom',
  valleys: 'an archipelago still forming',
  krill: 'an upwelling, 40 km offshore',
  forest: 'coiled islands, nesting season',
  song: 'a ring of eleven sea stacks',
  night: 'open sea, no moon',
  storm: 'gusts over 90 km/h',
  falcon: 'clear skies after the storm',
  wall: 'sea fog, two days',
  oasis: 'an atoll 9 km across',
};

/** The cameraman's voice-over. One line at a time. */
export const NARRATION = {
  // the hatching
  dawn: 'We arrived before first light. The herd was already here.',
  vortex: 'The maelstrom turns once every nine minutes. At the centre the water is flat.',
  lay: 'Just after six, the female settled in the eye. The egg came quickly.',
  macro: 'Through the shell you can see the calf, curled nose to tail. Its heart beats eighty times a minute.',
  leave: 'She has not fed in five weeks. By eight she was gone, toward the shoals.',
  guard: 'Seven males stayed. They circle the egg in turns, day and night.',
  threat: 'Day 9. A lanternjack, following the glow up from the deep.',
  driven: 'One slap of the tail, then a boom we felt through the hull. It did not come back.',
  lapse: 'Five weeks. We filmed the egg every hour.',
  crack: 'Day 38, 05:52. The first crack.',
  push: 'It is pushing now.',
  free: 'Out. Four metres long, and it has never seen light.',
  rise: 'It goes straight up. Nobody showed it how.',
  breath: 'First breath at 06:04.',
  mother: 'She was back before noon, her throat full of fish.',
  migrate: 'In two days the herd leaves the lagoon. The calf will go with them.',
  // the first migration
  lagoon: 'The calf stays within a body length of her. It will for months.',
  reach: 'Some of these islands rose in the last century. They are still warm.',
  coilwing: 'Coilwings ride the adults for days. They pick lice out of the fur.',
  shoals: 'Glintfin, a few million of them. They come up with the cold water.',
  net: 'The adults blow a ring of bubbles under the shoal. The fish will not cross it.',
  lunge: 'Then they come up through the middle, mouths open.',
  feast: 'The calf\'s first dive. It came up with nothing, and went straight back down.',
  forest: 'The trunks turn a few degrees each year, following the sun.',
  skimmer: 'Skimmers nest on these ledges. They fish the same shoals as the whales.',
  song: 'Golden hour. The herd sings for about twenty minutes. You feel it in your chest.',
  night: 'At night the sea lights up wherever something moves through it.',
  plankton: 'The glow is plankton. Every wingbeat leaves a trail.',
  storm: 'The storm belt. We lost two days of filming here.',
  storm2: 'The calf has to stay in its mother\'s lee. Out of it, the wind takes it.',
  falcon: 'For three days something had been following the herd.',
  falcon2: 'A storm falcon. They only take calves.',
  falcon3: 'The adults close in around the young. Together they are too loud to attack.',
  wall: 'Fog for two days. The calf follows her voice.',
  oasis: 'The Oasis. Herds from all over Vur Sok end the season here.',
  tree: 'The Mother Tree. The whales circle it before they rest.',
  // Year 9
  court: 'Year 9. The calf from the maelstrom is full grown.',
  court2: 'A female has answered his call three times today.',
  dance: 'Every roll she makes, he repeats. It went on past sunset.',
  // Year 11
  return: 'Year 11. They came back to the maelstrom where he hatched.',
  lay3: 'She laid at 06:20, in the eye.',
  feed3: 'She has to feed now. For the next five weeks the egg is his.',
  guard3: 'He circles it. Anything that comes close, he chases off.',
  threat3: 'Lanternjacks. They hunt by the glow.',
  above3: 'Skimmers, coming in low from the west.',
  held3: 'The egg is untouched.',
  hatch3: 'Day 36. The shell gives.',
  lift3: 'Newborns cannot reach the surface alone. He has to lift it.',
  breath3: 'First breath.',
  mate3: 'She was back by evening, full of fish.',
  teach3: 'It answers his call now. Nobody else\'s.',
  // Year 31
  elder: 'Year 31. The herd waits for him before it moves.',
  lastSong: 'Probably his last song. The others stopped to listen.',
  rest: 'He went down slowly, a few hundred metres from the herd.',
  garden: 'We came back a year later. The sea floor around him was full of life.',
  cycle: 'Year 32. In the eye of the maelstrom, another egg.',
};

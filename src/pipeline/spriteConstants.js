/**
 * spriteConstants.js — Shared constants and utilities for sprite sheet generation.
 * Extracted to break circular dependency between orchestrator and sprite-sheet route.
 */

// Hard-injected into EVERY sprite sheet frame — forces clean 2D sprite output.
export const SPRITE_POSITIVE_PREFIX =
  '2D game sprite, single character, solo character, one character only, ' +
  '(pure white background:1.4), (white background:1.4), isolated on white, ' +
  'clean cutout edges, flat shading, no scene background, not a reference sheet, ' +
  'no text, no watermark, no labels';

// Hard-appended to EVERY frame's negative — blocks the most common failures.
export const SPRITE_NEGATIVE_SUFFIX =
  ', text, words, letters, watermark, written text, printed text, text overlay, ' +
  'caption, label, annotation, title text, brand name, copyright text, ' +
  'game title, logo, corner logo, studio watermark, any writing, ' +
  'grey background, gradient background, light grey background, off-white background, ' +
  'dark grey background, studio grey, seamless grey, neutral grey, silver background, ' +
  'product photography background, studio photography backdrop, vignette, ' +
  'character reference sheet, character turnaround sheet, multiple poses in one image, ' +
  'multiple views of same character, model sheet, front back side view, ' +
  'ground plane, drop shadow, cast shadow, 3D render, CGI, blender render, ' +
  'photorealistic rendering, depth of field, bokeh, studio lighting, rim lighting, ' +
  'ambient occlusion, hud elements, interface ui, ' +
  'multiple characters, crowd, busy background, environment scene';

// Per-asset-type pose sets — injected per-frame so each frame is a distinct useful pose
export const POSE_SETS = {
  character: {
    4:  [
      'standing idle, relaxed, arms loose at sides, neutral expression',
      'walking forward, mid-stride, one leg raised, weight shifting',
      'attacking, weapon raised overhead, lunging forward, fierce expression',
      'stumbling backward from a hit, arms raised in defense, off balance',
    ],
    8:  [
      'standing idle, relaxed neutral stance, arms at sides',
      'idle, subtle weight shift, slight body sway',
      'walking briskly, one leg raised, mid-stride, arms swinging',
      'running fast, leaning forward, both feet leaving ground',
      'attack wind-up, arm drawn back, tensed and ready to strike',
      'attacking, weapon fully extended, striking forward',
      'jumping, both feet off ground, airborne',
      'hurt, stumbling backward, cringing in pain, recoiling',
    ],
    9:  [
      'idle neutral stance', 'idle relaxed, slight lean', 'idle looking back over shoulder',
      'walking forward, mid-stride', 'running forward at speed',
      'sprinting at full pace, leaning hard', 'attacking with weapon raised high',
      'jumping in air, airborne', 'hurt stumbling backward',
    ],
    16: [
      'idle 1 neutral stance', 'idle 2 breathing, slight sway', 'idle 3 glancing sideways', 'idle 4 relaxed arms crossed',
      'walking 1 mid-stride', 'walking 2 opposite leg raised', 'walking 3 arms swinging', 'walking 4 weight forward',
      'running 1 fast sprint lean', 'running 2 full speed both feet off ground',
      'attack 1 wind-up tensed', 'attack 2 full strike extension',
      'jumping rising upward', 'falling descending',
      'hurt hit reaction cringing', 'defeated collapse',
    ],
  },
  creature: {
    4:  [
      'idle alert stance, front facing, full body, natural posture',
      'prowling forward slowly, one paw raised mid-step',
      'lunging attack, mouth open, claws extended, aggressive leap',
      'recoiling from hit, defensive flinch, drawn back',
    ],
    8:  [
      'idle alert, watching', 'idle resting, sniffing ground',
      'stalking forward slowly, low body', 'trotting, mid-stride',
      'charging at full speed, body low', 'lunging attack, mouth open wide',
      'pouncing jump, airborne', 'hurt flinching back, defensive',
    ],
    9:  [
      'idle alert front facing', 'idle resting curled', 'idle looking away',
      'walking forward', 'trotting mid-stride', 'running full charge',
      'attacking aggressively', 'jumping pouncing', 'hurt recoiling',
    ],
    16: [
      'idle 1 alert watching', 'idle 2 sniffing', 'idle 3 resting', 'idle 4 shifting weight',
      'walk 1 slow step', 'walk 2 opposite paw', 'walk 3 turning', 'walk 4 approaching',
      'run 1 trotting', 'run 2 full gallop', 'attack 1 wind-up', 'attack 2 lunging strike',
      'jump rising', 'fall landing', 'hurt flinching', 'death collapsing',
    ],
  },
  item: {
    4:  ['front view centered', 'side view angled left', 'top down overhead view', 'three quarter perspective view'],
    8:  ['front view', 'back view', 'left side', 'right side', 'top view', 'bottom view', 'angle 1', 'angle 2'],
    9:  ['front', 'back', 'left', 'right', 'top', 'bottom', 'angle 1', 'angle 2', 'close up detail'],
  },
  prop: {
    4:  ['front view centered', 'side view', 'top down view', 'three quarter angled'],
    8:  ['front', 'back', 'left side', 'right side', 'top', 'bottom', 'angle 1', 'angle 2'],
  },
  building: {
    4:  ['front facade', 'side view', 'back view', 'three quarter isometric view'],
    8:  ['front day', 'front night', 'side view', 'back', 'damaged variant', 'top down', 'ruins', 'full detail close up'],
  },
  vfx: {
    4:  [
      'start frame, small spark, beginning',
      'build up frame, growing energy, expanding',
      'peak frame, full intensity, maximum brightness',
      'dissipate frame, fading out, smoke trails',
    ],
    8:  [
      'frame 1 spark ignite', 'frame 2 grow', 'frame 3 expand',
      'frame 4 peak bright', 'frame 5 fade start',
      'frame 6 smoke', 'frame 7 dissipate', 'frame 8 gone',
    ],
  },
  particle: {
    4:  ['start frame small', 'expanding mid frame', 'peak intensity', 'end dissolving'],
    8:  ['frame 1', 'frame 2', 'frame 3', 'frame 4', 'frame 5', 'frame 6', 'frame 7', 'frame 8'],
  },
  texture: {
    4:  ['seamless tile section 1', 'seamless tile section 2', 'seamless tile variation', 'edge transition'],
  },
  icon: {
    4:  ['normal state', 'hover highlighted state', 'pressed active state', 'disabled greyed state'],
    8:  ['icon 1', 'icon 2', 'icon 3', 'icon 4', 'icon 5', 'icon 6', 'icon 7', 'icon 8'],
  },
};

// Returns an array of pose suffix strings, one per frame
export function getPoseSuffixes(assetType, frameCount) {
  const typeSet = POSE_SETS[assetType];
  if (!typeSet) {
    return Array.from({ length: frameCount }, (_, i) => `variation ${i + 1}, unique pose`);
  }
  const available = Object.keys(typeSet).map(Number).sort((a, b) => a - b);
  const closest = available.reduce((prev, curr) =>
    Math.abs(curr - frameCount) < Math.abs(prev - frameCount) ? curr : prev
  );
  const poses = typeSet[closest];
  return Array.from({ length: frameCount }, (_, i) => poses[i % poses.length]);
}

/**
 * buildNegative(assetType) — Builds a tailored negative prompt for a specific asset type.
 * Blocks common failure modes and identity confusion for that category.
 */
export function buildNegative(assetType) {
  const base =
    'blurry, low quality, jpeg artifacts, watermark, text, logo, ' +
    'signature, border, frame, vignette, dark background, gradient background';

  const weaponTypes = [
    'sword', 'greatsword', 'dagger', 'axe', 'greataxe',
    'hammer', 'greathammer', 'mace', 'spear', 'staff',
    'wand', 'bow', 'shield'
  ];

  const weaponBase = 'person holding, hand, arm, character, ' +
                     'broken, floating parts, multiple weapons';

  const typeNegatives = {
    // ── WEAPONS ────────────────────────────────────────────────────────
    sword:       'grip visible, blood, gore, broken blade, rust stains, weapon rack, scabbard attached',
    greatsword:  'bent blade, small sword, dagger size',
    dagger:      'sword size, too large, multiple daggers',
    axe:         'broken head, floating blade, multiple axes, sword shape, incorrect handle',
    greataxe:    'small axe, hatchet size',
    hammer:      'broken handle, floating head, nail hammer, tool hammer',
    greathammer: 'small size, tool size',
    mace:        'floating spikes, hammer shape',
    spear:       'broken shaft, floating tip, arrow shape, too short',
    staff:       'floating orb, walking stick, cane, multiple staves',
    wand:        'too large, staff size, multiple wands',
    bow:         'arrow nocked, crossbow shape, multiple bows',
    shield:      'arm strap visible, shattered, multiple shields, sword attached',

    // ── CHARACTERS ─────────────────────────────────────────────────────
    character:   'multiple characters, crowd, clone, duplicate, ' +
                 'bad anatomy, extra limbs, missing limbs, fused fingers, ' +
                 'deformed hands, floating limbs, disconnected body parts, ' +
                 'wrong proportions, giant head, tiny head, ' +
                 'weapon floating, item floating separately',
    warrior:     'multiple characters, bad anatomy, extra limbs, fused fingers, ' +
                 'floating weapon, armor clipping badly, missing shield arm',
    mage:        'multiple characters, bad anatomy, extra limbs, ' +
                 'floating staff, disconnected orb, missing hands',
    orc:         'multiple characters, bad anatomy, extra limbs, ' +
                 'human face, elf ears, too pretty, civilized appearance',
    elf:         'multiple characters, bad anatomy, extra limbs, ' +
                 'round ears, orc face, ugly features, deformed ears',
    dwarf:       'multiple characters, bad anatomy, extra limbs, ' +
                 'tall proportions, normal height, no beard if male',
    goblin:      'multiple characters, bad anatomy, extra limbs, ' +
                 'large size, human face, attractive features',
    skeleton:    'multiple characters, flesh visible, skin, muscle, ' +
                 'living appearance, extra bones, floating bones',
    ghost:       'multiple characters, solid form, physical body, ' +
                 'flesh, skeleton visible, opaque',

    // ── CREATURES ──────────────────────────────────────────────────────
    creature:    'multiple creatures, duplicate, humanoid body, ' +
                 'bad anatomy, extra limbs, fused legs, floating limbs, ' +
                 'human face, character riding, person nearby',
    dragon:      'multiple dragons, humanoid features, small size, ' +
                 'lizard size, missing wings, floating scales, ' +
                 'person riding, character nearby',
    wolf:        'multiple wolves, humanoid, werewolf unless specified, ' +
                 'floating fur, domestic dog appearance, tiny size',
    golem:       'multiple golems, organic texture, flesh, skin, ' +
                 'humanoid face, floating rocks, broken apart',

    // ── PROPS/FURNITURE ────────────────────────────────────────────────
    chest:       'open chest showing contents, person nearby, character, ' +
                 'floating lock, broken hinge, multiple chests, ' +
                 'interior scene, dungeon background',
    barrel:      'person nearby, character, broken staves, floating hoop, ' +
                 'multiple barrels, liquid spilling, interior',
    door:        'person nearby, character, open door showing room, ' +
                 'floating handle, broken frame, multiple doors, ' +
                 'door frame cut off',
    throne:      'person sitting, character, floating armrest, ' +
                 'broken, multiple thrones, room background',

    // ── ENVIRONMENT ────────────────────────────────────────────────────
    tree:        'person nearby, character, floating leaves, ' +
                 'cut off top, roots cut off, multiple trees, ' +
                 'forest background, ground plane',
    rock:        'person nearby, character, floating chunks, ' +
                 'ground attached, multiple rocks merged, ' +
                 'landscape background',
    building:    'person nearby, character, floating walls, ' +
                 'interior visible, cut off, multiple buildings, ' +
                 'street scene background',

    // ── VFX ────────────────────────────────────────────────────────────
    vfx:         'solid object, hard edges, physical weapon, character, person, ' +
                 'static image, no motion, single color, flat shape, ' +
                 'item, prop, background scene',
    fire:        'solid flame, candle only, static fire, character, person, ' +
                 'smoke only, no glow, flat orange shape',
    ice:         'solid block only, no crystal, character, person, ' +
                 'water puddle, melting puddle, flat blue shape',
    lightning:   'solid line only, character, person, static bolt, ' +
                 'no glow, no energy, flat yellow line',
    explosion:   'character, person, solid object, no smoke, ' +
                 'flat circle, single color, no particles',
    magic_aura:  'character, person, solid ring, flat circle, ' +
                 'no glow, no energy, opaque background',

    // ── PARTICLES ──────────────────────────────────────────────────────
    particle:    'solid object, character, person, weapon, item, ' +
                 'hard edges, opaque background, single large shape, ' +
                 'no transparency, static',

    // ── UI / ICONS ─────────────────────────────────────────────────────
    icon:        'person holding item, character, scene background, ' +
                 'multiple items, perspective view, 3D render, ' +
                 'photorealistic, drop shadow, outer glow, ui frame, ' +
                 'button border, hud element, number overlay, ' +
                 'text label, quantity number',
    icon_skill:  'character casting, person, scene, background, ' +
                 'multiple elements, photorealistic, 3D render, ' +
                 'text overlay, number, cooldown indicator',

    // ── TILESET / TEXTURE ───────────────────────────────────────────────
    tileset:     'character, person, creature, item floating, ' +
                 'non-repeating, perspective view, 3D render, ' +
                 'photorealistic, visible seams, mismatched edges',
    texture:     'character, person, creature, weapon, item, ' +
                 'non-tileable, visible seams, perspective distortion, ' +
                 '3D object, photorealistic render',

    // ── PORTRAITS ──────────────────────────────────────────────────────
    portrait:    'full body visible, multiple characters, crowd, ' +
                 'body below shoulders, floating head, disembodied, ' +
                 'bad anatomy, deformed face, extra eyes, fused features, ' +
                 'background figures, scene behind character',

    // ── NEW ENTRIES ────────────────────────────────────────────────────
    ring:        'person wearing, hand, finger, multiple rings, ' +
                 'broken band, floating gem, necklace shape, bracelet shape, ' +
                 'ring box, jewelry store background',

    armor:       'person wearing, character inside, floating pieces, ' +
                 'disconnected plates, broken, multiple armor sets, ' +
                 'weapon attached, shield attached, mannequin visible',

    vehicle:     'person inside, character driving, floating wheels, ' +
                 'disconnected parts, multiple vehicles, ' +
                 'road background, environment scene',

    environment: 'character, person, creature, floating elements, ' +
                 'cut off edges, interior room, single object only, ' +
                 'plain background, white background',

    skybox:      'character, person, creature, weapon, item, ' +
                 'ground visible, horizon cut off, interior, ' +
                 'single object, white background, plain background',

    ui_element:  'character, person, 3D render, photorealistic, ' +
                 'physical object, weapon, item in scene, ' +
                 'text label, number overlay, multiple elements merged',

    prop:        'character holding, person nearby, floating parts, ' +
                 'broken, multiple props, interior scene background, ' +
                 'hand visible, arm visible',

    furniture:   'person sitting, character nearby, floating parts, ' +
                 'broken, multiple pieces, room background visible, ' +
                 'interior scene, people around it',

    concept_art: '', // intentionally empty — freeform, no restrictions
  };

  const typeSpecific = typeNegatives[assetType] ||
    'multiple subjects, duplicate, bad anatomy, floating parts, ' +
    'character nearby, person, background scene';

  if (weaponTypes.includes(assetType)) {
    return `${base}, ${weaponBase}, ${typeSpecific}${SPRITE_NEGATIVE_SUFFIX}`;
  }

  return `${base}, ${typeSpecific}${SPRITE_NEGATIVE_SUFFIX}`;
}

/**
 * buildStyleNegative(artStyle) — Builds a tailored negative prompt for a specific art style.
 * Enforces stylistic constraints by blocking competing aesthetic features.
 */
export function buildStyleNegative(artStyle) {
  const styleNegatives = {
    pixel:        'smooth gradients, anti-aliased edges, high resolution, ' +
                  'photorealistic, 3D render, blurry, soft shading, ' +
                  'too many colors, dithering artifacts if unwanted',

    anime:        'photorealistic, 3D render, western cartoon, ' +
                  'realistic proportions, painterly texture, ' +
                  'pixel art, low poly',

    lowpoly:      'smooth surfaces, high poly, photorealistic, ' +
                  'curved edges, organic smooth shapes, ' +
                  'texture detail, fine detail, subsurface scattering',

    painted:      'photorealistic, 3D render, pixel art, ' +
                  'clean vector lines, smooth digital gradient, ' +
                  'cel shading, anime style',

    isometric:    'perspective view, front view, side view only, ' +
                  'top down flat, first person, ' +
                  'non-45-degree angle, flat 2D',

    chibi:        'realistic proportions, tall character, ' +
                  'adult proportions, serious expression, ' +
                  'photorealistic, 3D render',

    watercolor:   'photorealistic, 3D render, sharp edges, ' +
                  'clean lines, pixel art, cel shading, ' +
                  'digital smooth gradient',

    darkfantasy:  'bright colors, cheerful, cute, chibi, ' +
                  'pastel colors, cartoon, anime, low poly',

    ink:         'color, full color, photorealistic, 3D render, ' +
                 'painted, watercolor, pixel art',

    // Broad styles with no specific restrictions
    stylized:    '',
    realistic:   '',
    scifi:       '',
    cartoon:     '',
    painterly:   '',
  };

  return styleNegatives[artStyle] || '';
}

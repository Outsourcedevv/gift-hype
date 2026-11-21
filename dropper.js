// The Dropper: a 100-level dropper that Unbound builds in its own world ("Gift Hype Dropper", the name of its folder).
//
// Each level is a shaft in the sky. You stand on a ledge at the top, step off, and steer through
// layers of obstacles as you fall. Land in the water at the bottom and you're teleported straight
// to the next level; hit anything else and the fall kills you and you respawn at the top of the
// same level. Every level is designed here from a seed, so the world always comes out the same.
//
// The levels get harder slowly: smaller holes, more layers, decoy holes that lead nowhere, holes
// further apart, smaller pools at the bottom and taller shafts. Every hole that's needed is
// checked against how far you can really steer while falling (Minecraft's own fall and air
// movement maths), with time to react and never more than about 60% of the steering you could
// do, so every level can be beaten without pixel-perfect moves.
//
// Touching anything but the water sends you back to the top of the level (no fall damage), so the
// first obstacles can be right under the ledge.
//
// The game itself (levels, landing in water, jail, the reset countdown, punches) runs from a
// data pack in the world, so it works the same however the world is opened. Unbound sends the
// gift actions as function calls.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVES_DIR } from './singleplayer.js';
import { knockFiles, knockCommand, MAX_PUNCHES_PER_GIFT } from './knock.js';

// "2": the levels got twice as tall, so the world needs a taller sky than an existing world can be
// given. The first Dropper world ("Gift Hype Dropper") is left as it was.
// "3": the levels start higher and higher (y=600 at level 1 up to y=1200 at level 100), so the world
// needs an even taller sky than "Gift Hype Dropper 2" has. The older Dropper worlds are left as they were.
// "4": the levels got wider and the falls about twice as long, so they reach far below y=0; the
// world goes down to y=-512. The older Dropper worlds are left as they were.
export const DROPPER_WORLD = 'Gift Hype Dropper 4';
// the Minecraft version the Dropper's pack is written for (its commands, text and taller sky)
export const DROPPER_MC = '26.2';
export const DROPPER_BUILD = 14;                 // bump when the levels change, to rebuild them
export const LEVELS = 100;
// Level 101, the secret one: you only get there by beating level 100, gifts can't send you there, and
// you have to beat it first try (touch anything and you're back on level 100).
export const SECRET = LEVELS + 1;
// The Dropper world's sky goes up to y=1279 (normal worlds stop at 319), set by the pack when the
// world is made, so the falls can be about 700 blocks.
const WORLD_MIN = -512, WORLD_HEIGHT = 2048;    // y=-512 to y=1535
// your feet on the start bridge: level 1 at y=600, a little higher every level, level 100 at y=1200
const TOP_FIRST = 600, TOP_LAST = 1200;
export const topOf = n => n > LEVELS ? 1500 : Math.round(TOP_FIRST + (TOP_LAST - TOP_FIRST) * (n - 1) / (LEVELS - 1));       // the secret level starts at y=1500
const ORIGIN = 3000, SPACING = 160;              // level 1 at x=3000 z=3000, 10 levels per row (room for the widest shafts)
const JAIL = [900, TOP_LAST, 900];
const WIN = [880, TOP_LAST, 1000];

// Settings for making the world the first time: a void world (nothing but the levels), no mobs.
export const DROPPER_PROPS = [
    'level-type=minecraft\\:flat',
    'generator-settings={"layers":[{"block":"minecraft:air","height":1}],"biome":"minecraft:the_void"}',
    'generate-structures=false', 'difficulty=peaceful', 'gamemode=adventure', 'allow-flight=true',
];

// ---------- maths of falling and steering (vanilla Minecraft, per game tick) ----------
// Falling: move by your speed, then speed = (speed - 0.08) * 0.98.
const DEPTH = (() => { const d = [0]; let v = 0, y = 0; for (let t = 1; t < 600; t++) { y += v; v = (v - 0.08) * 0.98; d.push(-y); } return d; })();
const tickAt = depth => { let t = 0; while (t < DEPTH.length - 1 && DEPTH[t] < depth) t++; return t; };
// Steering in the air from a standstill: speed = speed * 0.91 + 0.02 each tick.
const REACH = (() => { const r = [0]; let s = 0, d = 0; for (let t = 1; t < 600; t++) { s = s * 0.91 + 0.02; d += s; r.push(d); } return r; })();

// ---------- small helpers ----------
function rngFor(seed) {
    let a = seed >>> 0;
    return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const mod = (a, n) => ((a % n) + n) % n;
const key = (x, z) => `${x},${z}`;
const center = r => [r.x + (r.s - 1) / 2, r.z + (r.s - 1) / 2];
// how far you need to move to get from region a into region b (both s x s squares)
// Where your middle can be to drop through a hole without touching its sides: you're 0.6 wide, and
// MARGIN more is kept spare on every side so you don't have to be pixel perfect.
let MARGIN = 0.3;
const span = (start, size) => { const lo = start + 0.3 + MARGIN, hi = start + size - 0.3 - MARGIN; return lo <= hi ? [lo, hi] : [start + size / 2, start + size / 2]; };
const axisGap = ([a1, a2], [b1, b2]) => Math.max(0, b1 - a2, a1 - b2);
// how far you need to move to get from fitting through hole a to fitting through hole b
const gapBetween = (a, b) => Math.hypot(axisGap(span(a.x, a.s), span(b.x, b.s)), axisGap(span(a.z, a.s), span(b.z, b.s)));

// ---------- themes ----------
// Every level is a place: its walls, layers, floor and railings all belong to one theme.
//   colours: wall (inside face), back (outer wall), stripe / panel (wall details), plate / plate2 (the
//   layers), accent, light (glowing), trim, rim (round the spots), glass (windows up top), bridge /
//   edge (the bridge you start on), fence (its railings), colors (extra colours: sprinkles, stars,
//   confetti, rainbow), cp (the three colours of the centrepieces: a outer, b inner, c core)
//   walls: the wall pattern, layers: the patterns the layers are tiled in, centers: the big shape round
//   each spot, floor: the landing floor, city: a city of blocks round the pool instead.
const theme = (name, title, o) => ({ name, title, back: o.wall, glass: 'white_stained_glass', bridge: o.accent, edge: o.trim, fence: 'oak_fence', colors: [o.accent, o.light], cp: { a: o.accent, b: o.plate2, c: o.light }, city: false, ...o });
const RAINBOW = ['red_concrete', 'orange_concrete', 'yellow_concrete', 'lime_concrete', 'cyan_concrete', 'blue_concrete', 'purple_concrete'];
const SPRINKLES = ['red_concrete', 'yellow_concrete', 'lime_concrete', 'light_blue_concrete', 'white_concrete', 'magenta_concrete'];
const THEMES = Object.fromEntries([
    theme('meadow', 'Flower Meadow', { wall: 'moss_block', stripe: 'green_concrete', panel: 'moss_block', plate: 'lime_concrete', plate2: 'green_concrete', accent: 'yellow_concrete', light: 'ochre_froglight', trim: 'white_concrete', rim: 'yellow_concrete', glass: 'lime_stained_glass', bridge: 'oak_planks', edge: 'stripped_oak_log', fence: 'oak_fence',
        colors: ['pink_concrete', 'white_concrete', 'yellow_concrete', 'light_blue_concrete', 'magenta_concrete'], cp: { a: 'pink_concrete', b: 'white_concrete', c: 'yellow_concrete' },
        walls: { type: 'blobs', blocks: ['oak_leaves[persistent=true]', 'flowering_azalea_leaves[persistent=true]', 'azalea_leaves[persistent=true]'], dots: ['pink_concrete', 'yellow_concrete', 'white_concrete'] },
        layers: ['checker', 'rings'], centers: ['flower', 'sun', 'flower'], floor: { type: 'checker', a: 'lime_concrete', b: 'green_concrete', size: 3 },
        names: ['Petal Drop', 'Buttercup Fall', 'Daisy Dive', 'Bloom Shaft', 'Pollen Path', 'Tulip Tumble'] }),
    theme('candy', 'Candy Land', { wall: 'white_concrete', stripe: 'red_concrete', panel: 'pink_concrete', plate: 'pink_concrete', plate2: 'white_concrete', accent: 'red_concrete', light: 'pearlescent_froglight', trim: 'magenta_concrete', rim: 'red_concrete', glass: 'pink_stained_glass', bridge: 'pink_concrete', edge: 'white_concrete', fence: 'cherry_fence',
        colors: SPRINKLES, cp: { a: 'light_blue_concrete', b: 'brown_terracotta', c: 'white_concrete' },
        walls: { type: 'helix', colors: ['red_concrete', 'white_concrete'], band: 3 },
        layers: ['checker', 'stripes'], centers: ['donut', 'vortex', 'bullseye'], floor: { type: 'checker', a: 'pink_concrete', b: 'white_concrete', size: 3 },
        names: ['Sprinkle Drop', 'Lollipop Swirl', 'Gumdrop Gorge', 'Frosting Fall', 'Sugar Rush', 'Candy Cane Chute'] }),
    theme('picnic', 'Picnic Party', { wall: 'white_concrete', stripe: 'red_concrete', panel: 'red_concrete', plate: 'white_concrete', plate2: 'red_concrete', accent: 'yellow_concrete', light: 'ochre_froglight', trim: 'spruce_planks', rim: 'spruce_planks', glass: 'red_stained_glass', bridge: 'spruce_planks', edge: 'stripped_spruce_log', fence: 'spruce_fence',
        cp: { a: 'yellow_concrete', b: 'orange_concrete', c: 'ochre_froglight' },
        walls: { type: 'checker', a: 'red_concrete', b: 'white_concrete', size: 5 },
        layers: ['diag', 'checker'], centers: ['pizza', 'sun', 'pizza'], floor: { type: 'diag', a: 'red_concrete', b: 'white_concrete', size: 3 },
        names: ['Pizza Party', 'Cheese Wheel', 'Tablecloth Tumble', 'Lemonade Leap', 'Sandwich Stack', 'Basket Drop'] }),
    theme('desert', 'Desert Tomb', { wall: 'smooth_sandstone', stripe: 'green_concrete', panel: 'cut_sandstone', plate: 'sandstone', plate2: 'cut_sandstone', accent: 'green_concrete', light: 'ochre_froglight', trim: 'chiseled_sandstone', rim: 'lime_concrete', glass: 'lime_stained_glass', bridge: 'cut_sandstone', edge: 'green_concrete', fence: 'birch_fence',
        cp: { a: 'orange_terracotta', b: 'gold_block', c: 'ochre_froglight' },
        walls: { type: 'stripes' },
        layers: ['tiles', 'mosaic'], centers: ['sun', 'gem', 'nested'], floor: { type: 'checker', a: 'smooth_sandstone', b: 'orange_terracotta', size: 4 },
        names: ['Pharaoh Drop', 'Scarab Shaft', 'Sunstone Well', 'Dune Plunge', 'Oasis Fall', 'Golden Sands'] }),
    theme('ocean', 'Coral Reef', { wall: 'prismarine_bricks', stripe: 'dark_prismarine', panel: 'prismarine', plate: 'prismarine', plate2: 'prismarine_bricks', accent: 'cyan_concrete', light: 'sea_lantern', trim: 'smooth_quartz', rim: 'cyan_concrete', glass: 'cyan_stained_glass', bridge: 'dark_prismarine', edge: 'prismarine_bricks', fence: 'warped_fence',
        colors: ['pink_concrete', 'yellow_concrete', 'magenta_concrete', 'orange_concrete', 'light_blue_concrete'], cp: { a: 'pink_concrete', b: 'magenta_concrete', c: 'sea_lantern' },
        walls: { type: 'blobs', blocks: ['dark_prismarine', 'prismarine'], dots: ['pink_concrete', 'yellow_concrete', 'magenta_concrete', 'sea_lantern'] },
        layers: ['rings', 'studs'], centers: ['flower', 'bullseye', 'vortex'], floor: { type: 'checker', a: 'smooth_sandstone', b: 'cyan_concrete', size: 3 },
        names: ['Coral Drop', 'Tide Pool', 'Starfish Fall', 'Reef Plunge', 'Pearl Dive', 'Kelp Chute'] }),
    theme('sky', 'Sky Temple', { wall: 'smooth_quartz', stripe: 'light_blue_concrete', panel: 'light_blue_stained_glass', plate: 'white_concrete', plate2: 'light_blue_concrete', accent: 'blue_concrete', light: 'sea_lantern', trim: 'quartz_block', rim: 'light_blue_concrete', glass: 'light_blue_stained_glass', bridge: 'light_blue_concrete', edge: 'white_concrete', fence: 'birch_fence',
        cp: { a: 'light_blue_concrete', b: 'white_concrete', c: 'sea_lantern' },
        walls: { type: 'grid', a: 'smooth_quartz', line: 'light_blue_concrete', size: 6 },
        layers: ['mosaic', 'tiles'], centers: ['ringlights', 'gem', 'bullseye'], floor: { type: 'checker', a: 'white_concrete', b: 'light_blue_concrete', size: 4 },
        names: ['Cloud Drop', 'Halo Fall', 'Heaven Gate', 'Skylight', 'Angel Steps', 'Bluebird'] }),
    theme('jungle', 'Jungle Temple', { wall: 'mossy_stone_bricks', stripe: 'stone_bricks', panel: 'moss_block', plate: 'mossy_stone_bricks', plate2: 'moss_block', accent: 'gold_block', light: 'verdant_froglight', trim: 'chiseled_stone_bricks', rim: 'gold_block', glass: 'lime_stained_glass', bridge: 'jungle_planks', edge: 'stripped_jungle_log', fence: 'jungle_fence',
        cp: { a: 'gold_block', b: 'emerald_block', c: 'verdant_froglight' },
        walls: { type: 'blobs', blocks: ['jungle_leaves[persistent=true]', 'moss_block', 'mossy_cobblestone'], dots: ['verdant_froglight'] },
        layers: ['tiles', 'studs'], centers: ['nested', 'sun', 'gem'], floor: { type: 'checker', a: 'mossy_stone_bricks', b: 'moss_block', size: 4 },
        names: ['Temple Drop', 'Idol Shaft', 'Vine Fall', 'Lost Ruins', 'Golden Idol', 'Canopy Plunge'] }),
    theme('mushroom', 'Mushroom Grove', { wall: 'mushroom_stem', stripe: 'red_mushroom_block', panel: 'brown_mushroom_block', plate: 'red_concrete', plate2: 'white_concrete', accent: 'red_mushroom_block', light: 'shroomlight', trim: 'brown_concrete', rim: 'white_concrete', glass: 'red_stained_glass', bridge: 'brown_mushroom_block', edge: 'mushroom_stem', fence: 'dark_oak_fence',
        cp: { a: 'red_concrete', b: 'white_concrete', c: 'shroomlight' },
        walls: { type: 'blobs', blocks: ['red_mushroom_block', 'brown_mushroom_block'], dots: ['shroomlight'] },
        layers: ['checker', 'rings'], centers: ['mushroom', 'flower', 'mushroom'], floor: { type: 'checker', a: 'brown_concrete', b: 'white_concrete', size: 3 },
        names: ['Toadstool Drop', 'Spore Fall', 'Cap Plunge', 'Fairy Ring', 'Morel Shaft', 'Fungus Fall'] }),
    theme('honey', 'Bee Hive', { wall: 'honeycomb_block', stripe: 'orange_concrete', panel: 'yellow_concrete', plate: 'yellow_concrete', plate2: 'honeycomb_block', accent: 'orange_concrete', light: 'ochre_froglight', trim: 'brown_terracotta', rim: 'orange_concrete', glass: 'yellow_stained_glass', bridge: 'orange_concrete', edge: 'yellow_concrete', fence: 'bamboo_fence',
        cp: { a: 'yellow_concrete', b: 'black_concrete', c: 'ochre_froglight' },
        walls: { type: 'checker', a: 'honeycomb_block', b: 'brown_terracotta', size: 4 },
        layers: ['checker', 'studs'], centers: ['flower', 'sun', 'gear'], floor: { type: 'checker', a: 'yellow_concrete', b: 'orange_concrete', size: 3 },
        names: ['Hive Drop', 'Honey Pot', 'Buzz Fall', 'Wax Works', 'Queen Bee', 'Nectar Plunge'] }),
    theme('ice', 'Ice Spikes', { wall: 'black_concrete', stripe: 'light_blue_concrete', panel: 'packed_ice', plate: 'snow_block', plate2: 'packed_ice', accent: 'light_blue_concrete', light: 'sea_lantern', trim: 'white_concrete', rim: 'blue_ice', glass: 'light_blue_stained_glass', bridge: 'blue_ice', edge: 'snow_block', fence: 'spruce_fence',
        cp: { a: 'white_concrete', b: 'light_blue_concrete', c: 'sea_lantern' },
        walls: { type: 'streaks', blocks: ['light_blue_concrete', 'packed_ice', 'white_concrete'], density: 55 },
        layers: ['checker', 'rings'], centers: ['snowflake', 'gem', 'ringlights'], floor: { type: 'checker', a: 'snow_block', b: 'packed_ice', size: 4 },
        names: ['Snow Drift', 'Frost Fall', 'Icicle Shaft', 'Glacier Drop', 'Blizzard', 'Polar Plunge'] }),
    theme('holiday', 'Winter Gifts', { wall: 'white_concrete', stripe: 'red_concrete', panel: 'green_concrete', plate: 'red_concrete', plate2: 'white_concrete', accent: 'green_concrete', light: 'ochre_froglight', trim: 'gold_block', rim: 'gold_block', glass: 'red_stained_glass', bridge: 'red_concrete', edge: 'white_concrete', fence: 'spruce_fence',
        colors: ['red_concrete', 'green_concrete', 'gold_block', 'white_concrete', 'light_blue_concrete'], cp: { a: 'gold_block', b: 'red_concrete', c: 'ochre_froglight' },
        walls: { type: 'helix', colors: ['red_concrete', 'white_concrete', 'green_concrete', 'white_concrete'], band: 3 },
        layers: ['confetti', 'checker'], centers: ['star', 'snowflake', 'bullseye'], floor: { type: 'checker', a: 'red_concrete', b: 'white_concrete', size: 3 },
        names: ['Candy Cane', 'Gift Drop', 'Star Topper', 'Sleigh Ride', 'Snow Globe', 'Stocking Stuffer'] }),
    theme('crystal', 'Crystal Cave', { wall: 'smooth_basalt', stripe: 'amethyst_block', panel: 'calcite', plate: 'purple_concrete', plate2: 'amethyst_block', accent: 'calcite', light: 'pearlescent_froglight', trim: 'calcite', rim: 'purple_concrete', glass: 'purple_stained_glass', bridge: 'amethyst_block', edge: 'calcite', fence: 'mangrove_fence',
        cp: { a: 'amethyst_block', b: 'purple_concrete', c: 'pearlescent_froglight' },
        walls: { type: 'streaks', blocks: ['amethyst_block', 'purple_concrete', 'calcite'], density: 45 },
        layers: ['studs', 'mosaic'], centers: ['gem', 'star', 'ringlights'], floor: { type: 'checker', a: 'purple_concrete', b: 'calcite', size: 3 },
        names: ['Geode', 'Amethyst Drop', 'Crystal Heart', 'Prism Fall', 'Shard Shaft', 'Gem Mine'] }),
    theme('copper', 'Copper Works', { wall: 'waxed_cut_copper', stripe: 'waxed_oxidized_cut_copper', panel: 'waxed_copper_block', plate: 'waxed_copper_block', plate2: 'waxed_cut_copper', accent: 'waxed_oxidized_copper', light: 'waxed_copper_bulb[lit=true]', trim: 'waxed_chiseled_copper', rim: 'waxed_oxidized_cut_copper', glass: 'orange_stained_glass', bridge: 'waxed_oxidized_copper', edge: 'waxed_cut_copper', fence: 'iron_bars',
        cp: { a: 'waxed_oxidized_copper', b: 'waxed_copper_block', c: 'waxed_copper_bulb[lit=true]' },
        walls: { type: 'stripes' },
        layers: ['beams', 'tiles'], centers: ['gear', 'nested', 'gear'], floor: { type: 'checker', a: 'waxed_copper_block', b: 'waxed_oxidized_copper', size: 4 },
        names: ['Cog Drop', 'Gearbox', 'Boiler Room', 'Pipe Dream', 'Rivet Row', 'Flywheel'] }),
    theme('lava', 'Lava Forge', { wall: 'blackstone', stripe: 'orange_concrete', panel: 'magma_block', plate: 'black_concrete', plate2: 'orange_concrete', accent: 'orange_concrete', light: 'shroomlight', trim: 'polished_blackstone_bricks', rim: 'shroomlight', glass: 'orange_stained_glass', bridge: 'polished_blackstone', edge: 'orange_concrete', fence: 'nether_brick_fence',
        cp: { a: 'orange_concrete', b: 'yellow_concrete', c: 'shroomlight' },
        walls: { type: 'blobs', blocks: ['magma_block', 'shroomlight', 'orange_concrete'], dots: ['yellow_concrete'] },
        layers: ['checker', 'beams'], centers: ['star', 'sun', 'vortex'], floor: { type: 'checker', a: 'black_concrete', b: 'orange_concrete', size: 3 },
        names: ['Magma Drop', 'Forge Fall', 'Ember Shaft', 'Molten Core', 'Ash Plunge', 'Furnace'] }),
    theme('nether', 'Nether Fortress', { wall: 'nether_bricks', stripe: 'red_nether_bricks', panel: 'red_nether_bricks', plate: 'red_nether_bricks', plate2: 'nether_bricks', accent: 'gold_block', light: 'shroomlight', trim: 'polished_blackstone', rim: 'gold_block', glass: 'red_stained_glass', bridge: 'red_nether_bricks', edge: 'nether_bricks', fence: 'nether_brick_fence',
        cp: { a: 'red_concrete', b: 'white_concrete', c: 'shroomlight' },
        walls: { type: 'stripes' },
        layers: ['tiles', 'beams'], centers: ['target', 'star', 'bullseye'], floor: { type: 'checker', a: 'red_nether_bricks', b: 'black_concrete', size: 3 },
        names: ['Fortress Drop', 'Wither Gate', 'Blaze Shaft', 'Soul Fall', 'Bastion', 'Crimson Root'] }),
    theme('haunted', 'Haunted House', { wall: 'black_concrete', stripe: 'orange_concrete', panel: 'purple_concrete', plate: 'orange_concrete', plate2: 'purple_concrete', accent: 'black_concrete', light: 'ochre_froglight', trim: 'dark_oak_planks', rim: 'black_concrete', glass: 'purple_stained_glass', bridge: 'dark_oak_planks', edge: 'stripped_dark_oak_log', fence: 'dark_oak_fence',
        cp: { a: 'orange_concrete', b: 'black_concrete', c: 'ochre_froglight' },
        walls: { type: 'helix', colors: ['orange_concrete', 'black_concrete', 'purple_concrete', 'black_concrete'], band: 3 },
        layers: ['checker', 'diag'], centers: ['pumpkin', 'vortex', 'bullseye'], floor: { type: 'checker', a: 'orange_concrete', b: 'purple_concrete', size: 3 },
        names: ['Haunted Drop', 'Pumpkin Patch', 'Ghost Fall', 'Spooky Shaft', 'Witching Hour', 'Graveyard Plunge'] }),
    theme('nightcity', 'Night City', { wall: 'black_concrete', stripe: 'gray_concrete', panel: 'black_concrete', plate: 'gray_concrete', plate2: 'black_concrete', accent: 'yellow_concrete', light: 'ochre_froglight', trim: 'light_gray_concrete', rim: 'red_concrete', glass: 'yellow_stained_glass', bridge: 'black_concrete', edge: 'yellow_concrete', fence: 'iron_bars',
        cp: { a: 'red_concrete', b: 'white_concrete', c: 'sea_lantern' },
        walls: { type: 'windows', lit: ['ochre_froglight', 'yellow_stained_glass', 'sea_lantern'] },
        layers: ['roads', 'studs'], centers: ['bullseye', 'ringlights', 'bullseye'], city: true,
        names: ['Rooftop Drop', 'Highway', 'Skyscraper', 'Neon Alley', 'Downtown', 'Overpass'] }),
    theme('cyber', 'Neon Grid', { wall: 'black_concrete', stripe: 'cyan_concrete', panel: 'gray_concrete', plate: 'black_concrete', plate2: 'gray_concrete', accent: 'cyan_concrete', light: 'sea_lantern', trim: 'cyan_concrete', rim: 'magenta_concrete', glass: 'cyan_stained_glass', bridge: 'cyan_concrete', edge: 'black_concrete', fence: 'iron_bars',
        colors: ['cyan_concrete', 'magenta_concrete', 'lime_concrete', 'light_blue_concrete', 'sea_lantern'], cp: { a: 'cyan_concrete', b: 'magenta_concrete', c: 'sea_lantern' },
        walls: { type: 'grid', a: 'black_concrete', line: 'cyan_concrete', size: 7 },
        layers: ['dance', 'tiles'], centers: ['nested', 'ringlights', 'gem'], floor: { type: 'dance' },
        names: ['Circuit', 'Data Stream', 'Pixel Drop', 'Firewall', 'Mainframe', 'Glitch'] }),
    theme('club', 'Nightclub', { wall: 'black_concrete', stripe: 'purple_concrete', panel: 'gray_concrete', plate: 'black_concrete', plate2: 'purple_concrete', accent: 'magenta_concrete', light: 'pearlescent_froglight', trim: 'purple_concrete', rim: 'yellow_concrete', glass: 'magenta_stained_glass', bridge: 'purple_concrete', edge: 'black_concrete', fence: 'iron_bars',
        colors: ['magenta_concrete', 'cyan_concrete', 'yellow_concrete', 'lime_concrete', 'purple_concrete', 'pearlescent_froglight'], cp: { a: 'yellow_concrete', b: 'orange_concrete', c: 'ochre_froglight' },
        walls: { type: 'speakers' },
        layers: ['dance', 'beams'], centers: ['star', 'vortex', 'ringlights'], floor: { type: 'dance' },
        names: ['Dance Floor', 'Bass Drop', 'Disco Fall', 'Strobe', 'Encore', 'Afterparty'] }),
    theme('space', 'Outer Space', { wall: 'black_concrete', stripe: 'purple_concrete', panel: 'black_concrete', plate: 'black_concrete', plate2: 'purple_concrete', accent: 'blue_concrete', light: 'sea_lantern', trim: 'gray_concrete', rim: 'white_concrete', glass: 'purple_stained_glass', bridge: 'gray_concrete', edge: 'white_concrete', fence: 'iron_bars',
        colors: ['white_concrete', 'yellow_concrete', 'light_blue_concrete', 'pink_concrete', 'sea_lantern', 'ochre_froglight'], cp: { a: 'blue_concrete', b: 'lime_concrete', c: 'white_concrete' },
        walls: { type: 'stars' },
        layers: ['checker', 'confetti'], centers: ['planet', 'sun', 'vortex'], floor: { type: 'checker', a: 'black_concrete', b: 'purple_concrete', size: 4 },
        names: ['Orbit', 'Black Hole', 'Moon Drop', 'Nebula', 'Comet Fall', 'Starship'] }),
    theme('goldmine', 'Gold Mine', { wall: 'blackstone', stripe: 'gold_block', panel: 'gilded_blackstone', plate: 'black_concrete', plate2: 'gold_block', accent: 'gold_block', light: 'shroomlight', trim: 'polished_blackstone_bricks', rim: 'gold_block', glass: 'yellow_stained_glass', bridge: 'gold_block', edge: 'polished_blackstone', fence: 'dark_oak_fence',
        cp: { a: 'black_concrete', b: 'gold_block', c: 'shroomlight' },
        walls: { type: 'streaks', blocks: ['gold_block', 'raw_gold_block', 'gilded_blackstone'], density: 50 },
        layers: ['studs', 'checker'], centers: ['vortex', 'gem', 'nested'], floor: { type: 'checker', a: 'gold_block', b: 'black_concrete', size: 3 },
        names: ['Gold Rush', 'Mine Shaft', 'Nugget Drop', 'Vault', 'Treasure Pit', 'Midas Fall'] }),
    theme('rainbow', 'Rainbow Road', { wall: 'white_concrete', stripe: 'red_concrete', panel: 'white_concrete', plate: 'white_concrete', plate2: 'light_gray_concrete', accent: 'yellow_concrete', light: 'sea_lantern', trim: 'white_concrete', rim: 'white_concrete', glass: 'white_stained_glass', bridge: 'white_concrete', edge: 'red_concrete', fence: 'birch_fence',
        colors: RAINBOW, cp: { a: 'red_concrete', b: 'blue_concrete', c: 'sea_lantern' },
        walls: { type: 'helix', colors: RAINBOW, band: 3 },
        layers: ['confetti', 'checker'], centers: ['rainbow', 'vortex', 'star'], floor: { type: 'confetti', a: 'white_concrete' },
        names: ['Rainbow Road', 'Prism Drop', 'Color Splash', 'Spectrum', 'Arcade', 'Over the Rainbow'] }),
    theme('palace', 'Royal Palace', { wall: 'smooth_quartz', stripe: 'lapis_block', panel: 'blue_concrete', plate: 'blue_concrete', plate2: 'lapis_block', accent: 'gold_block', light: 'sea_lantern', trim: 'quartz_block', rim: 'diamond_block', glass: 'blue_stained_glass', bridge: 'diamond_block', edge: 'quartz_block', fence: 'iron_bars',
        cp: { a: 'gold_block', b: 'blue_concrete', c: 'sea_lantern' },
        walls: { type: 'stripes' },
        layers: ['mosaic', 'studs', 'stripes'], centers: ['ringlights', 'gem', 'star'], city: true,
        names: ['The Final Drop'] }),
    theme('void', 'Secret Level', { wall: 'black_concrete', stripe: 'purple_concrete', panel: 'crying_obsidian', plate: 'obsidian', plate2: 'black_concrete', accent: 'gold_block', light: 'pearlescent_froglight', trim: 'gold_block', rim: 'diamond_block', glass: 'purple_stained_glass', bridge: 'diamond_block', edge: 'gold_block', fence: 'iron_bars',
        colors: ['white_concrete', 'purple_concrete', 'magenta_concrete', 'pearlescent_froglight'], cp: { a: 'purple_concrete', b: 'black_concrete', c: 'pearlescent_froglight' },
        walls: { type: 'stars' },
        layers: ['beams', 'studs', 'rings'], centers: ['vortex', 'star', 'ringlights'], city: true,
        names: ['Ascension'] }),
].map(t => [t.name, t]));

// Which theme each level is: ten chapters, bright and friendly first, darker and wilder later.
// Each chapter has three themes in turn for its first nine levels and its own one for the tenth.
const CHAPTER_THEMES = [
    [['meadow', 'candy', 'picnic'], 'honey'],
    [['desert', 'ocean', 'sky'], 'jungle'],
    [['jungle', 'mushroom', 'honey'], 'crystal'],
    [['ice', 'holiday', 'sky'], 'candy'],
    [['crystal', 'copper', 'goldmine'], 'lava'],
    [['lava', 'nether', 'haunted'], 'goldmine'],
    [['picnic', 'holiday', 'rainbow'], 'club'],
    [['nightcity', 'cyber', 'copper'], 'club'],
    [['space', 'club', 'cyber'], 'rainbow'],
    [['nightcity', 'space', 'rainbow'], 'palace'],
];
const themeOf = n => n > LEVELS ? THEMES.void : THEMES[n % 10 === 0 ? CHAPTER_THEMES[(n - 1) / 10 | 0][1] : CHAPTER_THEMES[(n - 1) / 10 | 0][0][((n - 1) % 10) % 3]];
// a level's name: the next of its theme's names
const nameOf = n => { const T = themeOf(n); let k = 0; for (let i = 1; i < n && i <= LEVELS; i++) if (themeOf(i) === T) k++; return T.names[k % T.names.length]; };
// Some levels are much harder than the ones round them (a big moment on stream): smaller spots,
// more fake spots, and more steering asked for.
const SPIKES = new Set([18, 27, 36, 44, 53, 58, 66, 73, 79, 83, 86, 91, 94, 97]);

// ---------- finding the way down ----------
function regionsOfSize(h, s) { const out = []; for (let x = -h; x <= h - s + 1; x++) for (let z = -h; z <= h - s + 1; z++) out.push({ x, z, s }); return out; }
const cellsOf = r => { const out = []; for (let i = 0; i < r.s; i++) for (let j = 0; j < r.s; j++) out.push(key(r.x + i, r.z + j)); return out; };
// Where you can be by now (a box of where your middle can be, worked out layer by layer from the
// bridge), and how far that is from fitting through spot r.
const win = r => { const [x1, x2] = span(r.x, r.s), [z1, z2] = span(r.z, r.s); return { x1, x2, z1, z2 }; };
const minGap = (reach, r) => { const w = win(r); return Math.hypot(axisGap([reach.x1, reach.x2], [w.x1, w.x2]), axisGap([reach.z1, reach.z2], [w.z1, w.z2])); };
// where you can be after steering `budget` blocks and then fitting through spot r (null: you can't)
function reachThrough(reach, budget, r) {
    const w = win(r), out = { x1: Math.max(reach.x1 - budget, w.x1), x2: Math.min(reach.x2 + budget, w.x2), z1: Math.max(reach.z1 - budget, w.z1), z2: Math.min(reach.z2 + budget, w.z2) };
    return out.x1 <= out.x2 + 1e-9 && out.z1 <= out.z2 + 1e-9 ? out : null;
}
// A spot you can get to from where you were, one you have to move for (at least lo x the steering there's time for).
function chooseTarget(c, s, ok = () => true) {
    const all = regionsOfSize(c.h, s).filter(r => ok(r) && minGap(c.reach, r) <= c.budget);
    if (!all.length) return null;
    const far = all.filter(r => minGap(c.reach, r) >= c.lo * c.budget);
    if (c.t > 0.04 && c.budget >= 0.9) return far.length ? pick(c.rng, far) : null;
    return pick(c.rng, far.length ? far : all);
}
// how far a cell is from a spot (0 in it, 1 right next to it...)
const distTo = (x, z, r) => Math.max(Math.max(r.x - x, 0, x - (r.x + r.s - 1)), Math.max(r.z - z, 0, z - (r.z + r.s - 1)));
// a small hash, for patterns that look random but are the same every time
const hash = (a, b, c = 0) => { let v = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };

// ---------- the layers ----------
// A layer covers the whole shaft. Its top is tiled in a pattern; some patterns have raised parts.
// Each style gives, for a cell (x, z from the middle of the shaft), what goes on top and how high it
// stands: role base | alt | acc | lit | trim, lift = blocks it stands above the floor of the layer,
// cap = what's on top of a raised part.
const STYLES = {
    // diamond mosaic (the level 100 layer in the videos): a lattice of trim lines, gems in the middle of each diamond
    mosaic: { relief: 1, at(x, z, v) {
        const P = v.size + 4, u = mod(x + z, P), w = mod(x - z, P), du = Math.abs(u - P / 2), dw = Math.abs(w - P / 2), gem = Math.floor(P / 4);
        if (u === 0 || w === 0) return { role: 'trim' };
        if (du + dw <= 1) return { role: 'lit', lift: du + dw === 0 ? 1 : 0, cap: 'lit' };
        if (du + dw <= gem) return { role: 'acc' };
        if (du + dw === gem + 1) return { role: 'trim' };
        return { role: mod(Math.floor((x + z) / P) + Math.floor((x - z) / P), 2) ? 'alt' : 'base' };
    } },
    // studs (level 100's floor and level 32's grey field): 2x2 blocks standing up on a grid, stepping up
    // in rings from the middle like terraces, lamps on the corner blocks of each ring, paths between
    studs: { relief: 2, at(x, z, v) {
        const bx = mod(x + 1, 3), bz = mod(z + 1, 3);
        if (bx === 2 || bz === 2) return { role: mod(Math.floor((x + 1) / 3) + Math.floor((z + 1) / 3), 2) ? 'base' : 'trim' };
        const ring = Math.floor(Math.max(Math.abs(Math.floor((x + 1) / 3)), Math.abs(Math.floor((z + 1) / 3))) / 2);
        const tall = 1 + mod(ring, 2), lamp = mod(Math.floor((x + 1) / 3), 4) === 0 && mod(Math.floor((z + 1) / 3), 4) === 0;
        return { role: 'alt', lift: tall, cap: lamp ? 'lit' : 'acc', body: 'alt' };
    } },
    // beams (level 32's orange X): two thick raised beams across the shaft over a striped field
    beams: { relief: 2, at(x, z, v) {
        const diag = v.turn === 0, a = diag ? x - z : x, b = diag ? x + z : z;
        if (Math.abs(a) <= 1 || Math.abs(b) <= 1) {
            const along = Math.abs(a) <= 1 ? b : a;
            return { role: 'acc', lift: 2, cap: Math.abs(a) + Math.abs(b) <= 2 || mod(along, 6) === 0 ? 'lit' : 'acc', body: 'acc' };
        }
        if (Math.abs(a) === 2 || Math.abs(b) === 2) return { role: 'trim' };
        if (mod(x, 6) === 3 && mod(z, 6) === 3) return { role: 'lit' };
        return { role: mod(x + z, 4) < 2 ? 'base' : 'alt' };
    } },
    // framed tiles: big square tiles with raised trim frames, a gem in the middle of each
    tiles: { relief: 1, at(x, z, v) {
        const T = v.size, ox = mod(x + Math.floor(T / 2), T), oz = mod(z + Math.floor(T / 2), T), m = Math.floor(T / 2);
        if (ox === 0 || oz === 0) return { role: 'trim', lift: 1, cap: (ox === 0 && oz === 0) ? 'lit' : 'trim', body: 'trim' };
        if (ox === m && oz === m) return { role: 'lit' };
        if (Math.abs(ox - m) + Math.abs(oz - m) <= 1) return { role: 'acc' };
        return { role: mod(Math.floor((x + m) / T) + Math.floor((z + m) / T), 2) ? 'alt' : 'base' };
    } },
    // rings round the middle of the shaft, raised trim every few, lamps along them
    rings: { relief: 1, at(x, z, v) {
        const d = Math.max(Math.abs(x), Math.abs(z)), P = v.size;
        if (mod(d, P) === 0) return { role: 'trim', lift: 1, cap: mod(x + z, 4) === 0 ? 'lit' : 'trim', body: 'trim' };
        if (mod(d, P) === Math.floor(P / 2)) return { role: mod(x - z, 6) === 0 ? 'lit' : 'acc' };
        return { role: mod(Math.floor(d / P), 2) ? 'alt' : 'base' };
    } },
    // wide diagonal stripes (level 12): bands of the two main colours with raised accent lines
    stripes: { relief: 1, at(x, z, v) {
        const P = v.size, m = mod(v.turn ? x - z : x + z, P);
        if (m === 0) return { role: 'acc', lift: 1, cap: mod(x, 6) === 0 ? 'lit' : 'acc', body: 'acc' };
        if (m === 1 || m === P - 1) return { role: 'trim' };
        return { role: m < P / 2 ? 'base' : 'alt' };
    } },
    // a city of columns: blocks of different heights with lit roofs, streets between them
    city: { relief: 3, at(x, z, v) {
        const T = 3, tx = Math.floor((x + 1) / T), tz = Math.floor((z + 1) / T), ix = mod(x + 1, T), iz = mod(z + 1, T);
        if (ix === 2 || iz === 2) return { role: 'trim' };
        // rows of blocks stepping up and down diagonally (1, 2, 3, 2, 1...), a few lit roofs
        const wave = mod(v.turn ? tx - tz : tx + tz, 4), tall = wave === 3 ? 2 : wave + 1;
        return { role: 'base', lift: tall, cap: tall === 3 && mod(v.turn ? tx + tz : tx - tz, 3) === 0 ? 'lit' : 'acc', body: mod(tx + tz, 2) ? 'alt' : 'base' };
    } },
};
// more layer patterns: plain checks, diagonal checks, a dance floor, confetti, and city roads with blocks of buildings
Object.assign(STYLES, {
    checker: { relief: 0, at(x, z, v) { return { role: mod(Math.floor(x / v.size) + Math.floor(z / v.size), 2) ? 'alt' : 'base' }; } },
    diag: { relief: 0, at(x, z, v) { return { role: mod(Math.floor((x + z) / v.size) + Math.floor((x - z) / v.size), 2) ? 'alt' : 'base' }; } },
    confetti: { relief: 0, at(x, z, v) { const r = hash(x, z, v.seed); return r > 0.86 ? { role: 'col:' + Math.floor(hash(z, x, v.seed + 7) * 12) } : { role: mod(Math.floor(x / 6) + Math.floor(z / 6), 2) ? 'alt' : 'base' }; } },
    dance: { relief: 0, at(x, z, v) {
        if (mod(x, 4) === 3 || mod(z, 4) === 3) return { role: 'base' };
        const tx = Math.floor(x / 4), tz = Math.floor(z / 4), r = hash(tx, tz, v.seed);
        return { role: r > 0.8 ? 'lit' : 'col:' + Math.floor(r * 10) };
    } },
    roads: { relief: 3, at(x, z, v) {
        const P = 14, rx = mod(x + 7, P), rz = mod(z + 7, P), onX = rx < 5, onZ = rz < 5;
        if (onX || onZ) {                                               // a road: tarmac, white edges, a dashed yellow middle
            const r = onX ? rx : rz, along = onX ? z : x;
            if (onX && onZ) return { role: 'blk:black_concrete' };
            if (r === 0 || r === 4) return { role: 'blk:white_concrete' };
            return { role: r === 2 && mod(along, 4) < 2 ? 'blk:yellow_concrete' : 'blk:black_concrete' };
        }
        if (rx === 5 || rx === 13 || rz === 5 || rz === 13) return { role: 'trim' };          // pavement
        const bx = Math.floor((x + 7) / P), bz = Math.floor((z + 7) / P), r = hash(bx, bz, v.seed), tall = 1 + Math.floor(r * 3);
        return { role: 'blk:gray_concrete', lift: tall, cap: hash(x, z, v.seed) > 0.8 ? 'lit' : 'blk:light_gray_concrete', body: 'blk:gray_concrete' };
    } },
});
const STYLE_SIZES = { checker: [4, 5, 6], diag: [3, 4], tiles: [7, 9], stripes: [10, 12, 14], studs: [10, 12], mosaic: [6, 8], rings: [6, 8], beams: [6, 8], confetti: [6], dance: [4], roads: [14], city: [6] };

// A role -> its block: the theme's colours, a centrepiece colour (a, b, c), an extra colour (col:N) or a block (blk:...)
const ROLE = (P, role) => {
    if (role.startsWith('blk:')) return role.slice(4);
    if (role.startsWith('col:')) return P.colors[+role.slice(4) % P.colors.length];
    return ({ base: P.plate, alt: P.plate2, acc: P.accent, lit: P.light, trim: P.trim, rim: P.rim, a: P.cp.a, b: P.cp.b, c: P.cp.c })[role] || P.plate;
};

// ---------- centrepieces: a big shape round each spot (the spot is its middle) ----------
// (dx, dz from the middle of the spot, R its size) -> { role, lift (blocks it stands up), cap } or null (not part of it)
const tri = x => 1 - Math.abs(mod(x, 1) * 2 - 1);          // 0 -> 1 -> 0 over each whole number
const ang = (dx, dz) => Math.atan2(dz, dx) / (2 * Math.PI);  // -0.5 .. 0.5 turns
const CENTERS = {
    // a starburst: five sharp points, gold edges, a glowing core
    star: (dx, dz, R) => {
        const r = Math.hypot(dx, dz), edge = R * (0.4 + 0.6 * tri(ang(dx, dz) * 5) ** 1.6);
        if (r > edge + 0.5) return null;
        if (r < R * 0.28) return { role: 'c' };
        return r > edge - Math.max(1, R / 9) ? { role: 'a', lift: 1 } : { role: 'b', lift: 1 };
    },
    // a sun: a round middle and rays round it
    sun: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r < R * 0.25) return { role: 'c' };
        if (r < R * 0.55) return { role: 'a', lift: 1 };
        return r <= R && tri(ang(dx, dz) * 12) > 0.62 ? { role: 'b' } : null;
    },
    // a target: rings, every other one raised
    bullseye: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R) return null;
        if (r > R - 1.5) return { role: 'trim', lift: 1 };
        const ring = Math.floor(r / (1.6 * R / 10));
        return ring % 2 ? { role: 'a', lift: 1 } : { role: 'b' };
    },
    // an archery target with an arrow stuck in it
    target: (dx, dz, R) => {
        const r = Math.hypot(dx, dz), along = (dx - dz) / Math.SQRT2, off = Math.abs(dx + dz) / Math.SQRT2;
        if (along > R * 0.25 && along < R * 1.35 && off < Math.max(0.75, R / 14)) return { role: 'blk:spruce_planks', lift: 2 };
        if (along >= R * 1.1 && along < R * 1.45 && off < Math.max(1.8, R / 6)) return { role: 'blk:white_wool', lift: 2 };
        return CENTERS.bullseye(dx, dz, R * 0.8);
    },
    // a spiral, like a vortex pulling you in
    vortex: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R) return null;
        if (r < R * 0.22) return { role: 'c' };
        if (r > R - Math.max(1, R / 10)) return { role: 'trim' };
        return mod(ang(dx, dz) * 3 + r / R * 1.4, 1) < 0.5 ? { role: 'a', lift: 1 } : { role: 'b' };
    },
    // a ring of lamps round a wheel of spokes
    ringlights: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R - 0.6) return null;
        if (r > R - 1.6 - R / 8) return { role: 'lit', lift: 1 };
        return mod(Math.floor(ang(dx, dz) * 12), 2) ? { role: 'a' } : { role: 'b' };
    },
    // squares inside squares (like steps down to the spot)
    nested: (dx, dz, R) => {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d > R) return null;
        const band = Math.floor(d / Math.max(2, R / 5)) % 3;
        return [{ role: 'a', lift: 1 }, { role: 'b' }, { role: 'c' }][band];
    },
    // a cut gem: four faces with glowing edges
    gem: (dx, dz, R) => {
        const m = Math.abs(dx) + Math.abs(dz);
        if (m > R) return null;
        if (m > R - Math.max(1, R / 10) || Math.abs(dx) < Math.max(0.6, R / 20) || Math.abs(dz) < Math.max(0.6, R / 20)) return { role: 'c' };
        return Math.sign(dx) * Math.sign(dz) > 0 ? { role: 'a', lift: 1 } : { role: 'b', lift: 1 };
    },
    // a flower: six petals round a yellow middle
    flower: (dx, dz, R) => {
        const r = Math.hypot(dx, dz), edge = R * (0.45 + 0.55 * Math.abs(Math.cos(ang(dx, dz) * Math.PI * 6)) ** 0.8);
        if (r > edge) return null;
        if (r < R * 0.3) return { role: 'c', lift: 1 };
        return r > edge - Math.max(1.2, R / 9) ? { role: 'b', lift: 1 } : { role: 'a', lift: 1 };
    },
    // a donut: frosting with sprinkles on a ring of dough
    donut: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R || r < R * 0.36) return null;
        if (r > R * 0.84 || r < R * 0.45) return { role: 'b', lift: 1 };
        const g = Math.max(2, R / 6), sx = Math.round(dx / g), sz = Math.round(dz / g), h = hash(sx, sz, 9);
        return h > 0.55 && Math.hypot(dx - sx * g, dz - sz * g) < g * 0.38 ? { role: 'col:' + Math.floor(h * 20), lift: 1 } : { role: 'a', lift: 1 };
    },
    // a pizza: crust, sauce, cheese and pepperoni
    pizza: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R) return null;
        const cr = Math.max(1.3, R / 8);
        if (r > R - cr) return { role: 'blk:orange_terracotta', lift: 1 };
        if (r > R - cr - 1.2) return { role: 'blk:red_terracotta' };
        const g = R / 3, px = Math.round(dx / g), pz = Math.round(dz / g);
        if ((px || pz) && hash(px, pz, 4) > 0.35 && Math.hypot(dx - px * g, dz - pz * g) < g * 0.37) return { role: 'blk:red_concrete' };
        return { role: 'blk:yellow_concrete' };
    },
    // a toadstool: a red cap with white spots
    mushroom: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R) return null;
        if (r > R - Math.max(1, R / 10)) return { role: 'b', lift: 1 };
        const g = Math.max(4, R / 3), sx = Math.round(dx / g), sz = Math.round(dz / g);
        return (sx || sz) && hash(sx, sz, 5) > 0.3 && Math.hypot(dx - sx * g, dz - sz * g) < g * 0.35 ? { role: 'blk:white_concrete', lift: 1 } : { role: 'a', lift: 1 };
    },
    // a cog: teeth round the edge and windows through it
    gear: (dx, dz, R) => {
        const r = Math.hypot(dx, dz), a = ang(dx, dz), edge = mod(a * 10, 1) < 0.5 ? R : R - 2;
        if (r > edge) return null;
        if (r < R * 0.32) return { role: 'b' };
        if (r > R * 0.52 && r < R * 0.74 && mod(a * 5, 1) < 0.45) return null;
        return { role: 'a', lift: 1 };
    },
    // a snowflake: six arms with branches
    snowflake: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R) return null;
        if (r < R * 0.24) return { role: 'c' };
        for (let k = 0; k < 6; k++) {
            const f = k * Math.PI / 3, p = dx * Math.cos(f) + dz * Math.sin(f), q = Math.abs(-dx * Math.sin(f) + dz * Math.cos(f));
            if (p < 0) continue;
            if (q < Math.max(0.8, R / 12)) return { role: 'a', lift: 1 };
            if (p > R * 0.45 && p < R * 0.85 && Math.abs(q - (p - R * 0.45) * 0.75) < Math.max(0.7, R / 14)) return { role: 'b', lift: 1 };
        }
        return null;
    },
    // a jack-o'-lantern: ribs, a glowing face, a stalk
    pumpkin: (dx, dz, R) => {
        if (dz < -R * 0.82 && dz > -R - 1.6 && Math.abs(dx) < 1.1) return { role: 'blk:green_concrete', lift: 1 };
        if ((dx / R) ** 2 + (dz / (R * 0.85)) ** 2 > 1) return null;
        const eye = s => Math.abs(dx - s * R * 0.42) < (dz + R * 0.48) * 0.9 && dz < -R * 0.12 && dz > -R * 0.48;
        if (eye(1) || eye(-1)) return { role: 'lit' };
        if (dz > R * 0.2 && dz < R * 0.45 && Math.abs(dx) < R * 0.6 && !(mod(Math.round(dx), 3) === 0 && dz < R * 0.3)) return { role: 'lit' };
        return mod(Math.round(dx), 3) === 0 ? { role: 'blk:orange_terracotta', lift: 1 } : { role: 'blk:orange_concrete', lift: 1 };
    },
    // a planet with bands, and a ring round it
    planet: (dx, dz, R) => {
        const r = Math.hypot(dx, dz), e = (dx / R) ** 2 + (dz / (R * 0.32)) ** 2;
        if (r > R * 0.55 && Math.abs(e - 1) < 0.2) return { role: 'c' };
        if (r > R * 0.6) return null;
        return [{ role: 'a', lift: 1 }, { role: 'b', lift: 1 }, { role: 'col:0', lift: 1 }][mod(Math.floor((dz + R) / Math.max(2.2, R / 5)), 3)];
    },
    // rings in every colour
    rainbow: (dx, dz, R) => {
        const r = Math.hypot(dx, dz);
        if (r > R) return null;
        const i = Math.floor(r / Math.max(1.3, R / 7));
        return { role: 'col:' + i, lift: i % 2 };
    },
};

// The rows of one layer: raised parts first (dy 0 is the highest), then the floor of the layer. Spots
// go all the way through; round each one its centrepiece, a frame of lamps and the rim colour, with
// nothing raised within 3 blocks so you drop in cleanly.
function layerRows(c, styleId, v, spot, decoys, centerId, R) {
    const S = STYLES[styleId], C = CENTERS[centerId], P = c.look, holes = [spot, ...decoys], h = c.h;
    const mids = holes.map(center), cells = [];
    for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
        const d = Math.min(...holes.map(r => distTo(x, z, r)));
        if (d === 0) continue;
        let a = null;
        if (d === 1) a = { role: 'lit' };
        else if (d === 2) a = { role: 'rim' };
        else { let best = 0, bd = Infinity; mids.forEach(([mx, mz], i) => { const dd = Math.hypot(x - mx, z - mz); if (dd < bd) { bd = dd; best = i; } }); a = C(x - mids[best][0], z - mids[best][1], R); }
        a ||= S.at(x, z, v);
        if (d <= 3 || !a.lift) a = { role: a.role, lift: 0 };
        cells.push({ k: key(x, z), ...a });
    }
    const top = Math.max(0, ...cells.map(cl => cl.lift)), rows = [];
    for (let dy = 0; dy < top; dy++) {
        const solid = new Set(), paint = new Map();
        for (const cl of cells) if (cl.lift >= top - dy) {
            solid.add(cl.k);
            paint.set(cl.k, ROLE(P, dy === top - cl.lift ? cl.cap || cl.role : cl.body || cl.role));
        }
        if (solid.size) rows.push({ dy, solid, paint, main: spot });
    }
    const floor = new Set(), paint = new Map();
    for (const cl of cells) { floor.add(cl.k); paint.set(cl.k, ROLE(P, cl.lift ? cl.body || cl.role : cl.role)); }
    rows.push({ dy: top, solid: floor, paint, main: spot });
    return rows;
}

// The bottom of a city level: blocks of buildings round the pool, lower towards it, lit roofs.
// It's one more "layer" (so the bot checks it), standing on the floor of the shaft.
function cityRows(c, pool, H) {
    const P = c.look, h = c.h, [pcx, pcz] = center(pool), cells = [];
    for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
        if (distTo(x, z, pool) <= 2) continue;
        const T = c.t < 0.5 ? 3 : 2, tx = Math.floor((x + h) / (T + 1)), tz = Math.floor((z + h) / (T + 1));
        if (mod(x + h, T + 1) === T || mod(z + h, T + 1) === T) continue;
        const far = Math.max(Math.abs(tx * (T + 1) - h + T / 2 - pcx), Math.abs(tz * (T + 1) - h + T / 2 - pcz)) - pool.s / 2;
        const r = hash(tx, tz, c.n), hgt = Math.max(1, Math.min(H, Math.round(far / 3) + Math.floor(r * 3) - 1));
        cells.push({ k: key(x, z), hgt, roof: r > 0.8 ? 'lit' : 'acc', body: mod(tx + tz, 2) ? 'alt' : 'base' });
    }
    const rows = [];
    for (let dy = 0; dy < H; dy++) {
        const solid = new Set(), paint = new Map();
        for (const cl of cells) if (cl.hgt >= H - dy) { solid.add(cl.k); paint.set(cl.k, ROLE(P, dy === H - cl.hgt ? cl.roof : cl.body)); }
        if (solid.size) rows.push({ dy, solid, paint, main: pool });
    }
    return rows;
}

function designLevel(n, attempt = 0) {
    const rng = rngFor(n * 7919 + 12345 + attempt * 104729);
    const secret = n > LEVELS, spike = SPIKES.has(n);
    const t = secret ? 1 : (n - 1) / (LEVELS - 1), boss = n % 10 === 0 || secret, final = n === LEVELS || secret;
    const T = themeOf(n);
    const h = secret ? 54 : final ? 52 : boss ? 48 : t < 0.3 ? pick(rng, [36, 37, 38, 39]) : pick(rng, [40, 41, 42, 43, 44, 45, 46]);
    const height = secret ? 1700 : final ? 1380 : Math.round(680 + 600 * t + randInt(rng, -20, 40) + (boss ? 40 : 0));
    // how much of the steering you could do that a level asks for: never more than about 60%
    const k = (final ? 0.55 : Math.min(0.56, 0.22 + 0.3 * t + (boss ? 0.03 : 0) + (spike ? 0.06 : 0))) * 0.9 ** Math.floor(attempt / 4);
    MARGIN = 0.35 - 0.2 * t;
    const lo = final ? 0.65 : Math.min(0.72, 0.3 + 0.4 * t + (spike ? 0.1 : 0));
    // few layers, far apart (so there's time to run for each spot): 3 at first, up to 5 (one more on a chapter's last level)
    const count = secret ? 11 : final ? 10 : 5 + Math.round(4 * t) + (boss ? 1 : 0);
    const spotSize = Math.min(4, Math.max(2, (final ? 2 : t < 0.15 ? 4 : t < 0.4 ? 3 : 2) - (spike ? 1 : 0)) + Math.floor(attempt / 12));
    const decoyCount = Math.min(2, (t < 0.3 ? 0 : t < 0.6 ? 1 : 2) + (spike ? 1 : 0));
    const R = h + 2;                                                    // centrepiece size: wall to wall, like a giant object filling the shaft
    // the layer patterns and centrepieces this level uses, in turn
    const styles = T.layers.map(id => ({ id, v: { size: pick(rng, STYLE_SIZES[id] || [6]), turn: randInt(rng, 0, 1), seed: n * 31 + randInt(rng, 0, 999) } }));
    const shift = randInt(rng, 0, 2);
    const cityH = T.city ? 3 + Math.round(7 * t) : 0;

    // How far you can steer between two layers: from when your head is out of the first (you're 1.8
    // tall) plus about 4 ticks (0.2s) to react, until your feet reach the top of the second.
    const budgetBetween = (d1, d2) => k * REACH[Math.max(0, tickAt(d2 - 1) - tickAt(d1 + 2) - 4)];
    // the first layer a long drop under the bridge; the rest spread out evenly in falling time
    const first = randInt(rng, 80, 110), last = height - cityH - 22, t1 = tickAt(first), t2 = tickAt(last);
    const depths = Array.from({ length: count }, (_, i) => Math.round(DEPTH[Math.round(t1 + (t2 - t1) * i / Math.max(1, count - 1))]));

    let reach = { x1: -2.3, x2: 2.3 + 1, z1: -h + BRIDGE + 0.3, z2: -h + BRIDGE + 0.9 }, lastDepth = 0;
    const placed = [], centers = [];
    const awayFromWalls = s => r => r.x >= -h + 3 && r.x + s - 1 <= h - 3 && r.z >= -h + 3 && r.z + s - 1 <= h - 3;
    for (let i = 0; i < depths.length; i++) {
        const depth = depths[i], st = styles[i % styles.length], cid = T.centers[(i + shift) % T.centers.length];
        const c = { rng, t, h, n, look: T, reach, budget: budgetBetween(lastDepth, depth), lo };
        const spot = chooseTarget(c, spotSize, awayFromWalls(spotSize));
        if (!spot) throw new Error(`level ${n}: no spot for layer ${i + 1}`);
        // fake spots: the same centrepiece round them, they lead nowhere
        const decoys = [];
        for (let tries = 0; decoys.length < decoyCount && tries < 80; tries++) {
            const r = { x: randInt(rng, -h + 3, h - 2 - spotSize), z: randInt(rng, -h + 3, h - 2 - spotSize), s: spotSize };
            if ([spot, ...decoys].every(o => Math.hypot(center(o)[0] - center(r)[0], center(o)[1] - center(r)[1]) > 16)) decoys.push(r);
        }
        const rows = layerRows(c, st.id, st.v, spot, decoys, cid, R);
        let now = reach, d0 = lastDepth;
        for (const r of rows) { now = now && reachThrough(now, budgetBetween(d0, depth + r.dy), r.main); d0 = depth + r.dy; }
        if (!now) throw new Error(`level ${n}: layer ${i + 1} can't be reached`);
        placed.push({ id: st.id, center: cid, depth, rows, block: T.plate, rim: null, hangers: false, studs: false, inlay: 'none' });
        centers.push(cid);
        reach = now; lastDepth = depth + rows[rows.length - 1].dy;
    }
    // the pool: big at first, smaller later, somewhere you have to steer to (a city round it on city levels)
    const ps = final ? 1 : t < 0.1 ? 13 : t < 0.25 ? 9 : t < 0.45 ? 6 : t < 0.6 ? 4 : t < 0.8 ? 3 : 2;
    const groundDepth = T.city ? height + 1 - cityH : height;
    const pool = chooseTarget({ rng, t, h, reach, budget: budgetBetween(lastDepth, groundDepth), lo }, ps, awayFromWalls(ps))
        || regionsOfSize(h, ps).filter(awayFromWalls(ps)).reduce((best, r) => !best || minGap(reach, r) < minGap(reach, best) ? r : best, null);
    if (T.city) {
        const city = cityRows({ t, h, n, look: T }, pool, cityH);
        if (city.length) placed.push({ id: 'ground', depth: groundDepth, rows: city, block: T.plate, rim: null, hangers: false, studs: false, inlay: 'none' });
    }
    return { n, name: nameOf(n), theme: T, look: T, h, height, layers: placed, pool, k, top: topOf(n), styles: styles.map(s => s.id), centers, R, spike };
}

// A level only goes in if a bot beats it while steering at 60% of full power and waiting 0.2s after
// each gap before it moves, like a person. Otherwise it's designed again (a bit easier each few tries).
function fairLevel(n) {
    let L;
    for (let attempt = 0; attempt < 40; attempt++) {
        try { L = designLevel(n, attempt); } catch { continue; }
        if (botPlay(L, { power: 0.6, react: 4 }).ok && (n < 4 || !botStandStill(L))) return L;
    }
    return L;
}
// A level's full design is big (every block of every layer), so it's made when it's needed and not
// kept: only a few numbers about each level are remembered.
// Those numbers are saved (data/dropper-levels.json), so the levels are only designed once per build.
const INFO_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'dropper-levels.json');
const infoCache = new Map();
// A copy comes with Unbound (dropper-levels.json next to this file), so a new install doesn't
// spend a minute or two designing every level before the world can open.
for (const file of [INFO_FILE, path.join(path.dirname(fileURLToPath(import.meta.url)), 'dropper-levels.json')]) {
    try { const f = JSON.parse(fs.readFileSync(file, 'utf8')); if (f.build === DROPPER_BUILD && f.levels?.length === SECRET) { for (const i of f.levels) infoCache.set(i.n, i); break; } } catch { }
}
function levelDesign(n) {
    const L = fairLevel(n), had = infoCache.size;
    infoCache.set(n, { n, h: L.h, name: L.name, height: L.height, title: L.theme.title });
    if (infoCache.size === SECRET && had < SECRET) {
        try { fs.mkdirSync(path.dirname(INFO_FILE), { recursive: true }); fs.writeFileSync(INFO_FILE, JSON.stringify({ build: DROPPER_BUILD, levels: [...infoCache.values()].sort((a, b) => a.n - b.n) })); } catch { }
    }
    return L;
}
function levelInfo(n) { if (!infoCache.has(n)) levelDesign(n); return infoCache.get(n); }
function* levelRange(from, to) { for (let n = from; n <= to; n++) yield levelDesign(n); }
// every level's full design (for checking them; uses a lot of memory)
export function dropperLevels() { return [...levelRange(1, LEVELS)]; }
// one level's full design (101 is the secret one)
export function dropperLevel(n) { return levelDesign(n); }

// The bot: Minecraft's own movement maths each tick. In the air: speed += input * 0.02, move,
// speed *= 0.91. Falling: y += vy, vy = (vy - 0.08) * 0.98. You're 0.6 wide and 1.8 tall, and
// touching any obstacle counts as a fail. It walks off the front of the ledge and steers for the
// next hole, lined up for the one after it.
// Can you get through by just walking off the bridge and not steering at all?
export function botStandStill(L) {
    for (let x = -2.2; x <= 2.7; x += 0.1) for (const vz of [0.05, 0.15, 0.25]) if (botRun(L, 0, 0, x, vz).ok) return true;
    return false;
}
export function botPlay(L, { power = 1, react = 0 } = {}) {
    for (let u = -2; u <= 2; u++) { const r = botRun(L, power, react, u + 0.5); if (r.ok) return r; }
    return { ok: false };
}
function botRun(L, power, react, startX, vz0 = 0.15) {
    const h = L.h, rows = [], TOP = L.top;
    for (const layer of L.layers) for (const r of layer.rows) if (!r.decor) rows.push({ yb: TOP - (layer.depth + r.dy), solid: r.solid, main: r.main });
    rows.sort((a, b) => b.yb - a.yb);
    const byY = new Map(rows.map(r => [r.yb, r])), floor = TOP - L.height, p = L.pool;
    const solidAt = (bx, by, bz) => (by === TOP - 1 && bx >= -2 && bx <= 2 && bz >= -h && bz < -h + BRIDGE) || !!byY.get(by)?.solid.has(`${bx},${bz}`);
    const touching = (x, y, z) => {
        for (let bx = Math.floor(x - 0.3); bx <= Math.floor(x + 0.3 - 1e-9); bx++)
            for (let by = Math.floor(y); by <= Math.floor(y + 1.8 - 1e-9); by++)
                for (let bz = Math.floor(z - 0.3); bz <= Math.floor(z + 0.3 - 1e-9); bz++) if (solidAt(bx, by, bz)) return true;
        return false;
    };
    const box = r => { const m = Math.min(0.08, Math.max(0, (r.s - 0.6) / 2 - 0.01)); return [r.x + 0.3 + m, r.x + r.s - 0.3 - m, r.z + 0.3 + m, r.z + r.s - 0.3 - m]; };
    const clampTo = (v, a, b) => Math.max(a, Math.min(b, v));
    // walking off the end of the bridge
    let x = startX, z = -h + BRIDGE + 0.31, vx = 0, vz = vz0, y = TOP, vy = 0, wait = 0, last = null;
    const lim = v => clampTo(v, -h + 0.3, h + 0.7);
    for (let t = 0; t < 800; t++) {
        const i = rows.findIndex(r => y + 1.8 > r.yb);            // the layer you're in or coming up to
        const goal = i >= 0 ? rows[i].main : p, after = i >= 0 ? (rows.slice(i + 1).find(r => r.main !== goal)?.main || p) : null;   // the next different hole
        if (goal !== last && last) wait = react;
        last = goal;
        const [x1, x2, z1, z2] = box(goal);
        let tx = (x1 + x2) / 2, tz = (z1 + z2) / 2;
        if (after) { const [a1, a2, b1, b2] = box(after); tx = clampTo((a1 + a2) / 2, x1, x2); tz = clampTo((b1 + b2) / 2, z1, z2); }
        let ax = 0, az = 0;
        if (wait > 0) wait--;
        else {
            const ex = tx - (x + vx * 0.91 / 0.09), ez = tz - (z + vz * 0.91 / 0.09);
            ax = Math.abs(ex) > 0.03 ? Math.sign(ex) : 0; az = Math.abs(ez) > 0.03 ? Math.sign(ez) : 0;
            const n = Math.hypot(ax, az) || 1; ax /= n; az /= n;
        }
        vx += ax * 0.02 * power; vz += az * 0.02 * power;
        const steps = Math.ceil(Math.max(Math.abs(vy), Math.abs(vx), Math.abs(vz)) / 0.2) + 1;
        for (let k = 0; k < steps; k++) {
            x = lim(x + vx / steps); z = lim(z + vz / steps); y += vy / steps;
            if (y <= floor) { const ok = x - 0.3 >= p.x && x + 0.3 <= p.x + p.s && z - 0.3 >= p.z && z + 0.3 <= p.z + p.s; return { ok, t, at: ok ? 'pool' : 'floor' }; }
            if (y < TOP - 0.5 && touching(x, y, z)) return { ok: false, t, at: TOP - Math.floor(y) };
        }
        vx *= 0.91; vz *= 0.91; vy = (vy - 0.08) * 0.98;
    }
    return { ok: false, at: 'timeout' };
}

const levelCenter = n => [ORIGIN + ((n - 1) % 10) * SPACING, ORIGIN + Math.floor((n - 1) / 10) * SPACING];
export function levelStart(n) { const [cx, cz] = levelCenter(n), L = levelInfo(n); return [cx, topOf(n), cz - L.h]; }

// ---------- building: the commands for one level ----------
// greedy rectangles over a set of solid cells
function rects(solid, h) {
    const left = new Set(solid), out = [];
    for (let z = -h; z <= h; z++) for (let x = -h; x <= h; x++) {
        if (!left.has(key(x, z))) continue;
        let x2 = x; while (x2 + 1 <= h && left.has(key(x2 + 1, z))) x2++;
        let z2 = z; for (; ;) { let all = true; for (let i = x; i <= x2; i++) if (!left.has(key(i, z2 + 1))) { all = false; break; } if (!all || z2 + 1 > h) break; z2++; }
        for (let i = x; i <= x2; i++) for (let j = z; j <= z2; j++) left.delete(key(i, j));
        out.push([x, z, x2, z2]);
    }
    return out;
}

const B = b => `minecraft:${b}`;
// what block one obstacle cell is: painted by its design, the rim round a hole, a pattern, or plain
function blockFor(layer, row, k, h) {
    if (row.paint?.has(k)) return row.paint.get(k);
    const [x, z] = k.split(',').map(Number);
    if (layer.rim) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + a, nz = z + b;
        if (Math.abs(nx) <= h && Math.abs(nz) <= h && !row.solid.has(key(nx, nz))) return mod(x + z, 2) ? layer.rim : layer.rim2;
    }
    if (layer.inlay === 'lanterns' && mod(x, 3) === 1 && mod(z, 3) === 1) return layer.lamp;
    if (layer.inlay === 'lattice') {                                   // lines every 4, a white flower with a lamp where they cross
        const ax = mod(x, 4), az = mod(z, 4);
        if (ax === 0 && az === 0) return layer.lamp;
        if ((ax === 0 && (az === 1 || az === 3)) || (az === 0 && (ax === 1 || ax === 3))) return layer.flower;
        if (ax === 0 || az === 0) return layer.inlayBlock;
        if (ax === 2 && az === 2) return layer.lamp;
    }
    if (layer.inlay === 'starburst') {                                 // lines out from the middle in 8 directions
        if (x === 0 || z === 0 || Math.abs(x) === Math.abs(z)) return mod(Math.max(Math.abs(x), Math.abs(z)), 4) === 0 ? layer.lamp : layer.inlayBlock;
    }
    if (layer.inlay === 'diamonds') { const d = Math.abs(x) + Math.abs(z); if (mod(d, 6) === 0) return layer.inlayBlock; if (mod(d, 6) === 3 && mod(x, 3) === 0) return layer.lamp; }
    if (layer.inlay === 'mosaic') { const v = mod(Math.floor(x / 2) * 7 + Math.floor(z / 2) * 13, 5); if (v === 0) return layer.inlayBlock; if (v === 1) return layer.flower; if (v === 2 && mod(x, 2) === 0 && mod(z, 2) === 0) return layer.lamp; }
    if (layer.inlay === 'bands') { const m = mod(x + z, 8); if (m < 2) return layer.inlayBlock; if (m === 2) return layer.lamp; }
    if (layer.inlay === 'rings') { const d = Math.max(Math.abs(x), Math.abs(z)); if (mod(d, 4) === 0) return layer.inlayBlock; if (mod(d, 4) === 2 && mod(x + z, 2) === 0) return layer.lamp; }
    if (layer.inlay === 'flowers') {
        const fx = mod(x + 2, 5) - 2, fz = mod(z + 2, 5) - 2;          // a plus shape round every 5th cell, a lamp in the middle
        if (fx === 0 && fz === 0) return layer.lamp;
        if (Math.abs(fx) + Math.abs(fz) === 1) return layer.flower;
    }
    const inlay = layer.inlay === 'stripes' ? mod(x + z, 4) === 0
        : layer.inlay === 'dots' ? mod(x, 3) === 1 && mod(z, 3) === 1
            : layer.inlay === 'checker' ? mod(Math.floor(x / 2) + Math.floor(z / 2), 2) === 0
                : layer.inlay === 'border' ? Math.abs(x) === h || Math.abs(z) === h : false;
    return inlay ? layer.inlayBlock : layer.block;
}

// The bridge you start on: 5 wide (x -2..2), sticking out BRIDGE blocks from the north wall.
const BRIDGE = 6;
// 3x5 digits for the level number built into the far wall
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

export function levelCommands(L) {
    const TOP = L.top, P = L.look, [cx, cz] = levelCenter(L.n), h = L.h, X = x => cx + x, Z = z => cz + z, Y = depth => TOP - depth;
    const rng = rngFor(L.n * 104729 + 99);
    const floorTop = Y(L.height) - 1, bottom = floorTop - 5, top = TOP + 14, out = [];
    // ---- the shaft: two-thick walls (the outer one `back`), everything inside cleared ----
    const W = 2 * h + 5, slab = Math.max(1, Math.floor(32000 / (W * 2))), inner = Math.max(1, Math.floor(32000 / ((2 * h + 1) ** 2)));
    for (let y = bottom; y <= top; y += slab) {
        const y2 = Math.min(top, y + slab - 1);
        out.push(`fill ${X(-h - 2)} ${y} ${Z(-h - 2)} ${X(h + 2)} ${y2} ${Z(-h - 1)} ${B(P.back)}`, `fill ${X(-h - 2)} ${y} ${Z(h + 1)} ${X(h + 2)} ${y2} ${Z(h + 2)} ${B(P.back)}`,
            `fill ${X(-h - 2)} ${y} ${Z(-h)} ${X(-h - 1)} ${y2} ${Z(h)} ${B(P.back)}`, `fill ${X(h + 1)} ${y} ${Z(-h)} ${X(h + 2)} ${y2} ${Z(h)} ${B(P.back)}`);
    }
    for (let y = bottom + 1; y <= top; y += inner) out.push(`fill ${X(-h)} ${y} ${Z(-h)} ${X(h)} ${Math.min(top, y + inner - 1)} ${Z(h)} minecraft:air`);
    out.push(`fill ${X(-h)} ${bottom} ${Z(-h)} ${X(h)} ${bottom} ${Z(h)} ${B(P.back)}`);
    // above the walls, a bit wider: nothing left of an older build (its towers stood higher)
    for (let a = top + 1; a <= top + 10; a += 2) out.push(`fill ${X(-h - 3)} ${a} ${Z(-h - 3)} ${X(h + 3)} ${a + 1} ${Z(h + 3)} minecraft:air`);
    // the inside face of each wall, in order round the shaft: [which axis is fixed, where], and
    // whether going round means going down u (so patterns that go round the shaft line up)
    const ring = [[['z', -h - 1], false], [['x', h + 1], false], [['z', h + 1], true], [['x', -h - 1], true]];
    const faces = ring.map(r => r[0]);
    const onFace = ([ax, v], u1, y1, u2, y2, b) => ax === 'z'
        ? `fill ${X(u1)} ${y1} ${Z(v)} ${X(u2)} ${y2} ${Z(v)} ${B(b)}`
        : `fill ${X(v)} ${y1} ${Z(u1)} ${X(v)} ${y2} ${Z(u2)} ${B(b)}`;
    const tall = (f, u1, y1, u2, y2, b) => {                    // a face fill split so it stays under the block limit
        const per = Math.max(1, Math.floor(32000 / (u2 - u1 + 1)));
        for (let y = y1; y <= y2; y += per) out.push(onFace(f, u1, y, u2, Math.min(y2, y + per - 1), b));
    };
    const U1 = -h - 1, U2 = h + 1, wallLo = floorTop + 1, wallHi = TOP - 9, WL = P.walls || { type: 'stripes' };
    if (P.wall !== P.back) for (const f of faces) tall(f, U1, wallLo, U2, top - 1, P.wall);
    const sp = h >= 30 ? 6 : 5, off = mod(h, sp), stripes = [];
    for (let u = -h + off; u <= h; u += sp) stripes.push(u);
    const pickOf = list => list[Math.floor(rng() * list.length)];
    // ---- the walls: each theme has its own pattern, up the whole height ----
    switch (WL.type) {
        case 'stripes': {               // full-height stripes (speed lines), lamps up every other one, panels between, trim bands
            for (const f of faces) stripes.forEach((u, i) => {
                tall(f, u, wallLo, u, wallHi, P.stripe);
                if (i % 2 === 0) for (let y = wallLo + 3; y <= wallHi; y += 7) out.push(onFace(f, u, y, u, y, P.light));
            });
            for (const f of faces) for (let i = 0; i + 1 < stripes.length; i++) {
                const u1 = stripes[i] + 2, u2 = stripes[i + 1] - 2;
                if (u2 >= u1) for (let y = wallLo + 6; y + 7 < wallHi; y += 16) out.push(onFace(f, u1, y, u2, y + 6, P.panel));
            }
            for (let y = wallLo + 24; y < wallHi; y += 48) for (const f of faces) out.push(onFace(f, U1, y, U2, y, P.trim));
            break;
        }
        case 'helix': {                 // bands of colour that wind round the shaft as you fall
            const C = WL.colors, bh = WL.band || 3, cyc = C.length * bh, segs = 3, w = Math.ceil((U2 - U1 + 1) / segs);
            ring.forEach(([f, rev], i) => {
                for (let j = 0; j < segs; j++) {
                    const u1 = U1 + j * w, u2 = Math.min(U2, u1 + w - 1), pos = i * segs + (rev ? segs - 1 - j : j), shift = Math.round(pos * cyc / (4 * segs));
                    for (let y = wallLo - mod(shift, bh); y <= wallHi; y += bh) {
                        const y1 = Math.max(wallLo, y), y2 = Math.min(wallHi, y + bh - 1);
                        if (y2 >= y1) out.push(onFace(f, u1, y1, u2, y2, C[mod(Math.floor((y - wallLo + shift) / bh), C.length)]));
                    }
                }
            });
            break;
        }
        case 'checker': {               // big two-colour checks
            const s = WL.size || 5;
            for (const f of faces) {
                tall(f, U1, wallLo, U2, wallHi, WL.a);
                for (let y = wallLo; y <= wallHi; y += s) for (let u = U1; u <= U2; u += s)
                    if (mod(Math.floor((u - U1) / s) + Math.floor((y - wallLo) / s), 2)) out.push(onFace(f, u, y, Math.min(U2, u + s - 1), Math.min(wallHi, y + s - 1), WL.b));
            }
            break;
        }
        case 'grid': {                  // lines in a grid, glowing where they cross
            const s = WL.size || 6;
            for (const f of faces) {
                tall(f, U1, wallLo, U2, wallHi, WL.a);
                for (let u = U1 + 2; u <= U2; u += s) tall(f, u, wallLo, u, wallHi, WL.line);
                for (let y = wallLo + 2; y <= wallHi; y += s) {
                    out.push(onFace(f, U1, y, U2, y, WL.line));
                    if (mod((y - wallLo - 2) / s, 2) === 0) for (let u = U1 + 2; u <= U2; u += s * 2) out.push(onFace(f, u, y, u, y, P.light));
                }
            }
            break;
        }
        case 'windows': {               // a city at night: dark towers, lit windows
            for (const f of faces) for (let y = wallLo + 2; y + 3 <= wallHi; y += 6) for (let u = U1 + 1; u + 1 <= U2; u += 4)
                if (rng() > 0.45) out.push(onFace(f, u, y, u + 1, y + 2, pickOf(WL.lit)));
            for (let y = wallLo + 30; y < wallHi; y += 60) for (const f of faces) out.push(onFace(f, U1, y, U2, y, P.trim));
            break;
        }
        case 'stars': {                 // space: stars of every colour on black
            for (const f of faces) {
                const n = Math.floor((U2 - U1 + 1) * (wallHi - wallLo) / 38);
                for (let i = 0; i < n; i++) { const u = U1 + Math.floor(rng() * (U2 - U1 + 1)), y = wallLo + Math.floor(rng() * (wallHi - wallLo)); out.push(onFace(f, u, y, u, y, pickOf(P.colors))); }
            }
            break;
        }
        case 'streaks': {               // streaks down the walls (ice, crystals, gold)
            for (const f of faces) {
                const n = Math.floor((U2 - U1 + 1) * (wallHi - wallLo) / (WL.density || 50) / 2);
                for (let i = 0; i < n; i++) {
                    const u = U1 + Math.floor(rng() * (U2 - U1 + 1)), y = wallLo + Math.floor(rng() * (wallHi - wallLo - 6)), len = 2 + Math.floor(rng() * 6);
                    out.push(onFace(f, u, y, u, Math.min(wallHi, y + len), pickOf(WL.blocks)));
                }
            }
            break;
        }
        case 'blobs': {                 // patches (leaves, coral, lava) with dots between
            for (const f of faces) {
                const n = Math.floor((U2 - U1 + 1) * (wallHi - wallLo) / 110);
                for (let i = 0; i < n; i++) {
                    const u = U1 + Math.floor(rng() * (U2 - U1 - 2)), y = wallLo + Math.floor(rng() * (wallHi - wallLo - 5));
                    out.push(onFace(f, u, y, Math.min(U2, u + 1 + Math.floor(rng() * 3)), Math.min(wallHi, y + 1 + Math.floor(rng() * 4)), pickOf(WL.blocks)));
                }
                for (let i = 0; i < n / 2; i++) { const u = U1 + Math.floor(rng() * (U2 - U1 + 1)), y = wallLo + Math.floor(rng() * (wallHi - wallLo)); out.push(onFace(f, u, y, u, y, pickOf(WL.dots))); }
            }
            break;
        }
        case 'speakers': {              // a nightclub: rows of speakers, neon strips between
            const sw = 9, gu = 12, gy = 16;
            for (const f of faces) {
                for (let y = wallLo + 4; y + sw <= wallHi; y += gy) {
                    for (let u = U1 + 2; u + sw - 1 <= U2; u += gu) {
                        out.push(onFace(f, u, y, u + 8, y + 8, 'gray_concrete'), onFace(f, u + 1, y + 1, u + 7, y + 7, 'black_concrete'),
                            onFace(f, u + 2, y + 2, u + 6, y + 6, 'gray_concrete'), onFace(f, u + 3, y + 3, u + 5, y + 5, 'black_concrete'), onFace(f, u + 4, y + 4, u + 4, y + 4, P.light));
                    }
                    out.push(onFace(f, U1, y + 12, U2, y + 12, P.stripe));
                }
            }
            break;
        }
    }
    // ---- the hall above the bridge: pillars, lit windows between them, trim bands, battlements, corner towers ----
    const back = ([ax, v]) => [ax, v + Math.sign(v)];
    for (const f of faces) {
        out.push(onFace(f, U1, TOP - 9, U2, top - 1, P.wall));
        for (const u of stripes) out.push(onFace(f, u, TOP - 9, u, top - 1, P.stripe));
        out.push(onFace(f, U1, TOP - 9, U2, TOP - 9, P.trim), onFace(f, U1, TOP - 1, U2, TOP - 1, P.trim), onFace(f, U1, TOP + 8, U2, TOP + 8, P.trim));
        for (let i = 0; i + 1 < stripes.length; i++) {
            const u1 = stripes[i] + 1, u2 = stripes[i + 1] - 1;
            if (u2 < u1) continue;
            out.push(onFace(f, u1, TOP + 2, u2, TOP + 6, P.glass), onFace(back(f), u1, TOP + 2, u2, TOP + 6, P.light));      // glass with light behind it
            out.push(onFace(f, u1, TOP - 7, u2, TOP - 4, P.glass), onFace(back(f), u1, TOP - 7, u2, TOP - 4, P.light));
        }
        out.push(onFace(f, U1, top, U2, top, P.trim));
        for (let u = U1; u <= U2; u += 2) out.push(onFace(f, u, top + 1, u, top + 1, P.stripe));      // battlements
    }
    for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const tx = a * (h + 1), tz = b * (h + 1);
        out.push(`fill ${X(tx - 1)} ${top} ${Z(tz - 1)} ${X(tx + 1)} ${top + 4} ${Z(tz + 1)} ${B(P.stripe)}`, `fill ${X(tx)} ${top + 5} ${Z(tz)} ${X(tx)} ${top + 6} ${Z(tz)} ${B(P.accent)}`, `setblock ${X(tx)} ${top + 7} ${Z(tz)} ${B(P.light)}`);
    }
    // the level number, big, in lamps in the far wall, facing you on the bridge
    const num = String(L.n).padStart(3, '0'), sc = 2, wTxt = (num.length * 4 - 1) * sc;
    out.push(onFace(faces[2], -Math.floor(wTxt / 2) - 2, TOP + 1, Math.floor(wTxt / 2) + 2, TOP + 7 + 4, P.back));      // a clean panel behind it
    for (let d = 0; d < num.length; d++) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (DIGITS[+num[d]][r * 3 + c] !== '1') continue;
        const x = Math.floor(wTxt / 2) - (d * 4 + c) * sc, y = TOP + 1 + (4 - r) * sc;           // facing south you see +x on your left
        out.push(`fill ${X(x - sc + 1)} ${y} ${Z(h + 1)} ${X(x)} ${y + sc - 1} ${Z(h + 1)} ${B(P.light)}`);
    }
    // ---- the bridge: its own colour down the middle, a lit strip, edges, railings, accent at the tip ----
    const zb1 = -h, zb2 = -h + BRIDGE - 1;
    out.push(`fill ${X(-2)} ${TOP - 1} ${Z(zb1)} ${X(2)} ${TOP - 1} ${Z(zb2)} ${B(P.edge)}`);
    out.push(`fill ${X(-1)} ${TOP - 1} ${Z(zb1)} ${X(1)} ${TOP - 1} ${Z(zb2)} ${B(P.bridge)}`);
    out.push(`fill ${X(0)} ${TOP - 1} ${Z(zb1)} ${X(0)} ${TOP - 1} ${Z(zb2 - 1)} ${B(P.light)}`);
    out.push(`fill ${X(-2)} ${TOP - 1} ${Z(zb2)} ${X(2)} ${TOP - 1} ${Z(zb2)} ${B(P.accent)}`);
    out.push(`fill ${X(-2)} ${TOP - 2} ${Z(zb1)} ${X(2)} ${TOP - 2} ${Z(zb2)} ${B(P.back)}`);
    for (const x of [-2, 2]) out.push(`fill ${X(x)} ${TOP} ${Z(zb1)} ${X(x)} ${TOP} ${Z(zb2 - 1)} ${B(P.fence)}`);
    // ---- the layers (and the city at the bottom): cells grouped by block into rectangles; the same
    // rectangle on rows under each other is one fill ----
    for (const layer of L.layers) {
        const open = new Map();
        const flush = r => out.push(`fill ${X(r[0])} ${Y(layer.depth + r[5])} ${Z(r[1])} ${X(r[2])} ${Y(layer.depth + r[4])} ${Z(r[3])} ${B(r[6])}`);
        const rowsByDy = new Map(layer.rows.map(r => [r.dy, r]));
        const dys = layer.rows.map(r => r.dy);
        for (let dy = Math.min(...dys); dy <= Math.max(...dys) + 1; dy++) {
            const row = rowsByDy.get(dy), groups = new Map(), now = new Map();
            if (row) for (const k of row.solid) { const b = blockFor(layer, row, k, h); if (!groups.has(b)) groups.set(b, new Set()); groups.get(b).add(k); }
            for (const [b, cells] of groups) for (const r of rects(cells, h)) now.set(`${b}|${r.join(',')}`, [...r, b]);
            for (const [k, r] of open) if (!now.has(k)) { flush(r); open.delete(k); }
            for (const [k, r] of now) if (!open.has(k)) open.set(k, [r[0], r[1], r[2], r[3], dy, dy, r[4]]); else open.get(k)[5] = dy;
        }
    }
    // ---- the floor: the theme's floor (checks, a dance floor...) with the first centrepiece round the
    // pool, framed in lamps and rim; on city levels, streets between the buildings ----
    for (let y = bottom + 1; y <= floorTop; y += 2) out.push(`fill ${X(-h)} ${y} ${Z(-h)} ${X(h)} ${Math.min(floorTop, y + 1)} ${Z(h)} ${B(P.plate2)}`);
    const p = L.pool, groups = new Map(), add = (b, x, z) => { if (!groups.has(b)) groups.set(b, new Set()); groups.get(b).add(key(x, z)); };
    const F = L.theme.floor, C0 = CENTERS[L.theme.centers[0]], [pcx, pcz] = center(p), FR = Math.round(h * 0.7);
    for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
        const d = distTo(x, z, p);
        if (d === 0) continue;
        if (d === 1) { add(P.light, x, z); continue; }
        if (d === 2) { add(P.rim, x, z); continue; }
        if (L.theme.city || !F) {
            const T = L.n <= 50 ? 4 : 3;
            if (mod(x + h, T) === T - 1 || mod(z + h, T) === T - 1) add(P.trim, x, z);
            continue;
        }
        const cp = C0(x - pcx, z - pcz, FR);
        if (cp) { add(ROLE(P, cp.role), x, z); continue; }
        const s = F.size || 3;
        if (F.type === 'checker') add(mod(Math.floor((x + h) / s) + Math.floor((z + h) / s), 2) ? F.b : F.a, x, z);
        else if (F.type === 'diag') add(mod(Math.floor((x + z) / s) + Math.floor((x - z) / s), 2) ? F.b : F.a, x, z);
        else if (F.type === 'dance') add(mod(x, 4) === 3 || mod(z, 4) === 3 ? 'black_concrete' : hash(x >> 2, z >> 2, L.n) > 0.8 ? P.light : P.colors[Math.floor(hash(x >> 2, z >> 2, L.n) * 10) % P.colors.length], x, z);
        else if (F.type === 'confetti') add(hash(x, z, L.n) > 0.82 ? P.colors[Math.floor(hash(z, x, L.n) * 20) % P.colors.length] : F.a, x, z);
    }
    for (const [b, cells] of groups) for (const r of rects(cells, h)) out.push(`fill ${X(r[0])} ${floorTop} ${Z(r[1])} ${X(r[2])} ${floorTop} ${Z(r[3])} ${B(b)}`);
    out.push(`fill ${X(p.x)} ${floorTop - 3} ${Z(p.z)} ${X(p.x + p.s - 1)} ${floorTop - 3} ${Z(p.z + p.s - 1)} minecraft:sea_lantern`);
    out.push(`fill ${X(p.x)} ${floorTop - 2} ${Z(p.z)} ${X(p.x + p.s - 1)} ${floorTop} ${Z(p.z + p.s - 1)} minecraft:water`);
    // the level's name over the drop with its theme, and "FAILS HERE" on the bridge (the game updates it)
    out.push(`kill @e[type=minecraft:text_display,tag=dr_sign,x=${cx},y=${TOP + 6},z=${cz},distance=..${h + 8}]`);
    out.push(`summon minecraft:text_display ${cx + 0.5} ${TOP + 10} ${cz + 0.5} {Tags:["dr_sign"],billboard:"center",scale:[4f,4f,4f],shadow:1b,text:[{text:${JSON.stringify(L.name)},color:"white",bold:true},{text:"\\n${L.theme.title}",color:"gold",bold:true}],background:0}`);
    out.push(`kill @e[type=minecraft:text_display,tag=dr_failsign,x=${cx},y=${TOP},z=${Z(zb1)},distance=..8]`);
    out.push(`summon minecraft:text_display ${cx + 0.5} ${TOP + 0.35} ${Z(zb1 + 1) + 0.5} {Tags:["dr_failsign","dr_sign"],billboard:"center",scale:[1.3f,1.3f,1.3f],shadow:1b,text:{text:"FAILS HERE: 0",color:"red",bold:true},background:0}`);
    return out;
}

// the jail cell and the winners' platform
function extraCommands() {
    const [jx, jy, jz] = JAIL, [wx, wy, wz] = WIN;
    return [
        `fill ${jx - 2} ${jy - 1} ${jz - 2} ${jx + 2} ${jy + 3} ${jz + 2} minecraft:iron_bars`,
        `fill ${jx - 2} ${jy - 1} ${jz - 2} ${jx + 2} ${jy - 1} ${jz + 2} minecraft:polished_blackstone_bricks`,
        `fill ${jx - 2} ${jy + 3} ${jz - 2} ${jx + 2} ${jy + 3} ${jz + 2} minecraft:polished_blackstone_bricks`,
        `fill ${jx - 1} ${jy} ${jz - 1} ${jx + 1} ${jy + 2} ${jz + 1} minecraft:air`,
        `fill ${wx - 6} ${wy - 1} ${wz - 6} ${wx + 6} ${wy - 1} ${wz + 6} minecraft:gold_block`,
        `fill ${wx - 2} ${wy - 1} ${wz - 2} ${wx + 2} ${wy - 1} ${wz + 2} minecraft:diamond_block`,
        `fill ${wx - 6} ${wy} ${wz - 6} ${wx + 6} ${wy} ${wz + 6} minecraft:glass hollow`,
        `fill ${wx - 5} ${wy} ${wz - 5} ${wx + 5} ${wy} ${wz + 5} minecraft:air`,
        `kill @e[type=minecraft:text_display,tag=dr_sign,x=${wx},y=${wy + 4},z=${wz},distance=..5]`,
        `summon minecraft:text_display ${wx + 0.5} ${wy + 4} ${wz + 0.5} {Tags:["dr_sign"],billboard:"center",scale:[3f,3f,3f],text:{text:"YOU BEAT ALL 100 LEVELS",color:"gold",bold:true},background:0}`,
    ];
}

// Builds every level. The building commands are functions in the data pack (dropper:build/N), so
// the game runs them itself; this just loads each level's area, runs its function and lets go.
// A big part can take the game a while. If the answer is late, wait until the game answers again
// (the part still finishes) and carry on.
async function patient(mc, command) {
    try { return await mc(command); } catch (e) {
        if (!/timeout/i.test(e.message)) throw e;
        for (let i = 0; i < 60; i++) { try { await mc('list'); return ''; } catch (e2) { if (!/timeout/i.test(e2.message)) throw e2; } }
        throw e;
    }
}
// A level's commands in parts of about the same work (blocks changed), at most 400 commands each.
function levelParts(L) {
    const parts = [[]]; let work = 0;
    for (const c of levelCommands(L)) {
        const m = /^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+)/.exec(c);
        const w = m ? (Math.abs(m[4] - m[1]) + 1) * (Math.abs(m[5] - m[2]) + 1) * (Math.abs(m[6] - m[3]) + 1) : 1;
        if (parts[parts.length - 1].length && (work + w > 400000 || parts[parts.length - 1].length >= 400)) { parts.push([]); work = 0; }
        parts[parts.length - 1].push(c); work += w;
    }
    return parts;
}
const progressFile = world => path.join(SAVES_DIR, world, 'gifthype-dropper.json');
function saveProgress(n, world = DROPPER_WORLD) {
    try { fs.writeFileSync(progressFile(world), JSON.stringify({ build: DROPPER_BUILD, levels: LEVELS, done: n, saved: new Date().toISOString() }, null, 2)); } catch { }
}
// How many levels of this build are already in the world (it carries on from there)
export function dropperProgress(world = DROPPER_WORLD) {
    try { const p = JSON.parse(fs.readFileSync(progressFile(world), 'utf8')); return p.build === DROPPER_BUILD ? Math.min(SECRET, p.done ?? p.levels ?? 0) : 0; } catch { return 0; }
}

export async function buildDropper(mc, { log = () => {}, progress = () => {}, from = 1, to = LEVELS } = {}) {
    const area = async (x1, z1, x2, z2, fn) => {
        await mc(`forceload add ${x1} ${z1} ${x2} ${z2}`);
        for (let i = 0; i < 300; i++) {
            if (/passed/i.test(await mc(`execute if loaded ${x1} 0 ${z1} if loaded ${x2} 0 ${z2} if loaded ${x1} 0 ${z2} if loaded ${x2} 0 ${z1}`))) break;
            await new Promise(r => setTimeout(r, 100));
        }
        for (const part of Array.isArray(fn) ? fn : [fn]) {
            const res = await patient(mc, `function dropper:${part}`);
            if (/Unknown|Incorrect|Expected|Invalid|not loaded|Too many|Can't find/i.test(res)) log(`Dropper build (${part}): ${res.trim().slice(0, 200)}`);
        }
        await mc(`forceload remove ${x1} ${z1} ${x2} ${z2}`);
    };
    if (from === 1) await area(Math.min(JAIL[0], WIN[0]) - 8, Math.min(JAIL[2], WIN[2]) - 8, Math.max(JAIL[0], WIN[0]) + 8, Math.max(JAIL[2], WIN[2]) + 8, 'build/extra');
    for (const L of levelRange(from, to)) {
        const [cx, cz] = levelCenter(L.n);
        const r = L.h + 3;
        await area(cx - r, cz - r, cx + r, cz + r, Array.from({ length: levelParts(L).length }, (_, i) => `build/${L.n}_${i + 1}`));
        saveProgress(L.n);
        progress(L.n);
    }
    const [sx, sy, sz] = levelStart(1);
    if (to >= LEVELS) await mc(`setworldspawn ${sx} ${sy} ${sz}`);
}

export function dropperBuilt(world = DROPPER_WORLD) {
    try { const p = JSON.parse(fs.readFileSync(progressFile(world), 'utf8')); return p.build === DROPPER_BUILD && !!p.built && (p.done ?? 0) >= SECRET; } catch { return false; }
}
export function markDropperBuilt(world = DROPPER_WORLD) {
    fs.writeFileSync(progressFile(world), JSON.stringify({ build: DROPPER_BUILD, levels: SECRET, done: SECRET, built: new Date().toISOString() }, null, 2));
}

// ---------- the data pack: the game ----------
const J = o => JSON.stringify(o);
// Minecraft 26.2's overworld, only taller (only in the Dropper world)
const TALL_OVERWORLD = {
    ambient_light: 0.0,
    attributes: {
        'minecraft:audio/ambient_sounds': { mood: { block_search_extent: 8, offset: 2.0, sound: 'minecraft:ambient.cave', tick_delay: 6000 } },
        'minecraft:audio/background_music': { creative: { max_delay: 24000, min_delay: 12000, sound: 'minecraft:music.creative' }, default: { max_delay: 24000, min_delay: 12000, sound: 'minecraft:music.game' } },
        'minecraft:gameplay/bed_rule': { can_set_spawn: 'always', can_sleep: 'when_dark', error_message: { translate: 'block.minecraft.bed.no_sleep' } },
        'minecraft:gameplay/nether_portal_spawns_piglin': true,
        'minecraft:gameplay/respawn_anchor_works': false,
        'minecraft:visual/ambient_light_color': '#0a0a0a',
        'minecraft:visual/cloud_color': '#ccffffff',
        'minecraft:visual/cloud_height': 192.33,
        'minecraft:visual/fog_color': '#c0d8ff',
        'minecraft:visual/sky_color': '#78a7ff',
    },
    coordinate_scale: 1.0, default_clock: 'minecraft:overworld', has_ceiling: false, has_ender_dragon_fight: false, has_skylight: true,
    height: WORLD_HEIGHT, infiniburn: '#minecraft:infiniburn_overworld', logical_height: WORLD_HEIGHT, min_y: WORLD_MIN,
    monster_spawn_block_light_limit: 0, monster_spawn_light_level: { type: 'minecraft:uniform', max_inclusive: 7, min_inclusive: 0 },
    timelines: '#minecraft:in_overworld',
};
export function packFiles() {
    const f = {
        'pack.mcmeta': JSON.stringify({ pack: { description: 'Unbound Dropper: 100 levels', min_format: 94, max_format: 999 } }, null, 2),
        'data/minecraft/tags/function/load.json': J({ values: ['dropper:load'] }),
        'data/minecraft/tags/function/tick.json': J({ values: ['dropper:tick'] }),
    };
    const fn = (name, lines) => { f[`data/dropper/function/${name}.mcfunction`] = lines.join('\n') + '\n'; };
    const knock = knockFiles('dropper', 'dr_');
    Object.assign(f, knock.files);
    const title = (who, text, sub, color = 'gold', subColor = 'white') => [
        `title ${who} times 3 30 8`, `title ${who} title ${J({ text, color, bold: true })}`, ...(sub ? [`title ${who} subtitle ${J({ text: sub, color: subColor })}`] : []),
    ];

    fn('load', [
        ...knock.objectives.map(o => `scoreboard objectives add ${o} dummy`),
        'scoreboard objectives add dr_level dummy', 'scoreboard objectives add dr_fails dummy', 'scoreboard objectives add dr_jail dummy', 'scoreboard objectives add dr_js dummy', 'scoreboard objectives add dr_v dummy',
        'scoreboard players set #20 dr_v 20',
        'execute unless score #punch dr_v matches 0..1 run scoreboard players set #punch dr_v 1',
        'execute unless score #shield dr_v matches 0.. run scoreboard players set #shield dr_v 0',
        'execute unless score #reset dr_v matches 0.. run scoreboard players set #reset dr_v 0',
        'execute unless data storage dropper:s save run data modify storage dropper:s save set value "Glowing Jellyfish"',
        `bossbar add dropper:level ${J({ text: 'LEVEL 01 / 100', bold: true })}`, 'bossbar set dropper:level color white', 'bossbar set dropper:level max 100', 'bossbar set dropper:level visible false',
        'scoreboard objectives add dr_life dummy', 'scoreboard objectives add dr_y dummy', 'scoreboard objectives add dr_top dummy', 'scoreboard objectives add dr_lf dummy',
        `bossbar add dropper:reset ${J({ text: 'Reset' })}`, 'bossbar set dropper:reset color red', 'bossbar set dropper:reset style notched_10',
        ...['immediate_respawn true', 'keep_inventory true', 'advance_time false', 'advance_weather false', 'spawn_mobs false', 'spawn_monsters false',
            'show_death_messages false', 'spawn_phantoms false', 'spawn_wandering_traders false', 'fall_damage false', 'mob_griefing false',
            'command_block_output false', 'respawn_radius 0', 'locator_bar false'].map(g => `gamerule ${g}`),
        'time set 6000', 'weather clear',
    ]);
    fn('tick', [
        'execute as @a[tag=!dr_in] run function dropper:join',
        // landed in the water: on to the next level
        'execute as @a[tag=dr_in] at @s if block ~ ~ ~ minecraft:water if block ~0.3 ~ ~0.3 minecraft:water if block ~-0.3 ~ ~-0.3 minecraft:water if block ~0.3 ~ ~-0.3 minecraft:water if block ~-0.3 ~ ~0.3 minecraft:water unless score @s dr_jail matches 1.. run function dropper:landed',
        // touched something on the way down (anywhere under the ledge that isn't the water): start the level again
        // (your height x10 against your level's: anything you stand on 1.6 blocks or more under the bridge)
        'execute as @a[tag=dr_in] store result score @s dr_y run data get entity @s Pos[1] 10',
        'execute as @a[tag=dr_in] at @s if predicate dropper:on_ground unless score @s dr_jail matches 1.. if score @s dr_y < @s dr_top run function dropper:fail',
        // fell out of the levels somehow: back to your level
        `execute as @a[tag=dr_in] at @s unless score @s dr_jail matches 1.. positioned ~ ${WORLD_MIN} ~ if entity @s[dy=1] run function dropper:goto`,
        'execute as @a[scores={dr_jail=1..}] run function dropper:jail/tick',
        'execute as @e[tag=dr_alert] run function dropper:alert/tick',
        // gift punches (arrows or sword hits), one at a time
        ...knock.tick,
        'execute if score #reset dr_v matches 1.. run function dropper:reset/tick',
        'scoreboard players add #hud dr_v 1',
        'execute if score #hud dr_v matches 10.. as @a[tag=dr_in] run function dropper:hud',
        'execute if score #hud dr_v matches 10.. run scoreboard players set #hud dr_v 0',
    ]);
    fn('join', [
        'tag @s add dr_in', 'gamemode adventure @s', 'clear @s',
        'execute unless score @s dr_level matches 1.. run scoreboard players set @s dr_level 1',
        'function dropper:goto',
        ...title('@s', 'THE DROPPER', '100 levels, every one a different place. Land in the water to go on.'),
    ]);
    fn('hud', [
        'effect give @s minecraft:night_vision infinite 0 true', 'effect give @s minecraft:saturation infinite 0 true',
        // your level is on the info line at the bottom with the rest (the Unbound HUD mod reads that line)
        'execute store result storage dropper:h level int 1 run scoreboard players get @s dr_level',
        'execute if score @s dr_level matches 101 run data modify storage dropper:h level set value "101-SECRET"',
        'scoreboard players operation @s dr_js = @s dr_jail', 'scoreboard players add @s dr_js 19', 'scoreboard players operation @s dr_js /= #20 dr_v',
        `execute if score @s dr_jail matches 1.. run return run title @s actionbar ${J([{ text: 'IN JAIL  ', color: 'red', bold: true }, { score: { name: '@s', objective: 'dr_js' }, color: 'white', bold: true }, { text: 's', color: 'red', bold: true }])}`,
        `execute if score @s dr_level matches 102.. run return run title @s actionbar ${J({ text: 'EVERY LEVEL DONE', color: 'gold', bold: true })}`,
        'execute store result storage dropper:h shield int 1 run scoreboard players get #shield dr_v',
        'execute store result storage dropper:h fails int 1 run scoreboard players get @s dr_fails',
        'data modify storage dropper:h punch set value "ON"', 'execute if score #punch dr_v matches 0 run data modify storage dropper:h punch set value "OFF"',
        'data modify storage dropper:h pc set value "red"', 'execute if score #punch dr_v matches 0 run data modify storage dropper:h pc set value "green"',
        'execute if score #shield dr_v matches 1.. run return run function dropper:hud_shield with storage dropper:h',
        'function dropper:hud_line with storage dropper:h',
    ]);
    fn('hud_bar', [
        '$bossbar set dropper:level name {"text":"LEVEL $(pad)$(level) / 100","color":"white","bold":true}',
        'execute store result bossbar dropper:level value run scoreboard players get @s dr_level',
        'bossbar set dropper:level players @a[tag=dr_in]',
    ]);
    // A gift's alert, in front of you for a few seconds and following your view: a spinning sun,
    // the sender's name in big letters and what they did.
    fn('alert', [
        'kill @e[tag=dr_alert]',
        '$execute at @s anchored eyes positioned ^ ^0.4 ^5 run summon minecraft:text_display ~ ~ ~ {Tags:["dr_alert","dr_alert_text","dr_new"],billboard:"center",teleport_duration:2,shadow:1b,background:0,scale:[1.3f,1.3f,1.3f],text:[{text:"$(who)",color:"gold",bold:true},{text:"\\n$(what)",color:"$(color)"}]}',
        'execute at @s anchored eyes positioned ^ ^1.6 ^5.2 run summon minecraft:item_display ~ ~ ~ {Tags:["dr_alert","dr_alert_sun","dr_new"],billboard:"center",teleport_duration:2,item:{id:"minecraft:sunflower",count:1},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[1.6f,1.6f,1.6f]}}',
        'scoreboard players set @e[tag=dr_new] dr_life 70', 'tag @e[tag=dr_new] remove dr_new',
        'execute at @s anchored eyes positioned ^ ^1.6 ^5 run particle minecraft:end_rod ~ ~ ~ 0.5 0.5 0.5 0.08 40 force @s',
    ]);
    fn('alert/tick', [
        'scoreboard players remove @s dr_life 1',
        'execute if score @s dr_life matches ..0 run return run kill @s',
        'execute if entity @s[tag=dr_alert_text] at @p[tag=dr_in] anchored eyes positioned ^ ^0.4 ^5 run tp @s ~ ~ ~',
        'execute if entity @s[tag=dr_alert_sun] at @p[tag=dr_in] anchored eyes positioned ^ ^1.6 ^5.2 run tp @s ~ ~ ~',
        'scoreboard players operation #m dr_v = @s dr_life', 'scoreboard players operation #m dr_v %= #20 dr_v',
        'execute if entity @s[tag=dr_alert_sun] if score #m dr_v matches 0 run data merge entity @s {start_interpolation:0,interpolation_duration:10,transformation:{left_rotation:[0f,0f,1f,0f]}}',
        'execute if entity @s[tag=dr_alert_sun] if score #m dr_v matches 10 run data merge entity @s {start_interpolation:0,interpolation_duration:10,transformation:{left_rotation:[0f,0f,0f,1f]}}',
    ]);
    fn('hud_line', [`$title @s actionbar [${J({ text: 'Level ', color: 'gold' })},{"text":"$(level)","color":"white","bold":true},${J({ text: '     Fails ', color: 'gold' })},${J({ text: '$(fails)', color: 'white' })},${J({ text: '     Punches ', color: 'gold' })},{"text":"$(punch)","color":"$(pc)","bold":true}]`]);
    fn('hud_shield', [`$title @s actionbar [${J({ text: 'Level ', color: 'gold' })},{"text":"$(level)","color":"white","bold":true},${J({ text: '     Fails ', color: 'gold' })},${J({ text: '$(fails)', color: 'white' })},${J({ text: '     Punches ', color: 'gold' })},{"text":"$(punch)","color":"$(pc)","bold":true},${J({ text: '     Shield x$(shield)', color: 'aqua', bold: true })}]`]);

    // go to the start of your level (not while you're in jail: you go there when you're let out)
    const levels = Array.from({ length: SECRET }, (_, i) => levelInfo(i + 1));
    fn('goto', [
        'execute if score @s dr_jail matches 1.. run return 0',
        'execute if score @s dr_level matches ..0 run scoreboard players set @s dr_level 1',
        'execute if score @s dr_level matches 102.. run return run function dropper:win_tp',
        ...levels.map(L => `execute if score @s dr_level matches ${L.n} run return run function dropper:lvl/${L.n}`),
    ]);
    for (const L of levels) {
        const [x, y, z] = levelStart(L.n);
        fn(`lvl/${L.n}`, [
            'execute unless entity @s[tag=dr_quiet] run scoreboard players set @s dr_lf 0',
            `tp @s ${x + 0.5} ${y} ${z + 0.5} 0 20`, `spawnpoint @s ${x} ${y} ${z} 0 0`, `scoreboard players set @s dr_top ${y * 10 - 16}`,
            ...(L.n === SECRET ? [`title @s times 5 60 15`, `title @s title ${J({ text: 'SECRET LEVEL 101', color: 'light_purple', bold: true })}`, `title @s subtitle ${J({ text: 'One try. Touch anything and you are back on level 100', color: 'white' })}`]
                : [`title @s times 3 30 8`, `title @s title ${J({ text: `Level ${L.n}`, color: 'gold', bold: true })}`, `title @s subtitle ${J([{ text: L.title || '', color: 'aqua', bold: true }, { text: '  ' + L.name, color: 'white' }])}`]).map(l => `execute unless entity @s[tag=dr_quiet] run ${l}`),
            ...(L.n > 1 && L.n <= LEVELS && (L.n - 1) % 10 === 0 ? [`title @s times 5 50 12`, `title @s title ${J({ text: `${L.n - 1} LEVELS DONE!`, color: 'gold', bold: true })}`, `title @s subtitle ${J({ text: `${LEVELS - L.n + 1} to go`, color: 'yellow', bold: true })}`, 'playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 0.8 1.2'].map(l => `execute if entity @s[tag=dr_landed] run ${l}`) : []),
            'execute at @s run function dropper:failsign_show',
        ]);
    }
    f['data/minecraft/dimension_type/overworld.json'] = JSON.stringify(TALL_OVERWORLD, null, 2);
    f['data/dropper/predicate/on_ground.json'] = J({ condition: 'minecraft:entity_properties', entity: 'this', predicate: { flags: { is_on_ground: true } } });
    fn('failsign_show', ['execute store result storage dropper:h lf int 1 run scoreboard players get @s dr_lf', 'function dropper:failsign with storage dropper:h']);
    fn('failsign', ['$execute as @e[type=minecraft:text_display,tag=dr_failsign,sort=nearest,limit=1] run data merge entity @s {text:{text:"FAILS HERE: $(lf)",color:"red",bold:true}}']);
    fn('landed_done', ['tag @a remove dr_landed']);
    fn('fail', [
        'scoreboard players add @s dr_fails 1', 'scoreboard players add @s dr_lf 1',
        'execute if score @s dr_level matches 101 run return run function dropper:secret_fail',
        'playsound minecraft:block.note_block.bass master @s ~ ~ ~ 1 0.6', 'playsound minecraft:entity.player.hurt master @s ~ ~ ~ 0.6 1',
        'tag @s add dr_quiet', 'function dropper:goto', 'tag @s remove dr_quiet',
    ]);
    fn('landed', [
        'playsound minecraft:entity.player.levelup master @s ~ ~ ~ 1 1.2',
        'scoreboard players add @s dr_level 1', 'tag @s add dr_landed', 'schedule function dropper:landed_done 1t',
        'execute if score @s dr_level matches 102.. run return run function dropper:win',
        'execute if score @s dr_level matches 101 run return run function dropper:secret_enter',
        'function dropper:goto',
    ]);
    // the secret level: found by beating level 100
    fn('secret_enter', [
        'function dropper:goto',
        'playsound minecraft:block.end_portal.spawn master @s ~ ~ ~ 1 1',
        'playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 1 0.7',
        `tellraw @a [${J({ text: 'A SECRET LEVEL HAS BEEN FOUND: ', color: 'light_purple', bold: true })},${J({ text: 'one try, or it is back to level 100', color: 'white' })}]`,
    ]);
    fn('secret_fail', [
        'scoreboard players set @s dr_level 100', 'scoreboard players set @s dr_lf 0',
        'playsound minecraft:entity.wither.death master @s ~ ~ ~ 0.7 1.2',
        'tag @s add dr_quiet', 'function dropper:goto', 'tag @s remove dr_quiet',
        ...title('@s', 'BACK TO LEVEL 100', 'The secret level only gives you one try', 'red'),
    ]);
    const [wx, wy, wz] = WIN;
    fn('win_tp', [`tp @s ${wx + 0.5} ${wy} ${wz + 0.5}`, `spawnpoint @s ${wx} ${wy} ${wz}`, 'scoreboard players set @s dr_top -100000']);
    fn('win', [
        'scoreboard players set @s dr_level 102', 'function dropper:win_tp',
        ...title('@s', 'YOU BEAT THE DROPPER', 'All 100 levels and the secret one!'),
        'playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 1 1',
        ...[[3, 0, 16711680], [-3, 2, 65280], [0, -3, 3447003], [2, 3, 16766720]].map(([dx, dz, col]) =>
            `summon minecraft:firework_rocket ~${dx} ~1 ~${dz} {LifeTime:30,FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{flight_duration:2,explosions:[{shape:"large_ball",colors:[I;${col}],has_trail:1b,has_twinkle:1b}]}}}}`),
    ]);

    // gifts: levels up and down (you can't be gifted past level 100: the last one is yours to land)
    fn('up', [
        'execute if score @s dr_level matches 100.. run return 0',
        '$scoreboard players add @s dr_level $(n)',
        'execute if score @s dr_level matches 101.. run scoreboard players set @s dr_level 100',
        'playsound minecraft:entity.player.levelup master @s ~ ~ ~ 1 1.5',
        '$title @s actionbar {"text":"+$(n) level(s)!","color":"green","bold":true}',
        'function dropper:goto',
    ]);
    fn('down', [
        '$scoreboard players remove @s dr_level $(n)',
        'execute if score @s dr_level matches ..0 run scoreboard players set @s dr_level 1',
        'playsound minecraft:entity.villager.no master @s ~ ~ ~ 1 0.8',
        '$title @s actionbar {"text":"-$(n) level(s)","color":"red","bold":true}',
        'function dropper:goto',
    ]);

    // gifts: jail. Back to the top of your level, locked in a cage on the bridge for a while.
    fn('jail', [
        'execute unless score @s dr_jail matches 1.. run function dropper:jail/enter',
        '$scoreboard players add @s dr_jail $(ticks)',
        'execute if score @s dr_jail matches 7200.. run scoreboard players set @s dr_jail 7200',
    ]);
    // (the cage's place is kept with a marker, so it's always taken away, wherever you are by then)
    fn('jail/enter', [
        'function dropper:jail/clear',
        'tag @s add dr_quiet', 'function dropper:goto', 'tag @s remove dr_quiet',
        'execute at @s align xyz run summon minecraft:marker ~ ~ ~ {Tags:["dr_jailpos"]}',
        'execute at @s align xyz run fill ~-1 ~ ~-1 ~1 ~2 ~1 minecraft:iron_bars replace minecraft:air',
        'execute at @s align xyz run fill ~ ~ ~ ~ ~1 ~ minecraft:air replace minecraft:iron_bars',
        'execute at @s align xyz run fill ~-1 ~3 ~-1 ~1 ~3 ~1 minecraft:iron_bars replace minecraft:air',
        'effect give @s minecraft:jump_boost 9999 250 true',
        'playsound minecraft:block.iron_door.close master @s ~ ~ ~ 1 0.8', ...title('@s', 'JAILED', 'on the bridge', 'red'),
    ]);
    fn('jail/tick', ['scoreboard players remove @s dr_jail 1', 'execute if score @s dr_jail matches ..0 run function dropper:jail/free']);
    fn('jail/clear', ['execute at @e[type=minecraft:marker,tag=dr_jailpos] run fill ~-1 ~ ~-1 ~1 ~3 ~1 minecraft:air replace minecraft:iron_bars', 'kill @e[type=minecraft:marker,tag=dr_jailpos]']);
    fn('jail/free', ['scoreboard players set @s dr_jail 0', 'function dropper:jail/clear', 'execute at @s run fill ~-1 ~ ~-1 ~1 ~3 ~1 minecraft:air replace minecraft:iron_bars', 'effect clear @s minecraft:jump_boost', 'playsound minecraft:block.iron_door.open master @s ~ ~ ~ 1 1', 'tag @s add dr_quiet', 'function dropper:goto', 'tag @s remove dr_quiet', ...title('@s', 'FREE', '', 'green')]);

    // gifts: punches (arrows or sword hits: knock.js)
    fn('punch_toggle', [
        'execute store success score #was dr_v if score #punch dr_v matches 1',
        'execute if score #was dr_v matches 1 run scoreboard players set #punch dr_v 0',
        'execute if score #was dr_v matches 0 run scoreboard players set #punch dr_v 1',
        ...title('@a', 'PUNCHES ON', 'Arrows and swords can knock you around', 'red').map(l => `execute if score #punch dr_v matches 1 run ${l}`),
        ...title('@a', 'PUNCHES OFF', 'No more arrows or swords', 'green').map(l => `execute if score #punch dr_v matches 0 run ${l}`),
        'execute as @a at @s run playsound minecraft:block.lever.click master @s ~ ~ ~ 1 1',
    ]);

    // gifts: the reset countdown (back to level 1 at 0), and the save that stops it or shields you
    fn('reset/start', [
        '$data modify storage dropper:s save set value "$(save)"',
        'execute if score #shield dr_v matches 1.. run return run function dropper:reset/blocked',
        'execute if score #reset dr_v matches 1.. run return 0',
        '$scoreboard players set #reset dr_v $(ticks)',
        '$bossbar set dropper:reset max $(secs)',
        'bossbar set dropper:reset players @a', 'bossbar set dropper:reset visible true',
        'function dropper:reset/second',
        ...title('@a', 'RESET INCOMING', '').slice(0, 2),
        '$title @a subtitle {"text":"$(save) saves you","color":"aqua"}',
        'execute as @a at @s run playsound minecraft:block.bell.use master @s ~ ~ ~ 1 0.6',
    ]);
    fn('reset/blocked', [
        'scoreboard players remove #shield dr_v 1',
        ...title('@a', 'RESET BLOCKED', 'Your shield took it', 'aqua'),
        'execute as @a at @s run playsound minecraft:item.shield.block master @s ~ ~ ~ 1 1',
    ]);
    fn('reset/tick', [
        'scoreboard players remove #reset dr_v 1',
        'scoreboard players operation #m dr_v = #reset dr_v', 'scoreboard players operation #m dr_v %= #20 dr_v',
        'execute if score #m dr_v matches 0 run function dropper:reset/second',
        'execute if score #reset dr_v matches ..0 run function dropper:reset/boom',
    ]);
    fn('reset/second', [
        'scoreboard players operation #secs dr_v = #reset dr_v', 'scoreboard players add #secs dr_v 19', 'scoreboard players operation #secs dr_v /= #20 dr_v',
        'execute store result bossbar dropper:reset value run scoreboard players get #secs dr_v',
        'execute store result storage dropper:s secs int 1 run scoreboard players get #secs dr_v',
        'function dropper:reset/name with storage dropper:s',
        'execute if score #secs dr_v matches 1..10 run function dropper:reset/flash with storage dropper:s',
    ]);
    fn('reset/name', [`$bossbar set dropper:reset name [${J({ text: 'RESET IN $(secs)s', color: 'red', bold: true })},${J({ text: '   $(save) saves you', color: 'aqua' })}]`]);
    fn('reset/flash', ['title @a times 0 14 4', '$title @a title {"text":"$(secs)","color":"red","bold":true}', 'title @a subtitle ""', 'execute as @a at @s run playsound minecraft:block.note_block.pling master @s ~ ~ ~ 1 0.8']);
    fn('reset/boom', [
        'scoreboard players set #reset dr_v 0', 'bossbar set dropper:reset visible false',
        'execute as @a[tag=dr_in] run scoreboard players set @s dr_level 1',
        'execute as @a[tag=dr_in] run function dropper:goto',
        ...title('@a', 'RESET!', 'Back to level 1', 'red'),
        'execute as @a at @s run playsound minecraft:entity.wither.death master @s ~ ~ ~ 0.6 1',
    ]);
    fn('save', [
        'execute if score #reset dr_v matches 1.. run return run function dropper:save/stop',
        'scoreboard players add #shield dr_v 1', 'execute if score #shield dr_v matches 4.. run scoreboard players set #shield dr_v 3',
        ...title('@a', 'SHIELD READY', 'The next reset gets blocked', 'aqua'),
        'execute as @a at @s run playsound minecraft:item.armor.equip_diamond master @s ~ ~ ~ 1 1',
    ]);
    fn('save/stop', [
        'scoreboard players set #reset dr_v 0', 'bossbar set dropper:reset visible false',
        ...title('@a', 'SAVED!', 'The reset is stopped', 'green'),
        'execute as @a at @s run playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 1 1.2',
    ]);
    return f;
}
function buildPackFiles(from, to) {
    const f = { 'pack.mcmeta': JSON.stringify({ pack: { description: 'Unbound Dropper: building the levels', min_format: 94, max_format: 999 } }, null, 2) };
    if (from === 1) f['data/dropper/function/build/extra.mcfunction'] = extraCommands().join('\n') + '\n';
    for (const L of levelRange(from, to)) levelParts(L).forEach((p, i) => { f[`data/dropper/function/build/${L.n}_${i + 1}.mcfunction`] = p.join('\n') + '\n'; });
    return f;
}
const BUILD_PACK = 'giftdropper_build';
export function installDropperBuildPack(world = DROPPER_WORLD, from = 1, to = LEVELS) {
    const root = path.join(SAVES_DIR, world, 'datapacks', BUILD_PACK);
    fs.rmSync(root, { recursive: true, force: true });
    for (const [rel, text] of Object.entries(buildPackFiles(from, to))) { const q = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(q), { recursive: true }); fs.writeFileSync(q, text); }
    return `file/${BUILD_PACK}`;
}
export function removeDropperBuildPack(world = DROPPER_WORLD) { fs.rmSync(path.join(SAVES_DIR, world, 'datapacks', BUILD_PACK), { recursive: true, force: true }); }

// Writes the pack into the Dropper world (making its folder if the world isn't made yet).
// Returns true if anything changed.
export function installDropperPack(world = DROPPER_WORLD) {
    const root = path.join(SAVES_DIR, world, 'datapacks', 'giftdropper');
    const files = packFiles();
    let changed = false;
    for (const [rel, text] of Object.entries(files)) {
        const p = path.join(root, ...rel.split('/'));
        if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text) continue;
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
        changed = true;
    }
    // files from older versions (the level building used to live in this pack)
    const prune = (dir, rel) => {
        for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
            const q = path.join(dir, e.name), r = `${rel}/${e.name}`;
            if (e.isDirectory()) { prune(q, r); if (!fs.readdirSync(q).length) fs.rmdirSync(q); }
            else if (!files[r]) { fs.rmSync(q); changed = true; }
        }
    };
    prune(path.join(root, 'data'), 'data');
    return changed;
}

// The commands for a Dropper gift action (run as you, at you).
export const DROPPER_ACTIONS = new Set(['punch', 'punchToggle', 'levelUp', 'levelDown', 'resetTimer', 'saveReset', 'jail', 'levelWheel']);
// The level slot machine: the amounts on its reel ("-10, -5, -1, 1, 5, 10"), the default if none are set
export function wheelAmounts(a) {
    const list = String(a.amounts ?? '').split(/[\s,;]+/).map(x => Math.round(+x)).filter(x => Number.isFinite(x) && x !== 0 && Math.abs(x) <= 99);
    return list.length ? [...new Set(list)] : [-10, -5, -3, -1, 1, 3, 5, 10];
}
export function dropperCommands(a, times, { saveGift = 'Glowing Jellyfish' } = {}) {
    const n = (v, lo, hi, def) => Math.max(lo, Math.min(hi, Number.isFinite(+v) && +v > 0 ? Math.round(+v) : def));
    switch (a.type) {
        case 'punch': return [knockCommand('dropper', a, Math.min(n(a.amount, 1, 10, 1) * times, MAX_PUNCHES_PER_GIFT))];
        case 'punchToggle': return ['function dropper:punch_toggle'];
        case 'levelUp': return [`function dropper:up {n:${Math.min(99, n(a.amount, 1, 99, 1) * times)}}`];
        case 'levelDown': return [`function dropper:down {n:${Math.min(99, n(a.amount, 1, 99, 1) * times)}}`];
        case 'resetTimer': { const s = n(a.seconds, 5, 600, 60); return [`function dropper:reset/start {ticks:${s * 20},secs:${s},save:"${String(saveGift).replace(/[^\w ]/g, '').slice(0, 30) || 'a save gift'}"}`]; }
        case 'saveReset': return ['function dropper:save'];
        case 'jail': return [`function dropper:jail {ticks:${Math.min(7200, n(a.seconds, 1, 360, 5) * times * 20)}}`];
        default: return [];
    }
}

// The alert shown in the game for a gift: the sender's name and what it did ("punched you x2",
// "+5 levels"...). Returns the command to run as you.
export function dropperAlertText(rule, count) {
    const times = rule.perCount ? count : 1, n = (v, d) => Math.max(1, Math.round(+v || d));
    let color = 'white';
    const parts = rule.actions.map(a => {
        switch (a.type) {
            case 'punch': { const k = n(a.amount, 1) * times; color = 'red'; return `${a.style === 'sword' ? 'hit you with a sword' : 'punched you'}${k > 1 ? ` x${k}` : ''}`; }
            case 'levelUp': { const k = n(a.amount, 1) * times; color = 'green'; return `+${k} level${k > 1 ? 's' : ''}`; }
            case 'levelDown': { const k = n(a.amount, 1) * times; color = 'red'; return `-${k} level${k > 1 ? 's' : ''}`; }
            case 'jail': color = 'red'; return `jailed you for ${n(a.seconds, 5) * times}s`;
            case 'resetTimer': color = 'red'; return 'started a RESET';
            case 'saveReset': color = 'aqua'; return 'saved you!';
            case 'punchToggle': color = 'yellow'; return 'switched punches';
            case 'levelWheel': color = 'yellow'; return 'spun the level slots';
            default: return null;
        }
    }).filter(Boolean);
    return { what: parts.join(', ') || rule.label || 'sent a gift', color };
}

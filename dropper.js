// The Dropper: a 100-level dropper that Gift Hype builds in its own world ("Gift Hype Dropper").
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
// data pack in the world, so it works the same however the world is opened. Gift Hype sends the
// gift actions as function calls.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVES_DIR } from './singleplayer.js';

// "2": the levels got twice as tall, so the world needs a taller sky than an existing world can be
// given. The first Dropper world ("Gift Hype Dropper") is left as it was.
export const DROPPER_WORLD = 'Gift Hype Dropper 2';
export const DROPPER_BUILD = 9;                 // bump when the levels change, to rebuild them
export const LEVELS = 100;
// The Dropper world's sky goes up to y=959 (normal worlds stop at 319), set by the pack when the
// world is made, so the falls can be about 700 blocks.
const WORLD_MIN = -64, WORLD_HEIGHT = 1024;
const TOP = 900;                                 // your feet on the start ledge
const ORIGIN = 3000, SPACING = 100;              // level 1 at x=3000 z=3000, 10 levels per row
const JAIL = [900, TOP, 900];
const WIN = [880, TOP, 1000];

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
// wall: the main wall block then two blocks it's patched with; trim: bands round the walls and
// window frames; light: lamps; ob: obstacle blocks; rim: the edge round holes; floor: the
// landing target rings; win: window glass.
const th = (name, wall, trim, light, ledge, ob, rim, floor, win) => ({ name, wall, trim, light, ledge, ob, rim, floor, win });
const THEMES = [
    th('Stone', ['stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks'], 'chiseled_stone_bricks', 'glowstone', 'polished_andesite', ['spruce_planks', 'oak_planks'], 'stripped_oak_log', ['smooth_stone', 'polished_andesite'], 'glass'),
    th('Sandstone', ['cut_sandstone', 'sandstone', 'smooth_sandstone'], 'chiseled_sandstone', 'ochre_froglight', 'chiseled_sandstone', ['orange_terracotta', 'terracotta'], 'cut_red_sandstone', ['smooth_sandstone', 'orange_terracotta'], 'orange_stained_glass'),
    th('Prismarine', ['prismarine_bricks', 'prismarine', 'dark_prismarine'], 'dark_prismarine', 'sea_lantern', 'prismarine_bricks', ['dark_prismarine', 'prismarine'], 'sea_lantern', ['prismarine_bricks', 'dark_prismarine'], 'cyan_stained_glass'),
    th('Nether', ['nether_bricks', 'cracked_nether_bricks', 'chiseled_nether_bricks'], 'red_nether_bricks', 'shroomlight', 'polished_blackstone', ['red_nether_bricks', 'nether_wart_block'], 'magma_block', ['nether_bricks', 'red_nether_bricks'], 'red_stained_glass'),
    th('Quartz', ['quartz_bricks', 'quartz_block', 'smooth_quartz'], 'chiseled_quartz_block', 'sea_lantern', 'quartz_pillar', ['black_concrete', 'gray_concrete'], 'gold_block', ['white_concrete', 'black_concrete'], 'white_stained_glass'),
    th('Frozen', ['packed_ice', 'blue_ice', 'snow_block'], 'snow_block', 'sea_lantern', 'snow_block', ['blue_ice', 'packed_ice'], 'white_concrete', ['snow_block', 'light_blue_concrete'], 'light_blue_stained_glass'),
    th('Mossy', ['mossy_stone_bricks', 'mossy_cobblestone', 'stone_bricks'], 'moss_block', 'ochre_froglight', 'mossy_cobblestone', ['moss_block', 'oak_leaves[persistent=true]'], 'flowering_azalea_leaves[persistent=true]', ['moss_block', 'grass_block'], 'lime_stained_glass'),
    th('Cherry', ['cherry_planks', 'stripped_cherry_wood', 'cherry_wood'], 'pink_terracotta', 'pearlescent_froglight', 'stripped_cherry_wood', ['pink_concrete', 'cherry_leaves[persistent=true]'], 'white_concrete', ['pink_concrete', 'white_concrete'], 'pink_stained_glass'),
    th('Copper', ['waxed_cut_copper', 'waxed_exposed_cut_copper', 'waxed_copper_block'], 'waxed_chiseled_copper', 'waxed_copper_bulb[lit=true]', 'waxed_copper_block', ['waxed_oxidized_cut_copper', 'waxed_weathered_cut_copper'], 'waxed_copper_block', ['waxed_cut_copper', 'waxed_oxidized_cut_copper'], 'orange_stained_glass'),
    th('Deepslate', ['deepslate_tiles', 'cracked_deepslate_tiles', 'deepslate_bricks'], 'chiseled_deepslate', 'verdant_froglight', 'polished_deepslate', ['polished_blackstone', 'deepslate_tiles'], 'verdant_froglight', ['deepslate_tiles', 'polished_deepslate'], 'gray_stained_glass'),
    th('Purpur', ['purpur_block', 'purpur_pillar', 'end_stone_bricks'], 'end_stone_bricks', 'sea_lantern', 'purpur_pillar', ['end_stone_bricks', 'end_stone'], 'purpur_pillar', ['purpur_block', 'end_stone'], 'magenta_stained_glass'),
    th('Terracotta', ['white_terracotta', 'light_gray_terracotta', 'white_terracotta'], 'brown_terracotta', 'glowstone', 'light_gray_terracotta', ['orange_terracotta', 'brown_terracotta', 'white_terracotta'], 'smooth_sandstone', ['orange_terracotta', 'white_terracotta'], 'orange_stained_glass'),
    th('Blossom', ['white_wool', 'white_concrete', 'pink_wool'], 'pink_concrete', 'pearlescent_froglight', 'white_wool', ['pink_wool', 'white_wool'], 'white_concrete', ['pink_concrete', 'white_concrete'], 'pink_stained_glass'),
    th('Mud', ['mud_bricks', 'packed_mud', 'mud_bricks'], 'mangrove_planks', 'shroomlight', 'muddy_mangrove_roots', ['packed_mud', 'mangrove_planks'], 'mangrove_planks', ['mangrove_planks', 'packed_mud'], 'brown_stained_glass'),
    th('Amethyst', ['amethyst_block', 'calcite', 'smooth_basalt'], 'smooth_basalt', 'sea_lantern', 'calcite', ['purple_concrete', 'amethyst_block'], 'calcite', ['amethyst_block', 'calcite'], 'purple_stained_glass'),
    th('Blackstone', ['polished_blackstone_bricks', 'cracked_polished_blackstone_bricks', 'blackstone'], 'gilded_blackstone', 'shroomlight', 'chiseled_polished_blackstone', ['gilded_blackstone', 'polished_blackstone'], 'gold_block', ['polished_blackstone', 'gold_block'], 'black_stained_glass'),
    th('Bamboo', ['bamboo_planks', 'bamboo_mosaic', 'stripped_bamboo_block'], 'bamboo_block', 'glowstone', 'stripped_bamboo_block', ['bamboo_mosaic', 'bamboo_planks'], 'lime_concrete', ['bamboo_planks', 'bamboo_mosaic'], 'lime_stained_glass'),
    th('Tuff', ['tuff_bricks', 'polished_tuff', 'chiseled_tuff_bricks'], 'chiseled_tuff', 'pearlescent_froglight', 'chiseled_tuff', ['polished_tuff', 'tuff_bricks'], 'waxed_cut_copper', ['tuff_bricks', 'polished_tuff'], 'glass'),
    th('Sky Glass', ['light_blue_stained_glass', 'white_stained_glass', 'light_blue_stained_glass'], 'smooth_quartz', 'sea_lantern', 'smooth_quartz', ['white_concrete', 'light_blue_concrete'], 'light_blue_concrete', ['white_concrete', 'light_blue_concrete'], 'glass'),
    th('Concrete', ['gray_concrete', 'light_gray_concrete', 'gray_concrete'], 'black_concrete', 'sea_lantern', 'light_gray_concrete', ['cyan_concrete', 'light_gray_concrete'], 'black_concrete', ['cyan_concrete', 'black_concrete'], 'cyan_stained_glass'),
];
const BOSS_THEMES = [
    th('Obsidian', ['obsidian', 'crying_obsidian', 'obsidian'], 'polished_blackstone_bricks', 'shroomlight', 'polished_blackstone', ['crying_obsidian', 'obsidian'], 'magma_block', ['obsidian', 'crying_obsidian'], 'purple_stained_glass'),
    th('Emerald', ['emerald_block', 'dark_prismarine', 'emerald_block'], 'smooth_stone', 'sea_lantern', 'smooth_stone', ['dark_prismarine', 'emerald_block'], 'gold_block', ['emerald_block', 'smooth_stone'], 'lime_stained_glass'),
    th('Redstone', ['red_nether_bricks', 'redstone_block', 'nether_bricks'], 'polished_blackstone', 'shroomlight', 'polished_blackstone', ['redstone_block', 'red_concrete'], 'shroomlight', ['red_concrete', 'black_concrete'], 'red_stained_glass'),
    th('Lapis', ['lapis_block', 'blue_concrete', 'lapis_block'], 'smooth_quartz', 'sea_lantern', 'smooth_quartz', ['white_concrete', 'lapis_block'], 'gold_block', ['lapis_block', 'white_concrete'], 'blue_stained_glass'),
    th('Sculk', ['sculk', 'deepslate_tiles', 'sculk'], 'reinforced_deepslate', 'verdant_froglight', 'polished_deepslate', ['reinforced_deepslate', 'sculk'], 'verdant_froglight', ['sculk', 'deepslate_tiles'], 'cyan_stained_glass'),
    th('Crimson', ['crimson_planks', 'stripped_crimson_stem', 'crimson_planks'], 'crimson_hyphae', 'shroomlight', 'crimson_nylium', ['nether_wart_block', 'crimson_planks'], 'shroomlight', ['crimson_nylium', 'nether_wart_block'], 'red_stained_glass'),
    th('Warped', ['warped_planks', 'stripped_warped_stem', 'warped_planks'], 'warped_hyphae', 'shroomlight', 'warped_nylium', ['warped_wart_block', 'warped_planks'], 'shroomlight', ['warped_nylium', 'warped_wart_block'], 'cyan_stained_glass'),
    th('Honey', ['honeycomb_block', 'yellow_terracotta', 'honeycomb_block'], 'orange_concrete', 'ochre_froglight', 'yellow_concrete', ['orange_concrete', 'honeycomb_block'], 'ochre_froglight', ['yellow_concrete', 'orange_concrete'], 'yellow_stained_glass'),
    th('Diamond', ['diamond_block', 'light_blue_concrete', 'diamond_block'], 'smooth_quartz', 'sea_lantern', 'smooth_quartz', ['black_concrete', 'diamond_block'], 'sea_lantern', ['diamond_block', 'white_concrete'], 'light_blue_stained_glass'),
];
const FINAL_THEME = th('Golden', ['gold_block', 'raw_gold_block', 'gold_block'], 'polished_blackstone_bricks', 'sea_lantern', 'diamond_block', ['obsidian', 'crying_obsidian'], 'gold_block', ['gold_block', 'black_concrete'], 'yellow_stained_glass');

// ---------- chapters: ten levels each, with a look of their own up top and their own level names ----------
const ALL_THEMES = Object.fromEntries([...THEMES, ...BOSS_THEMES, FINAL_THEME].map(t => [t.name, t]));
const LEAVES = { 'Dawn Gardens': 'oak_leaves[persistent=true]', 'Sunstone Halls': 'acacia_leaves[persistent=true]', 'Tidal Vaults': 'azalea_leaves[persistent=true]', 'Cherry Grove': 'cherry_leaves[persistent=true]', 'Frostpeak': 'spruce_leaves[persistent=true]', 'Ember Depths': 'nether_wart_block', 'Verdant Wilds': 'jungle_leaves[persistent=true]', 'Clockwork Foundry': 'dark_oak_leaves[persistent=true]', 'Shadow Realm': 'warped_wart_block', 'Golden Ascent': 'flowering_azalea_leaves[persistent=true]' };
const ch = (name, themes, boss, ground, trees, wall, pillar, plants, names, spikes = false) => ({ name, themes, boss, ground, trees, wall, pillar, plants, names, spikes, leaves: LEAVES[name] });
const FLOWERS = ['short_grass', 'short_grass', 'short_grass', 'poppy', 'dandelion', 'cornflower', 'azure_bluet', 'allium', 'oxeye_daisy'];
const CHAPTERS = [
    ch('Dawn Gardens', ['Prismarine', 'Mossy', 'Stone', 'Cherry'], 'Emerald', 'grass_block', ['fancy_oak', 'oak', 'azalea_tree'], 'smooth_stone', 'polished_andesite', FLOWERS,
        ['Dawnbreak', 'Morning Dew', 'Ivy Steps', 'Lantern Walk', 'Petal Drop', 'Mossway', 'Bramble Gate', 'Sunrise Well', 'Willow Shaft', 'Garden Gauntlet']),
    ch('Sunstone Halls', ['Sandstone', 'Terracotta', 'Bamboo', 'Sandstone'], 'Honey', 'sand', ['acacia'], 'smooth_sandstone', 'cut_sandstone', ['dead_bush', 'short_dry_grass', 'tall_dry_grass'],
        ['Solar Gate', 'Dune Spiral', 'Amber Hall', 'Sandglass', 'Golden Arches', 'Mirage', 'Scarab Vault', 'Desert Bloom', "Pharaoh's Drop", 'Sunstone Gauntlet'], true),
    ch('Tidal Vaults', ['Prismarine', 'Sky Glass', 'Copper', 'Quartz'], 'Lapis', 'grass_block', ['birch', 'oak'], 'prismarine_bricks', 'dark_prismarine', FLOWERS,
        ['Coral Gate', 'Tidepool', 'Kelp Forest', 'Pearl Drop', 'Lighthouse', 'Undertow', 'Lantern Reef', 'Abyss Window', 'Shipwreck', 'Tidal Gauntlet']),
    ch('Cherry Grove', ['Cherry', 'Blossom', 'Amethyst', 'Quartz'], 'Redstone', 'grass_block', ['cherry'], 'calcite', 'stripped_cherry_wood', ['pink_petals', 'short_grass', 'lily_of_the_valley', 'pink_tulip', 'white_tulip'],
        ['Blossom Fall', 'Pink Lanterns', 'Petal Storm', 'Rose Window', 'Silk Road', 'Paper Cranes', 'Spring Rain', 'Moon Bridge', 'Tea Garden', 'Cherry Gauntlet']),
    ch('Frostpeak', ['Frozen', 'Sky Glass', 'Quartz', 'Purpur'], 'Diamond', 'snow_block', ['spruce'], 'packed_ice', 'snow_block', [],
        ['Snowfall', 'Ice Halls', 'Frozen Falls', 'Glacier Eye', 'Aurora', 'Hailstone', 'Crystal Spire', 'Blizzard', 'Polar Night', 'Frostpeak Gauntlet']),
    ch('Ember Depths', ['Nether', 'Blackstone', 'Mud', 'Terracotta'], 'Obsidian', 'crimson_nylium', ['crimson_fungus_planted'], 'nether_bricks', 'polished_blackstone', ['crimson_roots', 'crimson_fungus'],
        ['Ember Gate', 'Ash Fall', 'Magma Rings', 'Cinder Steps', 'Furnace', 'Obsidian Throat', 'Fire Lilies', 'Smoke Stack', 'Inferno', 'Ember Gauntlet']),
    ch('Verdant Wilds', ['Mossy', 'Bamboo', 'Mud', 'Stone'], 'Warped', 'grass_block', ['jungle_tree', 'azalea_tree', 'fancy_oak'], 'mossy_stone_bricks', 'stripped_jungle_log', FLOWERS,
        ['Root Hollow', 'Canopy', 'Vine Maze', 'Fern Gully', 'Mushroom Ring', 'Wild Bloom', 'Jungle Drop', 'Lost Temple', 'Overgrowth', 'Wilds Gauntlet']),
    ch('Clockwork Foundry', ['Copper', 'Tuff', 'Deepslate', 'Concrete'], 'Crimson', 'grass_block', ['dark_oak'], 'polished_tuff', 'waxed_cut_copper', FLOWERS,
        ['Cog Drop', 'Copper Pipes', 'Gearwork', 'Steam Vents', 'Rivet Row', 'Piston Hall', 'Boiler Room', 'Flywheel', 'Iron Lung', 'Foundry Gauntlet']),
    ch('Shadow Realm', ['Deepslate', 'Purpur', 'Blackstone', 'Amethyst'], 'Sculk', 'warped_nylium', ['warped_fungus_planted'], 'deepslate_tiles', 'polished_deepslate', ['warped_roots', 'nether_sprouts'],
        ['Dusk Gate', 'Void Lanterns', 'Echo Halls', 'Night Bloom', 'Shade Spiral', 'Phantom Drop', 'Eclipse', "Warden's Well", 'Dark Matter', 'Shadow Gauntlet']),
    ch('Golden Ascent', ['Quartz', 'Sandstone', 'Blackstone', 'Copper'], 'Golden', 'grass_block', ['fancy_oak', 'cherry'], 'quartz_bricks', 'gold_block', FLOWERS,
        ['Gilded Gate', 'Crown Jewels', 'Treasure Fall', 'Golden Hour', 'Sky Palace', 'Diamond Rain', 'Halo', 'Starfall', 'Last Light', 'The Final Drop'], true),
];

// ---------- the obstacle designs ----------
// Each design gets the grid (-h..h on x and z), where you can be coming from (prev regions), how
// far you can steer before it (budget), the hole size (s) and how hard it should be. It returns
// rows of solid cells (dy = blocks below its top) and the region you'll fall through (main).

function regionsOfSize(h, s) { const out = []; for (let x = -h; x <= h - s + 1; x++) for (let z = -h; z <= h - s + 1; z++) out.push({ x, z, s }); return out; }
const cellsOf = r => { const out = []; for (let i = 0; i < r.s; i++) for (let j = 0; j < r.s; j++) out.push(key(r.x + i, r.z + j)); return out; };
// Where you can be by now (a box of where your middle can be, worked out layer by layer from the
// ledge), and how far that is from fitting through hole r.
const win = r => { const [x1, x2] = span(r.x, r.s), [z1, z2] = span(r.z, r.s); return { x1, x2, z1, z2 }; };
const minGap = (reach, r) => { const w = win(r); return Math.hypot(axisGap([reach.x1, reach.x2], [w.x1, w.x2]), axisGap([reach.z1, reach.z2], [w.z1, w.z2])); };
// where you can be after steering `budget` blocks and then fitting through hole r (null: you can't)
function reachThrough(reach, budget, r) {
    const w = win(r), out = { x1: Math.max(reach.x1 - budget, w.x1), x2: Math.min(reach.x2 + budget, w.x2), z1: Math.max(reach.z1 - budget, w.z1), z2: Math.min(reach.z2 + budget, w.z2) };
    return out.x1 <= out.x2 + 1e-9 && out.z1 <= out.z2 + 1e-9 ? out : null;
}
// the cells round where you're falling, one block spare on every side (for designs you fall straight through)
const roomAround = (r, h) => { const out = []; for (let x = r.x - 1; x <= r.x + r.s; x++) for (let z = r.z - 1; z <= r.z + r.s; z++) if (Math.abs(x) <= h && Math.abs(z) <= h) out.push(key(x, z)); return out; };

// A region reachable from where you were, preferring ones you have to move for (lo * budget away).
function chooseTarget(c, s, ok = () => true) {
    const all = regionsOfSize(c.h, s).filter(r => ok(r) && minGap(c.reach, r) <= c.budget);
    if (!all.length) return null;
    const far = all.filter(r => minGap(c.reach, r) >= c.lo * c.budget);
    // after the first few levels you always have to move for it (when there's time to)
    if (c.t > 0.04 && c.budget >= 0.9) return far.length ? pick(c.rng, far) : null;
    return pick(c.rng, far.length ? far : all);
}
function fullGrid(h) { const s = new Set(); for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) s.add(key(x, z)); return s; }
const isOpen = (solid, r) => cellsOf(r).every(k => !solid.has(k));
function chooseOpen(c, solid, s) { return chooseTarget(c, s, r => isOpen(solid, r)); }
// holes that lead nowhere: they look like the way down
function addDecoys(c, solid, s, n, avoid) {
    for (let i = 0, tries = 0; i < n && tries < 60; tries++) {
        const r = { x: randInt(c.rng, -c.h, c.h - s + 1), z: randInt(c.rng, -c.h, c.h - s + 1), s };
        if (avoid.some(a => Math.abs(center(a)[0] - center(r)[0]) < (a.s + s) / 2 + 1 && Math.abs(center(a)[1] - center(r)[1]) < (a.s + s) / 2 + 1)) continue;
        cellsOf(r).forEach(k => solid.delete(k)); avoid.push(r); i++;
    }
}

const DESIGNS = {
    // a floor with holes; only some of them lead anywhere
    plate: { name: 'Trapdoors', from: 1, rim: true, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const solid = fullGrid(c.h); cellsOf(main).forEach(k => solid.delete(k));
        addDecoys(c, solid, c.s, randInt(c.rng, 1, 1 + Math.round(4 * c.t)), [main]);
        const thick = c.rng() < 0.3 ? 2 : 1;
        return Array.from({ length: thick }, (_, dy) => ({ dy, solid, main }));
    } },
    // a canopy of leaves with lamps dotted through it, a framed hole to drop through
    canopy: { name: 'Canopy', from: 4, rim: true, canopy: true, make(c) { return DESIGNS.plate.make(c); } },
    // bars across the shaft, the next set turned the other way
    beams: { name: 'Beams', from: 1, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const along = c.rng() < 0.5, bar = randInt(c.rng, 1, c.t < 0.4 ? 2 : 3), p = bar + c.s;
        const off = (along ? main.z : main.x) - bar, solid = new Set();
        for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) if (mod((along ? z : x) - off, p) < bar) solid.add(key(x, z));
        return [{ dy: 0, solid, main }];
    } },
    // a block that covers the shaft except a strip along one side
    half: { name: 'Slalom', from: 3, rim: true, make(c) {
        const sides = [['x', 1], ['x', -1], ['z', 1], ['z', -1]].sort(() => c.rng() - 0.5);
        const w = Math.max(c.s, randInt(c.rng, 2, Math.max(2, c.h - 1)));
        for (const [ax, sg] of sides) {
            const solid = new Set();
            for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) { const v = (ax === 'x' ? x : z) * sg; if (v < c.h - w + 1) solid.add(key(x, z)); }
            const main = chooseOpen(c, solid, c.s);
            if (main) return [{ dy: 0, solid, main }, ...(c.rng() < 0.5 ? [{ dy: 1, solid, main }] : [])];
        }
        return null;
    } },
    // a grid of bars with square openings
    grid: { name: 'Grid', from: 6, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const bar = randInt(c.rng, 1, 2), p = bar + c.s, solid = new Set();
        for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) if (mod(x - (main.x - bar), p) < bar || mod(z - (main.z - bar), p) < bar) solid.add(key(x, z));
        return [{ dy: 0, solid, main }];
    } },
    // a plate with a shaped hole: plus, diamond, circle, X or a ring
    shape: { name: 'Shapes', from: 8, rim: true, make(c) {
        const t = chooseTarget(c, c.s); if (!t) return null;
        const kinds = ['plus', 'diamond', 'circle', 'x', ...(c.t > 0.5 ? ['ring', 'ring'] : [])];
        const kind = pick(c.rng, kinds), R = randInt(c.rng, 2, 4) + (c.t < 0.3 ? 1 : 0), [cx, cz] = center(t), half = (c.s - 1) / 2 + 0.01;
        const solid = fullGrid(c.h);
        for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) {
            const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
            const open = kind === 'plus' ? (Math.abs(dx) <= half && Math.abs(dz) <= R) || (Math.abs(dz) <= half && Math.abs(dx) <= R)
                : kind === 'diamond' ? Math.abs(dx) + Math.abs(dz) <= R
                    : kind === 'circle' ? d <= R + 0.3
                        : kind === 'x' ? Math.abs(Math.abs(dx) - Math.abs(dz)) <= half + 0.5 && d <= R + 1
                            : d <= R + 0.5 && d > R - c.s + 0.5;
            if (open) solid.delete(key(x, z));
        }
        const main = chooseOpen(c, solid, c.s); if (!main) return null;
        return [{ dy: 0, solid, main }];
    } },
    // square rings around a point
    rings: { name: 'Rings', from: 12, make(c) {
        // the rings are lined up so a reachable spot is between two of them
        const main = chooseTarget(c, c.s); if (!main) return null;
        const bar = randInt(c.rng, 1, 2), p = bar + c.s;
        for (let tries = 0; tries < 20; tries++) {
            const ox = randInt(c.rng, -c.h + 2, c.h - 2), oz = randInt(c.rng, -c.h + 2, c.h - 2), ring = (x, z) => Math.max(Math.abs(x - ox), Math.abs(z - oz));
            const ds = cellsOf(main).map(k => ring(...k.split(',').map(Number))), lo = Math.min(...ds);
            if (Math.max(...ds) - lo > c.s - 1) continue;
            const ph = mod(bar - lo, p), solid = new Set();
            for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) if (mod(ring(x, z) + ph, p) < bar) solid.add(key(x, z));
            if (isOpen(solid, main)) return [{ dy: 0, solid, main }];
        }
        return null;
    } },
    // a funnel: the hole gets smaller over a few blocks
    funnel: { name: 'Funnels', from: 15, rim: true, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const n = Math.min(c.room, randInt(c.rng, 3, 5)); if (n < 2) return null;
        return Array.from({ length: n }, (_, dy) => {
            const e = n - 1 - dy, solid = fullGrid(c.h);
            for (let x = main.x - e; x < main.x + c.s + e; x++) for (let z = main.z - e; z < main.z + c.s + e; z++) solid.delete(key(x, z));
            return { dy, solid, main };
        });
    } },
    // columns hanging down: stay where you are and don't touch them
    pillars: { name: 'Stalactites', from: 18, make(c) {
        const L = Math.min(c.room, randInt(c.rng, 6, 14)); if (L < 4) return null;
        const main = c.prevRegion, keep = new Set(roomAround(main, c.h)), cols = [];
        const n = Math.round((2 * c.h + 1) ** 2 * (0.12 + 0.18 * c.t));
        for (let i = 0; i < n; i++) {
            const x = randInt(c.rng, -c.h, c.h), z = randInt(c.rng, -c.h, c.h);
            if (keep.has(key(x, z))) continue;
            const top = randInt(c.rng, 0, Math.floor(L / 2)); cols.push([key(x, z), top, randInt(c.rng, Math.min(L - 1, top + 2), L - 1)]);
        }
        return Array.from({ length: L }, (_, dy) => ({ dy, solid: new Set(cols.filter(([, a, b]) => dy >= a && dy <= b).map(([k]) => k)), main }));
    } },
    // diagonal bars
    diagonal: { name: 'Diagonals', from: 22, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const dir = c.rng() < 0.5 ? 1 : -1, bar = randInt(c.rng, 1, 2), p = bar + 2 * c.s - 1, solid = new Set();
        const off = Math.min(...cellsOf(main).map(k => { const [x, z] = k.split(',').map(Number); return x + dir * z; })) - bar;
        for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) if (mod(x + dir * z - off, p) < bar) solid.add(key(x, z));
        return isOpen(solid, main) ? [{ dy: 0, solid, main }] : null;
    } },
    // a checkerboard: only the squares that are missing let you through
    checker: { name: 'Checkerboard', from: 30, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const q = c.s, oz = mod(-main.z, q); let ox = mod(-main.x, q);
        if (mod((main.x + ox) / q + (main.z + oz) / q, 2) === 0) ox += q;     // make the target square a missing one
        const solid = new Set();
        for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) if (mod(Math.floor((x + ox) / q) + Math.floor((z + oz) / q), 2) === 0) solid.add(key(x, z));
        return isOpen(solid, main) ? [{ dy: 0, solid, main }] : null;
    } },
    // two plates close together with tiny holes, the second one a step to the side
    // Terraces: steps of ground going down towards the hole from all round (zigzag diamonds or
    // squares), lamps along the edges of the steps, the hole framed in lamps and gold.
    terraces: { name: 'Terraces', from: 1, make(c) {
        const K = Math.min(c.room, randInt(c.rng, 5, 9)); if (K < 4) return null;
        const main = chooseTarget(c, c.s); if (!main) return null;
        const [mx, mz] = center(main), half = (main.s - 1) / 2, w = randInt(c.rng, 1, 3), diamond = c.rng() < 0.6;
        const ground = c.ground, inMain = (x, z) => x >= main.x && x < main.x + main.s && z >= main.z && z < main.z + main.s;
        const top = new Map();
        for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) {
            if (inMain(x, z)) continue;
            const dx = Math.max(0, Math.abs(x - mx) - half), dz = Math.max(0, Math.abs(z - mz) - half), d = diamond ? dx + dz : Math.max(dx, dz);
            top.set(key(x, z), Math.max(0, K - 1 - Math.floor((Math.ceil(d) - 1) / w)));      // next to the hole is lowest
        }
        const lowerNext = (x, z, t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const q = top.get(key(x + a, z + b)); return q !== undefined && q > t; });
        return Array.from({ length: K }, (_, dy) => {
            const solid = new Set(), paint = new Map();
            for (const [k, t] of top) {
                if (t > dy) continue;
                solid.add(k);
                const [x, z] = k.split(',').map(Number);
                let b = t === dy ? ground.top : ground.side;
                if (t === dy) {
                    const nearHole = Math.max(Math.abs(x - mx) - half, Math.abs(z - mz) - half) <= 1.01;
                    if (nearHole) b = mod(x + z, 2) ? 'gold_block' : c.theme.light;
                    else if (lowerNext(x, z, t) && mod(x * 3 + z * 5, 4) === 0) b = c.theme.light;
                } else if (t === dy - 1 && Math.max(Math.abs(x - mx) - half, Math.abs(z - mz) - half) <= 1.01) b = c.theme.rim;
                paint.set(k, b);
            }
            return { dy, solid, main, paint };
        });
    } },
    // Lattice: raised beams on a grid with lamps along them and white flowers where they cross,
    // panels sitting between them at different depths, the odd beam picked out in gold.
    lattice3d: { name: 'Lattice', from: 1, make(c) {
        const K = Math.min(c.room, randInt(c.rng, 4, 6)); if (K < 3) return null;
        const main = chooseTarget(c, c.s); if (!main) return null;
        const p = Math.max(c.s + 1, randInt(c.rng, 6, 7)), ox = main.x - 1, oz = main.z - 1;
        const line = (x, z) => mod(x - ox, p) === 0 || mod(z - oz, p) === 0;
        const cellOf = (x, z) => `${Math.floor((x - ox) / p)},${Math.floor((z - oz) / p)}`, mainCell = cellOf(main.x, main.z);
        const depthOf = new Map(), gold = new Set();
        const cellDepth = id => { if (!depthOf.has(id)) depthOf.set(id, id === mainCell ? -1 : c.rng() < 0.12 + 0.1 * c.t ? -1 : randInt(c.rng, 1, K - 1)); return depthOf.get(id); };
        for (let i = -c.h; i <= c.h; i++) if (c.rng() < 0.15) gold.add(i);
        // panels in a colour that sets off the beams (sandstone with teal, like the big maps)
        const PANEL = { Prismarine: 'smooth_sandstone', Stone: 'birch_planks', Mossy: 'birch_planks', Copper: 'smooth_sandstone', 'Sky Glass': 'smooth_quartz', Frozen: 'snow_block', Lapis: 'smooth_quartz', Emerald: 'smooth_sandstone' };
        const beam = c.theme.ob[0], panel = PANEL[c.theme.name] || c.theme.ob[1] || c.theme.wall[0], white = /Quartz|Sky Glass|Frozen/.test(c.theme.name) ? 'white_concrete' : 'smooth_quartz';
        return Array.from({ length: K }, (_, dy) => {
            const solid = new Set(), paint = new Map();
            for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) {
                const k = key(x, z);
                if (line(x, z)) {
                    if (dy > 1) continue;                                          // beams are 2 deep
                    solid.add(k);
                    const ax = mod(x - ox, p) === 0, az = mod(z - oz, p) === 0;
                    let b = beam;
                    if (dy === 0) {
                        if (ax && az) b = c.theme.light;
                        else if ((ax && Math.abs(mod(z - oz + 1, p) - 1) <= 1) || (az && Math.abs(mod(x - ox + 1, p) - 1) <= 1)) b = white;   // a white flower round each crossing
                        else if ((ax && gold.has(x)) || (az && gold.has(z))) b = 'gold_block';
                        else if (ax && az === false && mod(z - oz, p) === Math.floor(p / 2) && mod(x - ox, 2 * p) === 0 || az && !ax && mod(x - ox, p) === Math.floor(p / 2) && mod(z - oz, 2 * p) === 0) b = c.theme.light;   // a lamp half way along every other beam
                    }
                    paint.set(k, b);
                } else if (cellDepth(cellOf(x, z)) === dy) { solid.add(k); paint.set(k, panel); }
            }
            return { dy, solid, main, paint };
        });
    } },
    // Hills: one or two stepped grass hills rising up the shaft, lamps on their edges, the hole off to the side
    hills: { name: 'Hills', from: 6, make(c) {
        const K = Math.min(c.room, randInt(c.rng, 6, 11)); if (K < 5) return null;
        const main = chooseTarget(c, c.s); if (!main) return null;
        const [mx, mz] = center(main), keep = new Set(roomAround({ x: main.x - 1, z: main.z - 1, s: main.s + 2 }, c.h));
        const peaks = [];
        for (let i = 0, tries = 0; peaks.length < randInt(c.rng, 1, 2) && tries < 30; tries++) {
            const px = randInt(c.rng, -c.h + 3, c.h - 3), pz = randInt(c.rng, -c.h + 3, c.h - 3);
            if (Math.hypot(px - mx, pz - mz) > c.s + 8) peaks.push([px, pz, randInt(c.rng, 7, Math.max(8, c.h - 2)), c.rng() < 0.5]);
        }
        if (!peaks.length) return null;
        const top = new Map();
        for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) {
            if (keep.has(key(x, z))) continue;
            let best = Infinity;
            for (const [px, pz, r, round] of peaks) { const d = round ? Math.hypot(x - px, z - pz) : Math.abs(x - px) + Math.abs(z - pz); if (d <= r) best = Math.min(best, Math.floor(d * (K - 1) / r)); }
            if (best < Infinity) top.set(key(x, z), best);                     // the middle of a hill is highest (dy 0)
        }
        const lowerNext = (x, z, t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const q = top.get(key(x + a, z + b)); return q === undefined || q > t; });
        return Array.from({ length: K }, (_, dy) => {
            const solid = new Set(), paint = new Map();
            for (const [k, t] of top) {
                if (t > dy) continue;
                solid.add(k);
                const [x, z] = k.split(',').map(Number);
                paint.set(k, t !== dy ? c.ground.side : lowerNext(x, z, t) && mod(x * 7 + z * 3, 5) === 0 ? c.theme.light : c.ground.top);
            }
            return { dy, solid, main, paint };
        });
    } },
    // Bridges: walkways right across the shaft with posts and lamps along them; drop between them
    bridges: { name: 'Bridges', from: 9, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const along = c.rng() < 0.5, lo = along ? main.z : main.x, hi = lo + main.s - 1, decks = [];
        for (let tries = 0; decks.length < randInt(c.rng, 2, 4) && tries < 40; tries++) {
            const at = randInt(c.rng, -c.h + 1, c.h - 3);
            if (at + 2 >= lo - 1 && at <= hi + 1) continue;                      // not over the hole
            if (decks.some(d => Math.abs(d - at) < 6)) continue;
            decks.push(at);
        }
        if (!decks.length) return null;
        const deck = c.theme.ob[0], post = c.theme.trim, rows = [{ dy: 0, solid: new Set(), main, paint: new Map() }, { dy: 1, solid: new Set(), main, paint: new Map() }, { dy: 2, solid: new Set(), main, paint: new Map() }];
        for (const at of decks) for (let u = -c.h; u <= c.h; u++) for (let w = 0; w < 3; w++) {
            const k = along ? key(u, at + w) : key(at + w, u);
            rows[1].solid.add(k); rows[1].paint.set(k, w === 1 && mod(u, 6) === 0 ? c.theme.light : deck);
            if (w === 1) { rows[2].solid.add(k); rows[2].paint.set(k, post); }                          // a beam under the middle
            if (w !== 1 && mod(u, 4) === 0) { rows[0].solid.add(k); rows[0].paint.set(k, mod(u, 8) === 0 ? c.theme.light : post); }   // posts along the edges
        }
        return rows;
    } },
    needle: { name: 'Needles', from: 45, rim: true, make(c) {
        const g = Math.min(c.room - 1, randInt(c.rng, 2, 4)); if (g < 2) return null;
        const s = Math.min(c.s, 2), a = chooseTarget(c, s); if (!a) return null;
        const between = c.budgetBetween(c.depth, c.depth + g);
        const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].sort(() => c.rng() - 0.5);
        let b = a;
        for (const [dx, dz] of steps) {
            const r = { x: a.x + dx, z: a.z + dz, s };
            if (r.x >= -c.h && r.z >= -c.h && r.x + s - 1 <= c.h && r.z + s - 1 <= c.h && gapBetween(a, r) <= between) { b = r; break; }
        }
        const top = fullGrid(c.h), bottom = fullGrid(c.h);
        cellsOf(a).forEach(k => top.delete(k)); cellsOf(b).forEach(k => bottom.delete(k));
        addDecoys(c, top, s, randInt(c.rng, 1, 3), [a]); addDecoys(c, bottom, s, randInt(c.rng, 0, 2), [b]);
        return [{ dy: 0, solid: top, main: a }, { dy: g, solid: bottom, main: b }];
    } },
    // round holes all over, like Swiss cheese
    circles: { name: 'Portholes', from: 10, rim: true, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const solid = fullGrid(c.h), [mx, mz] = center(main), r0 = Math.max(1.3, c.s * 0.75 + 0.3);
        const carve = (ox, oz, r) => { for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) if (Math.hypot(x - ox, z - oz) <= r) solid.delete(key(x, z)); };
        carve(mx, mz, r0); cellsOf(main).forEach(k => solid.delete(k));
        for (let i = 0, n = randInt(c.rng, 2, 3 + Math.round(3 * c.t)), tries = 0; i < n && tries < 50; tries++) {
            const ox = randInt(c.rng, -c.h + 1, c.h - 1), oz = randInt(c.rng, -c.h + 1, c.h - 1), r = r0 + c.rng() * 1.2;
            if (Math.hypot(ox - mx, oz - mz) < r + r0 + 1.5) continue;
            carve(ox, oz, r); i++;
        }
        return [{ dy: 0, solid, main }, ...(c.rng() < 0.4 && c.room > 2 ? [{ dy: 1, solid, main }] : [])];
    } },
    // a fan: blades round a hub, you drop between two of them
    fan: { name: 'Fans', from: 20, make(c) {
        const main = chooseTarget(c, c.s); if (!main) return null;
        const [mx, mz] = center(main), nb = randInt(c.rng, 3, 6), sector = 2 * Math.PI / nb, gap = 0.55 - 0.2 * c.t;
        for (let tries = 0; tries < 25; tries++) {
            const ox = randInt(c.rng, -c.h + 2, c.h - 2), oz = randInt(c.rng, -c.h + 2, c.h - 2);
            if (Math.hypot(mx - ox, mz - oz) < c.s + 1.6) continue;
            const phase = Math.atan2(mz - oz, mx - ox) - (1 - gap / 2) * sector, solid = new Set();
            for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) {
                const d = Math.hypot(x - ox, z - oz), a = mod(Math.atan2(z - oz, x - ox) - phase, sector);
                if (d <= 1.5 || a < (1 - gap) * sector) solid.add(key(x, z));
            }
            if (isOpen(solid, main)) return [{ dy: 0, solid, main }];
        }
        return null;
    } },
    // floating islands of grass and dirt, with plants on top
    islands: { name: 'Sky Islands', from: 26, make(c) {
        if (c.room < 4) return null;
        const main = chooseTarget(c, c.s); if (!main) return null;
        const top = new Set(), blobs = randInt(c.rng, 3, 6);
        for (let i = 0; i < blobs; i++) {
            const ox = randInt(c.rng, -c.h, c.h), oz = randInt(c.rng, -c.h, c.h), r = 1.5 + c.rng() * (2 + c.h / 3);
            for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) if (Math.hypot(x - ox, z - oz) + c.rng() * 0.8 <= r) top.add(key(x, z));
        }
        cellsOf(main).forEach(k => top.delete(k));
        const inner = (set, k) => { const [x, z] = k.split(',').map(Number); return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => set.has(key(x + a, z + b))); };
        const mid = new Set([...top].filter(k => inner(top, k))), low = new Set([...mid].filter(k => inner(mid, k) || c.rng() < 0.35));
        const plants = new Map([...top].filter(() => c.rng() < 0.3).map(k => [k, pick(c.rng, ['short_grass', 'short_grass', 'fern', 'poppy', 'dandelion', 'azure_bluet', 'oxeye_daisy'])]));
        return [
            { dy: -1, decor: true, solid: new Set(plants.keys()), paint: plants, main },
            { dy: 0, solid: top, main, paint: new Map([...top].map(k => [k, 'grass_block'])) },
            { dy: 1, solid: mid, main, paint: new Map([...mid].map(k => [k, 'dirt'])) },
            { dy: 2, solid: low, main, paint: new Map([...low].map(k => [k, 'rooted_dirt'])) },
        ].filter(r => r.solid.size || r.dy === 0);
    } },
    // a ramp winding down round the walls; you fall down the middle
    helix: { name: 'Spiral', from: 34, make(c) {
        const L = Math.min(c.room, randInt(c.rng, 8, 16)); if (L < 6) return null;
        const main = c.prevRegion, keep = new Set(roomAround(main, c.h)), bw = c.h >= 6 ? 3 : 2, a0 = c.rng() * 2 * Math.PI, turn = (c.rng() < 0.5 ? 1 : -1) * 2 * Math.PI / L;
        return Array.from({ length: L }, (_, dy) => {
            const solid = new Set();
            for (let x = -c.h; x <= c.h; x++) for (let z = -c.h; z <= c.h; z++) {
                if (Math.max(Math.abs(x), Math.abs(z)) < c.h - bw + 1 || keep.has(key(x, z))) continue;
                if (mod(Math.atan2(z, x) - a0 - dy * turn, 2 * Math.PI) < 1.1) solid.add(key(x, z));
            }
            return { dy, solid, main };
        });
    } },
};

// ---------- levels ----------
// the top and sides of a chapter's ground for terraces (no sand: it would fall)
const GROUND = { grass_block: ['grass_block', 'dirt'], sand: ['smooth_sandstone', 'sandstone'], snow_block: ['snow_block', 'packed_ice'], crimson_nylium: ['crimson_nylium', 'netherrack'], warped_nylium: ['warped_nylium', 'netherrack'] };
const groundOf = ch => { const [top, side] = GROUND[ch.ground] || ['grass_block', 'dirt']; return { top, side }; };
function holeSize(rng, t) {
    if (t < 0.25) return 3;
    if (t < 0.5) return rng() < 0.7 ? 2 : 3;
    if (t < 0.75) return rng() < 0.9 ? 2 : 1;
    return rng() < 0.6 ? 2 : 1;
}
const INLAYS = ['lattice', 'lattice', 'flowers', 'bands', 'rings', 'lanterns', 'starburst', 'diamonds', 'mosaic', 'checker'];

function designLevel(n, attempt = 0) {
    const rng = rngFor(n * 7919 + 12345 + attempt * 104729);
    const t = (n - 1) / (LEVELS - 1), boss = n % 10 === 0, final = n === LEVELS;
    const chapter = CHAPTERS[Math.floor((n - 1) / 10)];
    const theme = final ? FINAL_THEME : boss ? ALL_THEMES[chapter.boss] : ALL_THEMES[chapter.themes[((n - 1) % 10) % chapter.themes.length]];
    const h = final ? 34 : boss ? 32 : t < 0.3 ? pick(rng, [24, 25, 26]) : pick(rng, [26, 27, 28, 29, 30, 31]);
    const height = final ? 690 : Math.round(340 + 300 * t + randInt(rng, -10, 20) + (boss ? 20 : 0));
    // how much of the steering you could do that a level asks for: never more than about 60%
    const k = (final ? 0.55 : Math.min(0.52, 0.22 + 0.3 * t + (boss ? 0.03 : 0))) * 0.9 ** Math.floor(attempt / 4);
    MARGIN = 0.35 - 0.2 * t;
    const lo = final ? 0.55 : Math.min(0.55, 0.25 + 0.35 * t);
    const slots = final ? 46 : Math.max(13, Math.min(42, Math.round((8 + 15 * t + rng() * 3) * 1.6) + (boss ? 3 : 0)));
    // which designs this level uses: the newest one you've reached, plus one or two others
    const avail = Object.entries(DESIGNS).filter(([, d]) => n >= d.from).map(([id]) => id);
    const newest = avail.reduce((a, b) => DESIGNS[b].from > DESIGNS[a].from ? b : a);
    // a design is the star of a few levels right after it first shows up, then it's one of the mix
    const main = boss || final ? null : n - DESIGNS[newest].from < 10 && rng() < 0.6 ? newest : pick(rng, avail);
    const others = avail.filter(id => id !== main).sort(() => rng() - 0.5).slice(0, boss || final ? avail.length : randInt(rng, 1, 2));
    const order = Array.from({ length: slots }, (_, i) => boss || final ? others[i % others.length] : i % 3 === 1 || !main ? pick(rng, others.length ? others : [main]) : main);
    const big = ['terraces', 'lattice3d', 'hills', 'bridges'].filter(id => n >= DESIGNS[id].from);
    for (let i = 0; i < order.length; i++) if (big.length && rng() < 0.5) order[i] = pick(rng, big);

    // How far you can steer between two layers: from when your head is out of the first (you're 1.8
    // tall) plus about 4 ticks (0.2s) to react, until your feet reach the top of the second.
    const budgetBetween = (d1, d2) => k * REACH[Math.max(0, tickAt(d2 - 1) - tickAt(d1 + 2) - 4)];
    // obstacles from just under the ledge, spread out evenly in falling time down to near the bottom
    const first = randInt(rng, 8, 11), last = height - 9, t1 = tickAt(first), t2 = tickAt(last);
    const depths = order.map((_, i) => DEPTH[Math.round(t1 + (t2 - t1) * i / Math.max(1, slots - 1))]).map(Math.round);
    for (let i = 1; i < depths.length; i++) depths[i] = Math.max(depths[i], depths[i - 1] + 4);
    while (depths.length && depths[depths.length - 1] > last) { depths.pop(); order.pop(); }

    // you drop off the end of the bridge (5 wide, on the north side): the route starts there
    let reach = { x1: -2.3, x2: 2.3 + 1, z1: -h + BRIDGE + 0.3, z2: -h + BRIDGE + 0.9 }, prevRegion = { x: -1, z: -h + BRIDGE, s: 3 }, lastDepth = 0, fails = 0;
    const placed = []; let studsLeft = 1;
    // the level's look, the same all the way down: its ground (grass, sand, snow...) or its own blocks,
    // one accent for hole edges, two floor patterns
    const look = { ground: rng() < 0.5 ? groundOf(chapter) : { top: theme.ob[0], side: theme.wall[0] }, rim2: rng() < 0.5 ? 'gold_block' : theme.light,
        inlays: [pick(rng, INLAYS), pick(rng, INLAYS)], glass: t > 0.7 && rng() < 0.3 };
    for (let i = 0; i < depths.length; i++) {
        const depth = depths[i], room = (depths[i + 1] ?? height - 4) - depth - 1;
        const glass = look.glass && rng() < 0.4;
        let rows = null, used = order[i];
        for (const id of [order[i], 'plate']) {
            const c = { rng, t, h, s: Math.min(3, holeSize(rng, t) + Math.floor(attempt / 12)), reach, prevRegion, lo, room, depth, budget: budgetBetween(lastDepth, depth), budgetBetween, theme, ground: look.ground };
            rows = DESIGNS[id].make(c); used = id;
            if (rows) break;
        }
        if (!rows) continue;
        // check every step of the way is reachable
        const solidRows = rows.filter(r => !r.decor);
        let ok = true, now = reach, d0 = lastDepth;
        for (const r of solidRows) { now = now && reachThrough(now, budgetBetween(d0, depth + r.dy), r.main); d0 = depth + r.dy; }
        if (!now) ok = false;
        if (!ok) { i--; if (++fails > 60) throw new Error(`level ${n}: couldn't make a fair layer`); continue; }
        const ob = theme.ob[i % theme.ob.length];
        placed.push({
            id: used, depth, rows, block: glass ? theme.win : DESIGNS[used].canopy ? chapter.leaves : ob, rim2: look.rim2,
            studs: DESIGNS[used].rim && !glass && chapter.spikes && (studsLeft-- > 0) && rng() < 0.25,
            hangers: DESIGNS[used].rim && rng() < 0.4,
            rim: DESIGNS[used].rim ? theme.rim : null,
            inlay: glass ? 'none' : DESIGNS[used].canopy ? 'lanterns' : look.inlays[i % 2], inlayBlock: theme.ob.find(b => b !== ob) || theme.trim, lamp: theme.light, flower: theme.trim,
        });
        const lastRow = solidRows[solidRows.length - 1];
        reach = now; prevRegion = lastRow.main; lastDepth = depth + lastRow.dy;
    }
    // the pool: the whole floor at first, then smaller, somewhere you have to steer to
    const ps = final ? 1 : t < 0.25 ? 2 * h + 1 : t < 0.45 ? 5 : t < 0.6 ? 4 : t < 0.8 ? 3 : 2;
    let pool;
    if (ps >= 2 * h + 1) pool = { x: -h, z: -h, s: 2 * h + 1 };
    else pool = chooseTarget({ rng, h, reach, budget: budgetBetween(lastDepth, height), lo }, ps) || regionsOfSize(h, ps).reduce((best, r) => minGap(reach, r) < minGap(reach, best) ? r : best);   // the nearest one (the bot check decides)
    const name = chapter.names[(n - 1) % 10];
    return { n, name, chapter, theme, h, height, layers: placed, pool, k };
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
try { const f = JSON.parse(fs.readFileSync(INFO_FILE, 'utf8')); if (f.build === DROPPER_BUILD) for (const i of f.levels) infoCache.set(i.n, i); } catch { }
function levelDesign(n) {
    const L = fairLevel(n), had = infoCache.size;
    infoCache.set(n, { n, h: L.h, name: L.name, height: L.height });
    if (infoCache.size === LEVELS && had < LEVELS) {
        try { fs.mkdirSync(path.dirname(INFO_FILE), { recursive: true }); fs.writeFileSync(INFO_FILE, JSON.stringify({ build: DROPPER_BUILD, levels: [...infoCache.values()].sort((a, b) => a.n - b.n) })); } catch { }
    }
    return L;
}
function levelInfo(n) { if (!infoCache.has(n)) levelDesign(n); return infoCache.get(n); }
function* levelRange(from, to) { for (let n = from; n <= to; n++) yield levelDesign(n); }
// every level's full design (for checking them; uses a lot of memory)
export function dropperLevels() { return [...levelRange(1, LEVELS)]; }

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
    const h = L.h, rows = [];
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
export function levelStart(n) { const [cx, cz] = levelCenter(n), L = levelInfo(n); return [cx, TOP, cz - L.h]; }

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
    const [cx, cz] = levelCenter(L.n), h = L.h, T = L.theme, C = L.chapter, X = x => cx + x, Z = z => cz + z, Y = depth => TOP - depth;
    const rng = rngFor(L.n * 104729 + 99);
    const floorTop = Y(L.height) - 1, bottom = floorTop - 5, top = TOP + 12, out = [];
    // the shaft: walls, and everything inside cleared (from an older build too); the walls go on up past the bridge
    const W = 2 * h + 5, step = Math.max(1, Math.floor(32000 / (W * W)));
    for (let y = bottom; y <= top; y += step) {
        const y2 = Math.min(top, y + step - 1);
        out.push(`fill ${X(-h - 2)} ${y} ${Z(-h - 2)} ${X(h + 2)} ${y2} ${Z(h + 2)} ${B(T.wall[0])}`);
        out.push(`fill ${X(-h)} ${Math.max(y, bottom + 1)} ${Z(-h)} ${X(h)} ${y2} ${Z(h)} minecraft:air`);
    }
    out.push(`fill ${X(-h)} ${top + 1} ${Z(-h)} ${X(h)} ${top + 4} ${Z(h)} minecraft:air`);
    // the inside face of each wall: [which axis is fixed, where]
    const faces = [['z', -h - 1], ['z', h + 1], ['x', -h - 1], ['x', h + 1]];
    const onFace = ([ax, v], u1, y1, u2, y2, b) => ax === 'z'
        ? `fill ${X(u1)} ${y1} ${Z(v)} ${X(u2)} ${y2} ${Z(v)} ${B(b)}`
        : `fill ${X(v)} ${y1} ${Z(u1)} ${X(v)} ${y2} ${Z(u2)} ${B(b)}`;
    // patches of the other wall blocks
    for (const f of faces) for (let i = 0, n = Math.round((2 * h + 1) * (top - bottom) * 0.01); i < n; i++) {
        const u = randInt(rng, -h, h), y = randInt(rng, bottom + 1, top - 1);
        out.push(onFace(f, u, y, Math.min(h, u + randInt(rng, 0, 1)), Math.min(top - 1, y + randInt(rng, 0, 2)), T.wall[1 + (i % 2)]));
    }
    // a grid of glass lines over the walls, with lamps where they cross
    const gx = 4, gy = 7, ph = randInt(rng, 0, gx - 1);
    for (const f of faces) {
        for (let u = -h + ph; u <= h; u += gx) out.push(onFace(f, u, floorTop + 2, u, TOP - 3, T.win));
        for (let y = floorTop + 4, row = 0; y <= TOP - 3; y += gy, row++) {
            out.push(onFace(f, -h, y, h, y, T.win));
            for (let u = -h + ph; u <= h; u += gx) if ((u + row) % 2 === 0) out.push(onFace(f, u, y, u, y, T.light));
        }
    }
    // alcoves set into the walls: a recess with a window at the back and a lamp under it
    const back = ([ax, v]) => [ax, v + Math.sign(v)];
    for (const f of faces) for (let y = floorTop + 10; y < TOP - 8; y += randInt(rng, 15, 20)) for (let u = -h + 3 + randInt(rng, 0, 4); u <= h - 5; u += randInt(rng, 9, 13)) {
        out.push(onFace(f, u, y, u + 2, y + 3, 'air'), onFace(back(f), u, y + 1, u + 2, y + 3, T.win), onFace(back(f), u + 1, y, u + 1, y, T.light));
        out.push(onFace(f, u - 1, y + 4, u + 3, y + 4, T.trim), onFace(f, u - 1, y - 1, u + 3, y - 1, T.trim));
    }
    // pilasters up the walls every 8 blocks
    for (const f of faces) for (let u = -h + 2 + ((ph + 2) % 4); u <= h - 2; u += 8) out.push(onFace(f, u, floorTop + 1, u, TOP - 3, T.trim));
    // above the bridge: the hall the shaft opens into. Pillars, a trim band, a lit crown, towers in the corners
    for (const f of faces) {
        out.push(onFace(f, -h, TOP - 1, h, TOP - 1, T.trim), onFace(f, -h, TOP + 7, h, TOP + 7, T.trim));
        for (let u = -h + 1; u <= h - 1; u += 5) out.push(onFace(f, u, TOP, u, TOP + 6, C.pillar), onFace(f, u, TOP + 7, u, TOP + 7, T.light));
        out.push(onFace(f, -h - 1, top, h + 1, top, T.trim));
        for (let u = -h - 1; u <= h + 1; u += 2) out.push(onFace(f, u, top + 1, u, top + 1, T.wall[0]));      // crenellations
    }
    for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const tx = a * (h + 1), tz = b * (h + 1);
        out.push(`fill ${X(tx - 1)} ${top} ${Z(tz - 1)} ${X(tx + 1)} ${top + 3} ${Z(tz + 1)} ${B(T.rim)}`, `fill ${X(tx)} ${top + 4} ${Z(tz)} ${X(tx)} ${top + 5} ${Z(tz)} ${B(T.rim)}`, `setblock ${X(tx)} ${top + 6} ${Z(tz)} ${B(T.light)}`);
    }
    // leaves spilling over the top of the walls
    for (let i = 0; i < 24; i++) {
        const f = faces[i % 4], u = randInt(rng, -h, h - 2);
        out.push(onFace(f, u, top - randInt(rng, 1, 3), u + randInt(rng, 1, 3), top - 1, C.leaves));
    }
    // the level number, big, in the far wall, facing you on the bridge
    const num = String(L.n).padStart(3, '0'), sc = h >= 11 ? 2 : 1, wTxt = (num.length * 4 - 1) * sc;
    for (let d = 0; d < num.length; d++) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (DIGITS[+num[d]][r * 3 + c] !== '1') continue;
        const x = Math.floor(wTxt / 2) - (d * 4 + c) * sc, y = TOP + 1 + (4 - r) * sc;           // facing south you see +x on your left
        out.push(`fill ${X(x - sc + 1)} ${y} ${Z(h + 1)} ${X(x)} ${y + sc - 1} ${Z(h + 1)} ${B(T.light)}`);
    }
    // the bridge: white down the middle with a lit strip, coloured edges, gold at the tip
    const zb1 = -h, zb2 = -h + BRIDGE - 1;
    out.push(`fill ${X(-2)} ${TOP - 1} ${Z(zb1)} ${X(2)} ${TOP - 1} ${Z(zb2)} ${B(T.rim)}`);
    out.push(`fill ${X(-1)} ${TOP - 1} ${Z(zb1)} ${X(1)} ${TOP - 1} ${Z(zb2)} ${B(T.ledge)}`);
    out.push(`fill ${X(0)} ${TOP - 1} ${Z(zb1)} ${X(0)} ${TOP - 1} ${Z(zb2 - 1)} ${B(T.light)}`);
    out.push(`fill ${X(-2)} ${TOP - 1} ${Z(zb2 - 1)} ${X(-2)} ${TOP - 1} ${Z(zb2)} minecraft:gold_block`, `fill ${X(2)} ${TOP - 1} ${Z(zb2 - 1)} ${X(2)} ${TOP - 1} ${Z(zb2)} minecraft:gold_block`);
    out.push(`fill ${X(-2)} ${TOP - 2} ${Z(zb1)} ${X(2)} ${TOP - 2} ${Z(zb2)} ${B(T.wall[0])}`);
    // obstacles: cells grouped by block into rectangles, the same rectangle on rows below each other is one fill
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
        // lanterns hanging under some plates, away from the holes
        if (layer.hangers) {
            const maxDy = Math.max(...dys), low = rowsByDy.get(maxDy), lamp = /Ember|Shadow/.test(C.name) ? 'soul_lantern' : 'lantern';
            if (low && !low.decor) for (const k of low.solid) {
                const [x, z] = k.split(',').map(Number);
                if (mod(x, 4) !== 2 || mod(z, 4) !== 2) continue;
                if ([[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !low.solid.has(key(x + a, z + b)))) continue;
                out.push(`setblock ${X(x)} ${Y(layer.depth + maxDy) - 1} ${Z(z)} minecraft:${lamp}[hanging=true]`);
            }
        }
        // studs standing on a plate, never next to a hole
        if (layer.studs && !rowsByDy.has(-1)) {
            const topRow = layer.rows.find(r => r.dy === 0);
            if (topRow) for (const k of topRow.solid) {
                const [x, z] = k.split(',').map(Number);
                if (mod(x, 4) || mod(z, 4)) continue;
                if ([[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => Math.abs(x + a) <= h && Math.abs(z + b) <= h && !topRow.solid.has(key(x + a, z + b)))) continue;
                out.push(`setblock ${X(x)} ${Y(layer.depth) + 1} ${Z(z)} minecraft:end_rod[facing=up]`);
            }
        }
    }
    // the bottom: the pool framed in lamps and gold, then a coloured border, then rings out to the walls
    out.push(`fill ${X(-h)} ${bottom + 1} ${Z(-h)} ${X(h)} ${floorTop} ${Z(h)} ${B(T.wall[0])}`);
    const p = L.pool, [pcx, pcz] = center(p);
    if (p.s < 2 * h + 1) {
        const groups = new Map();
        for (let x = -h; x <= h; x++) for (let z = -h; z <= h; z++) {
            const ring = Math.ceil(Math.max(0, Math.max(Math.abs(x - pcx), Math.abs(z - pcz)) - (p.s - 1) / 2));
            if (ring === 0) continue;
            const b = ring === 1 ? (mod(x + z, 2) ? 'gold_block' : T.light) : ring === 2 ? T.rim : ring % 6 === 0 ? T.light : T.floor[Math.floor(ring / 2) % 2];
            if (!groups.has(b)) groups.set(b, new Set()); groups.get(b).add(key(x, z));
        }
        for (const [b, cells] of groups) for (const r of rects(cells, h)) out.push(`fill ${X(r[0])} ${floorTop} ${Z(r[1])} ${X(r[2])} ${floorTop} ${Z(r[3])} ${B(b)}`);
        out.push(`fill ${X(p.x)} ${floorTop - 3} ${Z(p.z)} ${X(p.x + p.s - 1)} ${floorTop - 3} ${Z(p.z + p.s - 1)} minecraft:sea_lantern`);
    } else {
        for (let z = -h; z <= h; z += 3) out.push(`fill ${X(-h)} ${floorTop - 3} ${Z(z)} ${X(h)} ${floorTop - 3} ${Z(z)} minecraft:sea_lantern`);
    }
    out.push(`fill ${X(p.x)} ${floorTop - 2} ${Z(p.z)} ${X(p.x + p.s - 1)} ${floorTop} ${Z(p.z + p.s - 1)} minecraft:water`);
    // the level's name over the drop, with its chapter
    out.push(`kill @e[type=minecraft:text_display,tag=dr_sign,x=${cx},y=${TOP + 6},z=${cz},distance=..${h + 8}]`);
    out.push(`summon minecraft:text_display ${cx + 0.5} ${TOP + 9} ${cz + 0.5} {Tags:["dr_sign"],billboard:"center",scale:[4f,4f,4f],shadow:1b,text:[{text:${JSON.stringify(L.name)},color:"white",bold:true},{text:"\\n${C.name}",color:"red",bold:true}],background:0}`);
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
    try { const p = JSON.parse(fs.readFileSync(progressFile(world), 'utf8')); return p.build === DROPPER_BUILD ? Math.min(LEVELS, p.done ?? p.levels ?? 0) : 0; } catch { return 0; }
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
    if (to === LEVELS) await mc(`setworldspawn ${sx} ${sy} ${sz}`);
}

export function dropperBuilt(world = DROPPER_WORLD) {
    try { const p = JSON.parse(fs.readFileSync(progressFile(world), 'utf8')); return p.build === DROPPER_BUILD && !!p.built; } catch { return false; }
}
export function markDropperBuilt(world = DROPPER_WORLD) {
    fs.writeFileSync(progressFile(world), JSON.stringify({ build: DROPPER_BUILD, levels: LEVELS, done: LEVELS, built: new Date().toISOString() }, null, 2));
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
function packFiles() {
    const f = {
        'pack.mcmeta': JSON.stringify({ pack: { description: 'Gift Hype Dropper: 100 levels', min_format: 94, max_format: 999 } }, null, 2),
        'data/minecraft/tags/function/load.json': J({ values: ['dropper:load'] }),
        'data/minecraft/tags/function/tick.json': J({ values: ['dropper:tick'] }),
    };
    const fn = (name, lines) => { f[`data/dropper/function/${name}.mcfunction`] = lines.join('\n') + '\n'; };
    const title = (who, text, sub, color = 'gold', subColor = 'white') => [
        `title ${who} times 3 30 8`, `title ${who} title ${J({ text, color, bold: true })}`, ...(sub ? [`title ${who} subtitle ${J({ text: sub, color: subColor })}`] : []),
    ];

    fn('load', [
        'scoreboard objectives add dr_level dummy', 'scoreboard objectives add dr_fails dummy', 'scoreboard objectives add dr_jail dummy', 'scoreboard objectives add dr_js dummy', 'scoreboard objectives add dr_v dummy',
        'scoreboard players set #20 dr_v 20',
        'execute unless score #punch dr_v matches 0..1 run scoreboard players set #punch dr_v 1',
        'execute unless score #shield dr_v matches 0.. run scoreboard players set #shield dr_v 0',
        'execute unless score #reset dr_v matches 0.. run scoreboard players set #reset dr_v 0',
        'execute unless data storage dropper:s save run data modify storage dropper:s save set value "Glowing Jellyfish"',
        `bossbar add dropper:level ${J({ text: 'LEVEL 01 / 100', bold: true })}`, 'bossbar set dropper:level color white', 'bossbar set dropper:level max 100', 'bossbar set dropper:level visible true',
        'scoreboard objectives add dr_life dummy',
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
        `execute as @a[tag=dr_in] at @s if predicate dropper:on_ground unless score @s dr_jail matches 1.. positioned ~ ${WORLD_MIN} ~ if entity @s[dy=${TOP - 300 + 362.4}] run function dropper:fail`,
        // fell out of the levels somehow: back to your level
        `execute as @a[tag=dr_in] at @s unless score @s dr_jail matches 1.. positioned ~ ${WORLD_MIN} ~ if entity @s[dy=1] run function dropper:goto`,
        'execute as @a[scores={dr_jail=1..}] run function dropper:jail/tick',
        'execute as @e[tag=dr_alert] run function dropper:alert/tick',
        'execute if score #reset dr_v matches 1.. run function dropper:reset/tick',
        'scoreboard players add #hud dr_v 1',
        'execute if score #hud dr_v matches 10.. as @a[tag=dr_in] run function dropper:hud',
        'execute if score #hud dr_v matches 10.. run scoreboard players set #hud dr_v 0',
    ]);
    fn('join', [
        'tag @s add dr_in', 'gamemode adventure @s', 'clear @s',
        'execute unless score @s dr_level matches 1.. run scoreboard players set @s dr_level 1',
        'function dropper:goto',
        ...title('@s', 'THE DROPPER', '100 levels. Land in the water to go on.'),
    ]);
    fn('hud', [
        'effect give @s minecraft:night_vision infinite 0 true', 'effect give @s minecraft:saturation infinite 0 true',
        // the level bar at the top of the screen
        'execute store result storage dropper:h level int 1 run scoreboard players get @s dr_level',
        'data modify storage dropper:h pad set value ""', 'execute if score @s dr_level matches ..9 run data modify storage dropper:h pad set value "0"',
        'execute if score @s dr_level matches ..100 run function dropper:hud_bar with storage dropper:h',
        `execute if score @s dr_level matches 101.. run bossbar set dropper:level name ${J({ text: 'ALL 100 LEVELS DONE', color: 'gold', bold: true })}`,
        'scoreboard players operation @s dr_js = @s dr_jail', 'scoreboard players add @s dr_js 19', 'scoreboard players operation @s dr_js /= #20 dr_v',
        `execute if score @s dr_jail matches 1.. run return run title @s actionbar ${J([{ text: 'IN JAIL  ', color: 'red', bold: true }, { score: { name: '@s', objective: 'dr_js' }, color: 'white', bold: true }, { text: 's', color: 'red', bold: true }])}`,
        `execute if score @s dr_level matches 101.. run return run title @s actionbar ${J({ text: 'ALL 100 LEVELS DONE', color: 'gold', bold: true })}`,
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
    fn('hud_line', [`$title @s actionbar [${J({ text: 'Fails ', color: 'gold' })},${J({ text: '$(fails)', color: 'white' })},${J({ text: '     Punches ', color: 'gold' })},{"text":"$(punch)","color":"$(pc)","bold":true}]`]);
    fn('hud_shield', [`$title @s actionbar [${J({ text: 'Fails ', color: 'gold' })},${J({ text: '$(fails)', color: 'white' })},${J({ text: '     Punches ', color: 'gold' })},{"text":"$(punch)","color":"$(pc)","bold":true},${J({ text: '     Shield x$(shield)', color: 'aqua', bold: true })}]`]);

    // go to the start of your level (not while you're in jail: you go there when you're let out)
    const levels = Array.from({ length: LEVELS }, (_, i) => levelInfo(i + 1));
    fn('goto', [
        'execute if score @s dr_jail matches 1.. run return 0',
        'execute if score @s dr_level matches ..0 run scoreboard players set @s dr_level 1',
        'execute if score @s dr_level matches 101.. run return run function dropper:win_tp',
        ...levels.map(L => `execute if score @s dr_level matches ${L.n} run return run function dropper:lvl/${L.n}`),
    ]);
    for (const L of levels) {
        const [x, y, z] = levelStart(L.n);
        fn(`lvl/${L.n}`, [
            `tp @s ${x + 0.5} ${y} ${z + 0.5} 0 20`, `spawnpoint @s ${x} ${y} ${z} 0 0`,
            ...[`title @s times 3 30 8`, `title @s title ${J({ text: `Level ${L.n}`, color: 'gold', bold: true })}`, `title @s subtitle ${J({ text: L.name, color: 'white' })}`].map(l => `execute unless entity @s[tag=dr_quiet] run ${l}`),
        ]);
    }
    f['data/minecraft/dimension_type/overworld.json'] = JSON.stringify(TALL_OVERWORLD, null, 2);
    f['data/dropper/predicate/on_ground.json'] = J({ condition: 'minecraft:entity_properties', entity: 'this', predicate: { flags: { is_on_ground: true } } });
    fn('fail', [
        'scoreboard players add @s dr_fails 1',
        'playsound minecraft:block.note_block.bass master @s ~ ~ ~ 1 0.6', 'playsound minecraft:entity.player.hurt master @s ~ ~ ~ 0.6 1',
        'tag @s add dr_quiet', 'function dropper:goto', 'tag @s remove dr_quiet',
    ]);
    fn('landed', [
        'playsound minecraft:entity.player.levelup master @s ~ ~ ~ 1 1.2',
        'scoreboard players add @s dr_level 1',
        'execute if score @s dr_level matches 101.. run return run function dropper:win',
        'function dropper:goto',
    ]);
    const [wx, wy, wz] = WIN;
    fn('win_tp', [`tp @s ${wx + 0.5} ${wy} ${wz + 0.5}`, `spawnpoint @s ${wx} ${wy} ${wz}`]);
    fn('win', [
        'scoreboard players set @s dr_level 101', 'function dropper:win_tp',
        ...title('@s', 'YOU BEAT THE DROPPER', 'All 100 levels!'),
        'playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 1 1',
        ...[[3, 0, 16711680], [-3, 2, 65280], [0, -3, 3447003], [2, 3, 16766720]].map(([dx, dz, col]) =>
            `summon minecraft:firework_rocket ~${dx} ~1 ~${dz} {LifeTime:30,FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{flight_duration:2,explosions:[{shape:"large_ball",colors:[I;${col}],has_trail:1b,has_twinkle:1b}]}}}}`),
    ]);

    // gifts: levels up and down (you can't be gifted past level 100: the last one is yours to land)
    fn('up', [
        'execute if score @s dr_level matches 101.. run return 0',
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
    fn('jail/enter', [
        'tag @s add dr_quiet', 'function dropper:goto', 'tag @s remove dr_quiet',
        'execute at @s run fill ~-1 ~ ~-1 ~1 ~2 ~1 minecraft:iron_bars replace minecraft:air',
        'execute at @s run fill ~ ~ ~ ~ ~1 ~ minecraft:air replace minecraft:iron_bars',
        'execute at @s run fill ~-1 ~3 ~-1 ~1 ~3 ~1 minecraft:iron_bars replace minecraft:air',
        'effect give @s minecraft:jump_boost 9999 250 true',
        'playsound minecraft:block.iron_door.close master @s ~ ~ ~ 1 0.8', ...title('@s', 'JAILED', 'on the bridge', 'red'),
    ]);
    fn('jail/tick', ['scoreboard players remove @s dr_jail 1', 'execute if score @s dr_jail matches ..0 run function dropper:jail/free']);
    fn('jail/free', ['scoreboard players set @s dr_jail 0', 'execute at @s run fill ~-1 ~ ~-1 ~1 ~3 ~1 minecraft:air replace minecraft:iron_bars', 'effect clear @s minecraft:jump_boost', 'playsound minecraft:block.iron_door.open master @s ~ ~ ~ 1 1', 'tag @s add dr_quiet', 'function dropper:goto', 'tag @s remove dr_quiet', ...title('@s', 'FREE', '', 'green')]);

    // gifts: punches. An arrow with Punch II hits you from a random side (only while punches are on).
    fn('punch', [
        `execute if score #punch dr_v matches 0 run return run title @s actionbar ${J({ text: 'Punches are OFF', color: 'green', bold: true })}`,
        'execute store result storage dropper:p vy double 0.001 run data get entity @s Motion[1] 1000',
        'execute store result score #r dr_v run random value 0..7',
        ...Array.from({ length: 8 }, (_, i) => `execute if score #r dr_v matches ${i} run return run function dropper:punch/d${i} with storage dropper:p`),
    ]);
    const arrow = (mx, mz) => `summon minecraft:arrow ~ ~ ~ {Motion:[${mx.toFixed(3)}d,$(vy)d,${mz.toFixed(3)}d],damage:2.0d,crit:1b,pickup:2b,weapon:{id:"minecraft:bow",count:1,components:{"minecraft:enchantments":{"minecraft:punch":2}}}}`;
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, dx = Math.sin(a) * 0.45, dz = Math.cos(a) * 0.45, sp = 2 / 0.45;
        fn(`punch/d${i}`, [
            'playsound minecraft:entity.arrow.shoot master @a ~ ~1 ~ 1 1',
            `$execute positioned ~${dx.toFixed(3)} ~1.1 ~${dz.toFixed(3)} if block ~ ~ ~ #minecraft:replaceable run return run ${arrow(-dx * sp, -dz * sp)}`,
            `$execute positioned ~${(-dx).toFixed(3)} ~1.1 ~${(-dz).toFixed(3)} if block ~ ~ ~ #minecraft:replaceable run return run ${arrow(dx * sp, dz * sp)}`,
            `execute positioned ~ ~2.3 ~ run ${arrow(0, 0).replace('$(vy)d', '-2.0d')}`,
        ]);
    }
    fn('punch_toggle', [
        'execute store success score #was dr_v if score #punch dr_v matches 1',
        'execute if score #was dr_v matches 1 run scoreboard players set #punch dr_v 0',
        'execute if score #was dr_v matches 0 run scoreboard players set #punch dr_v 1',
        ...title('@a', 'PUNCHES ON', 'Arrows can knock you around', 'red').map(l => `execute if score #punch dr_v matches 1 run ${l}`),
        ...title('@a', 'PUNCHES OFF', 'No more arrows', 'green').map(l => `execute if score #punch dr_v matches 0 run ${l}`),
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
    const f = { 'pack.mcmeta': JSON.stringify({ pack: { description: 'Gift Hype Dropper: building the levels', min_format: 94, max_format: 999 } }, null, 2) };
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
        case 'punch': return Array(Math.min(n(a.amount, 1, 10, 1) * times, 10)).fill('function dropper:punch');
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
            case 'punch': { const k = n(a.amount, 1) * times; color = 'red'; return `punched you${k > 1 ? ` x${k}` : ''}`; }
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

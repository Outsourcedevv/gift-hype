// Chat Teleport (a Minecraft type): viewers type a block, a structure or a biome in the LIVE chat,
// and every so often you're teleported to the nearest one of what chat picked: the one typed most
// (one vote per viewer each round) or the last one typed. Only things in the dimension you're in.
//
//   blocks: every block in Minecraft (1193 in 26.2) and groups like "logs" or "diamond ores": the
//           nearest one within the search range (found without changing anything in the world).
//   structures: all 34 (villages, trial chambers, strongholds, ancient cities, bastions, end cities...)
//           and groups (any village, any ruined portal, shipwrecks...), with everyday names.
//   biomes: all 65 (cherry grove, deep dark, ice spikes, crimson forest, end highlands...).
// Never another dimension: everything is looked for only in the dimension you are in.
// The lists are in chatteleport-targets.json (made from Minecraft 26.2's own data).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockGuesses, GROUPS } from './chatdelete.js';
import { hudTitle } from './hudpack.js';

const LISTS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'chatteleport-targets.json'), 'utf8'));
const BLOCKS = new Set(LISTS.blocks);
const DIM_NAME = { overworld: 'the Overworld', the_nether: 'the Nether', the_end: 'the End' };

// everyday names for structures
const STRUCTURE_NAMES = {
    village: '#village', villages: '#village', town: '#village',
    plains_village: 'village_plains', desert_village: 'village_desert', savanna_village: 'village_savanna', snowy_village: 'village_snowy', taiga_village: 'village_taiga',
    nether_fortress: 'fortress', fortress: 'fortress', bastion: 'bastion_remnant', bastion_remnant: 'bastion_remnant',
    woodland_mansion: 'mansion', mansion: 'mansion', ocean_monument: 'monument', monument: 'monument',
    desert_temple: 'desert_pyramid', desert_pyramid: 'desert_pyramid', pyramid: 'desert_pyramid',
    jungle_temple: 'jungle_pyramid', jungle_pyramid: 'jungle_pyramid', witch_hut: 'swamp_hut', swamp_hut: 'swamp_hut', witch_house: 'swamp_hut',
    trial_chamber: 'trial_chambers', trial_chambers: 'trial_chambers', trial: 'trial_chambers',
    end_city: 'end_city', end_ship: 'end_city', outpost: 'pillager_outpost', pillager_outpost: 'pillager_outpost', pillager_tower: 'pillager_outpost',
    portal: '#ruined_portal', ruined_portal: '#ruined_portal', nether_portal_ruin: '#ruined_portal',
    ocean_ruin: '#ocean_ruin', ocean_ruins: '#ocean_ruin', ruins: '#ocean_ruin', ship: '#shipwreck', shipwreck: '#shipwreck', boat: '#shipwreck',
    mineshaft: '#mineshaft', mine: '#mineshaft', abandoned_mineshaft: '#mineshaft',
    treasure: 'buried_treasure', buried_treasure: 'buried_treasure', igloo: 'igloo', stronghold: 'stronghold', end_portal_room: 'stronghold',
    ancient_city: 'ancient_city', city: 'ancient_city', trail_ruins: 'trail_ruins', nether_fossil: 'nether_fossil', fossil: 'nether_fossil',
};
const BIOME_NAMES = { mushroom_island: 'mushroom_fields', mushroom: 'mushroom_fields', cherry: 'cherry_grove', cherry_blossom: 'cherry_grove', the_end: 'the_end', end: 'the_end',
    warden: 'deep_dark', nether: 'nether_wastes', soul_sand: 'soul_sand_valley', crimson: 'crimson_forest', warped: 'warped_forest',
    mesa: 'badlands', jungle: 'jungle', dark_oak: 'dark_forest', pale_forest: 'pale_garden', mountains: 'jagged_peaks', mountain: 'jagged_peaks', cave: 'lush_caves', caves: 'dripstone_caves' };
// where to land in underground structures: on the highest place you can stand below this height
const UNDER = { ancient_city: -40, trial_chambers: -20, stronghold: 40, mineshaft: 40, '#mineshaft': 40, bastion_remnant: 100, fortress: 75, nether_fossil: 45 };
const CAVE_BIOMES = new Set(['lush_caves', 'dripstone_caves', 'deep_dark', 'sulfur_caves']);

const dimsOfStructure = id => id.startsWith('#') ? new Set((LISTS.structureGroups[id.slice(1)] || []).map(s => LISTS.structures[s])) : new Set([LISTS.structures[id]]);
const LABELS = { fortress: 'NETHER FORTRESS', bastion_remnant: 'BASTION', mansion: 'WOODLAND MANSION', monument: 'OCEAN MONUMENT', swamp_hut: 'WITCH HUT', desert_pyramid: 'DESERT TEMPLE', jungle_pyramid: 'JUNGLE TEMPLE', pillager_outpost: 'PILLAGER OUTPOST', '#ruined_portal': 'RUINED PORTAL', '#ocean_ruin': 'OCEAN RUINS', '#shipwreck': 'SHIPWRECK', '#mineshaft': 'MINESHAFT', '#village': 'VILLAGE', mushroom_fields: 'MUSHROOM ISLAND', the_end: 'THE END', ocean_ruin_warm: 'WARM OCEAN RUINS', ocean_ruin_cold: 'COLD OCEAN RUINS', village_plains: 'PLAINS VILLAGE', village_desert: 'DESERT VILLAGE', village_savanna: 'SAVANNA VILLAGE', village_snowy: 'SNOWY VILLAGE', village_taiga: 'TAIGA VILLAGE', mineshaft_mesa: 'BADLANDS MINESHAFT', ruined_portal_nether: 'NETHER RUINED PORTAL', shipwreck_beached: 'BEACHED SHIPWRECK', '#beds': 'BED', '#doors': 'DOOR', '#all_signs': 'SIGN', '#flowers': 'FLOWERS', '#leaves': 'LEAVES', '#wool': 'WOOL', '#logs': 'LOGS' };
const nice = id => LABELS[id] || id.replace(/^#/, '').replace(/_/g, ' ').toUpperCase();

// ----- the targets, made from a name: s:<structure or #group>, b:<biome>, k:<block or #tag> -----
const structureTarget = sid => {
    const plain = sid.replace(/^#/, '');
    return { key: 's:' + sid, kind: 'structure', filter: sid.startsWith('#') ? `#minecraft:${plain}` : `minecraft:${plain}`, label: nice(sid), dims: dimsOfStructure(sid), under: UNDER[sid] };
};
const biomeTarget = bid => ({ key: 'b:' + bid, kind: 'biome', filter: `minecraft:${bid}`, label: nice(bid), dims: new Set([LISTS.biomes[bid]]), cave: CAVE_BIOMES.has(bid) });
const blockTarget = id => id.startsWith('#')
    ? { key: 'k:' + id, kind: 'block', filter: `#minecraft:${id.slice(1)}`, label: nice(id), dims: null }
    : { key: 'k:' + id, kind: 'block', filter: `minecraft:${id}`, label: nice(id), dims: null };
// ore words mean that ore (both kinds: stone and deepslate)
// everyday names for blocks
const BLOCK_NAMES = { table: 'crafting_table', plate: '#pressure_plates', pressure_plate: '#pressure_plates', concrete: 'white_concrete', mob_spawner: 'spawner', monster_spawner: 'spawner', grass: 'grass_block', oak: 'oak_log', spruce: 'spruce_log', dark_oak: 'dark_oak_log', acacia: 'acacia_log', jungle_wood: 'jungle_log', mangrove: 'mangrove_log', crafting: 'crafting_table', workbench: 'crafting_table', enchanting: 'enchanting_table', enchant_table: 'enchanting_table', furnace: 'furnace', bed: '#beds', door: '#doors', sign: '#all_signs', flower: '#flowers', leaves: '#leaves', wool: '#wool', water: 'water', lava: 'lava', portal_frame: 'end_portal_frame', nether_portal: 'nether_portal' };
const ORE_WORDS = { diamond: 'diamond_ores', iron: 'iron_ores', gold: 'gold_ores', coal: 'coal_ores', emerald: 'emerald_ores', copper: 'copper_ores', redstone: 'redstone_ores', lapis: 'lapis_ores', lapis_lazuli: 'lapis_ores', ore: 'diamond_ores' };

// Every name chat can mean, for close-enough matching: [words, make the target, rank (structures first)]
let CATALOG = null;
function catalog() {
    if (CATALOG) return CATALOG;
    const out = [], add = (name, make, rank) => out.push({ name, words: name.split('_'), make, rank });
    for (const [n, sid] of Object.entries(STRUCTURE_NAMES)) add(n, () => structureTarget(sid), 0);
    for (const id of Object.keys(LISTS.structures)) add(id, () => structureTarget(id), 0);
    for (const id of Object.keys(LISTS.structureGroups)) add(id, () => structureTarget('#' + id), 0);
    for (const [n, tag] of Object.entries(GROUPS)) add(n, () => blockTarget('#' + tag), 2);
    for (const [n, tag] of Object.entries(ORE_WORDS)) add(n, () => blockTarget('#' + tag), 2);
    for (const [n, id] of Object.entries(BLOCK_NAMES)) add(n, () => blockTarget(id), 2);
    for (const [n, bid] of Object.entries(BIOME_NAMES)) if (LISTS.biomes[bid]) add(n, () => biomeTarget(bid), 1);
    for (const id of Object.keys(LISTS.biomes)) add(id, () => biomeTarget(id), 1);
    for (const id of LISTS.blocks) add(id, () => blockTarget(id), 3);
    return CATALOG = out;
}
// words that are chat or TikTok gifts, not Minecraft (typed all the time on a LIVE)
const CHAT_WORDS = new Set('rose roses heart hearts love money galaxy gift gifts tiktok live follow followers like likes share lion universe corgi perfume doughnut donut crown king queen fire lit goat sus real true dead mad sad bro bruh lol lmao rip win won lose lost fail'.split(' '));
// typos between two words (letters swapped, missing, extra or wrong)
function typos(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        let rowMin = Infinity;
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            rowMin = Math.min(rowMin, d[i][j]);
        }
        if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
}
const allowedTypos = (q, n) => Math.min(q.length >= 8 ? 2 : q.length >= 5 ? 1 : 0, n.length >= 8 ? 2 : n.length >= 5 ? 1 : 0);
// how well one typed word fits a word of a name (lower is better; null: it doesn't)
function wordCost(q, n) {
    if (q === n) return 0;
    if (q + 's' === n || n + 's' === q || q + 'es' === n || n + 'es' === q) return 0.2;
    if (q.length >= 4 && n.startsWith(q)) return 0.6;                     // "craft" -> crafting
    if (q[0] !== n[0]) return null;                                        // real typos keep the first letter
    const max = allowedTypos(q, n), t = typos(q, n, max);
    return t <= max ? 1 + t : null;
}
// The closest name to what was typed: every typed word has to fit a word of the name (any order);
// the fewer typos and extra words, the better. Chat like "lol" or "ok" never fits anything.
function closest(text) {
    const q = String(text || '').toLowerCase().replace(/^[!/#.]+/, '').replace(/^minecraft:/, '').replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).filter(w => w && !['the', 'a', 'an', 'to', 'tp', 'go', 'me', 'nearest', 'closest', 'block', 'please', 'pls'].includes(w));
    if (!q.length || q.join('').length < 3 || q.length > 6 || q.some(w => CHAT_WORDS.has(w))) return null;
    let best = null;
    const joined = q.join(''), consider = (cost, e) => { if (!best || cost < best.cost) best = { cost, e }; };
    for (const e of catalog()) {
        // the whole thing with the spaces taken out ("strong hold", "dep dark")
        if (joined.length >= 5 && joined[0] === e.name[0]) { const flat = e.name.replace(/_/g, ''), m = allowedTypos(joined, flat), t = flat === joined ? 0 : typos(joined, flat, m); if (t <= m) consider(0.3 + t + e.rank * 0.05 + e.name.length * 0.001, e); }
        if (e.words.length < q.length) continue;
        let cost = 0, used = new Set();
        for (const w of q) {
            let bi = -1, bc = null;
            e.words.forEach((nw, i) => { if (used.has(i)) return; const c = wordCost(w, nw); if (c != null && (bc == null || c < bc)) { bc = c; bi = i; } });
            if (bi < 0) { cost = null; break; }
            used.add(bi); cost += bc;
        }
        if (cost == null) continue;
        cost += (e.words.length - q.length) * 0.7 + e.rank * 0.05 + e.name.length * 0.001 - (e.words.at(-1) === 'block' && !q.includes('block') ? 0.15 : 0);
        consider(cost, e);
    }
    return best && best.cost < 4 ? best.e.make() : null;
}

// What someone typed -> what it means: { key, kind, filter, label, dims (null: any), under, cave } or null.
// The exact name first, then the closest one (typos, part of a name, words in any order).
export function targetOf(text) {
    if (CHAT_WORDS.has(String(text || '').toLowerCase().replace(/[^a-z]/g, ''))) return null;      // "fire", "rose"...: chat, not a pick
    return exactTarget(text) || closest(text);
}
function exactTarget(text) {
    const guesses = blockGuesses(text);
    if (!guesses) return null;
    const words = guesses.filter(g => g.id).map(g => g.id);
    for (const w of words) if (ORE_WORDS[w]) return blockTarget('#' + ORE_WORDS[w]);
    for (const w of words) if (BLOCK_NAMES[w]) return blockTarget(BLOCK_NAMES[w]);
    for (const w of words) {
        const sid = STRUCTURE_NAMES[w] || (LISTS.structures[w] ? w : LISTS.structureGroups[w] ? '#' + w : null);
        if (sid) {
            const plain = sid.replace(/^#/, '');
            return { key: 's:' + sid, kind: 'structure', filter: sid.startsWith('#') ? `#minecraft:${plain}` : `minecraft:${plain}`, label: nice(sid), dims: dimsOfStructure(sid), under: UNDER[sid] };
        }
    }
    for (const w of words) {
        const bid = LISTS.biomes[w] ? w : !BLOCKS.has(w) ? BIOME_NAMES[w] : null;   // a real block name beats a biome nickname
        if (bid && LISTS.biomes[bid]) return biomeTarget(bid);
    }
    for (const g of guesses) {
        if (g.tag) return { key: 'k:#' + g.tag, kind: 'block', filter: `#minecraft:${g.tag}`, label: nice(g.tag), dims: null };
        if (g.id && BLOCKS.has(g.id)) return { key: 'k:' + g.id, kind: 'block', filter: `minecraft:${g.id}`, label: nice(g.id), dims: null };
    }
    return null;
}

export function normalizeChatTeleport(c = {}, onByDefault = false) {
    const n = (v, lo, hi, def) => Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : def;
    return {
        on: typeof c.on === 'boolean' ? c.on : onByDefault,
        seconds: n(c.seconds, 10, 600, 30),             // how often you're teleported
        pick: c.pick === 'last' ? 'last' : 'most',      // the last thing typed, or the one typed most
        range: n(c.range, 32, 160, 96),                 // how far to look for blocks (structures and biomes: as far as Minecraft looks)
        blocked: String(c.blocked ?? '').slice(0, 2000),
        showGame: c.showGame !== false,                 // the timer box in Minecraft (on)
        boxX: n(c.boxX, -100, 100, 0),                  // where the box is: left (-100) to right (100) of the middle of your screen
        boxY: n(c.boxY, -100, 100, 40),                 // down (-100) to up (100)
        boxSize: n(c.boxSize, 50, 250, 100),            // how big, in % (50, 75, 100, 125, 150, 200, 250)
        showOverlay: c.showOverlay === true,            // the timer on the stream overlay (off: add your own in LIVE Studio)
    };
}

const txt = (t, color, extra = '') => `{"text":${JSON.stringify(t)},"color":"${color}"${extra}}`;
const BAR = 'gifthype:chatteleport';          // the old timer bar (removed if it's still there)
// The timer box: fixed on your screen, like the hotbar. In your own world (Gift Hype's hidden server) it's
// a box drawn by Gift Hype's resource pack (hudpack.js), placed and sized from the settings; on a server
// without the pack it's plain text above the hotbar. While it counts down it only says when (never what
// to or how many votes); after a teleport it shows what you went to, its picture and how far away it was.
export const BOX_TAG = 'gh_tpbox';           // the old floating box (removed if it's still there)

// target() -> (promise of) { cfg, player } while Chat Teleport is the type playing (world open, you in it), else null.
// dimOf(player) -> 'overworld' | 'the_nether' | 'the_end'. teleport(player, target, range) -> { away } or throws.
export function makeChatTeleport({ mc, log, broadcast, target, dimOf, teleport }) {
    let round = null;           // { endsAt, total, votes: Map viewer -> {t, at}, last: {t, by} }
    let busy = false, boxUp = false, boxFor = null, boxPack = false, last = null, holdUntil = 0;

    const blockedSet = cfg => new Set(String(cfg.blocked).toLowerCase().split(/[\s,;]+/).map(s => s.replace(/^minecraft:/, '').replace(/^#/, '')).filter(Boolean));
    const isBlocked = (cfg, t) => { const b = blockedSet(cfg); return b.has(t.filter.replace(/^#?minecraft:/, '')) || b.has(t.label.toLowerCase().replace(/ /g, '_')); };
    // what chat wants, best first: [{ t, votes, by }]
    function ranking(cfg) {
        if (!round) return [];
        if (cfg.pick === 'last') return round.last ? [{ t: round.last.t, by: round.last.by }] : [];
        const count = new Map();
        for (const v of round.votes.values()) {
            const c = count.get(v.t.key) || { t: v.t, votes: 0, at: 0 };
            c.votes++; c.at = Math.max(c.at, v.at);
            count.set(v.t.key, c);
        }
        return [...count.values()].sort((a, b) => b.votes - a.votes || b.at - a.at);
    }
    const publicState = cfg => {
        const r = ranking(cfg), lead = r[0];
        return { on: !!round, tag: 'TELEPORT TO', doneTag: 'TELEPORTED TO', pick: cfg.pick, left: round ? Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000)) : 0, total: round?.total || cfg.seconds,
            leader: lead && { label: lead.t.label, by: lead.by || null, votes: lead.votes || null }, top: r.slice(0, 3).map(x => ({ label: x.t.label, votes: x.votes })) };
    };
    const newRound = cfg => { round = { endsAt: Date.now() + cfg.seconds * 1000, total: cfg.seconds, votes: new Map(), last: null }; };
    const say = (cfg, d) => { if (cfg.showOverlay) broadcast('chunkchat', d); };

    const sel = p => /^\w{1,16}$/.test(p || '') ? `@a[name=${p},limit=1]` : '@p';
    // the box: sent again every second (it stays up 1.5 s), so it goes away by itself if Gift Hype stops
    async function showBox(t, cfg, what) {
        const s = sel(t.player);
        if (what) last = what; else what = last;
        if (!what) return;
        if (!boxUp || boxFor !== t.player || boxPack !== t.pack) {
            if (boxUp) await hideBox();
            boxUp = true; boxFor = t.player; boxPack = t.pack;
            if (t.pack) { await mc(`title ${s} reset`).catch(() => {}); await mc(`title ${s} times 0 30 0`).catch(() => {}); }
        }
        if (t.pack) await mc(`title ${s} title ${hudTitle(cfg, what)}`).catch(() => {});
        else await mc(`title ${s} actionbar ${plain(what)}`).catch(() => {});
    }
    async function hideBox() {
        if (!boxUp) return;
        const s = sel(boxFor), pack = boxPack;
        boxUp = false; boxFor = null; last = null;
        await mc(pack ? `title ${s} clear` : `title ${s} actionbar ""`).catch(() => {});
    }
    const plain = w => w.left != null ? `[${txt('TELEPORT IN ', 'aqua', ',"bold":true')},${txt(String(w.left), w.left <= 5 ? 'red' : 'white', ',"bold":true')}]`
        : w.done ? `[${txt(w.target?.label || 'TELEPORTED', 'aqua', ',"bold":true')}${w.away ? ',' + txt(` - ${w.away} blocks away`, 'white') : ''}]`
        : txt('NOTHING FOUND', 'red', ',"bold":true');

    let cleaned = false;
    async function tick() {
        if (busy) return;
        busy = true;
        try {
            // a bar or box left over from before Gift Hype was restarted
            if (!cleaned) { cleaned = true; await mc(`bossbar remove ${BAR}`).catch(() => { cleaned = false; }); await mc(`kill @e[type=minecraft:text_display,tag=${BOX_TAG}]`).catch(() => {}); }
            const t = await target();
            if (!t) { if (round || boxUp) { round = null; await hideBox(); broadcast('chunkchat', { on: false }); } return; }
            const cfg = t.cfg;
            if (!round) newRound(cfg);
            const st = publicState(cfg);
            if (cfg.showGame) { if (Date.now() >= holdUntil) await showBox(t, cfg, { left: st.left }); else await showBox(t, cfg, null); }
            else await hideBox();
            if (Date.now() < round.endsAt) { say(cfg, st); return; }
            await go(t, cfg);
        } finally { busy = false; }
    }

    // time's up: to the nearest of what chat picked (the next one if that's not in your dimension or not near)
    async function go(t, cfg) {
        const list = ranking(cfg);
        newRound(cfg);
        if (!list.length) { say(cfg, { ...publicState(cfg), done: { none: true } }); return; }
        const s = sel(t.player);
        const dim = await dimOf(t.player).catch(() => 'overworld');
        const flash = async what => { if (cfg.showGame) { holdUntil = Date.now() + 4000; await showBox(t, cfg, what); } };
        for (const c of list.slice(0, 4)) {
            if (c.t.dims && !c.t.dims.has(dim)) { log(`Chat Teleport: ${c.t.label} isn't in ${DIM_NAME[dim] || dim}`); continue; }
            try {
                const r = await teleport(t.player, c.t, cfg.range);
                await flash({ done: true, target: c.t, away: r.away || 0 });
                await mc(`execute at ${s} run playsound minecraft:entity.enderman.teleport master @a ~ ~ ~ 1 1`).catch(() => {});
                await mc(`execute at ${s} run particle minecraft:portal ~ ~1 ~ 0.6 1 0.6 0.5 120 force`).catch(() => {});
                log(`Chat Teleport: to ${c.t.label}${r.away ? ` (${r.away} blocks away)` : ''}`);
                say(cfg, { ...publicState(cfg), done: { label: c.t.label, by: c.by || null, votes: c.votes || null } });
                return;
            } catch (e) {
                log(`Chat Teleport: no ${c.t.label} found (${e.message})`);
            }
        }
        await flash({ none: true });
        say(cfg, { ...publicState(cfg), done: { label: 'NOTHING FOUND', failed: true } });
    }
    setInterval(() => tick().catch(e => log(`Chat Teleport: ${e.message}`)), 1000);

    // Someone typed in the LIVE chat. Returns what happened (for the app's Try box).
    let chain = Promise.resolve();
    const onChat = (text, by) => (chain = chain.then(() => handle(text, by), () => handle(text, by)));
    async function handle(text, by) {
        const t = await target();
        if (!t) return { ok: false, why: 'Chat Teleport is not the type playing (or nobody is in the world)' };
        let tg = targetOf(text);
        if (!tg) {
            // a block from a newer Minecraft than the list: ask the game
            const g = (blockGuesses(text) || []).find(x => x.id);
            if (g && !/unknown|invalid|expected/i.test(String(await mc(`execute if block ~ ~ ~ minecraft:${g.id}`).catch(e => e.message))))
                tg = { key: 'k:' + g.id, kind: 'block', filter: `minecraft:${g.id}`, label: g.id.replace(/_/g, ' ').toUpperCase(), dims: null };
        }
        if (!tg) return { ok: false, why: 'Not a block, structure or biome' };
        if (isBlocked(t.cfg, tg)) return { ok: false, why: `${tg.label} can't be picked` };
        if (tg.dims) {
            const dim = await dimOf(t.player).catch(() => null);
            if (dim && !tg.dims.has(dim)) return { ok: false, why: `${tg.label} isn't in ${DIM_NAME[dim] || dim}` };
        }
        if (!round) newRound(t.cfg);
        const who = String(by).slice(0, 30);
        if (t.cfg.pick === 'last') round.last = { t: tg, by: who };
        else round.votes.set(who, { t: tg, at: Date.now() });
        say(t.cfg, publicState(t.cfg));
        return { ok: true, label: tg.label, kind: tg.kind, pick: t.cfg.pick };
    }

    return { onChat, state: async () => { const t = await target(); return t?.cfg.showOverlay ? publicState(t.cfg) : { on: false }; }, skip: async () => { if (round) round.endsAt = Date.now(); } };
}

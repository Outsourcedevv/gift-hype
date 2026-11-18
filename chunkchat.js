// Chunk Chat (a Minecraft type): viewers type blocks in the LIVE chat, and every so often the whole
// chunk you're in turns into the block chat picked: the last one typed, or the one typed most
// (one vote per viewer each round). Air stays air, so you're never buried, and the bedrock floor
// stays, so nothing pours out into the void.
//
// Every block in Minecraft is understood, typos and all ("diamnd blok", "obsidain", "oak leafs"), with
// everyday names ("diamonds" = diamond block, "logs" = oak logs). Only full blocks you can stand on can
// fill a chunk: nothing you'd fall through (chains, candles, flowers, rails...), nothing a gift does
// (lava, air, cobwebs), nothing with an inside (chests, furnaces...) and nothing that sets itself off
// (TNT, pistons, observers...). Water is fine. When the timer runs out, chat's picks are tried from the
// winner down (newest first) until one can fill the chunk.
// The lists are in chunkchat-blocks.json (made from Minecraft 26.2's own block list).
//
// On screen (each can be turned off): Chat Teleport's box in Minecraft (hudpack.js) saying when the
// next chunk comes, then the block's picture, its name and how many blocks changed; the timer on the
// stream overlay; and a reveal animation on the overlay every time the chunk changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockTargetOf, plainBlockOf } from './chatteleport.js';
import { hudTitle, BOX_DEFAULTS, boxWords, boxColour } from './hudpack.js';

const LISTS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'chunkchat-blocks.json'), 'utf8'));
const ALLOWED = new Set(LISTS.allowed);
// every block that gets turned, for the data pack's block tag (#gifthype:chunk_chat)
export const CHUNK_REPLACE = LISTS.replace;

// the box's words for Chunk Chat (its colours and look are the same settings as Chat Teleport's box)
export const CC_BOX = { ...BOX_DEFAULTS, colStripe: '#55C26A', colLabel: '#2E8B3E',
    txtTeleportIn: 'NEW CHUNK IN', txtLoading: 'CHANGING...', txtNothing: 'NO BLOCK PICKED', txtAway: 'BLOCKS CHANGED', txtTeleported: 'CHUNK CHANGED!' };
// the sound when the chunk changes
export const CC_SOUNDS = { anchor: 'minecraft:block.respawn_anchor.charge', anvil: 'minecraft:block.anvil.land', boom: 'minecraft:entity.generic.explode',
    level: 'minecraft:entity.player.levelup', bell: 'minecraft:block.bell.use', none: null };

export function normalizeChunkChat(c = {}, onByDefault = false) {
    const n = (v, lo, hi, def) => Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : def;
    return {
        on: typeof c.on === 'boolean' ? c.on : onByDefault,
        seconds: n(c.seconds, 10, 600, 30),            // how often your chunk changes
        pick: c.pick === 'last' ? 'last' : 'most',     // the last block typed, or the one typed most
        blocked: String(c.blocked ?? '').slice(0, 2000), // more blocks you don't want
        // ---- on screen (before 2.9.0 one switch, "show", did the overlay timer and a bar in the game) ----
        showGame: c.showGame !== false,                 // the timer box in Minecraft
        showOverlay: typeof c.showOverlay === 'boolean' ? c.showOverlay : c.show === true,   // the timer on the stream overlay
        reveal: c.reveal !== false,                     // the animation on the stream overlay when the chunk changes
        revealGame: c.revealGame !== false,             // a big title in Minecraft when it changes (when the box is off)
        // ---- the box (the same settings as Chat Teleport's box) ----
        boxX: n(c.boxX, -100, 100, 0), boxY: n(c.boxY, -100, 100, 40), boxSize: n(c.boxSize, 50, 250, 100),
        icon3d: c.icon3d !== false,
        ...Object.fromEntries(Object.entries(CC_BOX).map(([k, v]) => [k, k.startsWith('col') ? boxColour(c[k], v) : boxWords(c[k], v)])),
        showPicture: c.showPicture !== false, showName: c.showName !== false, showDistance: c.showDistance !== false,   // distance = how many blocks changed
        // ---- timings and sounds ----
        resultSeconds: n(c.resultSeconds, 1, 15, 4),    // how long the result shows (the next countdown starts after it)
        warnAt: n(c.warnAt, 0, 30, 5),                  // the last seconds in the warning colour (0: never)
        warnSound: c.warnSound === true,                // a tick each of those seconds
        sound: Object.hasOwn(CC_SOUNDS, c.sound) ? c.sound : 'anchor',
        particles: c.particles !== false,               // a burst of the block round you when it changes
    };
}

const label = id => id.replace(/_/g, ' ').toUpperCase();
const txt = (t, color, extra = '') => `{"text":${JSON.stringify(t)},"color":"${color}"${extra}}`;
const BAR = 'gifthype:chunkchat';               // the old timer bar (removed if it's still there)

// plain words that mean the block of it ("diamonds" -> diamond block), before the general matching
const MATERIAL = { diamond: 'diamond_block', emerald: 'emerald_block', gold: 'gold_block', iron: 'iron_block', coal: 'coal_block', copper: 'copper_block',
    redstone: 'redstone_block', lapis: 'lapis_block', netherite: 'netherite_block', quartz: 'quartz_block', amethyst: 'amethyst_block', bone: 'bone_block',
    hay: 'hay_block', melon: 'melon', pumpkin: 'pumpkin', snow: 'snow_block', moss: 'moss_block', mud: 'mud', dirt: 'dirt', clay: 'clay', ice: 'ice', glass: 'glass' };
// a group ("logs", "wool", "diamond ores") -> one block of it that can fill a chunk
function groupBlock(tag) {
    const stem = tag.replace(/^all_/, '').replace(/ies$/, 'y').replace(/(ches|shes|xes)$/, m => m.slice(0, -2)).replace(/s$/, '');
    const fits = id => id === tag || id === stem || id.endsWith('_' + tag) || id.endsWith('_' + stem);
    const rank = id => (/^(oak|white|stone)_/.test(id) ? 0 : 1) + (/deepslate|stripped|waxed|infested/.test(id) ? 2 : 0) + id.length / 100;
    const list = LISTS.allowed.filter(fits).sort((a, b) => rank(a) - rank(b));
    return list[0] || null;
}
// What someone typed -> { id, label, ok, why } or null (not a block). ok: it can fill a chunk.
export function chunkBlockOf(text, cfg = {}) {
    const plain = String(text || '').toLowerCase().replace(/^minecraft:/, '').replace(/[^a-z]+/g, '').replace(/(es|s)$/, '');
    let id = MATERIAL[plain] || MATERIAL[plain + 'e'] || null;
    if (!id) {
        const t = blockTargetOf(text);
        if (!t) return null;
        const raw = t.filter.replace(/^#?minecraft:/, '');
        // a group: the single block it also means, if that can fill a chunk ("glas" -> glass), else one of the group
        const single = t.filter.startsWith('#') ? plainBlockOf(text) : null;
        const inGroup = b => { const st = raw.replace(/ies$/, 'y').replace(/s$/, ''); return b === raw || b === st || b.endsWith('_' + raw) || b.endsWith('_' + st); };
        id = !t.filter.startsWith('#') ? raw : single && ALLOWED.has(single) && !inGroup(single) ? single : groupBlock(raw) || (single && ALLOWED.has(single) ? single : null);
        if (!id) return { id: raw, label: t.label, ok: false, why: `${t.label} can't fill a chunk` };
    }
    const extra = new Set(String(cfg.blocked || '').toLowerCase().split(/[\s,;]+/).map(s => s.replace(/^minecraft:/, '')).filter(Boolean));
    if (extra.has(id)) return { id, label: label(id), ok: false, why: `${label(id)} is turned off in your Chunk Chat settings` };
    if (!ALLOWED.has(id)) return { id, label: label(id), ok: false, why: `${label(id)} can't fill a chunk (you'd fall through it, a gift does it, or it has an inside)` };
    return { id, label: label(id), ok: true };
}

// target() -> (promise of) { cfg, player, pack } while Chunk Chat is the type playing (and the world is
// open), else null. pack: Unbound's box pack is in the game (your own world). fillChunk(player, block) ->
// how many blocks changed (throws if it couldn't).
export function makeChunkChat({ mc, log, broadcast, target, fillChunk }) {
    let round = null;           // { endsAt, total, votes: Map viewer -> {id, at}, log: [{id, by, at}] }
    let busy = false, boxUp = false, boxFor = null, boxPack = false, lastBox = null, holdUntil = 0, lastTick = null;

    // what chat wants, best first: [{ id, votes, by }]. Most typed: by votes (one each), then everything
    // else typed this round, newest first. Last typed: newest first. Only blocks that can fill a chunk.
    function ranking(cfg) {
        if (!round) return [];
        const out = [], seen = new Set();
        if (cfg.pick !== 'last') {
            const count = new Map();
            for (const v of round.votes.values()) {
                const c = count.get(v.id) || { id: v.id, votes: 0, at: 0 };
                c.votes++; c.at = Math.max(c.at, v.at);
                count.set(v.id, c);
            }
            for (const c of [...count.values()].sort((a, b) => b.votes - a.votes || b.at - a.at)) { out.push(c); seen.add(c.id); }
        }
        for (let i = round.log.length - 1; i >= 0; i--) {
            const l = round.log[i];
            if (!seen.has(l.id)) { seen.add(l.id); out.push({ id: l.id, by: l.by }); }
        }
        return out;
    }
    const publicState = cfg => {
        const r = ranking(cfg), lead = r[0];
        return { on: !!round, tag: 'NEXT CHUNK', doneTag: 'YOUR CHUNK IS NOW', pick: cfg.pick, left: round ? Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000)) : 0, total: round?.total || cfg.seconds,
            leader: lead && { label: label(lead.id), by: lead.by || null, votes: lead.votes || null }, top: r.slice(0, 3).map(x => ({ label: label(x.id), votes: x.votes })) };
    };
    const newRound = (cfg, at = Date.now()) => { round = { endsAt: at + cfg.seconds * 1000, total: cfg.seconds, votes: new Map(), log: [] }; };
    let ovOn = false;
    const say = (cfg, d) => { if (cfg.showOverlay) { ovOn = true; broadcast('chunkchat', d); } };

    // ---- the box in Minecraft: sent again every second (it stays up 1.5 s), so it goes if Unbound stops ----
    const sel = p => /^\w{1,16}$/.test(p || '') ? `@a[name=${p},limit=1]` : '@p';
    async function showBox(t, cfg, what) {
        const s = sel(t.player);
        if (what) lastBox = what; else what = lastBox;
        if (!what) return;
        if (!boxUp || boxFor !== t.player || boxPack !== t.pack) {
            if (boxUp) await hideBox();
            boxUp = true; boxFor = t.player; boxPack = t.pack;
            if (t.pack) { await mc(`title ${s} reset`).catch(() => {}); await mc(`title ${s} times 0 30 0`).catch(() => {}); }
        }
        if (t.pack) await mc(`title ${s} title ${hudTitle(cfg, what)}`).catch(() => {});
        else await mc(`title ${s} actionbar ${plain(cfg, what)}`).catch(() => {});
    }
    async function hideBox() {
        if (!boxUp) return;
        const s = sel(boxFor), pack = boxPack;
        boxUp = false; boxFor = null; lastBox = null;
        await mc(pack ? `title ${s} clear` : `title ${s} actionbar ""`).catch(() => {});
    }
    // on a server without the pack: text above the hotbar, in the box's words and colours
    const plain = (c, w) => w.left != null ? `[${txt(c.txtTeleportIn + ' ', c.colLabel, ',"bold":true')},${txt(String(w.left), w.left <= c.warnAt ? c.colWarn : c.colDigits, ',"bold":true')}]`
        : w.done ? `[${txt(c.showName ? w.target?.label || c.txtTeleported : c.txtTeleported, c.colName, ',"bold":true')}${w.away && c.showDistance ? ',' + txt(` - ${w.away.toLocaleString('en-US')} ${c.txtAway.toLowerCase()}`, c.colAway) : ''}]`
        : txt(c.txtNothing, c.colNone, ',"bold":true');

    let cleaned = false;
    async function tick() {
        if (busy) return;
        busy = true;
        try {
            // a bar left over from before Unbound was restarted (older versions had one)
            if (!cleaned) { cleaned = true; await mc(`bossbar remove ${BAR}`).catch(() => { cleaned = false; }); }
            const t = await target();
            if (!t) { if (round || boxUp) { round = null; await hideBox(); broadcast('chunkchat', { on: false }); } return; }
            const cfg = t.cfg;
            if (!round) newRound(cfg);
            const st = publicState(cfg), showing = Date.now() < holdUntil;
            if (cfg.warnSound && cfg.warnAt && st.left > 0 && st.left <= cfg.warnAt && st.left !== lastTick && !showing) {
                lastTick = st.left;
                await mc(`execute at ${sel(t.player)} run playsound minecraft:block.note_block.hat master ${sel(t.player)} ~ ~ ~ 1 ${(1 + (cfg.warnAt - st.left) / cfg.warnAt).toFixed(2)}`).catch(() => {});
            }
            if (cfg.showGame) await showBox(t, cfg, showing ? null : { left: st.left });
            else await hideBox();
            if (!cfg.showOverlay && ovOn) { ovOn = false; broadcast('chunkchat', { on: false }); }
            if (Date.now() < round.endsAt) { if (!showing) say(cfg, st); return; }
            await change(t, cfg);
        } finally { busy = false; }
    }

    // time's up: the chunk turns into the best of chat's picks that works (the next one if it doesn't)
    async function change(t, cfg) {
        const list = ranking(cfg), s = sel(t.player);
        const after = () => Math.max(Date.now(), holdUntil);
        const flash = async what => { if (cfg.showGame) { holdUntil = Date.now() + cfg.resultSeconds * 1000; await showBox(t, cfg, what); } };
        if (!list.length) {
            await flash({ none: true });
            newRound(cfg, after());
            say(cfg, { ...publicState(cfg), done: { none: true } });
            return;
        }
        for (const c of list.slice(0, 15)) {
            const name = label(c.id);
            let count = 0;
            try { count = await fillChunk(t.player, c.id); }
            catch (e) { log(`Chunk Chat: ${name} didn't work (${e.message}), trying the next one`); continue; }
            const target = { kind: 'block', filter: `minecraft:${c.id}`, label: name };
            await flash({ done: true, target, away: count });
            // no box: a big title instead (settings)
            if (!cfg.showGame && cfg.revealGame) {
                await mc(`title ${s} times 5 40 10`).catch(() => {});
                await mc(`title ${s} subtitle ${txt(c.by ? `picked by ${c.by}` : c.votes ? `${c.votes} vote${c.votes > 1 ? 's' : ''}` : '', 'gray')}`).catch(() => {});
                await mc(`title ${s} title ${txt(`${name} CHUNK`, 'green', ',"bold":true')}`).catch(() => {});
            }
            if (CC_SOUNDS[cfg.sound]) await mc(`execute at ${s} run playsound ${CC_SOUNDS[cfg.sound]} master @a ~ ~ ~ 1 0.8`).catch(() => {});
            if (cfg.particles) await mc(`execute at ${s} run particle minecraft:block{block_state:"minecraft:${c.id}"} ~ ~1 ~ 1.2 1 1.2 0.2 160 force`)
                .catch(() => mc(`execute at ${s} run particle minecraft:block minecraft:${c.id} ~ ~1 ~ 1.2 1 1.2 0.2 160 force`).catch(() => {}));
            log(`Chunk Chat: your chunk is now ${name} (${count.toLocaleString('en-US')} blocks)`);
            newRound(cfg, after());
            const done = { id: c.id, label: name, by: c.by || null, votes: c.votes || null, count };
            say(cfg, { ...publicState(cfg), done });
            if (cfg.reveal) broadcast('chunkreveal', done);
            return;
        }
        await flash({ none: true });
        newRound(cfg, after());
        say(cfg, { ...publicState(cfg), done: { label: 'NOTHING WORKED', failed: true } });
    }
    setInterval(() => tick().catch(e => log(`Chunk Chat: ${e.message}`)), 1000);

    // Someone typed in the LIVE chat. Returns what happened (for the app's Try box).
    let chain = Promise.resolve();
    const onChat = (text, by) => (chain = chain.then(() => handle(text, by), () => handle(text, by)));
    async function handle(text, by) {
        const t = await target();
        if (!t) return { ok: false, why: 'Chunk Chat is not the type playing (or the world is not open)' };
        const b = chunkBlockOf(text, t.cfg);
        if (!b) return { ok: false, why: 'Not a block name' };
        if (!b.ok) return { ok: false, why: b.why };
        if (!round) newRound(t.cfg);
        const who = String(by).slice(0, 30);
        if (t.cfg.pick !== 'last') round.votes.set(who, { id: b.id, at: Date.now() });     // one vote each: a new block replaces your vote
        round.log.push({ id: b.id, by: who, at: Date.now() });
        if (round.log.length > 200) round.log.shift();
        if (Date.now() >= holdUntil) say(t.cfg, publicState(t.cfg));
        return { ok: true, label: b.label, pick: t.cfg.pick };
    }

    return { onChat, state: async () => { const t = await target(); return t?.cfg.showOverlay ? publicState(t.cfg) : { on: false }; }, skip: async () => { if (round) round.endsAt = Date.now(); } };
}

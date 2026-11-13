// Chunk Chat (a Minecraft type): viewers type blocks in the LIVE chat, and every so often the whole
// chunk you're in turns into the block chat picked: the last one typed, or the one typed most
// (one vote per viewer each round). Air stays air, so you're never buried, and the bedrock floor
// stays, so nothing pours out into the void.
//
// Only full blocks you can stand on can be picked: nothing you'd fall through (chains, candles,
// flowers, rails...), nothing a gift does (lava, air, cobwebs), nothing with an inside (chests,
// furnaces...) and nothing that sets itself off (TNT, pistons, observers...). Water is fine.
// The lists are in chunkchat-blocks.json (made from Minecraft 26.2's own block list).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockGuesses } from './chatdelete.js';

const LISTS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'chunkchat-blocks.json'), 'utf8'));
const ALLOWED = new Set(LISTS.allowed);
// every block that gets turned, for the data pack's block tag (#gifthype:chunk_chat)
export const CHUNK_REPLACE = LISTS.replace;

export function normalizeChunkChat(c = {}, onByDefault = false) {
    const n = (v, lo, hi, def) => Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : def;
    return {
        on: typeof c.on === 'boolean' ? c.on : onByDefault,
        seconds: n(c.seconds, 10, 600, 30),            // how often your chunk changes
        pick: c.pick === 'last' ? 'last' : 'most',     // the last block typed, or the one typed most
        blocked: String(c.blocked ?? '').slice(0, 2000), // more blocks you don't want
        show: c.show === true,                          // the timer on the stream overlay and as a bar in the game (off: you add your own in LIVE Studio)
    };
}

const label = id => id.replace(/_/g, ' ').toUpperCase();
const txt = (t, color, extra = '') => `{"text":${JSON.stringify(t)},"color":"${color}"${extra}}`;
const BAR = 'gifthype:chunkchat';

// target() -> (promise of) { cfg, player } while Chunk Chat is the type playing (and the world is
// open), else null. fillChunk(player, block) -> how many blocks changed.
export function makeChunkChat({ mc, log, broadcast, target, fillChunk }) {
    const known = new Map();
    let round = null;           // { endsAt, total, votes: Map viewer -> {id, at}, last: {id, by} }
    let busy = false, barUp = false;

    async function exists(id) {
        if (known.has(id)) return known.get(id);
        const reply = String(await mc(`execute if block ~ ~ ~ minecraft:${id}`).catch(e => e.message || ''));
        const ok = !/unknown|invalid|expected/i.test(reply);
        known.set(id, ok);
        return ok;
    }

    function standings(cfg) {
        if (!round) return { leader: null, top: [] };
        if (cfg.pick === 'last') return { leader: round.last ? { id: round.last.id, by: round.last.by } : null, top: [] };
        const count = new Map();
        for (const v of round.votes.values()) {
            const c = count.get(v.id) || { id: v.id, votes: 0, at: 0 };
            c.votes++; c.at = Math.max(c.at, v.at);
            count.set(v.id, c);
        }
        const top = [...count.values()].sort((a, b) => b.votes - a.votes || b.at - a.at);
        return { leader: top[0] || null, top: top.slice(0, 3) };
    }
    const publicState = cfg => {
        const { leader, top } = standings(cfg);
        return {
            on: !!round, pick: cfg.pick, left: round ? Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000)) : 0, total: round?.total || cfg.seconds,
            leader: leader && { label: label(leader.id), by: leader.by || null, votes: leader.votes || null },
            top: top.map(t => ({ label: label(t.id), votes: t.votes })),
        };
    };

    const newRound = cfg => { round = { endsAt: Date.now() + cfg.seconds * 1000, total: cfg.seconds, votes: new Map(), last: null }; };

    async function hide() {
        round = null;
        if (barUp) { barUp = false; await mc(`bossbar remove ${BAR}`).catch(() => {}); }
        broadcast('chunkchat', { on: false });
    }

    async function tick() {
        if (busy) return;
        busy = true;
        try {
            const t = await target();
            if (!t) { if (round || barUp) await hide(); return; }
            const cfg = t.cfg;
            if (!round) newRound(cfg);
            if (!cfg.show) {
                // nothing on screen: no bar in the game, no box on the overlay; the chunk still changes on time
                if (barUp) { barUp = false; await mc(`bossbar remove ${BAR}`).catch(() => {}); broadcast('chunkchat', { on: false }); }
                if (Date.now() >= round.endsAt) await change(t, cfg);
                return;
            }
            if (!barUp) {
                barUp = true;
                await mc(`bossbar remove ${BAR}`).catch(() => {});
                await mc(`bossbar add ${BAR} ${txt('Chunk Chat', 'green')}`).catch(() => {});
                for (const c of ['color green', 'style notched_10', 'players @a']) await mc(`bossbar set ${BAR} ${c}`).catch(() => {});
            }
            const st = publicState(cfg);
            if (Date.now() < round.endsAt) {
                const what = st.leader ? [txt('Next chunk: ', 'white'), txt(st.leader.label, 'green', ',"bold":true'), txt(st.leader.votes ? ` (${st.leader.votes} vote${st.leader.votes > 1 ? 's' : ''})` : st.leader.by ? ` (${st.leader.by})` : '', 'gray')] : [txt('Type a block in chat!', 'yellow', ',"bold":true')];
                await mc(`bossbar set ${BAR} name [${[...what, txt(`  ${st.left}s`, 'white')].join(',')}]`).catch(() => {});
                await mc(`bossbar set ${BAR} max ${round.total}`).catch(() => {});
                await mc(`bossbar set ${BAR} value ${st.left}`).catch(() => {});
                broadcast('chunkchat', st);
                return;
            }
            await change(t, cfg);
        } finally { busy = false; }
    }

    // time's up: the chunk turns into the block that won (on the overlay too, if it's shown)
    async function change(t, cfg) {
            const say = d => { if (cfg.show) broadcast('chunkchat', d); };
            const { leader } = standings(cfg);
            newRound(cfg);
            if (!leader) { say({ ...publicState(cfg), done: { none: true } }); return; }
            const name = label(leader.id), by = leader.by || null;
            let count = 0;
            try { count = await fillChunk(t.player, leader.id); }
            catch (e) { log(`Chunk Chat: ${name} didn't work: ${e.message}`); say({ ...publicState(cfg), done: { label: name, failed: true } }); return; }
            const s = /^\w{1,16}$/.test(t.player || '') ? `@a[name=${t.player},limit=1]` : '@p';
            if (cfg.show) {
                await mc(`title ${s} times 5 40 10`).catch(() => {});
                await mc(`title ${s} subtitle ${txt(by ? `picked by ${by}` : leader.votes ? `${leader.votes} vote${leader.votes > 1 ? 's' : ''}` : '', 'gray')}`).catch(() => {});
                await mc(`title ${s} title ${txt(`${name} CHUNK`, 'green', ',"bold":true')}`).catch(() => {});
            }
            await mc(`execute at ${s} run playsound minecraft:block.respawn_anchor.charge master @a ~ ~ ~ 1 0.8`).catch(() => {});
            log(`Chunk Chat: your chunk is now ${name} (${count.toLocaleString('en-US')} blocks)`);
            say({ ...publicState(cfg), done: { label: name, by, votes: leader.votes || null, count } });
    }
    setInterval(() => tick().catch(e => log(`Chunk Chat: ${e.message}`)), 1000);

    // Someone typed in the LIVE chat. Returns what happened (for the app's Try box).
    let chain = Promise.resolve();
    const onChat = (text, by) => (chain = chain.then(() => handle(text, by), () => handle(text, by)));
    async function handle(text, by) {
        const t = await target();
        if (!t) return { ok: false, why: 'Chunk Chat is not the type playing (or the world is not open)' };
        const guesses = (blockGuesses(text) || []).filter(g => g.id);
        if (!guesses.length) return { ok: false, why: 'Not a block name' };
        const extra = new Set(String(t.cfg.blocked).toLowerCase().split(/[\s,;]+/).map(s => s.replace(/^minecraft:/, '')).filter(Boolean));
        let id = null, refused = null;
        for (const g of guesses) {
            if (!ALLOWED.has(g.id) || extra.has(g.id)) { if (!refused && await exists(g.id)) refused = g.id; continue; }
            if (await exists(g.id)) { id = g.id; break; }
        }
        if (!id) return { ok: false, why: refused ? `${label(refused)} can't be used in Chunk Chat` : 'Not a block name' };
        if (!round) newRound(t.cfg);
        const who = String(by).slice(0, 30);
        if (t.cfg.pick === 'last') round.last = { id, by: who };
        else round.votes.set(who, { id, at: Date.now() });     // one vote each: a new block replaces your vote
        if (t.cfg.show) broadcast('chunkchat', publicState(t.cfg));
        return { ok: true, label: label(id), pick: t.cfg.pick };
    }

    return { onChat, state: async () => { const t = await target(); return t?.cfg.show ? publicState(t.cfg) : { on: false }; }, skip: async () => { if (round) round.endsAt = Date.now(); } };
}

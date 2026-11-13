// Chat block delete (Block Delete Survival): a viewer types a block's name in the LIVE chat, a
// countdown starts (on the stream overlay and as a bar in the game), and when it runs out every block
// of that kind in the chunks around you is removed.
//
// Block names are checked with the game itself (so new blocks in new versions work), e.g. "stone",
// "Oak Log", "minecraft:oak_log", "!dirt". A few plural words mean a whole group: "logs", "leaves",
// "wool", "flowers", "ores"... Anything else people type in chat is ignored.

const SLOTS = 8; // countdown bars in the game: gifthype:chatdel0..7

export const CHAT_DELETE_BLOCKED = 'bedrock, barrier, end_portal_frame, end_portal, end_gateway, nether_portal, command_block, chain_command_block, repeating_command_block, structure_block, jigsaw, light';

// The settings for one type (stored with the type, next to its gifts)
export function normalizeChatDelete(c = {}, onByDefault = false) {
    const n = (v, lo, hi, def) => Number.isFinite(+v) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(+v))) : def;
    return {
        on: typeof c.on === 'boolean' ? c.on : onByDefault,
        seconds: n(c.seconds, 5, 600, 30),      // countdown
        chunks: n(c.chunks, 0, 3, 1),           // chunks around yours: 0 = just yours, 1 = 3x3, 2 = 5x5, 3 = 7x7
        cooldown: n(c.cooldown, 0, 600, 20),    // seconds before the same viewer can pick again
        max: n(c.max, 1, SLOTS, 5),             // countdowns at once
        blocked: String(c.blocked ?? CHAT_DELETE_BLOCKED).slice(0, 2000),
    };
}

// Plural words for groups of blocks (Minecraft's own block tags)
const GROUPS = {
    logs: 'logs', wood: 'logs', leaves: 'leaves', planks: 'planks', wool: 'wool', carpets: 'wool_carpets', carpet: 'wool_carpets',
    flowers: 'flowers', saplings: 'saplings', sand: 'sand', slabs: 'slabs', stairs: 'stairs', doors: 'doors', trapdoors: 'trapdoors',
    beds: 'beds', fences: 'fences', walls: 'walls', terracotta: 'terracotta', candles: 'candles', ice: 'ice', rails: 'rails',
    buttons: 'buttons', signs: 'all_signs', banners: 'banners', crops: 'crops', coral: 'coral_blocks', corals: 'coral_blocks',
    coal_ores: 'coal_ores', iron_ores: 'iron_ores', copper_ores: 'copper_ores', gold_ores: 'gold_ores', redstone_ores: 'redstone_ores',
    lapis_ores: 'lapis_ores', diamond_ores: 'diamond_ores', emerald_ores: 'emerald_ores', diamonds: 'diamond_ores', emeralds: 'emerald_ores',
    stones: 'base_stone_overworld', glass: 'impermeable',
};
const NEVER = new Set(['air', 'cave_air', 'void_air']);

// What someone typed -> the names to try, best first. null if it can't be a block.
export function blockGuesses(text) {
    let t = String(text || '').toLowerCase().trim()
        .replace(/^[!/#.]+/, '').replace(/^(delete|remove|del|bye)\s+/, '').replace(/^minecraft:/, '').replace(/[.!?]+$/, '').trim();
    if (!/^[a-z][a-z _-]{1,44}$/.test(t) || t.split(/[ _-]+/).length > 6) return null;
    t = t.replace(/[ -]+/g, '_');
    const out = [{ id: t }];
    if (GROUPS[t]) out.push({ tag: GROUPS[t] });
    if (/s$/.test(t) && t.length > 3) out.push({ id: t.slice(0, -1) });          // "stones" -> stone
    if (/es$/.test(t) && t.length > 4) out.push({ id: t.slice(0, -2) });         // "bushes" -> bush
    return out;
}

const TAG_LABEL = { base_stone_overworld: 'stone types', impermeable: 'glass', all_signs: 'signs', wool_carpets: 'carpets', coral_blocks: 'coral' };
const nice = c => (c.tag ? `all ${TAG_LABEL[c.tag] || c.tag}` : c.id).replace(/_/g, ' ').toUpperCase();
const filterOf = c => c.tag ? `#minecraft:${c.tag}` : `minecraft:${c.id}`;
const txt = (t, color, extra = '') => `{"text":${JSON.stringify(t)},"color":"${color}"${extra}}`;

// mc: runs a command (RCON). deleteBlocks(player, filter, chunks) -> how many blocks went.
// target() -> (promise of) { cfg, player } for the type that's playing now, or null when it's not a chat-delete type.
export function makeChatDelete({ mc, log, broadcast, target, deleteBlocks }) {
    const known = new Map();       // "id:stone" -> true / false (does the game know it)
    const lastBy = new Map();      // viewer -> time of their last pick
    let pending = [];              // { key, label, filter, by, endsAt, total, slot }
    let ticker = null, deleting = Promise.resolve(), barsClean = false;

    async function exists(c) {
        const key = c.tag ? `tag:${c.tag}` : `id:${c.id}`;
        if (known.has(key)) return known.get(key);
        const reply = String(await mc(`execute if block ~ ~ ~ ${filterOf(c)}`).catch(e => e.message || ''));
        // a known block gives "Test passed/failed" or "not loaded"; a made-up one "Unknown block (type/tag)"
        const ok = !/unknown|invalid|expected/i.test(reply);
        if (known.size > 3000) known.clear();
        known.set(key, ok);
        return ok;
    }

    const publicList = () => pending.map(p => ({ label: p.label, by: p.by, left: Math.max(0, Math.ceil((p.endsAt - Date.now()) / 1000)), total: p.total }));
    const show = () => broadcast('chatdel', { items: publicList() });

    async function tick() {
        const now = Date.now();
        const due = pending.filter(p => p.endsAt <= now);
        if (due.length) {
            // the bar goes first (commands run in order), so a new countdown can't lose its bar in that slot
            for (const p of due) mc(`bossbar remove gifthype:chatdel${p.slot}`).catch(() => {});
            pending = pending.filter(p => p.endsAt > now);
            for (const p of due) deleting = deleting.then(() => finish(p)).catch(() => {});
        }
        if (!pending.length) { clearInterval(ticker); ticker = null; }
        show();
        for (const p of [...pending]) {
            const left = Math.max(0, Math.ceil((p.endsAt - now) / 1000));
            mc(`bossbar set gifthype:chatdel${p.slot} value ${left}`).catch(() => {});
            await mc(`bossbar set gifthype:chatdel${p.slot} name ${barName(p, left)}`).catch(() => {});
        }
    }
    const barName = (p, left) => `[${txt(`${p.label} `, 'red', ',"bold":true')},${txt(`deleted in ${left}s`, 'white')},${txt(`  (${p.by})`, 'gray')}]`;

    async function finish(p) {
        const t = await target();
        if (!t?.player) { broadcast('chatdel', { items: publicList(), done: { label: p.label, by: p.by, count: 0, failed: true } }); return; }
        let count = 0;
        try {
            count = await deleteBlocks(t.player, p.filter, t.cfg.chunks);
        } catch (e) {
            log(`Chat block delete: ${p.label} couldn't be deleted: ${e.message}`);
            broadcast('chatdel', { items: publicList(), done: { label: p.label, by: p.by, count: 0, failed: true } });
            return;
        }
        const s = /^\w{1,16}$/.test(t.player) ? `@a[name=${t.player},limit=1]` : '@p';
        await mc(`title ${s} times 5 40 10`).catch(() => {});
        await mc(`title ${s} subtitle ${txt(`${count.toLocaleString('en-US')} blocks gone (${p.by})`, 'gray')}`).catch(() => {});
        await mc(`title ${s} title ${txt(`${p.label} DELETED`, 'red', ',"bold":true')}`).catch(() => {});
        await mc(`execute at ${s} run playsound minecraft:block.beacon.deactivate master @a ~ ~ ~ 1 0.6`).catch(() => {});
        log(`Chat block delete: ${p.label} (from ${p.by}) - ${count} blocks gone`);
        broadcast('chatdel', { items: publicList(), done: { label: p.label, by: p.by, count } });
    }

    // Someone typed something in the LIVE chat. Returns what happened (for the app's Try button).
    // One message at a time, so two people typing the same block at once start one countdown.
    let chain = Promise.resolve();
    const onChat = (text, by, opts) => (chain = chain.then(() => handle(text, by, opts), () => handle(text, by, opts)));
    async function handle(text, by, { test = false } = {}) {
        const t = await target();
        if (!t) return { ok: false, why: 'Chat block delete is off for the type that is playing' };
        const guesses = blockGuesses(text);
        if (!guesses) return { ok: false, why: 'Not a block name' };
        const cfg = t.cfg, now = Date.now();
        const blocked = new Set(String(cfg.blocked).toLowerCase().split(/[\s,;]+/).map(s => s.replace(/^minecraft:/, '')).filter(Boolean));
        let pick = null;
        for (const c of guesses) {
            if (c.id && (NEVER.has(c.id) || blocked.has(c.id))) return { ok: false, why: `${nice(c)} can't be deleted` };
            if (c.tag && blocked.has(c.tag)) continue;
            if (await exists(c)) { pick = c; break; }
        }
        if (!pick) return { ok: false, why: 'Not a block name' };
        const label = nice(pick), filter = filterOf(pick);
        if (pending.some(p => p.filter === filter)) return { ok: false, why: `${label} is already counting down` };
        if (pending.length >= cfg.max) return { ok: false, why: `${cfg.max} countdowns are already running` };
        const last = lastBy.get(by);
        if (!test && cfg.cooldown && last && now - last < cfg.cooldown * 1000) return { ok: false, why: `${by} has to wait ${Math.ceil((cfg.cooldown * 1000 - (now - last)) / 1000)}s` };
        lastBy.set(by, now);
        if (lastBy.size > 5000) lastBy.clear();

        if (!pending.length && !barsClean) {
            // bars left over from before (Gift Hype closed during a countdown)
            barsClean = true;
            await Promise.all([...Array(SLOTS).keys()].map(i => mc(`bossbar remove gifthype:chatdel${i}`).catch(() => {})));
        }
        const used = new Set(pending.map(p => p.slot));
        const slot = [...Array(SLOTS).keys()].find(i => !used.has(i));
        const p = { label, filter, by: String(by).slice(0, 30), endsAt: now + cfg.seconds * 1000, total: cfg.seconds, slot };
        pending.push(p);
        await mc(`bossbar remove gifthype:chatdel${slot}`).catch(() => {});
        await mc(`bossbar add gifthype:chatdel${slot} ${barName(p, cfg.seconds)}`).catch(() => {});
        for (const c of [`color red`, `style notched_10`, `max ${cfg.seconds}`, `value ${cfg.seconds}`, `players @a`]) await mc(`bossbar set gifthype:chatdel${slot} ${c}`).catch(() => {});
        await mc(`tellraw @a [${txt(p.by, 'aqua')},${txt(' picked ', 'white')},${txt(label, 'red', ',"bold":true')},${txt(`: deleted in ${cfg.seconds}s`, 'white')}]`).catch(() => {});
        await mc(`execute as @a at @s run playsound minecraft:block.note_block.bell master @s ~ ~ ~ 1 0.7`).catch(() => {});
        log(`Chat block delete: ${p.by} picked ${label} (in ${cfg.seconds}s)`);
        if (!ticker) ticker = setInterval(() => tick().catch(() => {}), 1000);
        show();
        return { ok: true, label, seconds: cfg.seconds };
    }

    // Stop every countdown (button in the app, or the type / game changed)
    async function clear() {
        const was = pending; pending = [];
        clearInterval(ticker); ticker = null;
        await Promise.all(was.map(p => mc(`bossbar remove gifthype:chatdel${p.slot}`).catch(() => {})));
        show();
        return was.length;
    }

    return { onChat, clear, list: publicList, forget: () => { known.clear(); barsClean = false; } };
}

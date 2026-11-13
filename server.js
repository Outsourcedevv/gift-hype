// Gift Hype: TikTok LIVE gifts play sounds and make things happen in your games.
//
// Each "game" has its own gift list. A gift can play a sound, pop up on the stream overlay, and
// do things in the game, through one of these:
//   minecraft - commands sent to a Minecraft server over RCON
//   websocket - JSON messages to your own game, which connects to ws://127.0.0.1:<wsPort>
//   keys      - key presses sent to whatever window is in front (works in many PC games)
//   none      - sounds and overlay only
//
// Run with:  node server.js            (opens the app window)
//            node server.js --no-open  (no window, for testing)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import { Rcon } from 'rcon-client';
import { WebSocketServer } from 'ws';
import { makePresets, MOBS, DELETE_BLOCKS, FILL_CHUNK } from './minecraft-presets.js';
import { makeChunkChat, normalizeChunkChat } from './chunkchat.js';
import { makeChatDelete, normalizeChatDelete } from './chatdelete.js';
import { listWorlds, installPack, singleplayerCommands } from './singleplayer.js';
import { makeLocalServer, setupLauncher, openLauncher, worldVersion } from './localserver.js';
import { checkForUpdate, applyUpdate, localVersion } from './updater.js';
import { DROPPER_WORLD, DROPPER_MC, DROPPER_PROPS, DROPPER_ACTIONS, LEVELS as DROPPER_LEVELS, installDropperPack, wheelAmounts, installDropperBuildPack, removeDropperBuildPack, dropperCommands, dropperAlertText, buildDropper, dropperBuilt, markDropperBuilt, dropperProgress } from './dropper.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const GAMES_DIR = path.join(DATA, 'games');
const COVERS_DIR = path.join(DATA, 'covers');
const SETTINGS_PATH = path.join(DATA, 'settings.json');
const SOUNDS_DIR = path.join(ROOT, 'sounds');
const CUSTOM_SOUNDS = path.join(SOUNDS_DIR, 'custom');
const NO_OPEN = process.argv.includes('--no-open');
const SOUND_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm' };

fs.mkdirSync(GAMES_DIR, { recursive: true });
fs.mkdirSync(CUSTOM_SOUNDS, { recursive: true });

// ---------- Settings and games ----------

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));

const settings = {
    tiktokUsername: '',
    eulerStreamApiKey: '',
    autoConnect: true,
    port: 4747,
    wsPort: 8765,
    activeGame: null,
    masterVolume: 0.8,
    soundsIn: 'app',        // 'app' (this window) or 'overlay' (the OBS overlay plays them)
    overlay: { position: 'top', scale: 1, showSender: true },
    ...readJson(SETTINGS_PATH, {}),
};
const saveSettings = () => writeJson(SETTINGS_PATH, settings);

const newId = () => crypto.randomBytes(5).toString('hex');
const gamePath = id => path.join(GAMES_DIR, `${id}.json`);

function loadGames() {
    const games = {};
    for (const f of fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'))) {
        const g = readJson(path.join(GAMES_DIR, f), null);
        if (g && g.id) games[g.id] = normalizeGame(g);
    }
    return games;
}

function normalizeGame(g) {
    return {
        id: g.id,
        name: String(g.name || 'My game').slice(0, 60),
        // Cover picture on the games screen: '' (none), 'file:<name>' (uploaded, in data/covers)
        // or a link to an official store picture (downloaded once, then kept in data/covers).
        cover: typeof g.cover === 'string' && (/^file:[\w.-]+$/.test(g.cover) || isCoverUrl(g.cover)) ? g.cover : '',
        connector: ['minecraft', 'websocket', 'keys', 'none'].includes(g.connector) ? g.connector : 'none',
        // serverFolder: a server found on this PC; its RCON port and password are read from its
        // server.properties. Without one, host/port/password are used as typed.
        // single: a singleplayer world (world = its folder name in .minecraft/saves) instead of a server
        minecraft: { serverFolder: '', host: '127.0.0.1', port: 25575, password: '', player: '', single: false, world: '', ...g.minecraft,
            manual: g.minecraft?.manual ?? (!!g.minecraft?.password && !g.minecraft?.serverFolder) },
        // Types of the game (e.g. Minecraft: Parkour Paradise / Block Delete Survival), each with its
        // own gift list. The picked one (mode) is the one gifts use. Old games had one list: `rules`.
        ...normalizeModes(g),
    };
}

// The first versions came with made-up .wav sounds; the real clips have the same names as .mp3.
const OLD_SOUND_NAMES = { 'pew-pew': 'bonk', fanfare: 'anime-wow' };
function realSound(sound) {
    const m = /^builtin\/([\w-]+)\.wav$/.exec(sound || '');
    return m ? `builtin/${OLD_SOUND_NAMES[m[1]] || m[1]}.mp3` : sound || null;
}

function normalizeRules(rules) {
    return (Array.isArray(rules) ? rules : []).map(r => ({
        id: r.id || newId(),
        gift: String(r.gift || ''),
        image: r.image || null,
        coins: r.coins ?? null,
        sound: realSound(r.sound),
        volume: Number.isFinite(+r.volume) ? Math.max(0, Math.min(1, +r.volume)) : 1,
        alert: r.alert !== false,
        label: String(r.label || ''),
        perCount: r.perCount !== false,
        actions: (Array.isArray(r.actions) ? r.actions : []).map(a => ({ type: a.type, ...a })),
    }));
}

function normalizeModes(g) {
    const src = Array.isArray(g.modes) && g.modes.length ? g.modes : [{ id: newId(), name: '', rules: g.rules }];
    const modes = src.slice(0, 20).map(m => ({
        id: String(m.id || newId()),
        name: String(m.name || '').slice(0, 40),
        cover: typeof m.cover === 'string' && /^file:[\w.-]+$/.test(m.cover) ? m.cover : '',
        rules: normalizeRules(m.rules),
        // chat block delete (chatdelete.js): on by itself for Block Delete types
        chat: normalizeChatDelete(m.chat, /block delete/i.test(m.name || '')),
        // Chunk Chat (chunkchat.js): on by itself for Chunk Chat types
        chunkChat: normalizeChunkChat(m.chunkChat, /chunk chat/i.test(m.name || '')),
    }));
    return { modes, mode: modes.some(m => m.id === g.mode) ? g.mode : modes[0].id };
}

const currentMode = g => g.modes.find(m => m.id === g.mode) || g.modes[0];
const rulesOf = g => currentMode(g).rules;

// What the Minecraft starter types do. Commands only, so they work on any server.
const AT = 'execute at @a[name={player},limit=1] run';
const PARKOUR_RULES = [
    { gift: 'Finger Heart', sound: 'builtin/bonk.mp3', label: 'Arrow rain', actions: [{ type: 'command', command: `${AT} summon arrow ~ ~6 ~ {Motion:[0.0d,-1.0d,0.0d],pickup:0b}` }] },
    { gift: 'Rosa', sound: 'builtin/oh-no.mp3', label: 'Frozen for 5s', actions: [
        { type: 'command', command: 'effect give {player} minecraft:slowness 5 255 true' },
        { type: 'command', command: 'effect give {player} minecraft:jump_boost 5 250 true' }] },
    { gift: 'Hat and Mustache', sound: 'builtin/fahh.mp3', label: 'Drunk for 15s', actions: [
        { type: 'command', command: 'effect give {player} minecraft:nausea 15 0 true' },
        { type: 'command', command: 'effect give {player} minecraft:slowness 15 1 true' }] },
    { gift: 'Paper Crane', sound: 'builtin/level-up.mp3', label: 'Speed boost', actions: [{ type: 'command', command: 'effect give {player} minecraft:speed 10 2 true' }] },
    { gift: 'Corgi', sound: 'builtin/boing.mp3', label: 'Super jump', actions: [{ type: 'command', command: 'effect give {player} minecraft:jump_boost 10 3 true' }] },
    { gift: 'Boxing Gloves', sound: 'builtin/whoosh.mp3', label: 'Launched into the air', actions: [{ type: 'command', command: 'effect give {player} minecraft:levitation 2 4 true' }] },
    { gift: 'Galaxy', sound: 'builtin/i-need-a-hero.mp3', label: 'Back to the start', perCount: false, actions: [{ type: 'command', command: 'kill {player}' }] },
];
const BLOCK_DELETE_RULES = [
    { gift: 'Rose', sound: 'builtin/vine-boom.mp3', label: 'Spawns a zombie', actions: [{ type: 'spawnMob', mob: 'zombie', amount: 1 }] },
    { gift: 'Finger Heart', sound: 'builtin/cha-ching.mp3', label: 'Diamond kit', perCount: false, actions: [{ type: 'diamondKit' }] },
    { gift: 'Rosa', sound: 'builtin/wrong-buzzer.mp3', label: 'Jail for 30s', actions: [{ type: 'jail', seconds: 30 }] },
    { gift: 'Perfume', sound: 'builtin/oh-no.mp3', label: 'Clears your inventory', perCount: false, actions: [{ type: 'clearInventory' }] },
    { gift: 'Doughnut', sound: 'builtin/bruh.mp3', label: 'Cobweb chunk', perCount: false, actions: [{ type: 'cobwebChunk' }] },
    { gift: 'Hat and Mustache', sound: 'builtin/fahh.mp3', label: 'Lava chunk', perCount: false, actions: [{ type: 'lavaChunk' }] },
    { gift: 'Corgi', sound: 'builtin/whoosh.mp3', label: 'Teleport to the End', perCount: false, actions: [{ type: 'endTp' }] },
    { gift: 'Money Gun', sound: 'builtin/anime-wow.mp3', label: 'God kit', perCount: false, actions: [{ type: 'godKit' }] },
    { gift: 'Galaxy', sound: 'builtin/i-need-a-hero.mp3', label: 'NUKE', perCount: false, actions: [{ type: 'nuke', size: 40 }] },
    { gift: 'Whale Diving', sound: 'builtin/nooo.mp3', label: 'Air chunk', perCount: false, actions: [{ type: 'airChunk' }] },
];
// Minecraft's official cover (Microsoft Store, Minecraft: Java & Bedrock Edition). Only the link is
// kept here; each PC downloads the picture itself the first time.
const MINECRAFT_COVER = 'https://store-images.s-microsoft.com/image/apps.808.14492077886571533.be42f4bd-887b-4430-8ed0-622341b4d2b0.c8274c53-105e-478b-9f4b-41b8088210a3';
function isCoverUrl(u) {
    try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'store-images.s-microsoft.com'; } catch { return false; }
}
// The Dropper (dropper.js): 100 levels in its own world, with levels, jail, punches and the reset.
const DROPPER_RULES = [
    { gift: 'Finger Heart', sound: 'builtin/bonk.mp3', label: 'Punch arrow', actions: [{ type: 'punch', amount: 1 }] },
    { gift: 'Rosa', sound: 'builtin/wrong-buzzer.mp3', label: 'Jail for 5s', actions: [{ type: 'jail', seconds: 5 }] },
    { gift: 'Doughnut', sound: 'builtin/vine-boom.mp3', label: 'Punches on/off', perCount: false, actions: [{ type: 'punchToggle' }] },
    { gift: 'Paper Crane', sound: 'builtin/level-up.mp3', label: 'Up 1 level', actions: [{ type: 'levelUp', amount: 1 }] },
    { gift: 'Hat and Mustache', sound: 'builtin/fahh.mp3', label: 'Down 1 level', actions: [{ type: 'levelDown', amount: 1 }] },
    { gift: 'Corgi', sound: 'builtin/anime-wow.mp3', label: 'Up 5 levels', actions: [{ type: 'levelUp', amount: 5 }] },
    { gift: 'Boxing Gloves', sound: 'builtin/nooo.mp3', label: 'Down 5 levels', actions: [{ type: 'levelDown', amount: 5 }] },
    { gift: 'Galaxy', sound: 'builtin/i-need-a-hero.mp3', label: 'Reset in 60s', perCount: false, actions: [{ type: 'resetTimer', seconds: 60 }] },
    { gift: 'Glowing Jellyfish', sound: 'builtin/cha-ching.mp3', label: 'Saves the reset', perCount: false, actions: [{ type: 'saveReset' }] },
    { gift: 'Hand Hearts', sound: 'builtin/here-comes-the-money.mp3', label: 'Level slots', perCount: false, actions: [{ type: 'levelWheel', amounts: '-10, -5, -3, -1, 1, 3, 5, 10' }] },
];
const minecraftModes = (parkourRules = PARKOUR_RULES) => [
    { id: newId(), name: 'Block Delete Survival', rules: BLOCK_DELETE_RULES },
    { id: newId(), name: 'Parkour Paradise', rules: parkourRules },
    { id: newId(), name: 'Dropper', rules: DROPPER_RULES },
    { id: newId(), name: 'Chunk Chat', rules: BLOCK_DELETE_RULES },
];
const isDropper = g => g?.connector === 'minecraft' && /dropper/i.test(currentMode(g)?.name || '');
// the world gifts go to: the Dropper has its own, the other types use the world you picked
const worldOf = g => isDropper(g) ? DROPPER_WORLD : g.minecraft.world;
const isSingle = g => isDropper(g) || !!g.minecraft.single;

let games = loadGames();
const saveGame = g => writeJson(gamePath(g.id), g);

// Starter games the first time the app opens.
if (!Object.keys(games).length) {
    const mc = normalizeGame({ id: newId(), name: 'Minecraft', cover: MINECRAFT_COVER, connector: 'minecraft', minecraft: { single: true, world: listWorlds()[0]?.name || '' }, modes: minecraftModes() });
    games = { [mc.id]: mc };
    saveGame(mc);
    settings.activeGame = mc.id;
    saveSettings();
} else if (!settings.minecraftTypes) {
    // Older versions started with "Minecraft" (one gift list) and "My own game". Now Minecraft has
    // the Parkour / Block Delete types and "My own game" is gone. Runs once.
    for (const g of Object.values(games)) {
        if (g.name === 'My own game' && g.connector === 'websocket') {
            delete games[g.id];
            fs.rmSync(gamePath(g.id), { force: true });
        } else if (g.name === 'Minecraft' && g.connector === 'minecraft' && g.modes.length === 1) {
            // Keeps the gifts you set up as the Parkour list; the untouched old starter is replaced.
            const old = g.modes[0].rules;
            const starter = old.map(r => r.label).join('|') === 'Spawns a zombie|Gives a diamond|Lightning strike!';
            Object.assign(g, normalizeModes({ modes: minecraftModes(starter || !old.length ? PARKOUR_RULES : old) }));
            saveGame(g);
        }
    }
}
if (!settings.minecraftTypes) { settings.minecraftTypes = true; saveSettings(); }
if (!settings.presets) {
    const OLD_BLOCK_DELETE = 'Spawns a zombie|Diamond kit|Spawns a ghast|Spawns a warden|Spawns the Ender Dragon|Clears your inventory';
    for (const g of Object.values(games)) {
        let changed = false;
        for (const m of g.modes) {
            if (m.name === 'Block Delete Survival' && m.rules.map(r => r.label).join('|') === OLD_BLOCK_DELETE) { m.rules = normalizeRules(BLOCK_DELETE_RULES); changed = true; }
            if (m.name === 'Parkour Paradise') for (const r of m.rules) if (r.gift === 'Galaxy' && r.label === 'Back to the start' && r.sound === 'builtin/sad-trombone.mp3') { r.sound = 'builtin/i-need-a-hero.mp3'; changed = true; }
        }
        if (changed) saveGame(g);
    }
    settings.presets = true; saveSettings();
}
if (!settings.bedrockNuke) {
    // the nuke now digs to bedrock across about 20 chunks: older starting sizes (12, 35) become 40
    for (const g of Object.values(games)) {
        let changed = false;
        for (const m of g.modes) for (const r of m.rules) for (const act of r.actions) if (act.type === 'nuke' && [12, 35].includes(+act.size || 12)) { act.size = 40; changed = true; }
        if (changed) saveGame(g);
    }
    settings.bedrockNuke = true; saveSettings();
}
if (!settings.singleplayer) {
    // Block Delete opens first and plays in your newest singleplayer world (switch to Server any time)
    for (const g of Object.values(games)) {
        if (g.connector !== 'minecraft') continue;
        const bd = g.modes.find(m => /block delete/i.test(m.name));
        if (bd) g.mode = bd.id;
        if (!g.minecraft.world) g.minecraft.world = listWorlds()[0]?.name || '';
        if (g.minecraft.world) { g.minecraft.single = true; g.minecraft.manual = false; }
        saveGame(g);
    }
    settings.singleplayer = true; saveSettings();
}
if (!settings.levelSlots) {
    // the level slot machine is added to Dropper gift lists made before it existed
    for (const g of Object.values(games)) {
        let changed = false;
        for (const m of g.modes) if (/dropper/i.test(m.name) && !m.rules.some(r => r.actions.some(a => a.type === 'levelWheel')) && !m.rules.some(r => r.gift === 'Hand Hearts')) {
            m.rules.push(...normalizeRules([DROPPER_RULES.find(r => r.actions[0].type === 'levelWheel')])); changed = true;
        }
        if (changed) saveGame(g);
    }
    settings.levelSlots = true; saveSettings();
}
if (!settings.dropper) {
    // the Dropper type is added to Minecraft
    for (const g of Object.values(games)) {
        if (g.connector !== 'minecraft' || !/minecraft/i.test(g.name) || g.modes.some(m => /dropper/i.test(m.name))) continue;
        g.modes.push({ id: newId(), name: 'Dropper', rules: normalizeRules(DROPPER_RULES) });
        saveGame(g);
    }
    settings.dropper = true; saveSettings();
}
if (!settings.chunkChat) {
    // the Chunk Chat type is added to Minecraft, with Block Delete's gifts
    for (const g of Object.values(games)) {
        if (g.connector !== 'minecraft' || !/minecraft/i.test(g.name) || g.modes.some(m => /chunk chat/i.test(m.name))) continue;
        g.modes.push({ id: newId(), name: 'Chunk Chat', rules: normalizeRules(BLOCK_DELETE_RULES), chunkChat: normalizeChunkChat({}, true) });
        saveGame(g);
    }
    settings.chunkChat = true; saveSettings();
}
if (!settings.covers) {
    for (const g of Object.values(games)) if (g.connector === 'minecraft' && /minecraft/i.test(g.name) && !g.cover) { g.cover = MINECRAFT_COVER; saveGame(g); }
    settings.covers = true; saveSettings();
}
if (!games[settings.activeGame]) settings.activeGame = Object.keys(games)[0] || null;
for (const g of Object.values(games)) {
    if (g.connector === 'minecraft' && !g.minecraft.serverFolder && !g.minecraft.manual) {
        const best = findServers().find(f => f.rcon);
        if (best) { g.minecraft.serverFolder = best.folder; saveGame(g); }
    }
}
const activeGame = () => games[settings.activeGame] || null;

// ---------- Sounds ----------

// ---------- Real sound clips (from MyInstants) ----------
// The starter sounds are the real meme clips. They aren't stored in this app's files: each PC
// downloads them the first time Gift Hype opens, into sounds/builtin.
const MYINSTANTS = 'https://www.myinstants.com';
const SOUND_PACK = {
    'fahh': 'fahhh_KcgAXfs.mp3',
    'vine-boom': 'vine-boom.mp3',
    'bruh': 'movie_1.mp3',
    'airhorn': 'airhorn.mp3',
    'sad-trombone': 'sadtrombone.swf.mp3',
    'lets-go': 'lets-go-meme_m93gdas.mp3',
    'oh-no': 'oh-no_h28Tjuw.mp3',
    'sheesh': 'sheesh-mpl-echo-ph.mp3',
    'nooo': 'charles-leclerc-scream-noooo.mp3',
    'cha-ching': 's1_c5-online-audio-converter.mp3',
    'ding': 'ding-sound-effect_2.mp3',
    'record-scratch': 'record-scratch-clean.mp3',
    'wrong-buzzer': 'wrong-answer-buzzer.mp3',
    'explosion': 'explosion-meme_dTCfAHs.mp3',
    'drumroll': 'drum-roll-gaming-sound-effect-hd.mp3',
    'level-up': 'levelup.mp3',
    'boing': 'cartoon-boing_7vRWDlc.mp3',
    'whoosh': 'transition-whoosh.mp3',
    'emotional-damage': 'emotional-damage-meme.mp3',
    'rizz': 'rizz-sound-effect.mp3',
    'taco-bell-bong': 'taco-bell-bong-sfx.mp3',
    'metal-pipe': 'metal-pipe-falling-sound-effect.mp3',
    'windows-error': 'erro.mp3',
    'among-us': 'among-us-role-reveal-sound.mp3',
    'anime-wow': 'anime-wow-sound-effect.mp3',
    'bonk': 'bonk_7zPAD7C.mp3',
    'oof': 'roblox-death-sound_1.mp3',
    'i-need-a-hero': 'i-need-a-hero.mp3',
    'dababy-lets-go': 'lets-go-sound-effect.mp3',
    'here-comes-the-money': 'here-comes-the-money.mp3',
};
const BUILTIN_SOUNDS = path.join(SOUNDS_DIR, 'builtin');
const isMp3 = b => b.length > 512 && (b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
const isClipPath = p => /^\/media\/sounds\/[\w.%()-]+\.mp3$/i.test(p) && !p.includes('..');

async function fetchClip(clipPath) {
    if (!isClipPath(clipPath)) throw new Error('Not a sound');
    const r = await fetch(MYINSTANTS + clipPath, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !isMp3(buf)) throw new Error("Couldn't get that sound");
    if (buf.length > 6e6) throw new Error('That sound is too long');
    return buf;
}

async function getSoundPack() {
    fs.mkdirSync(BUILTIN_SOUNDS, { recursive: true });
    // made-up sounds from older versions
    for (const f of fs.readdirSync(BUILTIN_SOUNDS)) if (f.endsWith('.wav')) fs.rmSync(path.join(BUILTIN_SOUNDS, f), { force: true });
    const missing = Object.entries(SOUND_PACK).filter(([name]) => !fs.existsSync(path.join(BUILTIN_SOUNDS, `${name}.mp3`)));
    if (!missing.length) return;
    log(`Getting ${missing.length} starter sounds...`);
    let got = 0;
    for (const [name, clip] of missing) {
        try { fs.writeFileSync(path.join(BUILTIN_SOUNDS, `${name}.mp3`), await fetchClip(`/media/sounds/${clip}`)); got++; } catch { }
    }
    log(got === missing.length ? 'Starter sounds ready.' : `Got ${got} of ${missing.length} starter sounds. The rest will be tried next time Gift Hype opens.`);
    broadcast('sounds', listSounds());
}

const unescapeHtml = t => t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function searchClips(q) {
    q = String(q || '').trim().slice(0, 80);
    if (!q) return [];
    const r = await fetch(`${MYINSTANTS}/en/search/?name=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error("Couldn't search right now");
    const html = await r.text(), out = [];
    for (const m of html.matchAll(/play\('(\/media\/sounds\/[^']+?\.mp3)'[\s\S]*?class="instant-link[^"]*"[^>]*>([^<]*)</g)) {
        if (isClipPath(m[1]) && !out.some(o => o.path === m[1])) out.push({ path: m[1], name: unescapeHtml(m[2]).trim() });
        if (out.length >= 40) break;
    }
    return out;
}

function listSounds() {
    const out = [];
    for (const kind of ['builtin', 'custom']) {
        const dir = path.join(SOUNDS_DIR, kind);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir).sort()) {
            if (!SOUND_TYPES[path.extname(f).toLowerCase()]) continue;
            out.push({ file: `${kind}/${f}`, name: path.basename(f, path.extname(f)).replace(/[-_]+/g, ' '), custom: kind === 'custom' });
        }
    }
    return out;
}

// Only files directly inside sounds/builtin or sounds/custom.
function soundFilePath(file) {
    const m = /^(builtin|custom)\/([^/\\]+)$/.exec(String(file || ''));
    if (!m || m[2].startsWith('.')) return null;
    const p = path.join(SOUNDS_DIR, m[1], m[2]);
    return fs.existsSync(p) ? p : null;
}

// TikTok LIVE Studio on this PC: its program, or its Start menu shortcut
function findLiveStudio() {
    const tries = [];
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs'), process.env.LOCALAPPDATA]) {
        if (!base) continue;
        const dir = path.join(base, 'TikTok LIVE Studio');
        if (!fs.existsSync(dir)) continue;
        tries.push(path.join(dir, 'TikTok LIVE Studio.exe'));
        for (const v of fs.readdirSync(dir).sort().reverse()) tries.push(path.join(dir, v, 'TikTok LIVE Studio.exe'));
    }
    for (const base of [path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')]) {
        const walk = (d, depth) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory() && depth < 2) walk(q, depth + 1); else if (/tiktok live studio.*\.lnk$/i.test(e.name)) tries.push(q); } } catch { } };
        walk(base, 0);
    }
    return tries.find(t => fs.existsSync(t)) || null;
}

// ---------- Live updates (Server-Sent Events) ----------

const clients = new Set();
const OVERLAY_EVENTS = new Set(['alert', 'play', 'stopSound', 'reset', 'wheel', 'chatdel', 'chunkchat', 'settings', 'state']);
const overlaySettings = () => ({ overlay: settings.overlay, theme: settings.theme, soundsIn: settings.soundsIn });
function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    let small = null;
    for (const res of clients) {
        if (!res.overlayOnly) { res.write(msg); continue; }
        if (!OVERLAY_EVENTS.has(event)) continue;
        // settings and state: only the overlay's own settings go to an overlay-only listener
        small ||= event === 'settings' ? `event: settings\ndata: ${JSON.stringify(overlaySettings())}\n\n`
            : event === 'state' ? `event: state\ndata: ${JSON.stringify({ settings: overlaySettings() })}\n\n` : msg;
        res.write(small);
    }
}

const recentLog = [];
function log(text) {
    const line = `[${new Date().toLocaleTimeString('en-GB')}] ${text}`;
    console.log(line);
    recentLog.push(line);
    if (recentLog.length > 200) recentLog.shift();
    broadcast('log', line);
}

const status = { tiktok: 'offline', tiktokError: null, minecraft: 'offline', gameClients: 0 };
function setStatus(patch) { Object.assign(status, patch); broadcast('status', status); }

const feed = [];

// ---------- Gift catalog (names, pictures, prices) ----------

let catalog = readJson(path.join(DATA, 'gift-catalog.json'), []);
const learnedPath = path.join(DATA, 'learned-gifts.json');
let learned = readJson(learnedPath, []);
const findGift = name => {
    const n = String(name || '').toLowerCase();
    return learned.find(g => g.name.toLowerCase() === n) || catalog.find(g => g.name.toLowerCase() === n) || null;
};
function learnGift(name, coins, image) {
    if (!name || !image) return;
    const old = learned.find(g => g.name.toLowerCase() === name.toLowerCase());
    if (old && old.image === image && old.coins === coins) return;
    learned = learned.filter(g => g !== old).concat({ name, coins: coins ?? old?.coins ?? 0, image });
    writeJson(learnedPath, learned);
}

// ---------- Finding Minecraft servers on this PC ----------

function readProps(file) {
    const props = {};
    try {
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = /^([^#=\s][^=]*)=(.*)$/.exec(line);
            if (m) props[m[1].trim()] = m[2].trim();
        }
    } catch { return null; }
    return props;
}

var foundServers = foundServers || []; // may already be filled by the startup scan above

// Looks in Downloads, Desktop, Documents (a few folders deep) for server.properties files.
function findServers() {
    // Declared in here: the startup scan runs before the rest of this file has loaded.
    const SKIP_DIRS = new Set(['node_modules', '.git', 'AppData', 'world', 'world_nether', 'world_the_end', 'libraries', 'versions', 'cache', 'logs', 'plugins', 'bundler', 'window']);
    const home = os.homedir();
    const roots = ['Downloads', 'Desktop', 'Documents', 'OneDrive\\Desktop', 'OneDrive\\Documents', 'curseforge\\minecraft\\Instances']
        .map(r => path.join(home, r)).concat(path.dirname(ROOT));
    const seen = new Set(), out = [];
    const walk = (dir, depth) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        if (entries.some(e => e.isFile() && e.name === 'server.properties')) {
            const real = fs.realpathSync(dir);
            if (!seen.has(real.toLowerCase())) {
                seen.add(real.toLowerCase());
                const p = readProps(path.join(dir, 'server.properties')) || {};
                let used = 0;
                for (const f of ['logs/latest.log', 'server.properties']) { try { used = Math.max(used, fs.statSync(path.join(dir, f)).mtimeMs); } catch { } }
                out.push({
                    folder: real,
                    name: path.basename(path.dirname(real)) === path.basename(real) ? path.basename(real) : `${path.basename(path.dirname(real))} › ${path.basename(real)}`,
                    rcon: p['enable-rcon'] === 'true' && !!p['rcon.password'],
                    port: +p['rcon.port'] || 25575,
                    world: p['level-name'] || 'world',
                    used,
                });
            }
        }
        if (depth <= 0) return;
        for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth - 1);
    };
    for (const r of roots) if (fs.existsSync(r)) walk(r, 4);
    // most recently used first
    // two servers with the same name: show more of where each one is
    const dupes = new Set(out.filter(o => out.filter(x => x.name === o.name).length > 1));
    for (const sv of dupes) sv.name = path.relative(home, sv.folder).split(path.sep).join(' › ');
    foundServers = out.sort((a, b) => b.used - a.used);
    return foundServers;
}

// Where to connect for a Minecraft game: the found server's own settings, or what was typed.
function rconTarget(g) {
    const m = g.minecraft;
    if (isSingle(g)) return localState === 'ready' && localServer.world() === worldOf(g) ? localServer.rcon() : { error: localState };
    if (m.manual) {
        if (!m.password) return { error: 'no password' };
        return { host: m.host || '127.0.0.1', port: +m.port || 25575, password: m.password };
    }
    if (m.serverFolder) {
        const p = readProps(path.join(m.serverFolder, 'server.properties'));
        if (!p) return { error: 'server folder not found' };
        if (p['enable-rcon'] !== 'true' || !p['rcon.password']) return { error: 'gift commands are off' };
        return { host: '127.0.0.1', port: +p['rcon.port'] || 25575, password: p['rcon.password'] };
    }
    return { error: 'no server picked' };
}

// Turns on RCON in a found server's server.properties (a random password). Takes effect when it restarts.
function enableRcon(folder) {
    const server = foundServers.find(f => f.folder === folder);
    if (!server) throw new Error('Pick a server from the list');
    const file = path.join(folder, 'server.properties');
    let text = fs.readFileSync(file, 'utf8');
    const set = (key, value, onlyIfEmpty) => {
        const re = new RegExp(`^${key.replace('.', '\\.')}=(.*)$`, 'm');
        const m = re.exec(text);
        if (m) { if (!(onlyIfEmpty && m[1].trim())) text = text.replace(re, `${key}=${value}`); }
        else text += (text.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
    };
    set('enable-rcon', 'true');
    set('rcon.port', '25575', true);
    set('rcon.password', crypto.randomBytes(12).toString('base64url'), true);
    set('broadcast-rcon-to-ops', 'false');
    fs.writeFileSync(file, text);
    findServers();
}

// ---------- Connectors ----------

// Minecraft over RCON. Connected while a Minecraft game is the active one.
let rcon = null, rconFor = null, rconTimer = null, rconQueue = Promise.resolve();
// Your singleplayer world, opened on a hidden server on this PC so gifts can reach it (localserver.js).
let localState = 'stopped';
const localServer = makeLocalServer({
    dir: path.join(DATA, 'mcserver'),
    log,
    onState: st => {
        localState = st;
        if (st === 'ready') { packNeedsReload = false; rconFor = null; connectMinecraft(); }
        else if (!rcon || st !== 'ready') setStatus({ minecraft: st === 'stopped' ? 'world closed' : st });
    },
});

// Singleplayer: keep the Gift Hype data pack in the world up to date (with a crater for each nuke size).
let packNeedsReload = false;
function nukeSizes(g) {
    return g.modes.flatMap(m => m.rules.flatMap(r => r.actions.filter(a => a.type === 'nuke').map(a => Math.max(16, Math.min(64, Math.round(+a.size || 40))))));
}
function syncPack(g) {
    if (isDropper(g)) {
        try { if (installDropperPack()) { packNeedsReload = true; log('Dropper pack updated.'); } return 'singleplayer'; }
        catch (e) { log(`Couldn't put the Dropper pack in place: ${e.message}`); return 'world failed'; }
    }
    if (!g.minecraft.world) return 'no world picked';
    try {
        if (installPack(g.minecraft.world, nukeSizes(g))) { packNeedsReload = true; log(`Gift Hype pack put into "${g.minecraft.world}".`); }
        return 'singleplayer';
    } catch (e) { log(`Couldn't put the pack into the world: ${e.message}`); return 'world not found'; }
}

async function connectMinecraft() {
    clearTimeout(rconTimer);
    const g = activeGame();
    if (!g || g.connector !== 'minecraft') return disconnectMinecraft();
    if (isSingle(g)) {
        const st = syncPack(g);
        if (st !== 'singleplayer') { await disconnectMinecraft(); return setStatus({ minecraft: st }); }
        if (!settings.mcEula) { await disconnectMinecraft(); localServer.stop(); return setStatus({ minecraft: 'eula not accepted' }); }
        const world = worldOf(g);
        if (!localServer.running() || localServer.world() !== world) {
            await disconnectMinecraft();
            rconFor = null;
            // the Dropper world is made the first time, on your newest world's Minecraft version, but never
            // older than the one its pack is made for (the launcher's "Gift Hype" install gets that version)
            const opts = isDropper(g) ? { version: newWorldVersion(), props: DROPPER_PROPS, atLeast: DROPPER_MC } : {};
            localServer.start(world, { eula: settings.mcEula, ...opts }).catch(e => { log(`Couldn't open the world: ${e.message}`); setStatus({ minecraft: 'world failed' }); });
            return;
        }
        if (localState !== 'ready') return setStatus({ minecraft: localState });
    } else if (localServer.running()) {
        localServer.stop();
    }
    const target = rconTarget(g);
    const key = JSON.stringify([g.id, target]);
    if (rcon && rconFor === key) return;
    await disconnectMinecraft();
    rconFor = key;
    if (target.error) {
        setStatus({ minecraft: target.error });
        // check again in a bit (e.g. RCON was just turned on and the server restarted)
        if (target.error !== 'no server picked' && !isSingle(g)) rconTimer = setTimeout(() => { rconFor = null; connectMinecraft(); }, 10000);
        return;
    }
    setStatus({ minecraft: 'connecting' });
    try {
        const r = await Rcon.connect({ host: target.host, port: target.port, password: target.password, timeout: 20000 });
        if (rconFor !== key) return r.end().catch(() => {});
        rcon = r;
        chatDelete.forget();
        r.on('end', () => {
            if (rcon !== r) return;
            rcon = null;
            setStatus({ minecraft: isSingle(g) ? (localServer.running() ? 'starting' : 'world closed') : 'offline' });
            if (isSingle(g)) return;
            log('Minecraft disconnected. Trying again in 10s...');
            rconTimer = setTimeout(() => { rconFor = null; connectMinecraft(); }, 10000);
        });
        r.on('error', () => {});
        setStatus({ minecraft: 'connected' });
        if (isDropper(g) && !dropperBuilt()) buildDropperWorld();
        if (!isSingle(g)) log(`Connected to Minecraft${g.minecraft.serverFolder ? ` (${path.basename(path.dirname(g.minecraft.serverFolder))})` : ` at ${target.host}:${target.port}`}.`);
    } catch (e) {
        if (rconFor !== key) return;
        // "offline" here usually means the server isn't started yet
        setStatus({ minecraft: /auth/i.test(e.message) ? 'wrong password' : 'offline' });
        rconTimer = setTimeout(() => { rconFor = null; connectMinecraft(); }, 10000);
    }
}
async function disconnectMinecraft() {
    clearTimeout(rconTimer);
    rconFor = null;
    const r = rcon;
    rcon = null;
    if (r) await r.end().catch(() => {});
    setStatus({ minecraft: 'offline' });
}
// The Minecraft version for a new world: the same as your newest world (so your game can join it).
function newWorldVersion() {
    for (const w of listWorlds()) { try { const v = worldVersion(w.name); if (v) return v; } catch { } }
    return '26.2';
}
// Builds the 100 Dropper levels into its world the first time it opens (about a minute).
let dropperBuilding = false;
async function buildDropperWorld() {
    if (dropperBuilding) return;
    dropperBuilding = true;
    const start = dropperProgress() + 1;
    log(start > 1 ? `Building the Dropper: carrying on from level ${start}...` : `Building the Dropper: ${DROPPER_LEVELS} levels (up to an hour, only the first time)...`);
    setStatus({ dropper: `building ${start - 1}/${DROPPER_LEVELS}` });
    try {
        // the building functions are a pack of their own, only in the world while it builds,
        // 20 levels at a time so the game never has to load all of them at once
        packNeedsReload = false;
        for (let from = start; from <= DROPPER_LEVELS; from += 20) {
            const to = Math.min(DROPPER_LEVELS, from + 19);
            const buildPack = installDropperBuildPack(undefined, from, to);
            await mc('reload');
            await mc(`datapack enable "${buildPack}"`).catch(() => {});
            await buildDropper(mc, { from, to, log, progress: n => { if (n % 5 === 0 || n === 1) setStatus({ dropper: `building ${n}/${DROPPER_LEVELS}` }); } });
        }
        markDropperBuilt();
        removeDropperBuildPack();
        await mc('reload').catch(() => {});
        setStatus({ dropper: 'ready' });
        log('The Dropper is built. Join Gift Hype in Minecraft to play.');
    } catch (e) {
        setStatus({ dropper: 'build stopped' });
        log(`The Dropper build stopped (${e.message}). It starts again next time the world opens.`);
    } finally { dropperBuilding = false; }
}
function mc(command) {
    // one command at a time, in order
    const run = rconQueue.then(() => rcon ? rcon.send(command.replace(/^\//, '')) : Promise.reject(new Error('Minecraft is not connected')));
    rconQueue = run.catch(() => {});
    return run;
}

// Your own game: it connects to this WebSocket server and gets a JSON message per gift action.
let wss = null;
function startGameSocket() {
    wss = new WebSocketServer({ host: '127.0.0.1', port: settings.wsPort });
    wss.on('connection', (ws, req) => {
        // Only local pages/programs: a website you visit can't connect and listen in.
        const origin = req.headers.origin;
        if (origin && !/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/|null)$/i.test(origin)) return ws.close(1008, 'Not allowed');
        setStatus({ gameClients: wss.clients.size });
        log('A game connected.');
        ws.send(JSON.stringify({ type: 'hello', app: 'Gift Hype', game: activeGame()?.name || null }));
        ws.on('close', () => { setStatus({ gameClients: wss.clients.size }); log('A game disconnected.'); });
        ws.on('error', () => {});
    });
    wss.on('error', e => log(`Game connection port ${settings.wsPort} couldn't open: ${e.message}`));
}
function sendToGames(message) {
    const text = JSON.stringify(message);
    let n = 0;
    for (const ws of wss?.clients || []) if (ws.readyState === 1) { ws.send(text); n++; }
    return n;
}

// Key presses: one PowerShell process that types into whatever window is in front.
let keyProc = null;
function pressKeys(keys) {
    // for testing: write the keys to a file instead of pressing them
    if (process.env.GIFTHYPE_KEYLOG) return fs.appendFileSync(process.env.GIFTHYPE_KEYLOG, String(keys) + '\n');
    if (!keyProc || keyProc.exitCode !== null) {
        keyProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            'Add-Type -AssemblyName System.Windows.Forms; while (($l = [Console]::In.ReadLine()) -ne $null) { try { [System.Windows.Forms.SendKeys]::SendWait($l) } catch { } }'],
            { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
        keyProc.on('error', e => log(`Key presses don't work here: ${e.message}`));
    }
    keyProc.stdin.write(String(keys).replace(/[\r\n]/g, '') + '\n');
}

// No Minecraft name typed in: use the player who's online (the first one, if there are several).
async function onlinePlayer(game) {
    if (game.connector !== 'minecraft' || !rcon) return null;
    const reply = await mc('list').catch(() => '');
    const names = (String(reply).split(':')[1] || '').split(',').map(n => n.trim().replace(/§./g, '')).filter(Boolean);
    return names[0] || null;
}

// ---------- Running a gift ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fill = (text, ctx) => String(text)
    .replaceAll('{player}', ctx.player).replaceAll('{from}', ctx.from)
    .replaceAll('{gift}', ctx.gift).replaceAll('{count}', String(ctx.count));

// Stops a huge streak from flooding the game. Each action runs at most this many times per gift event.
const MAX_REPEAT = 50;

// Ready-made Minecraft actions (nuke, jail, chunk fills, kits...), in minecraft-presets.js.
const PRESETS = makePresets({ mc, log });

// Chat block delete (chatdelete.js): a block typed in the LIVE chat is removed around you when its countdown ends.
const chatDelete = makeChatDelete({
    mc, log, broadcast,
    target: async () => {
        const g = activeGame();
        if (!g || g.connector !== 'minecraft' || isDropper(g) || !rcon) return null;
        const cfg = currentMode(g).chat;
        return cfg?.on && !isChunkChat(g) ? { cfg, player: g.minecraft.player || await onlinePlayer(g) } : null;
    },
    deleteBlocks: (player, filter, chunks) => PRESETS[DELETE_BLOCKS](player, filter, chunks),
});
// Chunk Chat (chunkchat.js): on a timer, the chunk you're in turns into the block chat picked.
const isChunkChat = g => g?.connector === 'minecraft' && /chunk chat/i.test(currentMode(g)?.name || '');
// On a server (no Gift Hype pack) these are the blocks that get turned: the ground, trees, water...
const CHUNK_FILTERS_SERVER = ['#minecraft:base_stone_overworld', '#minecraft:dirt', '#minecraft:sand', 'minecraft:gravel', 'minecraft:sandstone', 'minecraft:red_sandstone',
    '#minecraft:terracotta', '#minecraft:logs', '#minecraft:leaves', 'minecraft:water', 'minecraft:lava', '#minecraft:coal_ores', '#minecraft:iron_ores', '#minecraft:copper_ores',
    '#minecraft:gold_ores', '#minecraft:redstone_ores', '#minecraft:lapis_ores', '#minecraft:diamond_ores', '#minecraft:emerald_ores', 'minecraft:clay', 'minecraft:snow_block',
    'minecraft:ice', 'minecraft:packed_ice', '#minecraft:base_stone_nether', 'minecraft:end_stone', 'minecraft:obsidian'];
const chunkChat = makeChunkChat({
    mc, log, broadcast,
    target: async () => {
        const g = activeGame();
        if (!isChunkChat(g) || !rcon) return null;
        const cfg = currentMode(g).chunkChat;
        if (!cfg?.on) return null;
        const player = g.minecraft.player || await onlinePlayer(g);
        return player ? { cfg, player } : null;            // the timer waits while nobody's in the world
    },
    fillChunk: async (player, block) => {
        const g = activeGame();
        if (isSingle(g) && packNeedsReload) { packNeedsReload = false; await mc('reload'); }
        return PRESETS[FILL_CHUNK](player, block, isSingle(g) ? ['#gifthype:chunk_chat'] : CHUNK_FILTERS_SERVER);
    },
});
function onChat(data) {
    const text = String(data.content || '');
    if (text.length > 60) return;
    const by = data.user?.nickname || data.user?.uniqueId || 'someone';
    if (isChunkChat(activeGame())) chunkChat.onChat(text, by).catch(e => log(`Chunk Chat: ${e.message}`));
    else chatDelete.onChat(text, by).catch(e => log(`Chat block delete: ${e.message}`));
}

async function runAction(game, a, ctx) {
    const times = Math.min(MAX_REPEAT, Math.max(1, (+a.times || 1) * (ctx.perCount ? ctx.count : 1)));
    if (isDropper(game) && DROPPER_ACTIONS.has(a.type)) {
        // the Dropper's own data pack does it, run as you
        if (!rcon) return log('The Dropper world is not open yet.');
        if (packNeedsReload) { packNeedsReload = false; await mc('reload'); }
        const who = /^\w{1,16}$/.test(ctx.player) ? `@a[name=${ctx.player},limit=1]` : '@a[limit=1]';
        if (a.type === 'levelWheel') {
            // the slot machine spins on the stream overlay; when it stops you go up or down that many levels
            const amounts = wheelAmounts(a), result = amounts[Math.floor(Math.random() * amounts.length)], spinMs = 4500;
            broadcast('wheel', { amounts, result, spinMs, from: ctx.from, gift: ctx.gift, image: ctx.image || null });
            log(`Level slots for ${ctx.from}: ${result > 0 ? '+' : ''}${result}`);
            await sleep(spinMs + 500);
            await mc(`execute as ${who} at @s run function dropper:${result > 0 ? 'up' : 'down'} {n:${Math.abs(result)}}`).catch(e => log(`Level slots failed: ${e.message}`));
            return;
        }
        const saveGift = rulesOf(game).find(r => r.actions.some(x => x.type === 'saveReset'))?.gift;
        for (const c of dropperCommands(a, ctx.perCount ? Math.min(MAX_REPEAT, ctx.count) : 1, { saveGift })) {
            await mc(`execute as ${who} at @s run ${c}`).catch(e => log(`${a.type} failed: ${e.message}`));
        }
        return;
    }
    if (game.connector === 'minecraft' && game.minecraft.single && PRESETS[a.type]) {
        // your world: the Gift Hype data pack does it, run as you
        if (!rcon) return log('Your world is not open yet.');
        if (packNeedsReload) { packNeedsReload = false; await mc('reload'); }
        const who = /^\w{1,16}$/.test(ctx.player) ? `@a[name=${ctx.player},limit=1]` : '@a[limit=1]';
        for (const c of singleplayerCommands(a, ctx.perCount ? Math.min(MAX_REPEAT, ctx.count) : 1, MOBS)) {
            await mc(`execute as ${who} at @s run ${c}`).catch(e => log(`${a.type} failed: ${e.message}`));
        }
        return;
    }
    if (a.type === 'command') {
        if (game.connector !== 'minecraft') return;
        for (let i = 0; i < times; i++) await mc(fill(a.command || '', ctx)).catch(e => log(`Command failed: ${e.message}`));
    } else if (a.type === 'message') {
        const sent = sendToGames({ type: 'gift', action: a.name || 'gift', amount: (+a.amount || 1) * (ctx.perCount ? ctx.count : 1), gift: ctx.gift, from: ctx.from, count: ctx.count, game: game.name });
        if (!sent) log(`No game is connected to receive "${a.name}".`);
    } else if (a.type === 'keys') {
        for (let i = 0; i < times; i++) { pressKeys(a.keys || ''); if (times > 1) await sleep(Math.max(30, +a.gap || 120)); }
    } else if (PRESETS[a.type]) {
        if (game.connector !== 'minecraft') return;
        await PRESETS[a.type](a, ctx, ctx.perCount ? Math.min(MAX_REPEAT, ctx.count) : 1).catch(e => log(`${a.type} failed: ${e.message}`));
    } else if (a.type === 'wait') {
        await sleep(Math.max(0, Math.min(60000, (+a.seconds || 1) * 1000)));
    }
}

function findRule(game, giftName) {
    const n = giftName.toLowerCase(), rules = rulesOf(game);
    return rules.find(r => r.gift.toLowerCase() === n) || rules.find(r => r.gift === '*') || null;
}

// ---------- The Dropper's reset countdown, kept in step with the game for the stream overlay ----------
// (the same rules as in the game: a shield blocks a reset, a second reset while one runs does nothing,
// a save stops it or, with no countdown, gives a shield)
let dropperReset = null, dropperShields = 0, resetTicker = null;
function resetPublic() {
    if (!dropperReset) return { active: false };
    return { active: true, secondsLeft: Math.max(0, Math.ceil((dropperReset.endsAt - Date.now()) / 1000)), total: dropperReset.total, saveGift: dropperReset.save };
}
function saveGiftOf(game) {
    const r = rulesOf(game).find(x => x.actions.some(a => a.type === 'saveReset'));
    return r ? { name: r.gift, image: findGift(r.gift)?.image || r.image || null } : null;
}
function dropperResetGift(game, rule, from) {
    const reset = rule.actions.find(a => a.type === 'resetTimer'), save = rule.actions.some(a => a.type === 'saveReset');
    if (reset) {
        if (dropperShields > 0) { dropperShields--; broadcast('reset', { active: false, event: 'blocked', by: from }); return 'blocked'; }
        if (dropperReset) return 'running';
        const secs = Math.max(5, Math.min(600, Math.round(+reset.seconds || 60)));
        dropperReset = { endsAt: Date.now() + secs * 1000, total: secs, save: saveGiftOf(game), by: from };
        clearInterval(resetTicker);
        resetTicker = setInterval(() => {
            if (!dropperReset) return clearInterval(resetTicker);
            if (Date.now() >= dropperReset.endsAt) {
                const by = dropperReset.by; dropperReset = null; clearInterval(resetTicker);
                broadcast('stopSound', { id: 'reset' });
                return broadcast('reset', { active: false, event: 'done', by });
            }
            broadcast('reset', resetPublic());
        }, 1000);
        broadcast('reset', resetPublic());
        return 'started';
    }
    if (save) {
        if (dropperReset) {
            dropperReset = null; clearInterval(resetTicker);
            broadcast('stopSound', { id: 'reset' });
            broadcast('reset', { active: false, event: 'saved', by: from });
            return 'saved';
        }
        dropperShields = Math.min(3, dropperShields + 1);
        broadcast('reset', { active: false, event: 'shield', by: from });
        return 'shield';
    }
    return null;
}

async function handleGift(giftName, count, from, image, coins) {
    const game = activeGame();
    const rule = game ? findRule(game, giftName) : null;
    const known = findGift(giftName);
    const entry = {
        time: Date.now(), gift: giftName, count, from,
        image: image || known?.image || rule?.image || null,
        coins: coins ?? known?.coins ?? null,
        did: rule ? (rule.label || rule.gift) : null,
    };
    feed.unshift(entry);
    feed.length = Math.min(feed.length, 60);
    broadcast('gift', entry);
    log(`${from} sent ${count > 1 ? count + ' x ' : ''}${giftName}${rule ? ` -> ${entry.did}` : ' (nothing set up for it)'}`);
    if (!rule) return;

    const dropper = isDropper(game), resetEvent = dropper ? dropperResetGift(game, rule, from) : null;
    // a reset's sound plays on (looping) for the whole countdown, until it's saved or runs out
    if (rule.sound) broadcast('play', { file: rule.sound, volume: rule.volume * settings.masterVolume, ...(resetEvent === 'started' ? { id: 'reset', loopFor: dropperReset.total } : {}) });
    if (rule.alert) broadcast('alert', { ...entry, label: rule.label, ...(dropper ? { dropper: true, action: dropperAlertText(rule, count).what, actionColor: dropperAlertText(rule, count).color } : {}) });

    const ctx = { player: game.minecraft.player || await onlinePlayer(game) || '@p', from, gift: giftName, count, perCount: rule.perCount, image: entry.image };
    try {
        for (const a of rule.actions) await runAction(game, a, ctx);
    } catch (e) {
        log(`Action failed: ${e.message}`);
    }
}

// ---------- TikTok ----------

let tiktok = null, tiktokTimer = null;
const streaks = new Map();

function onGift(data) {
    const name = data.gift?.name || `gift ${data.giftId}`;
    const image = data.gift?.image?.urlList?.[0] || null;
    learnGift(data.gift?.name, data.gift?.diamondCount, image);
    const repeat = data.repeatCount || 1;
    let count = repeat;
    // Streak gifts send an event per tap with a growing count: only the new taps count.
    if (data.gift?.type === 1) {
        const key = `${data.user?.userId}:${data.giftId}`;
        const last = streaks.get(key) || 0;
        count = repeat >= last ? repeat - last : repeat;
        if (data.repeatEnd) streaks.delete(key);
        else streaks.set(key, repeat);
    }
    if (count > 0) handleGift(name, count, data.user?.nickname || data.user?.uniqueId || 'someone', image, data.gift?.diamondCount);
}

async function connectTikTok(username) {
    await disconnectTikTok();
    username = String(username || '').replace(/^@/, '').trim();
    if (!username) return;
    settings.tiktokUsername = username;
    saveSettings();
    // enableExtendedGiftInfo stays off: it needs a paid Euler Stream plan and makes connect() fail without one.
    const conn = new TikTokLiveConnection(username, {
        enableExtendedGiftInfo: false,
        processInitialData: false,
        signApiKey: settings.eulerStreamApiKey || undefined,
    });
    tiktok = conn;
    conn.on(WebcastEvent.GIFT, onGift);
    conn.on(WebcastEvent.CHAT, onChat);
    conn.on('disconnected', () => {
        if (tiktok !== conn) return;
        log('TikTok disconnected. Reconnecting in 10s...');
        setStatus({ tiktok: 'connecting' });
        tiktokTimer = setTimeout(attempt, 10000);
    });
    async function attempt() {
        if (tiktok !== conn) return;
        setStatus({ tiktok: 'connecting', tiktokError: null });
        try {
            await conn.connect();
            if (tiktok !== conn) return;
            log(`Connected to @${username}'s LIVE.`);
            setStatus({ tiktok: 'connected', tiktokError: null });
        } catch (e) {
            if (tiktok !== conn) return;
            const why = `${e.constructor?.name} ${e.message}`;
            const msg = /offline/i.test(why) ? `@${username} isn't live right now`
                : /room id/i.test(why) ? `Couldn't find a live for @${username}. Check the name, and make sure you're live`
                : /rate|limit|429/i.test(why) ? 'Too many connects today. Add a free Euler Stream key in Settings'
                : e.message;
            log(`TikTok: ${msg}. Trying again in 15s...`);
            setStatus({ tiktok: 'waiting', tiktokError: msg });
            tiktokTimer = setTimeout(attempt, 15000);
        }
    }
    attempt();
}

async function disconnectTikTok() {
    clearTimeout(tiktokTimer);
    const conn = tiktok;
    tiktok = null;
    streaks.clear();
    if (conn) { await conn.disconnect().catch(() => {}); log('Disconnected from TikTok.'); }
    setStatus({ tiktok: 'offline', tiktokError: null });
}

// ---------- HTTP ----------

function send(res, code, body, type = 'application/json') {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req, limit = 1e6) {
    return new Promise((resolve, reject) => {
        const chunks = []; let size = 0;
        req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Too big')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

const publicState = () => ({
    settings: { ...settings, eulerStreamApiKey: settings.eulerStreamApiKey ? '••••••' : '' },
    games: Object.values(games).map(g => ({ id: g.id, name: g.name, cover: coverVersion(g), connector: g.connector, gifts: rulesOf(g).length, mode: g.modes.length > 1 ? currentMode(g).name : '' })),
    game: activeGame(),
    sounds: listSounds(),
    status, feed, log: recentLog.slice(-80),
    reset: resetPublic(),
    version: localVersion(ROOT),
});

function setActive(id) {
    if (!games[id]) throw new Error('No such game');
    settings.activeGame = id;
    saveSettings();
    connectMinecraft();
    broadcast('state', publicState());
    const g = games[id];
    log(`Now playing: ${g.name}${g.modes.length > 1 ? ` (${currentMode(g).name})` : ''}`);
}

const routes = {
    'GET /api/state': () => publicState(),
    // Opens TikTok LIVE Studio if it's on this PC (its scene files aren't documented, so the overlay
    // is added there by hand: the app copies the address and shows the clicks).
    'POST /api/live-studio/open': () => {
        const exe = findLiveStudio();
        if (!exe) return { opened: false };
        spawn(exe.endsWith('.lnk') ? 'explorer.exe' : exe, exe.endsWith('.lnk') ? [exe] : [], { detached: true, stdio: 'ignore' }).unref();
        return { opened: true };
    },
    // Updates (updater.js): is there a newer version on GitHub, and install it
    'GET /api/update/check': async () => { const u = await checkForUpdate(ROOT); setStatus({ update: u }); return u; },
    'POST /api/update/apply': async () => {
        if (updating) throw new Error('Already updating');
        updating = true;
        setStatus({ update: { ...(status.update || {}), state: 'updating' } });
        try {
            const v = await applyUpdate(ROOT, log);
            log(`Updated to version ${v}. Restarting Gift Hype...`);
            setStatus({ update: { current: v, latest: v, available: false, state: 'restarting' } });
            setTimeout(restartAfterUpdate, 800);
            return { ok: true, version: v };
        } catch (e) {
            updating = false;
            setStatus({ update: { ...(status.update || {}), state: 'failed', error: e.message } });
            throw new Error(`The update didn't work: ${e.message}`);
        }
    },
    'GET /api/overlay-state': async () => ({ settings: overlaySettings(), reset: resetPublic(), chatdel: chatDelete.list(), chunkchat: await chunkChat.state() }),
    // Chunk Chat: try a block as if it was typed in chat, or change the chunk now
    'POST /api/chunkchat/try': async b => {
        const r = await chunkChat.onChat(String(b.text || ''), 'You (test)');
        if (!r.ok) throw new Error(r.why);
        return r;
    },
    'POST /api/chunkchat/now': async () => { await chunkChat.skip(); return { ok: true }; },
    // Chat block delete: try a block name as if it was typed in chat, or stop every countdown
    'POST /api/chatdel/try': async b => {
        const r = await chatDelete.onChat(String(b.text || ''), 'You (test)', { test: true });
        if (!r.ok) throw new Error(r.why);
        return r;
    },
    'POST /api/chatdel/clear': async () => ({ cleared: await chatDelete.clear() }),
    'GET /api/catalog': () => [...learned, ...catalog.filter(c => !learned.some(l => l.name.toLowerCase() === c.name.toLowerCase()))].sort((a, b) => (a.coins ?? 0) - (b.coins ?? 0) || a.name.localeCompare(b.name)),
    'POST /api/connect': async b => { await connectTikTok(b.username); return { ok: true }; },
    'POST /api/disconnect': async () => { await disconnectTikTok(); return { ok: true }; },
    'POST /api/settings': b => {
        if (typeof b.eulerStreamApiKey === 'string' && b.eulerStreamApiKey !== '••••••') settings.eulerStreamApiKey = b.eulerStreamApiKey.trim();
        if (Number.isFinite(+b.masterVolume)) settings.masterVolume = Math.max(0, Math.min(1, +b.masterVolume));
        if (['app', 'overlay'].includes(b.soundsIn)) settings.soundsIn = b.soundsIn;
        if (typeof b.autoConnect === 'boolean') settings.autoConnect = b.autoConnect;
        if (typeof b.mcEula === 'boolean' && b.mcEula !== settings.mcEula) { settings.mcEula = b.mcEula; setTimeout(connectMinecraft, 50); }
        if (['sky', 'blaze', 'punk', 'egyptian'].includes(b.theme)) settings.theme = b.theme;
        if (b.overlay && typeof b.overlay === 'object') {
            const o = settings.overlay;
            if (['top', 'middle', 'bottom'].includes(b.overlay.position)) o.position = b.overlay.position;
            if (Number.isFinite(+b.overlay.scale)) o.scale = Math.max(0.4, Math.min(3, +b.overlay.scale));
            if (typeof b.overlay.showSender === 'boolean') o.showSender = b.overlay.showSender;
        }
        saveSettings();
        broadcast('settings', publicState().settings);
        return { ok: true };
    },
    'POST /api/games/new': b => {
        const g = normalizeGame({ id: newId(), name: b.name || 'New game', connector: b.connector || 'none', cover: /minecraft/i.test(b.name || '') && b.connector === 'minecraft' ? MINECRAFT_COVER : '', rules: [] });
        if (g.connector === 'minecraft') g.minecraft.serverFolder = findServers().find(f => f.rcon)?.folder || '';
        games[g.id] = g;
        saveGame(g);
        setActive(g.id);
        return { ok: true, id: g.id };
    },
    'POST /api/games/save': b => {
        if (!games[b.id]) throw new Error('No such game');
        // covers are changed only by uploading: keep the ones this side has
        const old = games[b.id], keepCover = m => ({ ...m, cover: old.modes.find(x => x.id === m.id)?.cover || '' });
        const g = normalizeGame({ ...b, cover: old.cover, modes: Array.isArray(b.modes) ? b.modes.map(keepCover) : b.modes });
        games[g.id] = g;
        saveGame(g);
        if (g.id === settings.activeGame) connectMinecraft();
        broadcast('games', publicState().games);
        return { ok: true, game: g };
    },
    'POST /api/games/delete': b => {
        if (!games[b.id]) throw new Error('No such game');
        const cover = games[b.id].cover;
        delete games[b.id];
        fs.rmSync(gamePath(b.id), { force: true });
        removeCoverIfUnused(cover);
        if (settings.activeGame === b.id) {
            settings.activeGame = Object.keys(games)[0] || null;
            saveSettings();
            connectMinecraft();
        }
        broadcast('state', publicState());
        return { ok: true };
    },
    'POST /api/games/duplicate': b => {
        const src = games[b.id];
        if (!src) throw new Error('No such game');
        const g = normalizeGame({ ...structuredClone(src), id: newId(), name: `${src.name} (copy)`, modes: src.modes.map(m => ({ ...m, rules: m.rules.map(r => ({ ...r, id: newId() })) })) });
        games[g.id] = g;
        saveGame(g);
        setActive(g.id);
        return { ok: true, id: g.id };
    },
    'POST /api/games/active': b => { setActive(b.id); return { ok: true }; },
    'POST /api/test': async b => {
        const game = activeGame();
        const rule = game && rulesOf(game).find(r => r.id === b.ruleId);
        if (!rule) throw new Error('Save the gift first');
        const known = findGift(rule.gift);
        await handleGift(rule.gift === '*' ? 'Any gift' : rule.gift, Math.max(1, Math.min(100, +b.count || 1)), 'TEST', known?.image || rule.image, known?.coins);
        return { ok: true };
    },
    'POST /api/sounds/add': async b => {
        const buf = await fetchClip(String(b.path || ''));
        const base = String(b.name || 'sound').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'sound';
        let name = `${base}.mp3`, i = 2;
        while (fs.existsSync(path.join(CUSTOM_SOUNDS, name))) name = `${base}-${i++}.mp3`;
        fs.writeFileSync(path.join(CUSTOM_SOUNDS, name), buf);
        log(`Added sound: ${name}`);
        broadcast('sounds', listSounds());
        return { ok: true, file: `custom/${name}` };
    },
    'POST /api/sounds/delete': b => {
        const p = soundFilePath(b.file);
        if (!p || !String(b.file).startsWith('custom/')) throw new Error('Only your own sounds can be deleted');
        fs.rmSync(p);
        broadcast('sounds', listSounds());
        return { ok: true };
    },
    'GET /api/minecraft/worlds': () => listWorlds(),
    'POST /api/minecraft/install-pack': () => {
        const g = activeGame();
        if (!g?.minecraft.single) throw new Error('Pick a singleplayer world first');
        const st = syncPack(g);
        setStatus({ minecraft: st });
        if (st !== 'singleplayer') throw new Error(st === 'no world picked' ? 'Pick a world first' : "Couldn't put the pack into that world");
        return { ok: true };
    },
    // The Play button: open your world, wait until it's ready, then open Minecraft set to join it.
    'POST /api/minecraft/play': async () => {
        const g = activeGame();
        if (!g || g.connector !== 'minecraft' || !isSingle(g)) throw new Error('Pick Singleplayer world for this game first');
        if (!worldOf(g)) throw new Error('Pick your world first');
        if (!settings.mcEula) throw new Error('Tick the Minecraft EULA box first');
        connectMinecraft();
        // the first time takes longest (Minecraft's server is downloaded, a new world is made), so it
        // waits up to 10 minutes while it's still getting there, and stops at once if something's wrong
        const deadline = Date.now() + 10 * 60 * 1000;
        const FAIL = ['world open in singleplayer', 'java missing', 'world failed', 'crashed', 'world not found', 'no world picked', 'eula not accepted'];
        const is = s => localState === s || status.minecraft === s;
        while (status.minecraft !== 'connected' && Date.now() < deadline) {
            if (FAIL.some(is)) break;
            await sleep(500);
        }
        if (status.minecraft !== 'connected') {
            const why = is('world open in singleplayer') ? 'That world is open in Minecraft singleplayer: close it (Save and Quit to Title), then press Play again'
                : is('java missing') ? "Java wasn't found. Open the Minecraft Launcher, play any version once (that downloads Java), then press Play again"
                : is('world not found') || is('no world picked') ? "Your world wasn't found. Pick your world again under Connects to, then press Play"
                : is('eula not accepted') ? 'Tick the Minecraft EULA box first'
                : is('crashed') ? `Minecraft's server stopped${localServer.problem() ? `: ${localServer.problem()}` : ''}. Press Play to try again; if it keeps happening, send the Activity log (Settings)`
                : is('world failed') ? "Your world couldn't be opened (see the Activity log in Settings). Press Play to try again"
                : localState === 'downloading' ? "Still downloading Minecraft's server (only the first time). Wait a minute and press Play again"
                : "Your world is still starting (the first time takes longest). Wait a minute and press Play again";
            throw new Error(why);
        }
        let quick = true;
        try { setupLauncher(worldVersion(worldOf(g))); }
        catch (e) { quick = false; log(`Couldn't add "Gift Hype" to the launcher (${e.message}). In Minecraft: Multiplayer, then Gift Hype.`); }
        openLauncher();
        log(quick ? 'Minecraft launcher opened: press Play on "Gift Hype" and you go straight into your world.' : 'Minecraft launcher opened: play Minecraft, then Multiplayer, then Gift Hype.');
        return { ok: true, quick };
    },
    'POST /api/minecraft/restart-world': async () => { await disconnectMinecraft(); await localServer.stop(); rconFor = null; connectMinecraft(); return { ok: true }; },
    'GET /api/minecraft/mobs': () => Object.entries(MOBS).map(([id, m]) => ({ id, name: m.name })),
    'GET /api/minecraft/servers': () => findServers().map(({ folder, name, rcon, port, world }) => ({ folder, name, rcon, port, world })),
    'POST /api/minecraft/enable-rcon': b => { enableRcon(String(b.folder || '')); connectMinecraft(); return { ok: true }; },
    'POST /api/minecraft/test': async () => {
        await connectMinecraft();
        if (!rcon) throw new Error(`Minecraft: ${status.minecraft}`);
        const r = await mc('list');
        return { ok: true, reply: r };
    },
};

// The overlay's own address, for streaming apps that won't take "localhost" (TikTok LIVE Studio).
// localtest.me is a public name that always points to 127.0.0.1, so it's still this PC. Through it
// only the overlay works (the page, its sounds, gift pictures and the live gift events), nothing else.
const OVERLAY_HOST = 'gifthype.localtest.me';
const OVERLAY_PATHS = new Set(['/overlay', '/api/overlay-state', '/api/events', '/gift-img']);
const overlayOnly = req => String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase() === OVERLAY_HOST;
// Pages only from this PC: blocks other websites (and DNS tricks) from using the app.
function allowed(req) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (overlayOnly(req)) {
        const p = new URL(req.url, 'http://x').pathname;
        return req.method === 'GET' && (OVERLAY_PATHS.has(p) || p.startsWith('/sounds/') || /^\/fonts\/[\w-]+\.ttf$/.test(p));
    }
    if (!['localhost', '127.0.0.1'].includes(host)) return false;
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return false;
    return true;
}

const STATIC = { '/': 'app.html', '/overlay': 'overlay.html' };

// ---------- Covers ----------
const coverVersion = g => g.cover ? crypto.createHash('md5').update(g.cover).digest('hex').slice(0, 8) : '';
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
function imageExt(buf) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
    if (buf.subarray(0, 4).toString('hex') === '89504e47') return '.png';
    if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return '.webp';
    if (buf.subarray(0, 3).toString() === 'GIF') return '.gif';
    return null;
}
function removeCoverIfUnused(cover) {
    if (!cover?.startsWith('file:') || Object.values(games).some(g => g.cover === cover || g.modes.some(m => m.cover === cover))) return;
    fs.rmSync(path.join(COVERS_DIR, cover.slice(5)), { force: true });
}
const coverDownloads = new Map();
async function coverFile(g) {
    if (!g.cover) return null;
    if (g.cover.startsWith('file:')) return path.join(COVERS_DIR, g.cover.slice(5));
    // Store picture: downloaded once (720 x 1080) and kept.
    const name = `store-${coverVersion(g)}.jpg`, p = path.join(COVERS_DIR, name);
    if (fs.existsSync(p)) return p;
    if (!coverDownloads.has(name)) coverDownloads.set(name, (async () => {
        const r = await fetch(`${g.cover}?w=720&h=1080`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const buf = Buffer.from(await r.arrayBuffer());
        if (!r.ok || !imageExt(buf)) throw new Error('no picture');
        fs.mkdirSync(COVERS_DIR, { recursive: true });
        fs.writeFileSync(p, buf);
    })().finally(() => coverDownloads.delete(name)));
    await coverDownloads.get(name);
    return p;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!allowed(req)) return send(res, 403, { error: 'Not allowed' });

    if (STATIC[url.pathname]) return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', STATIC[url.pathname])), 'text/html; charset=utf-8');
    if (url.pathname === '/icon.png') return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'icon.png')), 'image/png');
    if (req.method === 'GET' && /^\/fonts\/[\w-]+\.ttf$/.test(url.pathname)) {
        const f = path.join(ROOT, 'public', url.pathname);
        if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'font/ttf', 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*' }); return res.end(fs.readFileSync(f)); }
    }
    if (req.method === 'GET' && /^\/img\/[\w-]+\.svg$/.test(url.pathname)) {
        const f = path.join(ROOT, 'public', url.pathname);
        if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' }); return res.end(fs.readFileSync(f)); }
    }

    if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': hi\n\n');
        res.overlayOnly = overlayOnly(req);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }

    // Sound files
    if (req.method === 'GET' && url.pathname.startsWith('/sounds/')) {
        const p = soundFilePath(decodeURIComponent(url.pathname.slice('/sounds/'.length)));
        if (!p) return send(res, 404, { error: 'Not found' });
        return send(res, 200, fs.readFileSync(p), SOUND_TYPES[path.extname(p).toLowerCase()]);
    }

    // Upload a sound: raw file in the body, its name in ?name=
    if (req.method === 'POST' && url.pathname === '/api/sounds/upload') {
        if (!/^application\/octet-stream/i.test(req.headers['content-type'] || '')) return send(res, 400, { error: 'Bad upload' });
        try {
            const original = String(url.searchParams.get('name') || 'sound');
            const ext = path.extname(original).toLowerCase();
            if (!SOUND_TYPES[ext]) throw new Error('Use an .mp3, .wav, .ogg or .m4a file');
            const base = path.basename(original, ext).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'sound';
            let name = `${base}${ext}`, i = 2;
            while (fs.existsSync(path.join(CUSTOM_SOUNDS, name))) name = `${base}-${i++}${ext}`;
            const data = await readBody(req, 15e6);
            if (!data.length) throw new Error('That file is empty');
            fs.writeFileSync(path.join(CUSTOM_SOUNDS, name), data);
            log(`Added sound: ${name}`);
            broadcast('sounds', listSounds());
            return send(res, 200, { ok: true, file: `custom/${name}` });
        } catch (e) {
            return send(res, 400, { error: e.message });
        }
    }

    // Find sounds online: GET /api/sounds/search?q=fahh, and a preview of one before adding it
    if (req.method === 'GET' && url.pathname === '/api/sounds/search') {
        try { return send(res, 200, await searchClips(url.searchParams.get('q'))); } catch (e) { return send(res, 502, { error: e.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/sound-preview') {
        try {
            const buf = await fetchClip(url.searchParams.get('p') || '');
            res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'max-age=86400' });
            return res.end(buf);
        } catch (e) { return send(res, 404, { error: e.message }); }
    }

    // Game covers
    if (req.method === 'GET' && url.pathname.startsWith('/cover/')) {
        const g = games[url.pathname.slice('/cover/'.length)];
        try {
            // a type's own cover (?mode=), or the game's
            const m = g && url.searchParams.get('mode') && g.modes.find(x => x.id === url.searchParams.get('mode'));
            const p = m ? (m.cover ? path.join(COVERS_DIR, m.cover.slice(5)) : null) : g && await coverFile(g);
            if (!p || !fs.existsSync(p)) return send(res, 404, { error: 'No cover' });
            const buf = fs.readFileSync(p);
            res.writeHead(200, { 'Content-Type': IMAGE_TYPES[imageExt(buf)] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
            return res.end(buf);
        } catch {
            return send(res, 502, { error: 'Cover unavailable' });
        }
    }

    // Upload a cover: the picture in the body, ?id=<game>. ?remove=1 takes the cover off.
    if (req.method === 'POST' && url.pathname === '/api/games/cover') {
        const g = games[url.searchParams.get('id')];
        if (!g) return send(res, 400, { error: 'No such game' });
        // with ?mode= it's that type's cover
        const m = url.searchParams.get('mode') ? g.modes.find(x => x.id === url.searchParams.get('mode')) : null;
        if (url.searchParams.get('mode') && !m) return send(res, 400, { error: 'No such type' });
        const holder = m || g;
        try {
            const old = holder.cover;
            if (url.searchParams.get('remove')) holder.cover = '';
            else {
                if (!/^application\/octet-stream/i.test(req.headers['content-type'] || '')) throw new Error('Bad upload');
                const buf = await readBody(req, 8e6);
                const ext = imageExt(buf);
                if (!ext) throw new Error('Use a .jpg, .png, .webp or .gif picture');
                const name = `${g.id}-${newId()}${ext}`;
                fs.mkdirSync(COVERS_DIR, { recursive: true });
                fs.writeFileSync(path.join(COVERS_DIR, name), buf);
                holder.cover = `file:${name}`;
            }
            saveGame(g);
            removeCoverIfUnused(old);
            broadcast('state', publicState());
            return send(res, 200, { ok: true });
        } catch (e) {
            return send(res, 400, { error: e.message === 'Too big' ? 'That picture is too big (8 MB max)' : e.message });
        }
    }

    // Gift pictures through here: TikTok's image server doesn't always allow other pages to load them.
    if (url.pathname === '/gift-img') {
        const u = url.searchParams.get('u') || '';
        let target;
        try { target = new URL(u); } catch { return send(res, 400, { error: 'Bad url' }); }
        if (target.protocol !== 'https:' || !/(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|ibyteimg\.com|byteimg\.com)$/i.test(target.hostname)) return send(res, 400, { error: 'Not a TikTok picture' });
        try {
            const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!r.ok) return send(res, 404, { error: 'Not found' });
            res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/webp', 'Cache-Control': 'public, max-age=604800' });
            return res.end(Buffer.from(await r.arrayBuffer()));
        } catch {
            return send(res, 502, { error: 'Picture unavailable' });
        }
    }

    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(res, 404, { error: 'Not found' });
    try {
        let body = {};
        if (req.method === 'POST') {
            if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 400, { error: 'Send JSON' });
            const raw = (await readBody(req)).toString('utf8');
            body = raw ? JSON.parse(raw) : {};
        }
        send(res, 200, await route(body));
    } catch (e) {
        send(res, 400, { error: e.message });
    }
});

// ---------- App window ----------

// After an update: close the world and the window, and start Gift Hype again (the new version)
let updating = false, appWindow = null;
async function restartAfterUpdate() {
    if (localServer.running()) { log('Saving your world...'); await localServer.stop(); }
    if (!process.env.GIFTHYPE_NO_RESTART) {
        const script = path.join(DATA, 'restart.cmd');
        fs.writeFileSync(script, '@echo off\r\nping -n 3 127.0.0.1 >nul\r\nstart "" wscript "%~dp0..\\Gift Hype.vbs"\r\n');
        spawn('cmd', ['/c', script], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
    appWindow?.removeAllListeners('exit');
    try { appWindow?.kill(); } catch { }
    setTimeout(() => process.exit(0), 300);
}
const appUrl = () => `http://localhost:${settings.port}/`;
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
    .find(p => fs.existsSync(p));

// Opens the app in its own window (Edge app mode, own profile so sounds can play without a click).
// Returns the window process, so the app can close when the window closes.
function openWindow() {
    if (NO_OPEN) return null;
    if (!EDGE) {
        spawn('cmd', ['/c', 'start', '', appUrl()], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        return null;
    }
    return spawn(EDGE, [
        `--app=${appUrl()}`,
        `--user-data-dir=${path.join(ROOT, 'data', 'window')}`,
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1400,900',
        '--no-first-run', '--no-default-browser-check',
    ], { stdio: 'ignore' });
}

server.on('error', async e => {
    if (e.code !== 'EADDRINUSE') throw e;
    // Already running: just show its window.
    console.log('Gift Hype is already running, opening its window.');
    openWindow();
    setTimeout(() => process.exit(0), 1500);
});

server.listen(settings.port, '127.0.0.1', () => {
    log(`Gift Hype is running: ${appUrl()}   Overlay for OBS / TikTok LIVE Studio: http://${OVERLAY_HOST}:${settings.port}/overlay`);
    startGameSocket();
    connectMinecraft();
    getSoundPack().catch(e => log(`Starter sounds: ${e.message}`));
    if (settings.autoConnect && settings.tiktokUsername) connectTikTok(settings.tiktokUsername);
    const win = appWindow = openWindow();
    // Is there a newer version? (checked once, a little after opening)
    setTimeout(() => checkForUpdate(ROOT).then(u => { setStatus({ update: u }); if (u.available) log(`Update available: version ${u.latest} (you have ${u.current}). Press Update in the bar at the top.`); }).catch(() => {}), 6000);
    // Close the app when its window is closed.
    win?.on('exit', async () => {
        log('Window closed, Gift Hype is stopping.');
        if (localServer.running()) { log('Saving your world...'); await localServer.stop(); }
        setTimeout(() => process.exit(0), 300);
    });
});

process.on('uncaughtException', e => log(`Error: ${e.message}`));
process.on('unhandledRejection', e => log(`Error: ${e?.message || e}`));

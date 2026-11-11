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

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const GAMES_DIR = path.join(DATA, 'games');
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
        icon: String(g.icon || '🎮').slice(0, 8),
        connector: ['minecraft', 'websocket', 'keys', 'none'].includes(g.connector) ? g.connector : 'none',
        // serverFolder: a server found on this PC; its RCON port and password are read from its
        // server.properties. Without one, host/port/password are used as typed.
        minecraft: { serverFolder: '', host: '127.0.0.1', port: 25575, password: '', player: '', ...g.minecraft,
            manual: g.minecraft?.manual ?? (!!g.minecraft?.password && !g.minecraft?.serverFolder) },
        rules: (Array.isArray(g.rules) ? g.rules : []).map(r => ({
            id: r.id || newId(),
            gift: String(r.gift || ''),
            image: r.image || null,
            coins: r.coins ?? null,
            sound: r.sound || null,
            volume: Number.isFinite(+r.volume) ? Math.max(0, Math.min(1, +r.volume)) : 1,
            alert: r.alert !== false,
            label: String(r.label || ''),
            perCount: r.perCount !== false,
            actions: (Array.isArray(r.actions) ? r.actions : []).map(a => ({ type: a.type, ...a })),
        })),
    };
}

let games = loadGames();
const saveGame = g => writeJson(gamePath(g.id), g);

// Starter games the first time the app opens.
if (!Object.keys(games).length) {
    const mc = normalizeGame({
        id: newId(), name: 'Minecraft', icon: '⛏️', connector: 'minecraft',
        rules: [
            { gift: 'Rose', sound: 'builtin/vine-boom.wav', label: 'Spawns a zombie', actions: [{ type: 'command', command: 'execute at @a[name={player},limit=1] run summon zombie ^ ^ ^3' }] },
            { gift: 'Finger Heart', sound: 'builtin/ding.wav', label: 'Gives a diamond', actions: [{ type: 'command', command: 'give {player} diamond 1' }] },
            { gift: 'Hat and Mustache', sound: 'builtin/fahh.wav', label: 'Lightning strike!', actions: [{ type: 'command', command: 'execute at @a[name={player},limit=1] run summon lightning_bolt ^ ^ ^2' }] },
        ],
    });
    const own = normalizeGame({
        id: newId(), name: 'My own game', icon: '🕹️', connector: 'websocket',
        rules: [
            { gift: 'Rose', sound: 'builtin/airhorn.wav', label: 'Spawn an enemy', actions: [{ type: 'message', name: 'spawnEnemy', amount: 1 }] },
            { gift: 'Finger Heart', sound: 'builtin/ding.wav', label: 'Heal', actions: [{ type: 'message', name: 'heal', amount: 10 }] },
        ],
    });
    games = { [mc.id]: mc, [own.id]: own };
    Object.values(games).forEach(saveGame);
    settings.activeGame = mc.id;
    saveSettings();
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

// ---------- Live updates (Server-Sent Events) ----------

const clients = new Set();
function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
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

const SKIP_DIRS = new Set(['node_modules', '.git', 'AppData', 'world', 'world_nether', 'world_the_end', 'libraries', 'versions', 'cache', 'logs', 'plugins', 'bundler', 'window']);
var foundServers = foundServers || []; // may already be filled by the startup scan above

// Looks in Downloads, Desktop, Documents (a few folders deep) for server.properties files.
function findServers() {
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
async function connectMinecraft() {
    clearTimeout(rconTimer);
    const g = activeGame();
    if (!g || g.connector !== 'minecraft') return disconnectMinecraft();
    const target = rconTarget(g);
    const key = JSON.stringify([g.id, target]);
    if (rcon && rconFor === key) return;
    await disconnectMinecraft();
    rconFor = key;
    if (target.error) {
        setStatus({ minecraft: target.error });
        // check again in a bit (e.g. RCON was just turned on and the server restarted)
        if (target.error !== 'no server picked') rconTimer = setTimeout(() => { rconFor = null; connectMinecraft(); }, 10000);
        return;
    }
    setStatus({ minecraft: 'connecting' });
    try {
        const r = await Rcon.connect({ host: target.host, port: target.port, password: target.password, timeout: 5000 });
        if (rconFor !== key) return r.end().catch(() => {});
        rcon = r;
        r.on('end', () => {
            if (rcon !== r) return;
            rcon = null;
            setStatus({ minecraft: 'offline' });
            log('Minecraft disconnected. Trying again in 10s...');
            rconTimer = setTimeout(() => { rconFor = null; connectMinecraft(); }, 10000);
        });
        r.on('error', () => {});
        setStatus({ minecraft: 'connected' });
        log(`Connected to Minecraft${g.minecraft.serverFolder ? ` (${path.basename(path.dirname(g.minecraft.serverFolder))})` : ` at ${target.host}:${target.port}`}.`);
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

async function runAction(game, a, ctx) {
    const times = Math.min(MAX_REPEAT, Math.max(1, (+a.times || 1) * (ctx.perCount ? ctx.count : 1)));
    if (a.type === 'command') {
        if (game.connector !== 'minecraft') return;
        for (let i = 0; i < times; i++) await mc(fill(a.command || '', ctx)).catch(e => log(`Command failed: ${e.message}`));
    } else if (a.type === 'message') {
        const sent = sendToGames({ type: 'gift', action: a.name || 'gift', amount: (+a.amount || 1) * (ctx.perCount ? ctx.count : 1), gift: ctx.gift, from: ctx.from, count: ctx.count, game: game.name });
        if (!sent) log(`No game is connected to receive "${a.name}".`);
    } else if (a.type === 'keys') {
        for (let i = 0; i < times; i++) { pressKeys(a.keys || ''); if (times > 1) await sleep(Math.max(30, +a.gap || 120)); }
    } else if (a.type === 'wait') {
        await sleep(Math.max(0, Math.min(60000, (+a.seconds || 1) * 1000)));
    }
}

function findRule(game, giftName) {
    const n = giftName.toLowerCase();
    return game.rules.find(r => r.gift.toLowerCase() === n) || game.rules.find(r => r.gift === '*') || null;
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

    if (rule.sound) broadcast('play', { file: rule.sound, volume: rule.volume * settings.masterVolume });
    if (rule.alert) broadcast('alert', { ...entry, label: rule.label });

    const ctx = { player: game.minecraft.player || await onlinePlayer(game) || '@p', from, gift: giftName, count, perCount: rule.perCount };
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
    games: Object.values(games).map(g => ({ id: g.id, name: g.name, icon: g.icon, connector: g.connector, gifts: g.rules.length })),
    game: activeGame(),
    sounds: listSounds(),
    status, feed, log: recentLog.slice(-80),
});

function setActive(id) {
    if (!games[id]) throw new Error('No such game');
    settings.activeGame = id;
    saveSettings();
    connectMinecraft();
    broadcast('state', publicState());
    log(`Now playing: ${games[id].name}`);
}

const routes = {
    'GET /api/state': () => publicState(),
    'GET /api/catalog': () => [...learned, ...catalog.filter(c => !learned.some(l => l.name.toLowerCase() === c.name.toLowerCase()))].sort((a, b) => (a.coins ?? 0) - (b.coins ?? 0) || a.name.localeCompare(b.name)),
    'POST /api/connect': async b => { await connectTikTok(b.username); return { ok: true }; },
    'POST /api/disconnect': async () => { await disconnectTikTok(); return { ok: true }; },
    'POST /api/settings': b => {
        if (typeof b.eulerStreamApiKey === 'string' && b.eulerStreamApiKey !== '••••••') settings.eulerStreamApiKey = b.eulerStreamApiKey.trim();
        if (Number.isFinite(+b.masterVolume)) settings.masterVolume = Math.max(0, Math.min(1, +b.masterVolume));
        if (['app', 'overlay'].includes(b.soundsIn)) settings.soundsIn = b.soundsIn;
        if (typeof b.autoConnect === 'boolean') settings.autoConnect = b.autoConnect;
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
        const g = normalizeGame({ id: newId(), name: b.name || 'New game', icon: b.icon || '🎮', connector: b.connector || 'none', rules: [] });
        if (g.connector === 'minecraft') g.minecraft.serverFolder = findServers().find(f => f.rcon)?.folder || '';
        games[g.id] = g;
        saveGame(g);
        setActive(g.id);
        return { ok: true, id: g.id };
    },
    'POST /api/games/save': b => {
        if (!games[b.id]) throw new Error('No such game');
        const g = normalizeGame(b);
        games[g.id] = g;
        saveGame(g);
        if (g.id === settings.activeGame) connectMinecraft();
        broadcast('games', publicState().games);
        return { ok: true, game: g };
    },
    'POST /api/games/delete': b => {
        if (!games[b.id]) throw new Error('No such game');
        delete games[b.id];
        fs.rmSync(gamePath(b.id), { force: true });
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
        const g = normalizeGame({ ...structuredClone(src), id: newId(), name: `${src.name} (copy)`, rules: src.rules.map(r => ({ ...r, id: newId() })) });
        games[g.id] = g;
        saveGame(g);
        setActive(g.id);
        return { ok: true, id: g.id };
    },
    'POST /api/games/active': b => { setActive(b.id); return { ok: true }; },
    'POST /api/test': async b => {
        const game = activeGame();
        const rule = game?.rules.find(r => r.id === b.ruleId);
        if (!rule) throw new Error('Save the gift first');
        const known = findGift(rule.gift);
        await handleGift(rule.gift === '*' ? 'Any gift' : rule.gift, Math.max(1, Math.min(100, +b.count || 1)), 'TEST', known?.image || rule.image, known?.coins);
        return { ok: true };
    },
    'POST /api/sounds/delete': b => {
        const p = soundFilePath(b.file);
        if (!p || !String(b.file).startsWith('custom/')) throw new Error('Only your own sounds can be deleted');
        fs.rmSync(p);
        broadcast('sounds', listSounds());
        return { ok: true };
    },
    'GET /api/minecraft/servers': () => findServers().map(({ folder, name, rcon, port, world }) => ({ folder, name, rcon, port, world })),
    'POST /api/minecraft/enable-rcon': b => { enableRcon(String(b.folder || '')); connectMinecraft(); return { ok: true }; },
    'POST /api/minecraft/test': async () => {
        await connectMinecraft();
        if (!rcon) throw new Error(`Minecraft: ${status.minecraft}`);
        const r = await mc('list');
        return { ok: true, reply: r };
    },
};

// Pages only from this PC: blocks other websites (and DNS tricks) from using the app.
function allowed(req) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1'].includes(host)) return false;
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return false;
    return true;
}

const STATIC = { '/': 'app.html', '/overlay': 'overlay.html' };

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!allowed(req)) return send(res, 403, { error: 'Not allowed' });

    if (STATIC[url.pathname]) return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', STATIC[url.pathname])), 'text/html; charset=utf-8');
    if (url.pathname === '/icon.png') return send(res, 200, fs.readFileSync(path.join(ROOT, 'public', 'icon.png')), 'image/png');

    if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': hi\n\n');
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
    log(`Gift Hype is running: ${appUrl()}   Overlay for OBS: ${appUrl()}overlay`);
    startGameSocket();
    connectMinecraft();
    if (settings.autoConnect && settings.tiktokUsername) connectTikTok(settings.tiktokUsername);
    const win = openWindow();
    // Close the app when its window is closed.
    win?.on('exit', () => { log('Window closed, Gift Hype is stopping.'); setTimeout(() => process.exit(0), 300); });
});

process.on('uncaughtException', e => log(`Error: ${e.message}`));
process.on('unhandledRejection', e => log(`Error: ${e?.message || e}`));

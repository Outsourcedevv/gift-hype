// "Play your singleplayer world with gifts": a singleplayer world can't take commands from outside
// the game, so Gift Hype opens YOUR world (from .minecraft/saves, not a copy) on a small hidden
// Minecraft server on this PC. You join it from Multiplayer ("Gift Hype", added for you) and gifts
// happen instantly through RCON. Your inventory and everything else stays in the world, so you can
// still open it in singleplayer later (just not both at once).
//
// It uses the official Minecraft server from Mojang for the version the world was last played on,
// downloaded once into data/mcserver. The Minecraft EULA has to be accepted in the app first.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Rcon } from 'rcon-client';
import { SAVES_DIR } from './singleplayer.js';

const MC_DIR = path.dirname(SAVES_DIR);

// ---------- NBT (Minecraft's file format), just enough for level.dat and servers.dat ----------
function readNbt(buf) {
    let o = 0;
    const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
    const payload = t => {
        switch (t) {
            case 1: return buf.readInt8(o++);
            case 2: { const v = buf.readInt16BE(o); o += 2; return v; }
            case 3: { const v = buf.readInt32BE(o); o += 4; return v; }
            case 4: { const v = buf.readBigInt64BE(o); o += 8; return v; }
            case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
            case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
            case 7: { const n = buf.readInt32BE(o); o += 4; const v = buf.subarray(o, o + n); o += n; return v; }
            case 8: return str();
            case 9: { const et = buf[o++]; const n = buf.readInt32BE(o); o += 4; const items = []; for (let i = 0; i < n; i++) items.push(payload(et)); return { listType: et, items }; }
            case 10: { const m = new Map(); for (;;) { const tt = buf[o++]; if (tt === 0) break; const k = str(); m.set(k, { t: tt, v: payload(tt) }); } return m; }
            case 11: { const n = buf.readInt32BE(o); o += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readInt32BE(o)); o += 4; } return v; }
            case 12: { const n = buf.readInt32BE(o); o += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readBigInt64BE(o)); o += 8; } return v; }
            default: throw new Error('Bad NBT');
        }
    };
    const t = buf[o++]; str();
    return { t, v: payload(t) };
}
function writeNbt(root) {
    const parts = [];
    const u8 = n => parts.push(Buffer.from([n & 255]));
    const i16 = n => { const b = Buffer.alloc(2); b.writeInt16BE(n); parts.push(b); };
    const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); parts.push(b); };
    const str = s => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); parts.push(l, b); };
    const payload = (t, v) => {
        switch (t) {
            case 1: u8(v); break;
            case 2: i16(v); break;
            case 3: i32(v); break;
            case 4: { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); parts.push(b); break; }
            case 5: { const b = Buffer.alloc(4); b.writeFloatBE(v); parts.push(b); break; }
            case 6: { const b = Buffer.alloc(8); b.writeDoubleBE(v); parts.push(b); break; }
            case 7: i32(v.length); parts.push(Buffer.from(v)); break;
            case 8: str(v); break;
            case 9: u8(v.listType); i32(v.items.length); for (const x of v.items) payload(v.listType, x); break;
            case 10: for (const [k, e] of v) { u8(e.t); str(k); payload(e.t, e.v); } u8(0); break;
            case 11: i32(v.length); for (const x of v) i32(x); break;
            case 12: i32(v.length); for (const x of v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(x)); parts.push(b); } break;
        }
    };
    u8(root.t); str(''); payload(root.t, root.v);
    return Buffer.concat(parts);
}

// The Minecraft version the world was last played on, e.g. "26.2".
export function worldVersion(world) {
    const nbt = readNbt(zlib.gunzipSync(fs.readFileSync(path.join(SAVES_DIR, world, 'level.dat'))));
    return nbt.v.get('Data')?.v.get('Version')?.v.get('Name')?.v || null;
}

// Adds "Gift Hype" to Minecraft's Multiplayer list (once). Minecraft must be closed to keep it,
// otherwise it can write its own list over it; it's added again each time the world starts.
export function addServerEntry(port) {
    const file = path.join(MC_DIR, 'servers.dat');
    const ip = `localhost:${port}`;
    let root;
    try { root = readNbt(fs.readFileSync(file)); } catch { root = { t: 10, v: new Map() }; }
    if (!root.v.has('servers')) root.v.set('servers', { t: 9, v: { listType: 10, items: [] } });
    const list = root.v.get('servers').v;
    if (list.items.some(s => s.get('ip')?.v === ip)) return false;
    if (fs.existsSync(file) && !fs.existsSync(file + '.before-gift-hype')) fs.copyFileSync(file, file + '.before-gift-hype');
    list.listType = 10;
    list.items.unshift(new Map([['name', { t: 8, v: 'Gift Hype' }], ['ip', { t: 8, v: ip }], ['acceptTextures', { t: 1, v: 1 }]]));
    fs.writeFileSync(file, writeNbt(root));
    return true;
}

// Java 21+ : the one Minecraft's launcher downloaded, an installed JDK, or whatever "java" is.
export function findJava() {
    const cands = [];
    const roots = [
        path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'),
        path.join(MC_DIR, 'runtime'),
        'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java', 'C:\\Program Files\\Microsoft',
    ];
    const walk = (dir, depth) => {
        let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isFile() && e.name.toLowerCase() === 'java.exe' && path.basename(dir).toLowerCase() === 'bin') cands.push(p);
            else if (e.isDirectory() && depth > 0) walk(p, depth - 1);
        }
    };
    for (const r of roots) walk(r, 6);
    cands.push('java');
    let best = null;
    for (const c of cands) {
        try {
            // java -version prints to stderr
            const res = spawnSync(c, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
            const r = String(res.stderr || '') + String(res.stdout || '');
            const m = /version "(\d+)/.exec(r);
            if (m && (!best || +m[1] > best.v)) best = { path: c, v: +m[1] };
        } catch { }
    }
    return best;
}

// The official server for that version, downloaded from Mojang once and checked against its sha1.
export async function serverJar(dir, version, log) {
    const file = path.join(dir, `minecraft-server-${version}.jar`);
    if (fs.existsSync(file)) return file;
    const manifest = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json();
    const entry = manifest.versions.find(v => v.id === version);
    if (!entry) throw new Error(`Minecraft ${version} wasn't found on Mojang's server list`);
    const info = await (await fetch(entry.url)).json();
    const dl = info.downloads?.server;
    if (!dl) throw new Error(`There is no server download for ${version}`);
    log(`Downloading the Minecraft ${version} server from Mojang (${Math.round(dl.size / 1e6)} MB)...`);
    const buf = Buffer.from(await (await fetch(dl.url)).arrayBuffer());
    if (crypto.createHash('sha1').update(buf).digest('hex') !== dl.sha1) throw new Error('The server download was damaged, try again');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.part', buf);
    fs.renameSync(file + '.part', file);
    return file;
}

export const SERVER_PORT = +process.env.GIFTHYPE_MC_PORT || 25566;   // the env settings are only for testing
export const RCON_PORT = +process.env.GIFTHYPE_RCON_PORT || 25576;

// Runs the hidden server. One at a time.
export function makeLocalServer({ dir, log, onState }) {
    let proc = null, world = null, password = null, stopping = null;
    const propsFile = path.join(dir, 'server.properties');

    function writeProps(extra = []) {
        const old = fs.existsSync(propsFile) ? fs.readFileSync(propsFile, 'utf8') : '';
        password = /rcon\.password=(\S+)/.exec(old)?.[1] || crypto.randomBytes(12).toString('hex');
        fs.writeFileSync(propsFile, [
            '# Made by Gift Hype: your singleplayer world on a hidden server on this PC only.',
            `server-port=${SERVER_PORT}`, 'server-ip=127.0.0.1',
            'enable-rcon=true', `rcon.port=${RCON_PORT}`, `rcon.password=${password}`, 'broadcast-rcon-to-ops=false',
            'online-mode=true', 'max-players=4', 'spawn-protection=0', 'enable-command-block=false',
            'motd=Gift Hype - your world with TikTok gifts', 'view-distance=10', 'simulation-distance=10',
            'sync-chunk-writes=true', 'enforce-secure-profile=false', 'log-ips=false', 'pause-when-empty-seconds=0',
            ...extra,
        ].join('\n') + '\n');
    }

    // newVersion and props: for a world that isn't made yet (it's made with those server.properties lines)
    // Starts and stops wait their turn, so asking for the world several times at once (switching
    // types, saving, reconnecting) never opens it twice: a second copy can't open a locked world.
    let queue = Promise.resolve();
    const inTurn = job => { const run = queue.then(job, job); queue = run.catch(() => {}); return run; };
    const start = (w, opts) => inTurn(() => doStart(w, opts));
    const stop = () => inTurn(doStop);

    async function doStart(w, { eula, version: newVersion, props = [] }) {
        if (proc && world === w) return;
        await doStop();
        if (!eula) return onState('eula not accepted');
        const lock = path.join(SAVES_DIR, w, 'session.lock');
        void lock;
        let version = newVersion;
        try { version = worldVersion(w) || newVersion; } catch { }
        if (!version) return onState('world not found');
        const java = findJava();
        if (!java || java.v < 21) return onState('java missing');
        onState('downloading');
        const jar = await serverJar(dir, version, log);
        await closeLeftover();
        writeProps(props);
        fs.writeFileSync(path.join(dir, 'eula.txt'), '# Accepted in Gift Hype by the player: https://aka.ms/MinecraftEULA\neula=true\n');
        try { addServerEntry(SERVER_PORT); } catch (e) { log(`Couldn't add Gift Hype to the Multiplayer list: ${e.message}`); }
        world = w;
        onState('starting');
        log(`Opening "${w}" (Minecraft ${version}) for gifts...`);
        const p = spawn(java.path, ['-Xms1G', '-Xmx3G', '-jar', jar, '--nogui', '--universe', SAVES_DIR, '--world', w],
            { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        proc = p;
        const out = fs.createWriteStream(path.join(dir, 'console.log'));
        const onLine = line => {
            out.write(line + '\n');
            if (/Done \(/.test(line)) { log(`"${w}" is ready. In Minecraft: Multiplayer, then Gift Hype.`); onState('ready'); }
            else if (/session\.lock|already locked|LockException|locked a portion/i.test(line)) onState('world open in singleplayer');
            else if (/joined the game|left the game/.test(line)) log(line.replace(/^.*INFO\]: /, ''));
            else if (/Failed to start|FAILED TO BIND|Exception in server tick/i.test(line)) log(`Minecraft: ${line.replace(/^.*\]: /, '')}`);
        };
        let buf = '';
        const feed = d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } };
        p.stdout.setEncoding('utf8').on('data', feed);
        p.stderr.setEncoding('utf8').on('data', feed);
        p.on('exit', code => {
            out.end();
            if (proc === p) { proc = null; world = null; onState(stopping ? 'stopped' : code ? 'crashed' : 'stopped'); }
        });
    }

    // Saves the world and closes the server (waits up to 30s).
    // A copy of the hidden world left running from before (e.g. Gift Hype was closed in a way that
    // didn't close it) keeps the world locked. It answers on our RCON port with our password, so it's
    // ours: ask it to save and close, and wait for it.
    async function closeLeftover() {
        const old = fs.existsSync(propsFile) ? /rcon\.password=(\S+)/.exec(fs.readFileSync(propsFile, 'utf8'))?.[1] : null;
        if (!old) return;
        let r;
        try { r = await Rcon.connect({ host: '127.0.0.1', port: RCON_PORT, password: old, timeout: 3000 }); } catch { return; }
        log('A copy of the world was still open from before: saving and closing it first...');
        r.on('error', () => { });
        await r.send('stop').catch(() => { });
        await r.end().catch(() => { });
        for (let i = 0; i < 60; i++) {
            await new Promise(res => setTimeout(res, 500));
            try { const t = await Rcon.connect({ host: '127.0.0.1', port: RCON_PORT, password: old, timeout: 1000 }); await t.end().catch(() => { }); } catch { break; }
        }
        await new Promise(res => setTimeout(res, 2000));   // let it let go of the world files
    }

    async function doStop() {
        const p = proc;
        if (!p) return;
        stopping = true;
        try { p.stdin.write('stop\n'); } catch { }
        await new Promise(res => { const t = setTimeout(() => { try { p.kill(); } catch { } res(); }, 30000); p.on('exit', () => { clearTimeout(t); res(); }); });
        stopping = null;
    }

    return {
        start, stop,
        running: () => !!proc,
        world: () => world,
        rcon: () => ({ host: '127.0.0.1', port: RCON_PORT, password }),
    };
}

// ---------- Opening Minecraft straight into your world ----------
// A launcher version "gift-hype-<version>" that is just the normal game plus "join localhost:25566 as
// soon as you start" (Minecraft's own quick-play option), and a "Gift Hype" launcher profile that
// uses it, marked as last used so the launcher has it picked. Then the launcher is opened.
export function setupLauncher(version) {
    const id = `gift-hype-${version}`;
    const vdir = path.join(MC_DIR, 'versions', id);
    fs.mkdirSync(vdir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(vdir, `${id}.json`), JSON.stringify({
        id, inheritsFrom: version, type: 'release', time: now, releaseTime: now,
        mainClass: 'net.minecraft.client.main.Main',
        arguments: { game: ['--quickPlayMultiplayer', `localhost:${SERVER_PORT}`], jvm: [] },
    }, null, 2));
    const pf = path.join(MC_DIR, 'launcher_profiles.json');
    const raw = fs.readFileSync(pf, 'utf8');
    if (!fs.existsSync(pf + '.before-gift-hype')) fs.writeFileSync(pf + '.before-gift-hype', raw);
    const j = JSON.parse(raw);
    j.profiles ||= {};
    const old = j.profiles['gift-hype'] || {};
    j.profiles['gift-hype'] = { ...old, name: 'Gift Hype', type: 'custom', icon: 'TNT', lastVersionId: id, created: old.created || now, lastUsed: now };
    fs.writeFileSync(pf, JSON.stringify(j, null, 2));
    return id;
}

export function openLauncher() {
    if (process.env.GIFTHYPE_NO_LAUNCH) return; // testing
    // the Microsoft Store / Xbox app launcher, or the older one if that's what is installed
    const legacy = ['C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe', 'C:\\Program Files\\Minecraft Launcher\\MinecraftLauncher.exe'].find(p => fs.existsSync(p));
    const p = legacy
        ? spawn(legacy, [], { detached: true, stdio: 'ignore' })
        : spawn('explorer.exe', ['shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft'], { detached: true, stdio: 'ignore' });
    p.unref();
}

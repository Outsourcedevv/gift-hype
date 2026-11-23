// Parkour Paradise 3, Hielke's 100-level parkour map, is the world for the Parkour Paradise type.
// Unbound doesn't include or host the map: it's Hielke's, free from his own page on MinecraftMaps,
// which only lets people (not programs) download it. So when Play needs it, Unbound opens that page
// in your browser, you press Download, and Unbound picks the zip up from your Downloads folder by
// itself, puts the world into .minecraft/saves and carries on.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { listWorlds, SAVES_DIR } from './singleplayer.js';
import { levelNameAt } from './localserver.js';

export const PP3 = {
    name: 'Parkour Paradise 3',
    by: 'Hielke',
    folder: 'Parkour Paradise 3',
    page: 'https://www.minecraftmaps.com/26467-parkour-paradise-3',
};
const NAME_RE = /parkour[\s_.-]*paradise[\s_.-]*3/i;

// The map's world in .minecraft/saves, if it's there (its folder name, else null): by its folder's
// name, or the name it has in Minecraft's world list
export function findParkourMap() {
    const worlds = listWorlds();
    return (worlds.find(w => w.name === PP3.folder) || worlds.find(w => NAME_RE.test(w.name))
        || worlds.find(w => NAME_RE.test(levelNameAt(path.join(SAVES_DIR, w.name)) || '')))?.name || null;
}

// Windows' Downloads folder (it can be moved, e.g. into OneDrive), else ~/Downloads
let downloadsCache = null;
export function downloadsDir() {
    if (downloadsCache) return downloadsCache;
    let dir = path.join(os.homedir(), 'Downloads');
    if (process.platform === 'win32') {
        try {
            const r = spawnSync('powershell', ['-NoProfile', '-Command', "(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path"], { encoding: 'utf8', timeout: 8000, windowsHide: true });
            const p = (r.stdout || '').trim();
            if (p && fs.existsSync(p)) dir = p;
        } catch { /* the usual one */ }
    }
    return (downloadsCache = dir);
}

export function openMapPage() {
    const p = process.platform === 'win32' ? spawn('cmd', ['/c', 'start', '', PP3.page], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [PP3.page], { detached: true, stdio: 'ignore' });
    p.on('error', () => {});   // no browser to open: the app shows the link too
    p.unref();
}

// Unzips with what the PC has: Windows' own tar (Windows 10 and later), PowerShell, or unzip
function unzip(zip, to) {
    fs.mkdirSync(to, { recursive: true });
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const tries = process.platform === 'win32'
        ? [[fs.existsSync(sysTar) ? sysTar : 'tar', ['-xf', zip, '-C', to]],
           ['powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${to.replace(/'/g, "''")}' -Force`]]]
        : [['unzip', ['-q', '-o', zip, '-d', to]], ['bsdtar', ['-xf', zip, '-C', to]]];
    for (const [cmd, args] of tries) {
        const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 5 * 60 * 1000, windowsHide: true });
        if (r.status === 0) return true;
    }
    return false;
}

// The world folder inside what was unzipped (the one with level.dat, nearest the top)
function findWorldIn(dir, depth = 0) {
    if (fs.existsSync(path.join(dir, 'level.dat'))) return dir;
    if (depth > 3) return null;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name === '__MACOSX') continue;
        const w = findWorldIn(path.join(dir, d.name), depth + 1);
        if (w) return w;
    }
    return null;
}

// Puts the map from a downloaded zip into .minecraft/saves as "Parkour Paradise 3".
// Returns the world's folder name, or null if that zip isn't the map.
export function importParkourMap(zip, log = () => {}) {
    if (findParkourMap()) return findParkourMap();
    const tmp = path.join(SAVES_DIR, '..', `unbound-map-${Date.now()}`);
    try {
        if (!unzip(zip, tmp)) throw new Error("the zip couldn't be opened");
        const world = findWorldIn(tmp);
        if (!world) return null;
        // it has to be this map: its zip, its folder or its name in Minecraft says Parkour Paradise 3
        if (![path.basename(zip), path.basename(world), levelNameAt(world) || ''].some(n => NAME_RE.test(n))) return null;
        const dest = path.join(SAVES_DIR, PP3.folder);
        fs.mkdirSync(SAVES_DIR, { recursive: true });
        try { fs.renameSync(world, dest); } catch { fs.cpSync(world, dest, { recursive: true }); }
        log(`${PP3.name} is in your Minecraft worlds (from ${path.basename(zip)}).`);
        return PP3.folder;
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// Zips in Downloads that could be the map, newest first (finished ones only: not .crdownload / .part)
function candidateZips(since = 0) {
    const dir = downloadsDir();
    let list = [];
    try { list = fs.readdirSync(dir).filter(f => /\.zip$/i.test(f)); } catch { return []; }
    return list.map(f => { const p = path.join(dir, f); try { const s = fs.statSync(p); return { p, f, t: s.mtimeMs, size: s.size }; } catch { return null; } })
        .filter(z => z && z.size > 0 && (NAME_RE.test(z.f) || z.t >= since))
        .sort((a, b) => (NAME_RE.test(b.f) - NAME_RE.test(a.f)) || b.t - a.t);
}

// Already downloaded before? (a zip with the map's name in Downloads)
export function importFromDownloads(log) {
    for (const z of candidateZips(Infinity)) {
        try { const w = importParkourMap(z.p, log); if (w) return w; } catch (e) { log(`Couldn't use ${z.f}: ${e.message}`); }
    }
    return null;
}

// Waits for the map's zip to land in Downloads (up to `minutes`), then puts it in place.
// isCancelled: stops waiting when it says so.
export async function waitForParkourMap({ log = () => {}, minutes = 20, isCancelled = () => false } = {}) {
    const since = Date.now() - 2000, tried = new Set(), until = Date.now() + minutes * 60 * 1000;
    while (Date.now() < until && !isCancelled()) {
        const found = findParkourMap();
        if (found) return found;
        for (const z of candidateZips(since)) {
            const key = z.p + ':' + z.size + ':' + z.t;
            if (tried.has(key)) continue;
            // still being written? wait until its size holds still
            await new Promise(r => setTimeout(r, 1500));
            let now; try { now = fs.statSync(z.p).size; } catch { continue; }
            if (now !== z.size) continue;
            tried.add(key);
            try { const w = importParkourMap(z.p, log); if (w) return w; } catch (e) { log(`Couldn't use ${z.f}: ${e.message}`); }
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    return null;
}

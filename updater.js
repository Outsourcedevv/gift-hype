// Updates: Gift Hype checks GitHub for a newer version and can install it in place.
//
// The version is the "version" in package.json. A new version is published by pushing it to the
// main branch of github.com/Outsourcedevv/gift-hype. Updating downloads that branch as a zip,
// copies the program files over this folder and leaves your own things alone (data: settings,
// games, keys, the Minecraft world server; your sounds; the downloaded parts in node_modules).
// If the parts Gift Hype needs changed, they're installed again. Then Gift Hype restarts.
//
// A copy that's a git checkout (the one updates are made from) never updates itself, so work in
// progress there can't be overwritten.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const REPO = 'Outsourcedevv/gift-hype';
const BRANCH = 'main';
// never touched by an update
const KEEP = new Set(['data', 'node_modules', '.git', 'sounds/custom', 'sounds/builtin']);

export const localVersion = root => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
export const isDevCopy = root => fs.existsSync(path.join(root, '.git'));

// 1.10.0 is newer than 1.9.3
export function newer(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
}

export async function latestVersion() {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/package.json?t=${Date.now()}`, { headers: { 'User-Agent': 'GiftHype-updater', 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    return (await r.json()).version;
}

export async function checkForUpdate(root) {
    const current = localVersion(root), latest = await latestVersion();
    return { current, latest, available: !isDevCopy(root) && newer(latest, current), devCopy: isDevCopy(root) };
}

// Downloads and installs the latest version. Returns the version installed.
export async function applyUpdate(root, log = () => {}) {
    if (isDevCopy(root)) throw new Error("This is the copy updates are made from, so it doesn't update itself");
    const work = path.join(root, 'data', 'update');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    try {
        log('Downloading the update...');
        const r = await fetch(`https://codeload.github.com/${REPO}/zip/refs/heads/${BRANCH}`, { headers: { 'User-Agent': 'GiftHype-updater' } });
        if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
        const zip = path.join(work, 'update.zip');
        fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
        // Windows' own tar unpacks zips
        const tar = fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')) ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
        const x = spawnSync(tar, ['-xf', zip, '-C', work], { windowsHide: true });
        if (x.status !== 0) throw new Error(`Couldn't unpack the update: ${String(x.stderr || '').trim().slice(0, 200)}`);
        const top = fs.readdirSync(work, { withFileTypes: true }).find(e => e.isDirectory());
        if (!top) throw new Error('The update was empty');
        const src = path.join(work, top.name);
        const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
        if (pkg.name !== 'gift-hype') throw new Error("That download isn't Gift Hype");
        const oldDeps = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies || {});

        log(`Installing version ${pkg.version}...`);
        const copy = (from, rel) => {
            for (const e of fs.readdirSync(from, { withFileTypes: true })) {
                const r2 = rel ? `${rel}/${e.name}` : e.name;
                if (KEEP.has(r2)) continue;
                const s = path.join(from, e.name), d = path.join(root, ...r2.split('/'));
                if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copy(s, r2); }
                else fs.copyFileSync(s, d);
            }
        };
        copy(src, '');

        if (JSON.stringify(pkg.dependencies || {}) !== oldDeps) {
            log('Installing the new parts it needs...');
            const n = spawnSync('cmd', ['/c', 'npm', 'install', '--no-audit', '--no-fund'], { cwd: root, windowsHide: true, encoding: 'utf8' });
            if (n.status !== 0) log(`npm install: ${String(n.stderr || n.stdout).trim().slice(-300)}`);
        }
        return pkg.version;
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}

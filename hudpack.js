// Chat Teleport's on-screen box: a small resource pack that Gift Hype's hidden server hands to your game.
// Minecraft can only put text in fixed places (title, action bar, boss bar), so the box is made of font
// glyphs: the box picture (designed in Figma: public/img/hud-box.png), pixel letters and numbers, and
// pictures of blocks taken from your own Minecraft. Each size/height setting is its own font (bitmap
// "height" = size, "ascent" = how far up or down) and "space" glyphs move things left and right. The title
// is drawn at 4x from the middle of the screen, so the box sits in the same spot on any screen.
import zlib from 'zlib';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findClientJar, makeIconReader, iconBlockFor } from './mcicons.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---- tiny PNG + ZIP writers (no packages needed) ----
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(w, h, rgba) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function readPng(file) {   // 8-bit RGBA, non-interlaced (what Figma exports)
    const buf = fs.readFileSync(file);
    let p = 8, w, h; const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8);
        if (t === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); }
        if (t === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
        p += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * 4, px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const a = x >= 4 ? px[y * stride + x - 4] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = y && x >= 4 ? px[(y - 1) * stride + x - 4] : 0;
            let v = raw[y * (stride + 1) + 1 + x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            px[y * stride + x] = v & 255;
        }
    }
    return { w, h, px };
}
function zip(files) {   // [{ name, data }] -> Buffer (stored, fixed dates so the same pack gives the same file)
    const locals = [], centrals = []; let off = 0;
    for (const f of files) {
        const name = Buffer.from(f.name), data = f.data, crc = crc32(data);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(10, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
        lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x5A21, 12); lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(10, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
        ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x5A21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20);
        ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
        locals.push(lh, name, data); centrals.push(ch, name);
        off += 30 + name.length + data.length;
    }
    const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...locals, cd, end]);
}

// ---- pixel letters (5x7) ----
const FONT = {
    '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
    '2': '.###.|#...#|....#|..##.|.#...|#....|#####', '3': '.###.|#...#|....#|..##.|....#|#...#|.###.',
    '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
    '6': '..##.|.#...|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
    '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.', '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
    A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
    C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
    E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
    G: '.###.|#...#|#....|#.###|#...#|#...#|.###.', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
    I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', J: '....#|....#|....#|....#|....#|#...#|.###.',
    K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
    M: '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#', N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
    O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
    Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
    S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
    U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
    W: '#...#|#...#|#...#|#...#|#.#.#|##.##|#...#', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
    Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
    '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', '.': '.....|.....|.....|.....|.....|.....|..#..',
    '-': '.....|.....|.....|.###.|.....|.....|.....', "'": '..#..|..#..|.....|.....|.....|.....|.....',
    ' ': '.....|.....|.....|.....|.....|.....|.....',
};
const CHARS = Object.keys(FONT).join('');

// colours (the Figma design: Gift Hype's navy, sky blue and orange on a light card)
const COL = { label: '#1474B4', digits: '#E8542A', soon: '#DC2626', name: '#13304A', away: '#1474B4', none: '#DC2626', done: '#1474B4' };

// ---- layout (in picture pixels; at size 100% one picture pixel = one GUI pixel) ----
const BOX_H = 40, CAP = 8, MIN_W = 112;
const ROWS = [6, 9, 16, 24];                     // text lines: timer label, block name, middle (one line), distance
const ROW = { label: 0, name: 1, mid: 2, away: 3 };
const DIGIT_Y = 19, DIGIT_PITCH = 12, ICON_X = 4, ICON_Y = 4;
export const SIZES = [75, 100, 125, 150, 200, 250];
export const HEIGHTS = [-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100];
const CELLS = [80, 160];                         // cell heights: a little see-through padding, lots (for high up)
const CH = { box: 0xE000, text: 0xE100, digit: 0xE200, icon: 0xE400, space: 0xEC00 };
const ICON_BOX = 32;                             // the picture's square in the box, in box pixels
// pictures: flat (16x16, drawn at 2x) or 3D (32x32, drawn at 1x). K = box pixels per picture pixel
const ICON_MODE = { flat: { K: 2, perRow: 64 }, '3d': { K: 1, perRow: 32 } };

const inkCols = ch => Math.max(-1, ...(FONT[ch] || FONT[' ']).split('|').map(r => r.lastIndexOf('#'))) + 1;
const inkWidth = (str, scale = 1) => { let w = 0; [...str].forEach((c, i) => { const k = inkCols(c); if (k) w = (i * 6 + k) * scale; }); return w; };

// A picture of equal cells, each W wide and H tall (see-through padding under the content)
function sheet(cols, rows, W, H) {
    const img = Buffer.alloc(cols * W * rows * H * 4), stride = cols * W;
    const put = (cell, x, y, rgba) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const cx = cell % cols, cy = Math.floor(cell / cols), i = ((cy * H + y) * stride + cx * W + x) * 4;
        img[i] = rgba[0]; img[i + 1] = rgba[1]; img[i + 2] = rgba[2]; img[i + 3] = rgba[3];
    };
    const glyph = (cell, ch, x0, y0, scale = 1) => (FONT[ch] || FONT[' ']).split('|').forEach((row, ry) => [...row].forEach((p, rx) => {
        if (p === '#') for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) put(cell, x0 + rx * scale + a, y0 + ry * scale + b, [255, 255, 255, 255]);
    }));
    return { put, glyph, png: () => png(cols * W, rows * H, img) };
}
function boxSheet(H) {        // left edge, middle slice, right edge, cut from the Figma box
    const art = readPng(path.join(ROOT, 'public', 'img', 'hud-box.png'));
    const s = sheet(3, 1, CAP, H), mid = Math.floor(art.w / 2) - CAP / 2;
    [0, mid, art.w - CAP].forEach((sx, cell) => {
        for (let y = 0; y < Math.min(BOX_H, art.h); y++) for (let x = 0; x < CAP; x++) {
            const i = (y * art.w + sx + x) * 4;
            s.put(cell, x, y, [art.px[i], art.px[i + 1], art.px[i + 2], art.px[i + 3]]);
        }
    });
    return s.png();
}
function textSheet(y, H) { const s = sheet(CHARS.length, 1, 6, H); [...CHARS].forEach((c, i) => s.glyph(i, c, 0, y)); return s.png(); }
function digitSheet(H) { const s = sheet(10, 1, DIGIT_PITCH, H); for (let d = 0; d < 10; d++) s.glyph(d, String(d), 0, DIGIT_Y, 2); return s.png(); }
function iconSheet(icons, cellH, mode) {   // icons: [P x P RGBA], ICON_Y/K rows down a cell cellH tall
    const { K, perRow } = ICON_MODE[mode], P = ICON_BOX / K;
    const rows = Math.max(1, Math.ceil(icons.length / perRow)), s = sheet(perRow, rows, P, cellH);
    icons.forEach((ic, n) => { for (let i = 0; i < P * P; i++) if (ic[i * 4 + 3]) s.put(n, i % P, ICON_Y / K + Math.floor(i / P), [ic[i * 4], ic[i * 4 + 1], ic[i * 4 + 2], ic[i * 4 + 3]]); });
    return { png: s.png(), rows };
}
const iconInk = (ic, P) => { let w = 0; for (let i = 0; i < P * P; i++) if (ic[i * 4 + 3]) w = Math.max(w, (i % P) + 1); return w; };

// Minecraft's sizes for a picture glyph: drawn at height/cellHeight per picture pixel, and it moves the
// pen by round(width to its last coloured column * that) + 1.
const glyphAdvance = (widthPx, scale) => Math.floor(0.5 + widthPx * scale) + 1;

// Where the box goes for these settings: { size, y, s, a, cell, font }
export function hudSpot(cfg) {
    const near = (list, v) => list.reduce((b, x) => Math.abs(x - v) < Math.abs(b - v) ? x : b, list[0]);
    const size = near(SIZES, cfg.boxSize), y = near(HEIGHTS, cfg.boxY), s = size / 100;
    const top = -y - BOX_H * s / 2;                    // GUI pixels from the middle of the screen, + is down
    // the title's top line is 40 GUI pixels above the middle and drawn at 4x: a glyph's top is (7 - ascent) * 4 below that
    let a = Math.round(7 - (top + 40) / 4), cell = CELLS[0];
    if (a > CELLS[0] * s / 4) cell = CELLS[1];
    a = Math.min(a, Math.round(cell * s / 4));
    return { size, y, s, a, cell, font: `gifthype:tp/s${size}_y${y + 100}` };
}

// space glyphs: one character for every quarter unit from -64 to +64 (Minecraft's commands from Gift
// Hype can only be about 1,400 characters long, so each gap must be a single character)
const SPACE_MAX = 64;
const spaceChar = q => String.fromCharCode(CH.space + q + SPACE_MAX * 4);        // q: quarter units
function space(units) {
    let q = Math.round(units * 4), out = '';
    while (Math.abs(q) > SPACE_MAX * 4) { const step = Math.sign(q) * SPACE_MAX * 4; out += spaceChar(step); q -= step; }
    return q ? out + spaceChar(q) : out;
}

// ---- the pack (built when the world opens: block pictures come from that Minecraft) ----
let current = null, lastMissing = null;
// why the last "teleported" box had no picture (for the activity log), then forgets it
export const hudMissing = () => { const m = lastMissing; lastMissing = null; return m; };
// what the pack has, for the activity log when the world opens
export const hudInfo = () => current && { pictures: current.iconIndex.size, size: current.iconSize, jar: current.jar, mode: current.iconMode };          // { data, sha1, id, iconFont, iconIndex: Map(blockId -> {n, ink}) }
const built = new Map();
export function hudPack() { return current || buildPack({}); }
function buildPack({ cfg, version }) {
    const spot = cfg ? hudSpot(cfg) : null;
    let reader = null;
    let jarFile = null;
    try { jarFile = findClientJar(version); if (jarFile && spot) reader = makeIconReader(jarFile); } catch { reader = null; }
    const mode = cfg?.icon3d === false ? 'flat' : '3d', { K, perRow } = ICON_MODE[mode], P = ICON_BOX / K;
    const key = `${spot?.size || ''}|${mode}|${reader ? version || 'any' : 'none'}`;
    if (built.has(key)) return built.get(key);

    const files = [];
    const add = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
    add('pack.mcmeta', { pack: { description: 'Gift Hype: the Chat Teleport box', pack_format: 15, supported_formats: [15, 999], min_format: 15, max_format: 999 } });
    try { add('pack.png', fs.readFileSync(path.join(ROOT, 'public', 'icon.png'))); } catch { }
    for (const h of CELLS) {
        add(`assets/gifthype/textures/hud/box${h}.png`, boxSheet(h));
        ROWS.forEach((y, r) => add(`assets/gifthype/textures/hud/text${r}_${h}.png`, textSheet(y, h)));
        add(`assets/gifthype/textures/hud/digits${h}.png`, digitSheet(h));
    }
    // block pictures: for the box's size when the world opened, at every height (they're big; at another
    // size it shows without until you join again)
    const iconIndex = new Map();
    let iconRows = 0;
    const iconCells = new Set();
    // a picture cell: 2 rows, the 16-row picture, then see-through rows so it can sit as high as the box
    // (Minecraft wants ascent <= height); a whole number of rows that makes a whole-number height
    const iconHeight = (c, p) => c * K * p.s / 4;
    const iconCell = p => { let c = Math.max(ICON_Y / K + P, Math.ceil(4 * p.a / (K * p.s))); while (iconHeight(c, p) % 1 || iconHeight(c, p) < p.a) c++; return c; };
    if (reader) {
        const ids = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'chatteleport-targets.json'), 'utf8')).blocks);
        for (const kind of ['structure', 'biome']) for (const n of ['village', 'trial_chambers', 'ancient_city', 'stronghold', 'fortress', 'bastion', 'mansion', 'monument', 'desert_pyramid', 'jungle', 'igloo', 'shipwreck', 'ruined_portal', 'end_city', 'mineshaft', 'outpost', 'trail_ruins', 'buried_treasure', 'ocean_ruin', 'swamp_hut', 'nether_fossil',
            'crimson', 'warped', 'soul', 'basalt', 'nether', 'end', 'deep_dark', 'dripstone', 'lush', 'mushroom', 'cherry', 'pale', 'badlands', 'desert', 'stony', 'frozen', 'snow', 'ocean', 'swamp', 'mangrove', 'jungle', 'dark_forest', 'birch', 'taiga', 'savanna', 'forest', 'plains']) {
            const b = iconBlockFor({ kind, filter: `minecraft:${n}` }, reader); if (b) ids.add(b);
        }
        const icons = [];
        const same = new Map();                        // blocks with the same picture share one
        for (const id of ids) {
            const ic = mode === '3d' ? reader.icon3d(id) : reader.icon(id); if (!ic) continue;
            const h = crypto.createHash('sha1').update(ic).digest('hex');
            if (!same.has(h)) { same.set(h, { n: icons.length, ink: iconInk(ic, P) }); icons.push(ic); }
            iconIndex.set(id, same.get(h));
        }
        if (icons.length) for (const y of HEIGHTS) {
            const c = iconCell(hudSpot({ boxSize: spot.size, boxY: y }));
            if (iconCells.has(c)) continue;
            iconCells.add(c);
            const s = iconSheet(icons, c, mode); iconRows = s.rows;
            add(`assets/gifthype/textures/hud/icons${c}.png`, s.png);
        }
    }
    const advances = {};
    for (let q = -SPACE_MAX * 4; q <= SPACE_MAX * 4; q++) if (q) advances[spaceChar(q)] = q / 4;
    const run = (first, n) => Array.from({ length: n }, (_, i) => String.fromCharCode(first + i)).join('');
    for (const size of SIZES) for (const y of HEIGHTS) {
        const p = hudSpot({ boxSize: size, boxY: y });
        const height = Math.round(p.cell * p.s / 4);
        const bmp = (file, chars) => ({ type: 'bitmap', file: `gifthype:hud/${file}.png`, height, ascent: p.a, chars });
        const providers = [
            { type: 'space', advances },
            bmp(`box${p.cell}`, [run(CH.box, 3)]),
            ...ROWS.map((_, r) => bmp(`text${r}_${p.cell}`, [run(CH.text + r * 64, CHARS.length)])),
            bmp(`digits${p.cell}`, [run(CH.digit, 10)]),
        ];
        if (iconIndex.size && spot && size === spot.size) {
            const c = iconCell(p);
            providers.push({ type: 'bitmap', file: `gifthype:hud/icons${c}.png`, height: Math.round(iconHeight(c, p)), ascent: p.a,
                chars: Array.from({ length: iconRows }, (_, r) => run(CH.icon + r * perRow, perRow)) });
        }
        add(`assets/gifthype/font/tp/s${size}_y${y + 100}.json`, { providers });
    }
    const data = zip(files);
    const sha1 = crypto.createHash('sha1').update(data).digest('hex');
    const h = sha1.slice(0, 32);
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const pack = { data, sha1, id, iconSize: iconIndex.size ? spot.size : null, iconIndex, iconK: K, iconMode: mode, reader, jar: reader ? path.basename(jarFile) : null };
    built.set(key, pack);
    return pack;
}

// server.properties lines for the hidden server (Gift Hype serves the pack on its own port). cfg: Chat
// Teleport's settings (where the box goes), version: the world's Minecraft (for the block pictures).
export function hudProps(port, cfg, version) {
    current = buildPack({ cfg, version });
    return [`resource-pack=http://127.0.0.1:${port}/mc/gifthype-hud.zip`, `resource-pack-sha1=${current.sha1}`, `resource-pack-id=${current.id}`,
        'require-resource-pack=false', 'resource-pack-prompt={"text":"Gift Hype: the Chat Teleport box"}'];
}

// The title text for the box. what: { left } for the countdown; { done: true, target, away } after a
// teleport (target: Chat Teleport's { kind, filter, label }); { looking: true } while it searches;
// { none: true } when nothing was found.
// The pieces are laid out left to right from the box's left edge, with one gap character before each to
// put it exactly where it goes; the last gap centres it all where the settings put it.
export function hudTitle(cfg, what) {
    const p = hudSpot(cfg), u = p.s / 4;                       // title units per picture pixel
    const parts = [];                                          // [text, colour]
    let pen = 0;                                               // where Minecraft's pen is, in title units
    const at = (xPx, ch, widthPx, colour = '#FFFFFF', scale = u) => {
        const gap = Math.round((xPx * u - pen) * 4) / 4;
        parts.push([space(gap) + ch, colour]);
        pen += gap + glyphAdvance(widthPx, scale);
    };
    const write = (str, xPx, row, colour) => [...str].forEach((c, i) => {
        const k = CHARS.indexOf(c); if (k < 0 || !inkCols(c)) return;
        at(xPx + i * 6, String.fromCharCode(CH.text + ROW[row] * 64 + k), inkCols(c), colour);
    });
    let W = MIN_W;
    const content = [];
    if (what.left != null) {
        const n = String(Math.max(0, Math.min(999, what.left)));
        content.push(() => write('TELEPORT IN', Math.round((W - inkWidth('TELEPORT IN')) / 2), 'label', COL.label));
        const w = n.length * DIGIT_PITCH - 2, x0 = Math.round((W - w) / 2);
        content.push(() => [...n].forEach((d, i) => at(x0 + i * DIGIT_PITCH, String.fromCharCode(CH.digit + +d), inkCols(d) * 2, what.left <= 5 ? COL.soon : COL.digits)));
    } else if (what.done) {
        const pack = current;
        const block = pack?.reader && what.target ? iconBlockFor(what.target, pack.reader) : null;
        const icon = block && pack.iconSize === p.size ? pack.iconIndex.get(block) : null;
        if (block && !icon) lastMissing = pack.iconSize == null ? 'no-pictures' : pack.iconSize !== p.size ? 'other-size' : 'no-picture';
        let name = String(what.target?.label || 'TELEPORTED').toUpperCase().replace(/[^A-Z0-9 !.'-]/g, ' ').replace(/\s+/g, ' ').trim();
        if (name.length > 24) name = name.slice(0, 23).trim() + '.';
        const away = what.away ? `${what.away} BLOCK${what.away === 1 ? '' : 'S'} AWAY` : 'TELEPORTED!';
        const x0 = icon ? ICON_X + 32 + 6 : 8;
        W = Math.ceil(Math.max(96, x0 + Math.max(inkWidth(name), inkWidth(away)) + 8) / CAP) * CAP;   // whole slices (overlaps would show)
        if (icon) content.push(() => at(ICON_X, String.fromCharCode(CH.icon + icon.n), icon.ink, '#FFFFFF', pack.iconK * u));
        content.push(() => write(name, x0, 'name', COL.name));
        content.push(() => write(away, x0, 'away', COL.away));
    } else if (what.looking) {
        content.push(() => write('LOOKING...', Math.round((W - inkWidth('LOOKING...')) / 2), 'mid', COL.label));
    } else {
        content.push(() => write('NOTHING FOUND', Math.round((W - inkWidth('NOTHING FOUND')) / 2), 'mid', COL.none));
    }
    // the box: left edge, middle slices, right edge
    at(0, String.fromCharCode(CH.box), CAP);
    for (let x = CAP; x < W - CAP; x += CAP) at(Math.min(x, W - 2 * CAP), String.fromCharCode(CH.box + 1), CAP);
    at(W - CAP, String.fromCharCode(CH.box + 2), CAP);
    content.forEach(f => f());
    const dx = Math.round(cfg.boxX * 1.5 / 4 * 2) / 2;           // left/right: up to 150 GUI pixels, in title units
    parts.push([space(W * u - 2 * dx - pen), '#FFFFFF']);
    // join neighbours of the same colour
    const merged = [];
    for (const [t, c] of parts) { const l = merged[merged.length - 1]; if (l && l[1] === c) l[0] += t; else merged.push([t, c]); }
    const esc = s => s.replace(/[^\x20-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    return `{"text":"","font":"${p.font}","shadow_color":0,"extra":[${merged.map(([t, c]) => `{"text":"${esc(t)}","color":"${c}"}`).join(',')}]}`;
}

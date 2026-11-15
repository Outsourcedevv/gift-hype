// Draws Unbound's icon (a U whose right side breaks out upwards as an arrow, on a violet-to-cyan tile) as public/icon.png and icon.ico.
// Run once with: node make-icon.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const segDist = (x, y, x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
};
function draw(size) {
    const SS = 4, W = size * SS;
    const px = new Float64Array(size * size * 4);
    const inRound = (x, y, x0, y0, x1, y1, r) => {
        if (x < x0 || x > x1 || y < y0 || y > y1) return false;
        const cx = Math.max(x0 + r, Math.min(x1 - r, x)), cy = Math.max(y0 + r, Math.min(y1 - r, y));
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    };
    // thicker lines on the small sizes, so it still reads at 16 px
    const T = size <= 32 ? 0.05 : 0.038;
    for (let sy = 0; sy < W; sy++) for (let sx = 0; sx < W; sx++) {
        const x = (sx + 0.5) / W, y = (sy + 0.5) / W; // 0..1
        let c = null;
        if (inRound(x, y, 0.02, 0.02, 0.98, 0.98, 0.24)) {
            // violet (bottom left) to cyan (top right), with a soft light in the top left
            const t = Math.max(0, Math.min(1, (x + (1 - y)) / 2));
            c = [124 + (34 - 124) * t, 92 + (211 - 92) * t, 255 + (238 - 255) * t, 255];
            const glow = Math.max(0, 1 - Math.hypot(x - 0.25, y - 0.2) / 0.6) * 0.18;
            c = c.map((v, k) => k < 3 ? v + (255 - v) * glow : v);
            // a bold U whose right side shoots up past the top into an arrow
            const W2 = T * 1.5, ax = 0.33, bx = 0.67, cy = 0.56, r = 0.17;
            const arc = y >= cy && Math.abs(Math.hypot(x - 0.5, y - cy) - r) <= W2;
            const left = Math.abs(x - ax) <= W2 && y >= 0.3 && y <= cy;
            const right = Math.abs(x - bx) <= W2 && y >= 0.2 && y <= cy;
            const head = segDist(x, y, bx, 0.16, bx - 0.14, 0.3) <= W2 || segDist(x, y, bx, 0.16, bx + 0.14, 0.3) <= W2;
            const ring = arc || left, arrow = right || head;
            if (ring || arrow) c = [255, 255, 255, 255];
        }
    if (!c) continue;
        const i = (Math.floor(sy / SS) * size + Math.floor(sx / SS)) * 4;
        for (let k = 0; k < 3; k++) px[i + k] += c[k] * c[3] / 255;
        px[i + 3] += c[3];
    }
    const out = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const a = px[i * 4 + 3] / (SS * SS);
        for (let k = 0; k < 3; k++) out[i * 4 + k] = a ? Math.round(px[i * 4 + k] / (SS * SS) / (a / 255)) : 0;
        out[i * 4 + 3] = Math.round(a);
    }
    return out;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function png(size) {
    const rgba = draw(size);
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(png);
fs.writeFileSync(path.join(__dirname, 'public', 'icon.png'), pngs[sizes.indexOf(256)]);
// .ico with PNG images inside (Windows Vista and newer)
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
});
fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...dir, ...pngs]));
console.log('icon done');

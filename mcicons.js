// Pictures of blocks for Chat Teleport's "teleported to" box, taken from your own Minecraft (the game's
// .jar in .minecraft/versions). Each block becomes a flat 16x16 picture the way its side looks (grass gets
// its green, leaves their colour); structures and biomes use a block that stands for them. Nothing is
// downloaded or shared: the pictures only go into the pack your own game loads from Gift Hype.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// ---- read files out of a .jar (a zip) ----
export function openZip(file) {
    const buf = fs.readFileSync(file);
    let e = buf.length - 22;
    while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not a zip');
    const n = buf.readUInt16LE(e + 10);
    let p = buf.readUInt32LE(e + 16);
    const entries = new Map();
    for (let i = 0; i < n; i++) {
        const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
        const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
        entries.set(buf.toString('utf8', p + 46, p + 46 + nameLen), { method, size, off });
        p += 46 + nameLen + extra + comment;
    }
    const read = name => {
        const en = entries.get(name);
        if (!en) return null;
        const start = en.off + 30 + buf.readUInt16LE(en.off + 26) + buf.readUInt16LE(en.off + 28);
        const raw = buf.subarray(start, start + en.size);
        return en.method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    };
    return { read, has: name => entries.has(name), names: () => entries.keys() };
}

// ---- PNG decode (8-bit RGBA / RGB / palette / grey, non-interlaced: all vanilla textures) ----
function decodePng(buf) {
    let p = 8, w, h, depth, type, plte, trns; const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
        if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; }
        else if (t === 'PLTE') plte = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d);
        p += 12 + len;
    }
    if (depth !== 8 && type !== 3) throw new Error('png depth');
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    const bpp = type === 3 ? 1 : ch;
    const rowBits = type === 3 ? w * depth : w * ch * 8, stride = Math.ceil(rowBits / 8);
    const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = y && x >= bpp ? px[o - stride + x - bpp] : 0;
            let v = src[x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            px[o + x] = v & 255;
        }
    }
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, o = y * stride;
        if (type === 6) px.copy(out, i, o + x * 4, o + x * 4 + 4);
        else if (type === 2) { px.copy(out, i, o + x * 3, o + x * 3 + 3); out[i + 3] = trns && trns.readUInt16BE(0) === out[i] && trns.readUInt16BE(2) === out[i + 1] && trns.readUInt16BE(4) === out[i + 2] ? 0 : 255; }
        else if (type === 0) { out[i] = out[i + 1] = out[i + 2] = px[o + x]; out[i + 3] = trns && trns.readUInt16BE(0) === px[o + x] ? 0 : 255; }
        else if (type === 4) { out[i] = out[i + 1] = out[i + 2] = px[o + x * 2]; out[i + 3] = px[o + x * 2 + 1]; }
        else {   // palette
            const bitPos = x * depth, byte = px[o + (bitPos >> 3)], idx = depth === 8 ? byte : (byte >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1);
            out[i] = plte[idx * 3]; out[i + 1] = plte[idx * 3 + 1]; out[i + 2] = plte[idx * 3 + 2]; out[i + 3] = trns && idx < trns.length ? trns[idx] : 255;
        }
    }
    return { w, h, px: out };
}

// ---- which Minecraft to read ----
const MC_DIR = path.join(process.env.APPDATA || '', '.minecraft');
export function findClientJar(version) {
    const dir = path.join(MC_DIR, 'versions');
    const jarOf = v => path.join(dir, v, `${v}.jar`);
    if (version && fs.existsSync(jarOf(version))) return jarOf(version);
    let best = null, bestTime = 0;     // otherwise the newest one installed (textures barely change)
    try {
        for (const v of fs.readdirSync(dir)) {
            const j = jarOf(v);
            try { const t = fs.statSync(j).mtimeMs; if (t > bestTime && fs.statSync(j).size > 10e6) { best = j; bestTime = t; } } catch { }
        }
    } catch { }
    return best;
}

const GRASS = [0x91, 0xBD, 0x59], FOLIAGE = [0x77, 0xAB, 0x2F], WATER = [0x3F, 0x76, 0xE4];

// A block's flat picture: 16x16 RGBA, or null if it has none.
export function makeIconReader(jarFile) {
    const z = openZip(jarFile);
    const json = p => { try { const b = z.read(p); return b ? JSON.parse(b.toString('utf8')) : null; } catch { return null; } };
    const tex = new Map();
    const texture = ref => {           // 'minecraft:block/stone' -> first 16x16 frame
        const id = ref.replace(/^minecraft:/, '');
        if (tex.has(id)) return tex.get(id);
        let img = null;
        try {
            const b = z.read(`assets/minecraft/textures/${id}.png`);
            if (b) {
                const d = decodePng(b), size = d.w, out = Buffer.alloc(16 * 16 * 4);
                for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
                    const sx = Math.floor(x * size / 16), sy = Math.floor(y * size / 16);
                    d.px.copy(out, (y * 16 + x) * 4, (sy * d.w + sx) * 4, (sy * d.w + sx) * 4 + 4);
                }
                img = out;
            }
        } catch { }
        tex.set(id, img);
        return img;
    };
    const raws = new Map();
    const rawTexture = ref => {        // the whole picture (chests' fold-out textures)
        const id = ref.replace(/^minecraft:/, '');
        if (!raws.has(id)) { let d = null; try { const b = z.read(`assets/minecraft/textures/${id}.png`); if (b) d = decodePng(b); } catch { } raws.set(id, d); }
        return raws.get(id);
    };
    const models = new Map();
    function model(name) {             // textures merged down the parent chain, elements from the nearest model with them
        name = name.replace(/^minecraft:/, '');
        if (models.has(name)) return models.get(name);
        const j = json(`assets/minecraft/models/${name}.json`) || {};
        const parent = j.parent && !String(j.parent).startsWith('builtin') ? model(j.parent) : { textures: {}, elements: null };
        const m = { textures: { ...parent.textures, ...(j.textures || {}) }, elements: j.elements || parent.elements, builtin: String(j.parent || '').startsWith('builtin') };
        models.set(name, m);
        return m;
    }
    const resolve = (m, ref, depth = 0) => {
        if (ref && typeof ref === 'object') ref = ref.sprite;
        if (!ref || typeof ref !== 'string' || depth > 8) return null;
        return ref.startsWith('#') ? resolve(m, m.textures[ref.slice(1)], depth + 1) : ref;
    };
    function itemModel(def) {          // the plain model inside an item definition
        if (!def || typeof def !== 'object') return null;
        if (def.type === 'minecraft:model') return { model: def.model, tints: def.tints || [] };
        if (def.type === 'minecraft:special') return { model: def.base, tints: [] };
        for (const k of ['fallback', 'on_false', 'on_true', 'model']) { const r = itemModel(def[k]); if (r) return r; }
        if (def.type === 'minecraft:composite' && Array.isArray(def.models)) for (const x of def.models) { const r = itemModel(x); if (r) return r; }
        for (const arr of [def.cases, def.entries]) if (Array.isArray(arr)) for (const c of arr) { const r = itemModel(c.model); if (r) return r; }
        return null;
    }
    const tintColor = (t, id) => {
        if (!t) return null;
        if (t.type === 'minecraft:constant') { const v = t.value >>> 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
        if (t.type === 'minecraft:grass') return GRASS;
        if (t.type === 'minecraft:foliage' || t.type === 'minecraft:dry_foliage') return FOLIAGE;
        if (/water/.test(id)) return WATER;
        return null;
    };
    const draw = (canvas, img, tint) => {
        for (let i = 0; i < 256; i++) {
            const a = img[i * 4 + 3] / 255;
            if (!a) continue;
            for (let c = 0; c < 3; c++) {
                const v = tint ? img[i * 4 + c] * tint[c] / 255 : img[i * 4 + c];
                canvas[i * 4 + c] = Math.round(v * a + canvas[i * 4 + c] * (1 - a));
            }
            canvas[i * 4 + 3] = Math.max(canvas[i * 4 + 3], img[i * 4 + 3]);
        }
    };
    // its item, else the same thing on a floor (wall banners, wall heads), else how the block itself is drawn
    function modelFor(id) {
        const def = json(`assets/minecraft/items/${id}.json`) || json(`assets/minecraft/items/${id.replace('wall_', '')}.json`);
        let im = itemModel(def?.model);
        if (!im) {
            const bs = json(`assets/minecraft/blockstates/${id}.json`) || {};
            const first = v => Array.isArray(v) ? v[0] : v;
            const m0 = bs.variants ? first(Object.values(bs.variants)[0])?.model : bs.multipart ? first(bs.multipart[0]?.apply)?.model : null;
            im = { model: m0 || `minecraft:block/${id}`, tints: [] };
        }
        return { m: model(im.model), im };
    }
    const faceTint = (f, im, id) => {
        if (f.tintindex == null) return null;
        return tintColor(im.tints[f.tintindex], id) || (/grass|fern|vine|sugar|lily/.test(id) ? GRASS : /leaves/.test(id) ? FOLIAGE : /water/.test(id) ? WATER : null);
    };
    const cache = new Map();
    function icon(id) {
        if (cache.has(id)) return cache.get(id);
        let out = null;
        try {
            const { m, im } = modelFor(id);
            const canvas = Buffer.alloc(16 * 16 * 4);
            let drew = false;
            if (m.textures.layer0) {                       // a flat item picture (doors, flowers...)
                for (let l = 0; l < 4; l++) {
                    const ref = resolve(m, m.textures['layer' + l]); if (!ref) continue;
                    const img = texture(ref); if (img) { draw(canvas, img, tintColor(im.tints[l], id)); drew = true; }
                }
            } else if (m.elements) {                       // a block: its north faces, layered, tinted where Minecraft tints them
                for (const el of m.elements) {
                    const f = el.faces?.north || el.faces?.south;
                    const ref = f && resolve(m, f.texture); if (!ref) continue;
                    const img = texture(ref); if (!img) continue;
                    let tint = f.tintindex != null ? tintColor(im.tints[f.tintindex], id) : null;
                    if (f.tintindex != null && !tint) tint = /grass|fern|vine|sugar|lily/.test(id) ? GRASS : /leaves/.test(id) ? FOLIAGE : /water/.test(id) ? WATER : null;
                    draw(canvas, img, tint); drew = true;
                }
            }
            if (!drew) {                                   // chests, beds, signs...: what their particles look like
                const ref = resolve(m, m.textures.particle) || resolve(model(`minecraft:block/${id}`), model(`minecraft:block/${id}`).textures.particle);
                const img = ref && texture(ref);
                if (img) { draw(canvas, img, null); drew = true; }
            }
            if (drew && !m.textures.layer0 && /water|bubble_column/.test(id)) for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) canvas[i * 4 + c] = Math.round(canvas[i * 4 + c] * WATER[c] / 255);
            if (drew && canvas.some((v, i) => i % 4 === 3 && v > 0)) out = canvas;
        } catch { }
        cache.set(id, out);
        return out;
    }

    // A 3D picture, 32x32, the way the inventory shows a block: seen from above, its north face on the
    // left and west face on the right, shaded like Minecraft (top lightest). Every part of the model is
    // drawn (stairs, slabs, fences...), nearest on top. Things that are flat in the inventory (flowers,
    // doors, torches) and things Minecraft draws in code (chests, beds) stay flat, at 2x.
    const cache3 = new Map();
    function icon3d(id) {
        if (cache3.has(id)) return cache3.get(id);
        const flat = () => {
            const f = icon(id); if (!f) return null;
            const o = Buffer.alloc(32 * 32 * 4);
            for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) f.copy(o, (y * 32 + x) * 4, ((y >> 1) * 16 + (x >> 1)) * 4, ((y >> 1) * 16 + (x >> 1)) * 4 + 4);
            return o;
        };
        let out = null;
        try {
            const { m, im } = modelFor(id);
            // chests are drawn by Minecraft in code: build one from its fold-out texture (lid, bottom, latch)
            const CHESTS = { chest: 'normal', trapped_chest: 'trapped', ender_chest: 'ender' };
            let elements = m.elements;
            if (CHESTS[id]) {
                const T = rawTexture(`entity/chest/${CHESTS[id]}`);
                if (T) {
                    const k = T.w / 64;                              // texture scale (64 wide normally)
                    const region = (x0, y0, w, h, flip) => (sx, ty) => {
                        const x = Math.floor((x0 + Math.min(0.999, sx) * w) * k), y = Math.floor((y0 + Math.min(0.999, flip ? 1 - ty : ty) * h) * k);
                        const i = (y * T.w + x) * 4; return [T.px[i], T.px[i + 1], T.px[i + 2], T.px[i + 3]];
                    };
                    elements = [
                        { from: [1, 0, 1], to: [15, 10, 15], sample: { up: region(28, 19, 14, 14), north: region(42, 33, 14, 10, true), west: region(0, 33, 14, 10, true) } },
                        { from: [1, 9, 1], to: [15, 14, 15], sample: { up: region(28, 0, 14, 14), north: region(42, 14, 14, 5, true), west: region(0, 14, 14, 5, true) } },
                        { from: [7, 7, 0], to: [9, 11, 1], sample: { up: region(1, 0, 2, 1), north: region(1, 1, 2, 4, true), west: region(0, 1, 1, 4, true) } },
                    ];
                }
            }
            // water and lava have no model: a full cube of their still texture
            if (!elements && /^(water|lava)$/.test(id)) {
                const tex = `minecraft:block/${id}_still`;
                elements = [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: tex }, north: { texture: tex }, west: { texture: tex } } }];
            }
            if (!m.textures.layer0 && elements && (!m.builtin || CHESTS[id])) {
                const S = 32, img = Buffer.alloc(S * S * 4), depth = new Float32Array(S * S).fill(-1e9);
                const water = /water|bubble_column/.test(id);
                let drew = false;
                for (const el of elements) {
                    if (el.rotation && el.rotation.angle) continue;           // tilted parts (plants' crossed planes): skip
                    const [fx, fy, fz] = el.from, [tx, ty, tz] = el.to;
                    const faces = [   // name, shade, world point for (s, t) across the face, default uv
                        ['up', 1.0, (s, t) => [fx + s * (tx - fx), ty, fz + t * (tz - fz)], [fx, fz, tx, tz]],
                        ['north', 0.8, (s, t) => [tx - s * (tx - fx), ty - t * (ty - fy), fz], [16 - tx, 16 - ty, 16 - fx, 16 - fy]],
                        ['west', 0.6, (s, t) => [fx, ty - t * (ty - fy), fz + s * (tz - fz)], [fz, 16 - ty, tz, 16 - fy]],
                    ];
                    for (const [name, shade, at, defUv] of faces) {
                        if (el.sample) {                                     // a part with its own picture (chests)
                            const fn = el.sample[name]; if (!fn) continue;
                            const N = 64;
                            for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
                                const s0 = (i + 0.5) / N, t0 = (j + 0.5) / N, c = fn(s0, t0);
                                if (c[3] < 16) continue;
                                const [x, y, z] = at(s0, t0);
                                const px = Math.floor(16 - x + z), py = Math.floor((32 - x - z) / 2 + (16 - y));
                                if (px < 0 || py < 0 || px >= S || py >= S) continue;
                                const d = -x - z + y, o = py * S + px;
                                if (d < depth[o]) continue;
                                depth[o] = d;
                                for (let q = 0; q < 3; q++) img[o * 4 + q] = Math.round(c[q] * shade);
                                img[o * 4 + 3] = c[3]; drew = true;
                            }
                            continue;
                        }
                        const f = el.faces?.[name]; if (!f) continue;
                        const ref = resolve(m, f.texture), tex = ref && texture(ref); if (!tex) continue;
                        const tint = water ? WATER : faceTint(f, im, id), uv = f.uv || defUv, rot = ((f.rotation || 0) / 90) & 3;
                        const N = 64;
                        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
                            const s0 = (i + 0.5) / N, t0 = (j + 0.5) / N;
                            let s1 = s0, t1 = t0;
                            for (let k = 0; k < rot; k++) [s1, t1] = [t1, 1 - s1];
                            const u = Math.min(15, Math.max(0, Math.floor(uv[0] + s1 * (uv[2] - uv[0])))), v = Math.min(15, Math.max(0, Math.floor(uv[1] + t1 * (uv[3] - uv[1]))));
                            const ti = (v * 16 + u) * 4, a = tex[ti + 3];
                            if (a < 16) continue;
                            const [x, y, z] = at(s0, t0);
                            const px = Math.floor(16 - x + z), py = Math.floor((32 - x - z) / 2 + (16 - y));
                            if (px < 0 || py < 0 || px >= S || py >= S) continue;
                            const d = -x - z + y, o = py * S + px;
                            if (d < depth[o]) continue;
                            depth[o] = d;
                            for (let c = 0; c < 3; c++) img[o * 4 + c] = Math.round(tex[ti + c] * (tint ? tint[c] / 255 : 1) * shade);
                            img[o * 4 + 3] = a;
                            drew = true;
                        }
                    }
                }
                if (drew) out = img;
            }
        } catch { out = null; }
        if (!out) out = flat();
        cache3.set(id, out);
        return out;
    }
    return { icon, icon3d, has: id => z.has(`assets/minecraft/items/${id}.json`) || z.has(`assets/minecraft/blockstates/${id}.json`) };
}

// What block stands for a structure or biome (the first one this Minecraft has)
const STRUCTURE_ICON = [
    [/village_desert/, 'cut_sandstone'], [/village_snowy/, 'snow_block'], [/village_taiga/, 'spruce_planks'], [/village_savanna/, 'acacia_planks'], [/village/, 'bell', 'hay_block'],
    [/trial/, 'trial_spawner', 'copper_block'], [/ancient_city/, 'sculk_shrieker', 'sculk'], [/stronghold/, 'end_portal_frame', 'stone_bricks'],
    [/fortress/, 'nether_bricks'], [/bastion/, 'gilded_blackstone'], [/mansion/, 'dark_oak_planks'], [/monument/, 'prismarine_bricks'],
    [/desert_pyramid/, 'chiseled_sandstone'], [/jungle/, 'mossy_cobblestone'], [/igloo/, 'snow_block'], [/shipwreck/, 'oak_planks'],
    [/ruined_portal/, 'crying_obsidian'], [/end_city/, 'purpur_block'], [/mineshaft/, 'rail'], [/outpost/, 'dark_oak_log'],
    [/trail_ruins/, 'suspicious_gravel'], [/buried_treasure/, 'chest'], [/ocean_ruin/, 'prismarine'], [/swamp_hut/, 'cauldron', 'spruce_planks'],
    [/nether_fossil/, 'bone_block'], [/./, 'chest'],
];
const BIOME_ICON = [
    [/crimson/, 'crimson_nylium'], [/warped/, 'warped_nylium'], [/soul/, 'soul_sand'], [/basalt/, 'basalt'], [/nether/, 'netherrack'],
    [/end|void/, 'end_stone'], [/deep_dark/, 'sculk'], [/dripstone/, 'dripstone_block'], [/lush/, 'moss_block'], [/mushroom/, 'mycelium'],
    [/cherry/, 'cherry_leaves'], [/pale/, 'pale_oak_leaves'], [/badlands|mesa/, 'red_sand'], [/desert|beach/, 'sand'], [/stony_shore|stony|peaks|windswept_gravelly/, 'stone'],
    [/frozen_ocean|ice|frozen/, 'packed_ice'], [/snow|grove|slopes/, 'snow_block'], [/ocean|river/, 'water'], [/swamp/, 'lily_pad'],
    [/mangrove/, 'mangrove_leaves'], [/jungle|bamboo/, 'jungle_leaves'], [/dark_forest/, 'dark_oak_leaves'], [/birch/, 'birch_leaves'],
    [/taiga|spruce/, 'spruce_leaves'], [/savanna/, 'acacia_leaves'], [/forest|grove/, 'oak_leaves'], [/./, 'grass_block'],
];
// For a Chat Teleport target ({ kind, filter }), the block id whose picture to show
export function iconBlockFor(t, reader) {
    const id = String(t.filter || '').replace(/^#?minecraft:/, '');
    const pick = table => { for (const [re, ...ids] of table) if (re.test(id)) for (const b of ids) if (reader.has(b)) return b; return null; };
    if (t.kind === 'place') return (t.filter === 'end_ship' ? ['purpur_block'] : ['dragon_egg', 'bedrock']).find(b => reader.has(b)) || null;
    if (t.kind === 'structure') return pick(STRUCTURE_ICON);
    if (t.kind === 'biome') return pick(BIOME_ICON);
    if (!t.filter?.startsWith('#')) return id;
    // a group of blocks (#logs, #gold_ores...): one of them
    const stem = id.replace(/ies$/, 'y').replace(/s$/, '');
    for (const c of [stem, `oak_${stem}`, `white_${stem}`, `stone_${stem}`, id]) if (reader.has(c)) return c;
    return null;
}

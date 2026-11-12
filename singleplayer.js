// Singleplayer worlds have no RCON, so for them Gift Hype:
//  1. puts a small data pack ("gifthype") into the world that does the big actions from inside the
//     game (nuke, jail, chunk fills, kits, End teleport), and
//  2. types a short command into Minecraft's chat for each gift, like  /function gifthype:nuke {size:40}
// The world needs commands allowed (cheats on), and Minecraft must be the window in front.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const SAVES_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft', 'saves');

export function listWorlds() {
    try {
        return fs.readdirSync(SAVES_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory() && fs.existsSync(path.join(SAVES_DIR, d.name, 'level.dat')))
            .map(d => ({ name: d.name, played: fs.statSync(path.join(SAVES_DIR, d.name, 'level.dat')).mtimeMs, installed: fs.existsSync(path.join(SAVES_DIR, d.name, 'datapacks', 'gifthype', 'pack.mcmeta')) }))
            .sort((a, b) => b.played - a.played);
    } catch { return []; }
}

const T = (t, color) => `{"text":${JSON.stringify(t)},"color":"${color}","bold":true}`;
const ENCH = e => `[enchantments={${Object.entries(e).map(([k, v]) => `${k}:${v}`).join(',')}}]`;

// ----- The crater shape (also used by the server version in minecraft-presets.js) -----
// A flat floor at y=-20, `size` blocks out from the middle. Around it the ground curves up gently
// for a bit, then the wall rises as steep as you can still climb: every layer is at least one
// block wider than the one under it, so there's always a block to jump up onto. The same slope
// carries on for 24 blocks above where the bomb landed, so hills and trees at the rim are cut
// into it too instead of leaving a cliff. Sea level landing, size 40: the hole is about 290
// blocks across (18 chunks).
export const CRATER_FLOOR = -20;
const MAX_DISC = 220, ABOVE = 24;
export function craterRadius(size, h) {                 // h = blocks above the floor
    return Math.min(MAX_DISC, size + 1.1 * h + 12 * Math.sqrt(Math.min(h, 12) / 12));
}
// one flat circle of air, radius r, as fill commands around ~ ~ ~ (rows of the same width share a fill)
export function discFills(r) {
    const ri = Math.floor(r), out = [];
    let start = -ri, width = Math.floor(Math.sqrt(Math.max(0, r * r - ri * ri)));
    for (let dz = -ri + 1; dz <= ri + 1; dz++) {
        const w = dz <= ri ? Math.floor(Math.sqrt(r * r - dz * dz)) : -1;
        if (w === width) continue;
        out.push([-width, start, width, dz - 1]);
        start = dz; width = w;
    }
    return out;
}
// The layers to dig for a bomb that landed at height y, top first: [height, radius]
export function craterLayers(size, y) {
    const layers = [];
    for (let h = y + ABOVE; h >= CRATER_FLOOR; h--) layers.push([h, craterRadius(size, h - CRATER_FLOOR)]);
    return layers.filter(([, r]) => r >= 0.5);
}
// In the pack the crater is dug one layer per tick or so while the fireball hides it. A pack can't
// do maths on where the bomb landed, so there's a dig plan for every 4 blocks of landing height.
const DIG_TICKS = 140;
const FORCE_R = 176;   // blocks around ground zero kept loaded while it digs (4 quarters: one forceload takes at most 256 chunks)
const FORCE_BOXES = [[`~-${FORCE_R} ~-${FORCE_R}`, '~-1 ~-1'], [`~ ~-${FORCE_R}`, `~${FORCE_R} ~-1`], [`~-${FORCE_R} ~`, `~-1 ~${FORCE_R}`], ['~ ~', `~${FORCE_R} ~${FORCE_R}`]];
const BUCKETS = Array.from({ length: 84 }, (_, i) => -16 + i * 4);   // landing y -16 .. 316

// ----- shapes made of block displays -----
const num = n => (Math.round(n * 1000) / 1000) + 'f';
const Q0 = [0, 0, 0, 1];
const qAxis = (axis, deg) => { const a = deg * Math.PI / 360, q = [0, 0, 0, Math.cos(a)]; q[axis] = Math.sin(a); return q; };
const qY = deg => qAxis(1, deg), qZ = deg => qAxis(2, deg);
const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qRot = (q, v) => { const u = [q[0], q[1], q[2]], c1 = cross(u, v), c2 = cross(u, c1); return v.map((x, i) => x + 2 * q[3] * c1[i] + 2 * c2[i]); };
// a box of this size, turned by q, with its middle at `center`
const tf = (center, size, q = Q0) => {
    const h = qRot(q, size.map(s => s / 2));
    return `transformation:{left_rotation:[${q.map(num).join(',')}],right_rotation:[0f,0f,0f,1f],translation:[${center.map((c, i) => num(c - h[i])).join(',')}],scale:[${size.map(num).join(',')}]}`;
};
const display = (pos, tags, block, box, extra = '') =>
    `summon minecraft:block_display ${pos} {Tags:[${tags.map(t => `"${t}"`).join(',')}],${extra}view_range:8f,brightness:{sky:15,block:15},block_state:{Name:"minecraft:${block}"},${tf(box.center, box.size, box.q)}}`;
// a round slice (a 2n-sided disc) made of n crossed slabs: radius r, from y up to y+h
const ringBoxes = (r, y, h, n) => Array.from({ length: n }, (_, i) => ({ center: [0, y + h / 2, 0], size: [2 * r, h, 2 * r * Math.tan(Math.PI / (2 * n))], q: qY(i * 180 / n) }));

// The bomb, nose down, 26 blocks long and 7 across: rounded black nose, yellow body with black
// bands, a radiation symbol on all four sides, tapered tail, fins and a tail ring.
const BOMB_R = 3.5, BOMB_DROP = 80;
function bombLines() {
    const lines = [], R = BOMB_R;
    const add = (block, box, tags = ['gh_part'], extra = '') => lines.push(display(`~ ~${BOMB_DROP} ~`, tags, block, box, 'teleport_duration:1,' + extra));
    // body first: it's the piece the fall is tracked by
    ringBoxes(R, 3.6, 14.4, 8).forEach((b, i) => add('yellow_concrete', b, i ? ['gh_part'] : ['gh_part', 'gh_nuke']));
    for (let i = 0; i < 6; i++) {                       // rounded nose
        const r = R * Math.sqrt(1 - (1 - (i + 1) / 6) ** 2);
        ringBoxes(r, i * 0.6, 0.6, r < 2.2 ? 4 : 6).forEach(b => add('black_concrete', b));
    }
    for (const y of [4.4, 15.6]) ringBoxes(R + 0.08, y, 1.2, 8).forEach(b => add('black_concrete', b));   // bands
    for (let i = 0; i < 6; i++) ringBoxes(R - (i + 0.5) * 0.32, 18 + i * 0.8, 0.8, 6).forEach(b => add('black_concrete', b)); // tail taper
    add('black_concrete', { center: [0, 22.5, 0], size: [0.4, 6, 10], q: Q0 });                          // fins
    add('black_concrete', { center: [0, 22.5, 0], size: [10, 6, 0.4], q: Q0 });
    for (let i = 0; i < 8; i++) {                       // tail ring
        const a = i * Math.PI / 4;
        add('yellow_concrete', { center: [4.8 * Math.sin(a), 24.25, 4.8 * Math.cos(a)], size: [4.3, 2.5, 0.3], q: qY(i * 45) });
    }
    // radiation symbol: a dot and three blades, flat on the side of the body, on all four sides
    const k = 0.7, zf = R + 0.14, yc = 10.4, t = 0.12, sym = [];
    sym.push({ center: [0, yc, zf], size: [k, k, t], q: Q0 }, { center: [0, yc, zf], size: [k, k, t], q: qZ(45) });
    for (const deg of [30, 150, 270]) {
        const a = deg * Math.PI / 180;
        for (let j = 0; j < 4; j++) {
            const r0 = k * (0.75 + j * 0.4375), r1 = r0 + k * 0.4375, rm = (r0 + r1) / 2;
            sym.push({ center: [rm * Math.cos(a), yc + rm * Math.sin(a), zf], size: [2 * rm * Math.tan(Math.PI / 6) * 0.95, r1 - r0 + 0.03, t], q: qZ(deg - 90) });
        }
    }
    for (const yaw of [0, 90, 180, 270]) for (const b of sym) add('black_concrete', b, ['gh_part'], `Rotation:[${yaw}f,0f],`);
    return lines;
}

// The blast, as a timeline of ticks after the bomb hits. Everything is made of big glowing block
// displays that grow and move smoothly: a white fireball that swells, turns yellow then orange and
// rises; a stem that climbs under it; a mushroom cap that rolls out on top; a dust ring along the
// ground. Then smoke, embers and a shock wave on top with particles.
const DIE_AT = 120, END_AT = 196;
function blast() {
    const summons = [], events = {};
    const at = (t, line) => (events[t] ||= []).push(line);
    let n = 0;
    // frames: [{t, dur, box?, block?}], the first one is how it starts
    const piece = (block, frames) => {
        const tag = `gh_fx${n++}`;
        summons.push(display('~ ~ ~', ['gh_fx', tag], block, frames[0].box));
        for (const f of frames.slice(1)) {
            const bits = [];
            if (f.box) bits.push('start_interpolation:0', `interpolation_duration:${f.dur}`, tf(f.box.center, f.box.size, f.box.q));
            if (f.block) bits.push(`block_state:{Name:"minecraft:${f.block}"}`);
            at(f.t, `data merge entity @e[type=minecraft:block_display,tag=${tag},limit=1] {${bits.join(',')}}`);
        }
    };
    const ring = (block, sides, frames) => {
        for (let i = 0; i < sides; i++) piece(block, frames.map(f => ({ t: f.t, dur: f.dur, block: f.block, box: f.r ? ringBoxes(f.r, f.y, f.h, sides)[i] : null })));
    };

    // fireball: a ball made of seven round slices
    const SLICES = 7;
    for (let j = 0; j < SLICES; j++) {
        const k = (j + 0.5) / SLICES * 2 - 1, w = Math.sqrt(1 - k * k);
        const ball = (t, dur, y, R, block) => ({ t, dur, block, r: Math.max(0.3, R * w), y: y - R + j * 2 * R / SLICES, h: 2 * R / SLICES });
        ring('white_concrete', 6, [ball(0, 0, 2, 1.5), ball(1, 7, 8, 19), ball(9, 10, 15, 17, 'yellow_concrete'), ball(20, 14, 31, 13, 'orange_concrete'), ball(36, 14, 46, 9), ball(52, 6, 50, 2)]);
    }
    const fireballs = n;
    // stem: a column that climbs, with a mound at the bottom and a flare where it meets the cap
    ring('orange_concrete', 6, [{ t: 0, r: 1, y: 0, h: 1 }, { t: 2, dur: 10, r: 8, y: 0, h: 10 }, { t: 14, dur: 16, r: 7, y: 0, h: 30 }, { t: 32, dur: 18, r: 6, y: 0, h: 44 },
        { t: 44, block: 'light_gray_concrete' }, { t: 60, dur: 60, r: 5.5, y: 0, h: 48 }, { t: 130, dur: 60, r: 3, y: 0, h: 52 }]);
    ring('orange_concrete', 6, [{ t: 0, r: 1, y: 0, h: 1 }, { t: 2, dur: 10, r: 10, y: 0, h: 6 }, { t: 14, dur: 16, r: 10, y: 0, h: 12 },
        { t: 44, block: 'gray_concrete' }, { t: 60, dur: 60, r: 11, y: 0, h: 12 }, { t: 130, dur: 60, r: 12, y: 0, h: 2 }]);
    ring('orange_concrete', 6, [{ t: 0, r: 1, y: 2, h: 0.5 }, { t: 2, dur: 16, r: 4, y: 12, h: 3 }, { t: 20, dur: 14, r: 7, y: 26, h: 5 }, { t: 36, dur: 16, r: 9.5, y: 34, h: 6 },
        { t: 44, block: 'light_gray_concrete' }, { t: 60, dur: 60, r: 10, y: 38, h: 6 }, { t: 130, dur: 60, r: 7, y: 46, h: 2 }]);
    // dust rolling out along the ground
    ring('light_gray_concrete', 6, [{ t: 0, r: 2, y: 0, h: 1 }, { t: 3, dur: 20, r: 22, y: 0, h: 4 }, { t: 30, dur: 60, r: 28, y: 0, h: 3 }, { t: 130, dur: 60, r: 32, y: 0, h: 0.3 }]);
    ring('gray_concrete', 6, [{ t: 0, r: 2, y: 0, h: 1 }, { t: 3, dur: 16, r: 15, y: 0, h: 7 }, { t: 30, dur: 60, r: 17, y: 0, h: 6 }, { t: 130, dur: 60, r: 18, y: 0, h: 0.5 }]);
    // collar around the stem
    ring('light_gray_concrete', 6, [{ t: 0, r: 1, y: 5, h: 0.3 }, { t: 30, dur: 20, r: 11, y: 22, h: 3 }, { t: 60, dur: 60, r: 13, y: 25, h: 3 }, { t: 130, dur: 60, r: 15, y: 28, h: 0.3 }]);
    // the cap: a dome, glowing orange where it curls under, grey rolling out, white on top
    const cap = [[-6, 10, 'orange_concrete'], [-3.5, 17, 'orange_concrete'], [-1, 22, 'gray_concrete'], [1.5, 24, 'gray_concrete'], [4, 24, 'light_gray_concrete'],
        [6.5, 22.5, 'light_gray_concrete'], [9, 20, 'light_gray_concrete'], [11.5, 16, 'white_concrete'], [14, 11, 'white_concrete'], [16.5, 5.5, 'white_concrete']];
    for (const [dy, r, block] of cap) {
        const h = 2.5, glow = block === 'orange_concrete';
        ring(block, 6, [{ t: 0, r: 1, y: 3 + dy * 0.1, h: 0.4 }, { t: 2, dur: 16, r: r * 0.35, y: 18 + dy * 0.45, h: h * 0.5 }, { t: 20, dur: 14, r: r * 0.7, y: 33 + dy * 0.75, h: h * 0.8 },
            { t: 36, dur: 16, r, y: 44 + dy, h }, { t: 60, dur: 60, r: r * 1.12, y: 48 + dy, h }, ...(glow ? [{ t: 95, block: 'gray_concrete' }] : []),
            { t: 130, dur: 60, r: r * 1.25, y: 54 + dy * 0.6, h: h * 0.3 }]);
    }
    for (let i = 0; i < fireballs; i++) at(58, `kill @e[type=minecraft:block_display,tag=gh_fx${i}]`); // the fireball has burnt out inside the cap

    // light and sound
    for (let t = 0; t <= 5; t++) at(t, 'particle minecraft:flash{color:[1.0,1.0,1.0,1.0]} ~ ~10 ~ 0 0 0 0 3 force');
    at(0, 'playsound minecraft:entity.warden.sonic_boom master @a ~ ~ ~ 10 0.5');
    at(0, 'playsound minecraft:entity.lightning_bolt.thunder master @a ~ ~ ~ 10 0.5');
    at(0, 'playsound minecraft:entity.lightning_bolt.impact master @a ~ ~ ~ 10 0.5');
    at(0, 'playsound minecraft:entity.ender_dragon.death master @a ~ ~ ~ 5 0.7');
    at(8, 'playsound minecraft:entity.lightning_bolt.thunder master @a ~ ~ ~ 10 0.3');
    at(12, 'playsound minecraft:entity.ender_dragon.growl master @a ~ ~ ~ 8 0.5');
    at(40, 'playsound minecraft:entity.lightning_bolt.thunder master @a ~ ~ ~ 8 0.3');
    // shock wave: a ring of white racing out along the ground
    for (let t = 1; t <= 24; t++) {
        const r = 4 + t * 3.2;
        for (let i = 0; i < 20; i++) {
            const a = (i + (t % 2) / 2) * Math.PI / 10;
            at(t, `particle minecraft:cloud ~${(r * Math.cos(a)).toFixed(1)} ~2 ~${(r * Math.sin(a)).toFixed(1)} 1 0.6 1 0.05 4 force`);
        }
    }
    // fire and embers up the stem, glowing dust cooling to smoke around the cap, smoke hanging on after
    for (let t = 4; t <= 50; t += 2) {
        at(t, `particle minecraft:flame ~ ~${Math.round(t * 0.8)} ~ 3 ${Math.max(2, Math.round(t * 0.3))} 3 0.05 30 force`);
        at(t, 'particle minecraft:lava ~ ~3 ~ 9 1 9 0 8 force');
    }
    for (let t = 10; t <= 64; t += 4) at(t, `particle minecraft:dust_color_transition{from_color:[1.0,0.55,0.1],to_color:[0.25,0.25,0.25],scale:4} ~ ~${Math.min(50, 8 + t)} ~ 9 3 9 0 25 force`);
    for (let t = 40; t <= 150; t += 5) at(t, 'particle minecraft:campfire_signal_smoke ~ ~54 ~ 14 4 14 0.005 20 force');
    for (let t = 20; t <= 110; t += 10) at(t, 'particle minecraft:large_smoke ~ ~2 ~ 14 2 14 0.02 40 force');

    // the crater, dug top to bottom while the fireball covers it
    for (let p = 0; p < DIG_TICKS; p++) { at(2 + p, `scoreboard players set #p gh_v ${p}`); at(2 + p, 'function gifthype:nuke/dig_here'); }
    at(DIE_AT, 'function gifthype:nuke/die');
    at(END_AT, 'function gifthype:nuke/end');
    return { summons, events };
}

function packFiles(nukeSizes) {
    const sizes = [...new Set([40, ...nukeSizes])].sort((a, b) => a - b);
    const f = {
        'pack.mcmeta': JSON.stringify({ pack: { description: 'Gift Hype: TikTok gift actions', min_format: 94, max_format: 999 } }, null, 2),
        'data/minecraft/tags/function/load.json': JSON.stringify({ values: ['gifthype:load'] }),
        'data/minecraft/tags/function/tick.json': JSON.stringify({ values: ['gifthype:tick'] }),
    };
    const fn = (name, lines) => { f[`data/gifthype/function/${name}.mcfunction`] = lines.join('\n') + '\n'; };

    fn('load', [
        'scoreboard objectives add gh_t dummy', 'scoreboard objectives add gh_size dummy',
        'scoreboard objectives add gh_jail dummy', 'scoreboard objectives add gh_js dummy', 'scoreboard objectives add gh_v dummy',
        'scoreboard players set #16 gh_v 16', 'scoreboard players set #20 gh_v 20', 'scoreboard players set #6 gh_v 6', 'scoreboard players set #4 gh_v 4',
    ]);
    fn('tick', [
        'execute as @e[type=minecraft:block_display,tag=gh_part] at @s run tp @s ~ ~-0.6 ~',
        'execute as @e[type=minecraft:block_display,tag=gh_nuke] at @s run function gifthype:nuke/fall',
        'execute as @e[type=minecraft:marker,tag=gh_boom] at @s run function gifthype:nuke/boom',
        'execute as @e[type=minecraft:armor_stand,tag=gh_cam] at @s run function gifthype:nuke/cam',
        'execute as @a[scores={gh_jail=1..}] run function gifthype:jail/tick',
        'execute as @a[tag=gh_end] run function gifthype:end/tick',
    ]);

    // ----- Nuke: your view goes up to a camera in the sky, a huge yellow and black bomb falls onto
    // where you were standing, the camera follows it down, it hits, the camera pulls back as the
    // fireball swells and the mushroom cloud climbs, then you're put back at ground zero and die. -----
    fn('nuke', [
        'title @s times 2 16 4', `title @s title ${T('NUKE INCOMING', 'red')}`, `title @s subtitle ${T('look up...', 'gold')}`,
        'playsound minecraft:entity.wither.spawn master @a ~ ~ ~ 3 0.6',
        'playsound minecraft:block.bell.use master @a ~ ~ ~ 3 0.5',
        'tag @s add gh_watch',
        // anything left from the last one
        'kill @e[type=minecraft:block_display,tag=gh_fx]',
        'kill @e[type=minecraft:marker,tag=gh_look]',
        // ground zero: where you stand now (moved to where the bomb really lands)
        'kill @e[type=minecraft:marker,tag=gh_gz]',
        'summon minecraft:marker ~ ~ ~ {Tags:["gh_gz","gh_new"]}',
        '$scoreboard players set @e[type=minecraft:marker,tag=gh_new] gh_size $(size)',
        'tag @e[type=minecraft:marker,tag=gh_new] remove gh_new',
        // keep the whole crater area loaded until it's dug, even with a short render distance
        'execute as @e[type=minecraft:marker,tag=gh_fl] at @s run function gifthype:nuke/unload',
        'summon minecraft:marker ~ ~ ~ {Tags:["gh_fl"]}',
        ...FORCE_BOXES.map(([a, b]) => `forceload add ${a} ${b}`),
        ...bombLines(),
        // the camera, up in the sky off to the side, looking at the bomb
        'kill @e[type=minecraft:armor_stand,tag=gh_cam]',
        'summon minecraft:armor_stand ~40 ~30 ~ {Tags:["gh_cam"],Invisible:1b,Marker:1b,NoGravity:1b,Silent:1b,Invulnerable:1b}',
        'scoreboard players set @e[type=minecraft:armor_stand,tag=gh_cam] gh_t 0',
        'execute as @e[type=minecraft:armor_stand,tag=gh_cam] at @s run tp @s ~ ~ ~ facing entity @e[tag=gh_nuke,limit=1] feet',
        'gamemode spectator @s',
        'spectate @e[type=minecraft:armor_stand,tag=gh_cam,limit=1] @s',
    ]);
    // while it falls the camera turns to follow the bomb; after it hits, it pulls straight back for
    // two seconds and looks at a point that rises with the cloud
    fn('nuke/cam', [
        'execute if entity @e[tag=gh_nuke] run tp @s ~ ~ ~ facing entity @e[tag=gh_nuke,limit=1] feet',
        'execute unless entity @e[tag=gh_nuke] run function gifthype:nuke/cam_back',
        'execute as @a[tag=gh_watch,gamemode=spectator] run spectate @e[type=minecraft:armor_stand,tag=gh_cam,limit=1] @s',
    ]);
    fn('nuke/cam_back', [
        'scoreboard players add @s gh_t 1',
        'execute if score @s gh_t matches ..40 facing entity @e[type=minecraft:marker,tag=gh_gz,limit=1] feet rotated ~ 0 run tp @s ^ ^ ^-1.3',
        'execute at @s if entity @e[type=minecraft:marker,tag=gh_look] run tp @s ~ ~ ~ facing entity @e[type=minecraft:marker,tag=gh_look,limit=1] feet',
    ]);
    fn('nuke/fall', [
        'particle minecraft:flame ~ ~26 ~ 1.5 1 1.5 0.03 14 force',
        'particle minecraft:large_smoke ~ ~28 ~ 1.5 2 1.5 0.01 10 force',
        'scoreboard players add @s gh_t 1',
        'scoreboard players operation #m gh_v = @s gh_t', 'scoreboard players operation #m gh_v %= #6 gh_v',
        'execute if score #m gh_v matches 0 run playsound minecraft:block.note_block.flute master @a ~ ~ ~ 4 1.4',
        'execute if score @s gh_t matches 3.. unless block ~ ~-1 ~ minecraft:air unless block ~ ~-1 ~ minecraft:cave_air run function gifthype:nuke/impact',
        'execute if score @s gh_t matches 600.. run kill @e[type=minecraft:block_display,tag=gh_part]',
    ]);
    const { summons, events } = blast();
    fn('nuke/impact', [
        'tp @e[type=minecraft:marker,tag=gh_gz] ~ ~ ~',
        'scoreboard players set @e[type=minecraft:marker,tag=gh_gz] gh_t -1',
        'tag @e[type=minecraft:marker,tag=gh_gz] add gh_boom',
        'summon minecraft:marker ~ ~10 ~ {Tags:["gh_look"]}',
        ...summons,
        'kill @e[type=minecraft:block_display,tag=gh_part,distance=..2]',
    ]);
    // the blast timeline: runs every tick as the ground zero marker
    const ticks = Object.keys(events).map(Number).sort((a, b) => a - b);
    fn('nuke/boom', [
        'scoreboard players add @s gh_t 1',
        'execute if score @s gh_t matches ..52 as @e[type=minecraft:marker,tag=gh_look] at @s run tp @s ~ ~0.5 ~',
        ...ticks.map(t => `execute if score @s gh_t matches ${t} run function gifthype:nuke/f/t${t}`),
    ]);
    for (const t of ticks) fn(`nuke/f/t${t}`, events[t]);
    // which dig plan: landing height rounded down to 4 (#b), crater size; #p is the step to dig now
    fn('nuke/dig_here', [
        'execute store result score #b gh_v run data get entity @s Pos[1]',
        'scoreboard players operation #b gh_v /= #4 gh_v', 'scoreboard players operation #b gh_v *= #4 gh_v',
        `execute if score #b gh_v matches ..${BUCKETS[0]} run scoreboard players set #b gh_v ${BUCKETS[0]}`,
        `execute if score #b gh_v matches ${BUCKETS[BUCKETS.length - 1]}.. run scoreboard players set #b gh_v ${BUCKETS[BUCKETS.length - 1]}`,
        'tag @s add gh_nosize',
        ...sizes.flatMap(s => [`execute if score @s gh_size matches ${s} align xyz run function gifthype:crater/s${s}`, `execute if score @s gh_size matches ${s} run tag @s remove gh_nosize`]),
        'execute if entity @s[tag=gh_nosize] align xyz run function gifthype:crater/s40',
        'tag @s remove gh_nosize',
    ]);
    fn('nuke/die', [
        'execute as @a[tag=gh_watch] run function gifthype:nuke/die_player',
        'kill @e[type=minecraft:armor_stand,tag=gh_cam]',
    ]);
    fn('nuke/die_player', [
        'gamemode survival @s',
        'execute at @e[type=minecraft:marker,tag=gh_gz,limit=1] run tp @s ~ ~ ~',
        'tag @s remove gh_watch',
        'damage @s 10000 minecraft:explosion',
        'kill @s',
    ]);
    // the cloud has thinned out: clear everything away
    fn('nuke/end', [
        'kill @e[type=minecraft:block_display,tag=gh_fx]',
        'kill @e[type=minecraft:marker,tag=gh_look]',
        'execute as @e[type=minecraft:marker,tag=gh_fl] at @s run function gifthype:nuke/unload',
        'kill @s',
    ]);
    fn('nuke/unload', [
        ...FORCE_BOXES.map(([a, b]) => `forceload remove ${a} ${b}`),
        'kill @s',
    ]);
    // dig plans: each step digs a few layers, each layer is one of the shared circles (disc/rN)
    const discs = new Set();
    for (const s of sizes) {
        fn(`crater/s${s}`, BUCKETS.map(b => `execute if score #b gh_v matches ${b} run function gifthype:crater/s${s}/y${b}`));
        for (const b of BUCKETS) {
            const layers = craterLayers(s, b);
            fn(`crater/s${s}/y${b}`, layers.map(([y, r], i) => {
                const ri = Math.round(r); discs.add(ri);
                return `execute if score #p gh_v matches ${Math.floor(i * DIG_TICKS / layers.length)} positioned ~ ${y} ~ run function gifthype:disc/r${ri}`;
            }));
        }
    }
    for (const r of discs) fn(`disc/r${r}`, discFills(r).map(([x1, z1, x2, z2]) => `fill ~${x1} ~ ~${z1} ~${x2} ~ ~${z2} minecraft:air`));

    // ----- Jail: bedrock and iron bars, no breaking out, more gifts add time -----
    fn('jail', [
        'execute unless score @s gh_jail matches 1.. align xyz run function gifthype:jail/build',
        '$scoreboard players add @s gh_jail $(ticks)',
    ]);
    fn('jail/build', [
        'kill @e[type=minecraft:marker,tag=gh_jailpos]',
        'fill ~-2 ~-1 ~-2 ~2 ~3 ~2 minecraft:bedrock hollow',
        'fill ~-2 ~ ~-2 ~2 ~2 ~2 minecraft:iron_bars outline',
        'tp @s ~0.5 ~ ~0.5',
        'summon minecraft:marker ~ ~ ~ {Tags:["gh_jailpos"]}',
        'playsound minecraft:block.iron_door.close master @a ~ ~ ~ 1 0.6',
        'title @s times 5 30 10', `title @s title ${T('JAILED', 'red')}`,
    ]);
    fn('jail/tick', [
        'scoreboard players remove @s gh_jail 1',
        'effect give @s minecraft:mining_fatigue 2 255 true',
        'scoreboard players operation @s gh_js = @s gh_jail', 'scoreboard players operation @s gh_js /= #20 gh_v', 'scoreboard players add @s gh_js 1',
        'title @s actionbar [{"text":"Jail: ","color":"red","bold":true},{"score":{"name":"@s","objective":"gh_js"},"color":"red","bold":true},{"text":"s","color":"red","bold":true}]',
        'execute if score @s gh_jail matches ..0 run function gifthype:jail/free',
    ]);
    fn('jail/free', [
        'execute at @e[type=minecraft:marker,tag=gh_jailpos] run fill ~-2 ~-1 ~-2 ~2 ~3 ~2 minecraft:air',
        'kill @e[type=minecraft:marker,tag=gh_jailpos]',
        'effect clear @s minecraft:mining_fatigue',
        'scoreboard players reset @s gh_jail',
        `title @s actionbar ${T('Free!', 'green')}`,
    ]);

    // ----- Chunk fills: the 16x16 chunk you're in. Air: the whole height. Cobweb / lava: from the
    // void up to just above you (in 16-high bands, so it stops within a few blocks of your head). -----
    fn('chunk', [
        'execute store result score #x gh_v run data get entity @s Pos[0]',
        'execute store result score #z gh_v run data get entity @s Pos[2]',
        'scoreboard players operation #x gh_v /= #16 gh_v', 'scoreboard players operation #x gh_v *= #16 gh_v',
        'scoreboard players operation #z gh_v /= #16 gh_v', 'scoreboard players operation #z gh_v *= #16 gh_v',
        'execute store result storage gifthype:c x int 1 run scoreboard players get #x gh_v',
        'execute store result storage gifthype:c z int 1 run scoreboard players get #z gh_v',
        'execute store result storage gifthype:c x2 int 1 run scoreboard players add #x gh_v 15',
        'execute store result storage gifthype:c z2 int 1 run scoreboard players add #z gh_v 15',
        '$data modify storage gifthype:c block set value "$(block)"',
        '$function gifthype:chunk/$(height) with storage gifthype:c',
        '$title @s actionbar $(msg)',
    ]);
    // from y=-64, so the bedrock floor goes too and the chunk opens straight into the void
    const bands = []; for (let y = -64; y <= 319; y += 16) bands.push([y, Math.min(319, y + 15)]);
    fn('chunk/all', bands.map(([a, b]) => `$fill $(x) ${a} $(z) $(x2) ${b} $(z2) $(block)`));
    fn('chunk/below', bands.map(([a, b]) => `$execute if entity @s[y=${a - 4},dy=4000] run fill $(x) ${a} $(z) $(x2) ${b} $(z2) $(block)`));

    // ----- Kits, clear, End -----
    const armor = (items) => items.flatMap(([slot, item]) => [
        `execute if items entity @s ${slot} * run give @s ${item}`,
        `execute unless items entity @s ${slot} * run item replace entity @s ${slot} with ${item}`,
    ]);
    fn('god_kit', [
        ...armor([
            ['armor.head', 'minecraft:netherite_helmet' + ENCH({ protection: 4, unbreaking: 3, mending: 1, respiration: 3, aqua_affinity: 1 })],
            ['armor.chest', 'minecraft:netherite_chestplate' + ENCH({ protection: 4, unbreaking: 3, mending: 1 })],
            ['armor.legs', 'minecraft:netherite_leggings' + ENCH({ protection: 4, unbreaking: 3, mending: 1, swift_sneak: 3 })],
            ['armor.feet', 'minecraft:netherite_boots' + ENCH({ protection: 4, unbreaking: 3, mending: 1, feather_falling: 4, depth_strider: 3 })],
        ]),
        'give @s minecraft:netherite_sword' + ENCH({ sharpness: 5, unbreaking: 3, mending: 1, looting: 3, fire_aspect: 2, sweeping_edge: 3 }),
        'give @s minecraft:netherite_pickaxe' + ENCH({ efficiency: 5, unbreaking: 3, mending: 1, fortune: 3 }),
        'give @s minecraft:netherite_axe' + ENCH({ efficiency: 5, unbreaking: 3, mending: 1, sharpness: 5 }),
        'give @s minecraft:bow' + ENCH({ power: 5, unbreaking: 3, infinity: 1, flame: 1, punch: 2 }),
        'give @s minecraft:arrow 1', 'give @s minecraft:ender_pearl 16', 'give @s minecraft:ender_eye 32',
        'give @s minecraft:golden_apple 16', 'give @s minecraft:enchanted_golden_apple 2', 'give @s minecraft:cooked_beef 32',
        'playsound minecraft:item.armor.equip_netherite master @a ~ ~ ~ 1 1', `title @s actionbar ${T('GOD KIT', 'light_purple')}`,
    ]);
    fn('diamond_kit', [
        ...armor([['armor.head', 'minecraft:diamond_helmet'], ['armor.chest', 'minecraft:diamond_chestplate'], ['armor.legs', 'minecraft:diamond_leggings'], ['armor.feet', 'minecraft:diamond_boots']]),
        'give @s minecraft:diamond_sword', 'give @s minecraft:cooked_beef 16',
        'playsound minecraft:item.armor.equip_diamond master @a ~ ~ ~ 1 1',
    ]);
    fn('clear', ['clear @s', `title @s actionbar ${T('Inventory cleared!', 'red')}`]);
    fn('end', [
        'effect give @s minecraft:slow_falling 12 0 true', 'effect give @s minecraft:resistance 8 4 true',
        'execute in minecraft:the_end run tp @s 100.5 52 0.5',
        'tag @s add gh_end', 'scoreboard players set @s gh_t 50',
    ]);
    fn('end/tick', ['scoreboard players remove @s gh_t 1', 'execute if score @s gh_t matches ..0 run function gifthype:end/land']);
    fn('end/land', [
        'execute in minecraft:the_end run fill 98 48 -2 102 48 2 minecraft:obsidian',
        'execute in minecraft:the_end run fill 98 49 -2 102 51 2 minecraft:air',
        'execute in minecraft:the_end run tp @s 100.5 49 0.5',
        'tag @s remove gh_end', `title @s title ${T('Welcome to the End', 'light_purple')}`,
    ]);
    fn('mob', ['$execute rotated ~ 0 positioned ^ ^$(up) ^$(front) run summon minecraft:$(id) ~ ~ ~']);
    return f;
}

// Writes the pack into the world. Returns true if anything changed (the game then needs /reload).
export function installPack(world, nukeSizes = []) {
    const worlds = listWorlds();
    if (!worlds.some(w => w.name === world)) throw new Error('That world was not found');
    const root = path.join(SAVES_DIR, world, 'datapacks', 'gifthype');
    const files = packFiles(nukeSizes);
    let changed = false;
    for (const [rel, text] of Object.entries(files)) {
        const p = path.join(root, ...rel.split('/'));
        if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text) continue;
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
        changed = true;
    }
    // functions from older versions or crater sizes nobody uses any more
    const fnDir = path.join(root, 'data', 'gifthype', 'function');
    const prune = (dir, rel) => {
        for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
            const p = path.join(dir, e.name), r = `${rel}/${e.name}`;
            if (e.isDirectory()) { prune(p, r); if (!fs.readdirSync(p).length) fs.rmdirSync(p); }
            else if (!files[r]) { fs.rmSync(p); changed = true; }
        }
    };
    prune(fnDir, 'data/gifthype/function');
    return changed;
}

// The chat command for each Block Delete action (typed after "/").
export function singleplayerCommands(a, times, MOBS) {
    const clampN = (v, lo, hi, def) => Math.max(lo, Math.min(hi, Number.isFinite(+v) && +v > 0 ? Math.round(+v) : def));
    switch (a.type) {
        case 'nuke': return [`function gifthype:nuke {size:${clampN(a.size, 16, 64, 40)}}`]; // one at a time: the camera follows one bomb
        case 'jail': return [`function gifthype:jail {ticks:${Math.min(3600, clampN(a.seconds, 1, 3600, 30) * times) * 20}}`];
        case 'cobwebChunk': return [`function gifthype:chunk {block:"minecraft:cobweb",height:"below",msg:'${T('COBWEB CHUNK', 'white')}'}`];
        case 'lavaChunk': return [`function gifthype:chunk {block:"minecraft:lava",height:"below",msg:'${T('LAVA CHUNK', 'gold')}'}`];
        case 'airChunk': return [`function gifthype:chunk {block:"minecraft:air",height:"all",msg:'${T('AIR CHUNK', 'aqua')}'}`];
        case 'clearInventory': return ['function gifthype:clear'];
        case 'endTp': return ['function gifthype:end'];
        case 'godKit': return Array(Math.min(times, 5)).fill('function gifthype:god_kit');
        case 'diamondKit': return Array(Math.min(times, 10)).fill('function gifthype:diamond_kit');
        case 'spawnMob': {
            const id = MOBS[a.mob] ? a.mob : 'zombie', m = MOBS[id];
            return Array(Math.min(clampN(a.amount, 1, 50, 1) * times, m.max, 15)).fill(`function gifthype:mob {id:"${id}",up:${m.up || 0},front:${m.front || 0}}`);
        }
        case 'lightning': return Array(Math.min(clampN(a.amount, 1, 20, 1) * times, 10)).fill('execute at @s run summon minecraft:lightning_bolt ~ ~ ~');
        default: return [];
    }
}

// Wipeout: a 100-level obstacle course in the sky that Unbound builds in its own world.
//
// The whole course is one straight line of white and blue concrete floating high above warm sea
// water, with birch wood stands on both sides (a different concrete design on each level). Each level
// is a short run of two obstacles (three after level 80) ending at an emerald pad: step on it and you're
// on the next level, which starts right after. There are no checkpoints: touch anything red (spinners
// to jump over, cubes sliding across, walls coming at you, crushers, red blocks sweeping past the
// zipline) and you're dead, back at the start of the level. The punching gloves knock you off; red and
// white wool boxing gloves bounce you up. Fall in the water (a wipeout) and it's back to the start too.
// Every level is designed here from a
// seed, so the world always comes out the same.
//
// The game runs from a data pack in the world (levels, the moving obstacles, jail, the
// reset countdown, punches), the same way as the Dropper's, and Unbound sends gift actions as
// function calls.

import fs from 'node:fs';
import path from 'node:path';
import { SAVES_DIR } from './singleplayer.js';
import { knockFiles, knockCommand, MAX_PUNCHES_PER_GIFT } from './knock.js';

export const WIPEOUT_WORLD = 'Unbound Wipeout 11';    // 11: new obstacles (the layout moved)
export const WIPEOUT_MC = '26.2';
export const WIPEOUT_BUILD = 16;                  // bump when the levels change, to rebuild them
export const LEVELS = 100;

// Settings for making the world the first time: nothing but the levels (and sea), warm ocean colours
export const WIPEOUT_PROPS = [
    'level-type=minecraft\\:flat',
    'generator-settings={"layers":[{"block":"minecraft:air","height":1}],"biome":"minecraft:warm_ocean"}',
    'generate-structures=false', 'difficulty=peaceful', 'gamemode=adventure', 'allow-flight=true',
];

// ---------- where things are ----------
const F = 140;                       // your feet on the course (the floor blocks are at F-1)
const SEA = F - 6;                   // the sea's top (water from SEA-3 to SEA, sand under it): a short fall
const ORIGIN_X = 1000, ORIGIN_Z = 1000, SEA_W = 60;     // the course runs north to south along x=1000; sea 60 each side
const WALL_X = 11, TOWER_WALL_X = 13; // the side walls' inner face, either side of the middle (wider round the tower)
const JAIL = [700, F, 700], WIN = [700, F, 800];
const B = b => `minecraft:${b}`;
const J = o => JSON.stringify(o);

// ---------- a seeded random ----------
function rngFor(seed) {
    let a = seed >>> 0;
    const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: list => list[Math.floor(next() * list.length)], chance: p => next() < p };
}

// ---------- the look ----------
// The course: white with blue, a different pattern on different levels
const FLOOR_STYLES = ['edges', 'stripes', 'checker', 'center', 'zigzag'];
// The side walls' designs: white and blue
const BW = ['blue_concrete', 'white_concrete'];
const STAND_STYLES = ['waves', 'checker', 'stripes', 'diamonds', 'bands', 'dots', 'arrows'].map(name => ({ name, cols: BW }));

// ---------- the obstacles ----------
// Each makes: the blocks (built once), the moving parts (summoned when you get to the level), what they
// do every tick, what happens each try (the doors' right door), and how long it takes to get past.
// x: the middle of the course, z: where it starts, w: the course's width. Returns { len, secs, ... }.
const SECS = { spinner: 3.2, gloves: 3, cubes: 1.8, wall: 6, punch: 1.8, zipline: 5.5, doors: 3.2, beam: 2.4, blink: 3.6, crusher: 1.8, spinfield: 4, duck: 4.5, lasers: 4, barrels: 4, balls: 4, stones: 4 };
const FIRST = { spinner: 1, gloves: 1, cubes: 1, beam: 2, doors: 3, wall: 4, punch: 5, zipline: 6, balls: 7, crusher: 9, stones: 10, blink: 11, lasers: 13, barrels: 16, spinfield: 22, duck: 26 };

let uid = 0;
function obstacle(type, ctx) {
    const { n, d, r, x, z, w } = ctx;            // d: 0 (level 1) to 1 (level 100)
    const id = `o${n}_${++uid}`;
    const o = { id, type, blocks: [], spawn: [], tick: [], reroll: [], fns: {}, len: 0, secs: SECS[type], sim: [] };   // sim: timings, for checking every level can be done
    const lo = x - Math.floor((w - 1) / 2), hi = lo + w - 1;     // the course's edges (x)
    const floorRow = (x1, z1, x2, z2) => o.blocks.push(...floorFill(x1, z1, x2, z2, ctx.style));
    const sp = (lo2, hi2) => +(lo2 + (hi2 - lo2) * d).toFixed(3);   // a speed from easy to hard
    switch (type) {
        // ---- a round platform with an arm (or two) sweeping round at your ankles: jump it ----
        case 'spinner': {
            const R = r.int(5, 6) + (d > 0.5 ? 1 : 0), cz = z + R + 1;
            disc(o, x, cz, R + 1, ctx.style);
            o.blocks.push(`setblock ${x} ${F} ${cz} ${B('red_concrete')}`);
            const arms = d > 0.3 && r.chance(0.35 + d * 0.4) ? 2 : 1, deg = sp(4, 7.5) * (r.chance(0.5) ? 1 : -1);
            for (let a = 0; a < arms; a++) o.spawn.push(display([id, 'wo_arm'], x + 0.5, F, cz + 0.5, 'red_concrete', 0.6, 0.55, 2 * R, { tx: -0.3, ty: 0.05, tz: -R, yaw: a * 90 + r.int(0, 89) }));
            o.tick.push(`execute as @e[tag=${id}] at @s run tp @s ~ ~ ~ ~${deg} ~`);
            // where the arm is (a little behind it, so you're knocked the way it's going): every 0.75 blocks out
            const back = deg > 0 ? -18 : 18;
            for (let k = -R + 0.4; k <= R - 0.4; k += 0.75) {
                o.tick.push(`execute as @e[tag=${id}] at @s rotated as @s positioned ^ ^ ^${k.toFixed(2)} positioned ~-0.5 ~-0.3 ~-0.5 if entity @a[tag=wo_in,dx=0,dy=0,dz=0] at @s rotated as @s rotated ~${back} 0 positioned ^ ^ ^${k.toFixed(2)} as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:zap`);
            }
            o.len = 2 * R + 3; o.secs += arms === 2 ? 0.8 : 0;
            break;
        }
        // ---- several spinners in a field (later levels) ----
        case 'spinfield': {
            const R = 4, cz = z + R + 1, gap = 2 * R + 2;
            const spots = [[x - 3, cz], [x + 3, cz + gap - 2], [x - 3, cz + 2 * gap - 4]];
            for (const [sx, sz] of spots) disc(o, sx, sz, R + 1, ctx.style);
            floorRow(x - 7, cz + R, x + 7, cz + R);                               // little bridges between them
            floorRow(x - 7, cz + gap + R - 2, x + 7, cz + gap + R - 2);
            spots.forEach(([sx, sz], i) => {
                o.blocks.push(`setblock ${sx} ${F} ${sz} ${B('red_concrete')}`);
                const deg = sp(5, 8) * (i % 2 ? -1 : 1);
                const sid = `${id}s${i}`;
                o.spawn.push(display([id, sid, 'wo_arm'], sx + 0.5, F, sz + 0.5, 'red_concrete', 0.6, 0.55, 2 * R, { tx: -0.3, ty: 0.05, tz: -R, yaw: r.int(0, 179) }));
                o.tick.push(`execute as @e[tag=${sid}] at @s run tp @s ~ ~ ~ ~${deg} ~`);
                for (let k = -R + 0.4; k <= R - 0.4; k += 0.75) o.tick.push(`execute as @e[tag=${sid}] at @s rotated as @s positioned ^ ^ ^${k.toFixed(2)} positioned ~-0.5 ~-0.3 ~-0.5 if entity @a[tag=wo_in,dx=0,dy=0,dz=0] at @s rotated as @s rotated ~${deg > 0 ? -18 : 18} 0 positioned ^ ^ ^${k.toFixed(2)} as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:zap`);
            });
            o.len = 6 * R + 3; o.secs = 5.5;
            break;
        }
        // ---- boxing gloves over the water: land on them and they bounce you up and on ----
        case 'gloves': {
            const count = r.int(2, 3) + (d > 0.5 ? 1 : 0);
            let zc = z + 1;
            floorRow(lo, z, hi, z);
            for (let i = 0; i < count; i++) {
                const gap = r.int(2, 3) + (d > 0.6 ? 1 : 0);
                zc += gap;
                const off = d > 0.4 ? r.int(-1, 1) * Math.min(2, Math.floor(w / 2)) : 0;
                glove(o, x + off, zc);
                zc += 4;
            }
            zc += r.int(2, 3);
            o.len = zc - z; o.secs = 1 + count * 0.9;
            break;
        }
        // ---- red cubes sliding across: run past one, stop, wait for the next ----
        case 'cubes': {
            // (kept fair: two-block cubes, four safe rows between them, slow enough to time, and each cube goes
            // well off the course on both sides so there's a proper gap to run through)
            const count = Math.min(4, 2 + Math.floor(d * 2) + (d > 0.3 ? r.int(0, 1) : 0)), size = 2, safe = 4;
            const L = count * (size + safe) + 3;
            floorRow(lo, z, hi, z + L - 1);
            const travel = w + size + 6, v = sp(0.1, 0.19), t = Math.max(10, Math.round(travel / v));
            for (let i = 0; i < count; i++) {
                const cz = z + 3 + i * (size + safe), cid = `${id}c${i}`;
                // spread out, so two cubes next to each other are never both in the way at once
                const steps = [{ d: [v, 0, 0], t }, { d: [-v, 0, 0], t }], off = Math.round(i * 2 * t / count + r.int(0, Math.round(t / 4))) % (2 * t);
                const start = posAt([lo - size - 3, F, cz], steps, off);
                o.spawn.push(display([id, cid], ...start, 'red_concrete', size, size, size), `scoreboard players set @e[tag=${cid}] wo_ph ${off}`);
                o.sim.push({ kind: 'lane', axis: 'x', p0: [lo - size - 3, F, cz], steps, off, size: [size, size, size], lo, hi });
                o.tick.push(...moveLines(cid, steps), hitBox(cid, size, size, size));
            }
            o.len = L; o.secs = 1.2 + count * 1.0;
            break;
        }
        // ---- waves: red walls come down a corridor at you, again and again. The corridor has holes in its
        // sides: duck into one while a wave goes past, then run to the next before the next wave ----
        case 'wall': {
            const S = 5, holes = 3 + Math.floor(d * 2) + r.int(0, 1), L = (holes + 1) * S + 1;
            floorRow(lo, z, hi, z + L - 1);
            // the corridor's sides (white, blue on top)
            for (const wx of [lo - 1, hi + 1]) o.blocks.push(`fill ${wx} ${F} ${z} ${wx} ${F + 2} ${z + L - 1} ${B('light_blue_concrete')}`, `fill ${wx} ${F + 3} ${z} ${wx} ${F + 3} ${z + L - 1} ${B('blue_concrete')}`);
            // the holes: an opening in the side and a little room behind it (two deep, two long)
            let side = r.chance(0.5) ? 1 : -1;
            for (let i = 0; i < holes; i++) {
                const hz = z + S * (i + 1) - 1, open = side > 0 ? hi + 1 : lo - 1, inner = open + side, back = open + 2 * side;
                o.blocks.push(
                    `fill ${Math.min(open, inner)} ${F - 1} ${hz} ${Math.max(open, inner)} ${F - 1} ${hz + 1} ${B('blue_concrete')}`,
                    `fill ${open} ${F} ${hz} ${open} ${F + 2} ${hz + 1} ${B('air')}`,
                    `fill ${inner} ${F} ${hz - 1} ${inner} ${F + 2} ${hz - 1} ${B('light_blue_concrete')}`, `fill ${inner} ${F} ${hz + 2} ${inner} ${F + 2} ${hz + 2} ${B('light_blue_concrete')}`,
                    `fill ${back} ${F} ${hz - 1} ${back} ${F + 2} ${hz + 2} ${B('light_blue_concrete')}`,
                    `fill ${Math.min(open, back)} ${F + 3} ${hz - 1} ${Math.max(open, back)} ${F + 3} ${hz + 2} ${B('blue_concrete')}`,
                    `fill ${open} ${F + 3} ${hz} ${open} ${F + 3} ${hz + 1} ${B('white_concrete')}`,
                );
                if (r.chance(0.6)) side = -side;
            }
            // the waves: from the far end back to the start, then round again
            const travel = L - 1, t = Math.round(travel / sp(0.15, 0.23)), v = travel / t, pause = Math.round(14 - 8 * d);
            const steps = [{ d: [0, 0, -v], t }, { d: [0, 0, travel], t: 1 }, { d: [0, 0, 0], t: pause }];
            const waves = 1, tot = t + 1 + pause;            // (two at once can leave no time to get to the next hole)
            for (let j = 0; j < waves; j++) {
                const wid = `${id}w${j}`, off = Math.round(j * tot / waves + r.int(0, 10)) % tot;
                const start = posAt([lo, F, z + L - 1], steps, off);
                o.spawn.push(display([id, wid], ...start, 'red_concrete', w, 3, 1), `scoreboard players set @e[tag=${wid}] wo_ph ${off}`);
                o.sim.push({ kind: 'waves', p0: [lo, F, z + L - 1], steps, off, z, L, holes: Array.from({ length: holes }, (_, i) => z + S * (i + 1) - 1) });
                o.tick.push(...moveLines(wid, steps), hitBox(wid, w, 3, 1));
            }
            o.len = L; o.secs = 1.5 + holes * 1.3;
            break;
        }
        // ---- punching gloves from the side: each one shoots out of a hole in a big wall on a metal arm and
        // goes back into it. Wait for a punch, then run past ----
        case 'punch': {
            const count = Math.min(5, 2 + Math.floor(d * 3) + r.int(0, 1)), L = count * 4 + 2, side = r.chance(0.5) ? 1 : -1;
            floorRow(lo, z, hi, z + L - 1);
            // each glove sits in a small frame at the course's edge, black right behind it, and shoots out on
            // an iron arm that grows out of the frame with it and goes back in with it (hidden while it's in).
            // The arm knocks you back too: you can't run through it
            const reach = w + 0.4, G = 1.6, cuff = 0.35;
            const wallX = side > 0 ? hi + 1 : lo - 1, back = wallX + 2 * side;    // the hole is 2 deep, then black
            const out = Math.max(3, Math.round(reach / sp(0.55, 0.85))), ret = Math.round(reach / 0.15);
            const wait = Math.round(42 - 22 * d) + r.int(0, 10);
            const vo = +(reach / out).toFixed(3), vb = +(reach / ret).toFixed(3);
            for (let i = 0; i < count; i++) {
                const pz = z + 2 + i * 4, pid = `${id}p${i}`, aid = `${pid}a`;
                const x1 = Math.min(wallX, back), x2 = Math.max(wallX, back);
                o.blocks.push(`fill ${x1} ${F - 1} ${pz - 1} ${x2} ${F + 2} ${pz + 2} ${B('blue_concrete')}`,
                    `fill ${x1} ${F + 2} ${pz - 1} ${x2} ${F + 2} ${pz + 2} ${B('white_concrete')}`,
                    `fill ${Math.min(wallX, wallX + side)} ${F} ${pz} ${Math.max(wallX, wallX + side)} ${F + 1} ${pz + 1} ${B('air')}`,
                    `fill ${back} ${F} ${pz} ${back} ${F + 1} ${pz + 1} ${B('black_concrete')}`);
                const steps = [{ d: [0, 0, 0], t: wait }, { d: [-side * vo, 0, 0], t: out }, { d: [0, 0, 0], t: 6 }, { d: [side * vb, 0, 0], t: ret }];
                const tot = wait + out + 6 + ret, off = Math.round(i * tot / count + r.int(0, 8)) % tot;
                // resting: in the hole, its front level with the frame
                const gx = side > 0 ? wallX : wallX + 1 - G, gy = F + 0.2, gz = pz + 0.2;
                const at = (dx, dy, dz) => posAt([gx + dx, gy + dy, gz + dz], steps, off);
                // the arm: fixed to the black at the back of the hole, as long as the glove is out
                const face = side > 0 ? back : back + 1, now = Math.abs(at(0, 0, 0)[0] - gx);
                const armT = len => `{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[${side > 0 ? -len.toFixed(3) : 0}f,0f,0f],scale:[${Math.max(0.001, len).toFixed(3)}f,0.5f,0.5f]}`;
                o.spawn.push(
                    display([id, pid, 'wo_glove'], ...at(0, 0, 0), 'red_wool', G, G, G),
                    display([id, pid], ...at(side > 0 ? G : -cuff, 0.3, 0.3), 'white_wool', cuff, 1.0, 1.0),           // the cuff
                    `summon minecraft:block_display ${face.toFixed(3)} ${(gy + 0.55).toFixed(3)} ${(gz + 0.55).toFixed(3)} {Tags:["wo_mv","wo_new","${id}","${aid}"],block_state:{Name:"minecraft:iron_block"},transformation:${armT(now)}}`,
                    `scoreboard players set @e[tag=${pid}] wo_ph ${off}`);
                o.sim.push({ kind: 'lane', axis: 'x', p0: [gx, gy, gz], steps, off, size: [G, G, G], lo, hi, arm: { face, side, back: side > 0 ? G + cuff : -cuff } });
                o.tick.push(...moveLines(pid, steps), hitBox(pid, G, G, G, `tag=${pid},tag=wo_glove`, 'hit {p:2}'),
                    // the arm grows out with the glove, and goes back in with it
                    `execute if entity @e[tag=${pid},tag=wo_glove,scores={wo_ph=${wait}}] run data merge entity @e[tag=${aid},limit=1] {start_interpolation:0,interpolation_duration:${out},transformation:${armT(reach)}}`,
                    `execute if entity @e[tag=${pid},tag=wo_glove,scores={wo_ph=${wait + out + 6}}] run data merge entity @e[tag=${aid},limit=1] {start_interpolation:0,interpolation_duration:${ret},transformation:${armT(0)}}`);
                // ...and knocks you back wherever it is: each block across, while the glove is past it
                for (let k = 0; k < Math.ceil(reach); k++) {
                    const sx = side > 0 ? wallX - k - 1 : wallX + k + 1;          // this block of the course (its low corner)
                    // (the glove's corner is a point: the box goes half a block round it up and down)
                    const past = side > 0 ? `positioned ${sx - 60} ${gy - 0.5} ${gz - 0.5} if entity @e[tag=${pid},tag=wo_glove,dx=${(60 - G - cuff - 1).toFixed(2)},dy=0,dz=0]`
                        : `positioned ${sx + 1 + cuff} ${gy - 0.5} ${gz - 0.5} if entity @e[tag=${pid},tag=wo_glove,dx=59,dy=0,dz=0]`;
                    o.tick.push(`execute ${past} positioned ${sx + 0.1} ${gy + 0.65} ${gz + 0.65} if entity @a[tag=wo_in,dx=-0.2,dy=-0.7,dz=-0.7] positioned ${sx + 0.5} ${gy + 0.8} ${gz + 0.8} as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:hit {p:1}`);
                }
            }
            o.len = L; o.secs = 1.2 + count * 1.0;
            break;
        }
        // ---- crushers: red blocks slamming down onto the course ----
        case 'crusher': {
            const count = Math.min(5, 2 + Math.floor(d * 3)), L = count * 4 + 2;
            floorRow(lo, z, hi, z + L - 1);
            for (let i = 0; i < count; i++) {
                const cz = z + 2 + i * 4, cid = `${id}k${i}`;
                const drop = 3.6, down = Math.max(3, Math.round(drop / sp(0.5, 0.9))), up = Math.round(drop / 0.12), hold = 10, wait = Math.round(30 - 15 * d) + r.int(0, 8);
                const steps = [{ d: [0, 0, 0], t: wait }, { d: [0, -drop / down, 0], t: down }, { d: [0, 0, 0], t: hold }, { d: [0, drop / up, 0], t: up }];
                const tot = wait + down + hold + up, off = Math.round(i * tot / count + r.int(0, 6)) % tot;
                const start = posAt([lo, F + 3.8, cz], steps, off);
                o.spawn.push(display([id, cid], ...start, 'red_concrete', w, 2, 2), `scoreboard players set @e[tag=${cid}] wo_ph ${off}`);
                o.sim.push({ kind: 'lane', axis: 'y', p0: [lo, F + 3.8, cz], steps, off, size: [w, 2, 2], lo, hi });
                o.tick.push(...moveLines(cid, steps), hitBox(cid, w, 2, 2));
                o.blocks.push(`fill ${lo - 1} ${F} ${cz} ${lo - 1} ${F + 6} ${cz + 1} ${B('light_blue_concrete')}`, `fill ${hi + 1} ${F} ${cz} ${hi + 1} ${F + 6} ${cz + 1} ${B('light_blue_concrete')}`,
                    `fill ${lo - 1} ${F + 6} ${cz} ${hi + 1} ${F + 6} ${cz + 1} ${B('blue_concrete')}`);
            }
            o.len = L; o.secs = 1.2 + count * 0.9;
            break;
        }
        // ---- the zipline: step on the plate and you ride under the bars, past the red blocks ----
        case 'zipline': {
            const G = r.int(12, 16) + Math.round(d * 6), z1 = z + 3, z2 = z1 + G;
            floorRow(lo, z, hi, z + 2);
            floorRow(lo, z2 + 1, hi, z2 + 3);
            o.blocks.push(`setblock ${x} ${F} ${z + 1} ${B('light_weighted_pressure_plate')}`,
                `fill ${x} ${F + 4} ${z + 1} ${x} ${F + 4} ${z2 + 1} ${B('iron_bars')}`,
                `fill ${x - 1} ${F} ${z} ${x - 1} ${F + 4} ${z} ${B('light_blue_concrete')}`, `fill ${x + 1} ${F} ${z} ${x + 1} ${F + 4} ${z} ${B('light_blue_concrete')}`,
                `fill ${x - 1} ${F + 5} ${z} ${x + 1} ${F + 5} ${z} ${B('blue_concrete')}`,
                `fill ${x - 1} ${F} ${z2 + 2} ${x - 1} ${F + 4} ${z2 + 2} ${B('light_blue_concrete')}`, `fill ${x + 1} ${F} ${z2 + 2} ${x + 1} ${F + 4} ${z2 + 2} ${B('light_blue_concrete')}`,
                `fill ${x - 1} ${F + 5} ${z2 + 2} ${x + 1} ${F + 5} ${z2 + 2} ${B('blue_concrete')}`);
            const speed = 0.32, ticks = Math.round((z2 + 1.5 - (z + 1.5)) / speed);
            // riding: the plate starts it (the "seat" is invisible, a chain is your handle)
            o.fns.zip = [
                'tag @s add wo_ride',
                `summon minecraft:item_display ${x + 0.5} ${F + 1.05} ${z + 1.5} {Tags:["wo_mv","wo_new","wo_zipv","${id}v"],teleport_duration:1}`,
                display(['wo_new', 'wo_ziph', `${id}v`], x + 0.42, F + 2.85, z + 1.42, 'chain', 0.16, 1.15, 0.16),
                `scoreboard players set @e[tag=wo_new] wo_gen ${n}`, 'scoreboard players set @e[tag=wo_new] wo_ph 0', 'tag @e[tag=wo_new] remove wo_new',
                `ride @s mount @e[tag=${id}v,tag=wo_zipv,limit=1]`,
                'playsound minecraft:block.chain.place master @s ~ ~ ~ 1 0.8',
            ];
            o.tick.push(
                `execute positioned ${x} ${F} ${z + 1} as @a[tag=wo_in,tag=!wo_ride,dx=0,dy=0,dz=0] unless score @s wo_jail matches 1.. at @s run function wipeout:${ctx.fnBase}/${id}_zip`,
                `execute as @e[tag=${id}v] at @s run tp @s ~ ~ ~${speed}`,
                `scoreboard players add @e[tag=${id}v,tag=wo_zipv] wo_ph 1`,
                `execute as @e[tag=${id}v,tag=wo_zipv,scores={wo_ph=${ticks}..}] run function wipeout:zip_end`,
                `execute as @e[tag=${id}v,tag=wo_zipv] at @s unless entity @a[tag=wo_ride,distance=..1.5] run function wipeout:zip_end`,
            );
            // red blocks sweeping side to side across the line. They're timed together, so there's always a
            // moment to go that gets you past every one: the light on top of the start turns green then
            const count = Math.min(3, 1 + Math.floor(d * 2.5));
            const travel = 8, t = Math.round(travel / sp(0.1, 0.17)), v = travel / t, per = 2 * t;
            const steps = [{ d: [v, 0, 0], t }, { d: [-v, 0, 0], t }];
            const W = Math.max(5, Math.floor(2.0 / v) - 3);      // how long the green light stays on, each side of the best moment
            let off0 = 0;
            for (let i = 0; i < count; i++) {
                const hz = Math.round(z1 + (i + 1) * G / (count + 1)), hid = `${id}h${i}`;
                // when the rider gets to it, it's at one end (left or right, every other one)
                const ti = Math.round((hz + 0.6 - (z + 1.5)) / speed) + 2, target = i % 2 ? t : 0, off = (((target - ti) % per) + per) % per;
                if (!i) off0 = off;
                const start = posAt([x - 4.75, F + 1.2, hz], steps, off);
                o.spawn.push(display([id, hid], ...start, 'red_concrete', 1.5, 1.6, 1.2), `scoreboard players set @e[tag=${hid}] wo_ph ${off}`);
                o.tick.push(...moveLines(hid, steps), hitBox(hid, 1.5, 1.6, 1.2));
                o.sim.push({ kind: 'zip', p0: [x - 4.75, F + 1.2, hz], steps, off, ti, x });
            }
            o.sim.push({ kind: 'zipwin', W, per, off0 });
            // the GO light (the middle of the top of the start): green while it's a good time to step on
            const lo2 = off0 - W, hi2 = off0 + W, range = (a, b) => a < 0 ? [[a + per, per - 1], [0, b]] : b >= per ? [[a, per - 1], [0, b - per]] : [[a, b]];
            o.tick.push(`scoreboard players set #${id}g wo_v 0`,
                ...range(lo2, hi2).map(([a, b]) => `execute if entity @e[tag=${id}h0,scores={wo_ph=${a}..${b}}] run scoreboard players set #${id}g wo_v 1`),
                `execute if score #${id}g wo_v matches 1 run setblock ${x} ${F + 5} ${z} ${B('lime_concrete')}`,
                `execute if score #${id}g wo_v matches 0 run setblock ${x} ${F + 5} ${z} ${B('gray_concrete')}`);
            o.len = G + 7; o.secs = 2.5 + G / 6.4;
            break;
        }
        // ---- pick the door: one opens, the others punch you back into the sea ----
        case 'doors': {
            const N = d < 0.25 ? 3 : r.chance(0.5) ? 4 : 3, DW = N * 3 + 1, dlo = x - Math.floor(DW / 2), gap = 2 + (d > 0.5 ? 1 : 0);
            floorRow(lo, z, hi, z);
            const lz = z + 1 + gap, wz = lz + 2;                  // the ledge, then the doors' wall
            o.blocks.push(...floorFill(dlo, lz, dlo + DW - 1, lz + 1, 'edges'),
                `fill ${dlo} ${F} ${wz} ${dlo + DW - 1} ${F + 3} ${wz} ${B('light_blue_concrete')}`,
                `fill ${dlo} ${F + 4} ${wz} ${dlo + DW - 1} ${F + 4} ${wz} ${B('blue_concrete')}`);
            o.blocks.push(...floorFill(dlo, wz + 1, dlo + DW - 1, wz + 2, 'edges'));
            o.reroll.push(`execute store result score #${id} wo_v run random value 1..${N}`);
            o.fns.ledge = floorFill(dlo, lz, dlo + DW - 1, lz + 1, 'edges');
            for (let j = 1; j <= N; j++) {
                const dx = dlo + 1 + (j - 1) * 3;
                const door = c => `fill ${dx} ${F} ${wz} ${dx + 1} ${F + 2} ${wz} ${B(c)}`;
                o.blocks.push(door('blue_concrete'), `setblock ${dx} ${F + 3} ${wz} ${B('white_concrete')}`, `setblock ${dx + 1} ${F + 3} ${wz} ${B('white_concrete')}`);
                // a wrong door goes red and the ledge drops away under you (into the sea)
                o.fns[`door${j}`] = [
                    `execute if score #${id} wo_v matches ${j} run return run function wipeout:${ctx.fnBase}/${id}_open${j}`,
                    'execute if score @s wo_cd matches 1.. run return 0',
                    'scoreboard players set @s wo_cd 20',
                    door('red_concrete'), `schedule function wipeout:${ctx.fnBase}/${id}_shut${j} 20t`,
                    `fill ${dlo} ${F - 1} ${lz} ${dlo + DW - 1} ${F - 1} ${lz + 1} ${B('air')}`, `schedule function wipeout:${ctx.fnBase}/${id}_ledge 30t`,
                    `title @s actionbar ${J({ text: 'WRONG DOOR!', color: 'red', bold: true })}`,
                    `playsound minecraft:block.anvil.land master @a ${dx + 1} ${F + 1} ${wz} 0.8 1.4`,
                ];
                o.fns[`open${j}`] = [door('air'), `playsound minecraft:block.iron_door.open master @a ${dx + 1} ${F + 1} ${wz} 1 1`, `playsound minecraft:entity.player.levelup master @s ~ ~ ~ 0.6 1.6`, `schedule function wipeout:${ctx.fnBase}/${id}_shut${j} 50t`];
                o.fns[`shut${j}`] = [
                    `execute positioned ${dx} ${F} ${wz} if entity @a[dx=1,dy=2,dz=0] run return run schedule function wipeout:${ctx.fnBase}/${id}_shut${j} 10t`,
                    door('blue_concrete'),
                ];
                o.tick.push(`execute positioned ${dx} ${F} ${wz - 0.7} as @a[tag=wo_in,dx=1,dy=1,dz=0] unless score @s wo_jail matches 1.. run function wipeout:${ctx.fnBase}/${id}_door${j}`);
            }
            o.len = wz + 3 - z; o.secs = 3 + (N - 3) * 0.6;
            break;
        }
        // ---- a bridge over the sea that comes and goes by itself: there, then yellow, then red, then gone,
        // then back. Wait for it to come back and run across before it goes ----
        case 'beam': {
            const L = r.int(8, 12) + Math.round(d * 4), bw = d < 0.7 ? 2 : 1;
            floorRow(lo, z, hi, z);
            const bx = d > 0.5 && r.chance(0.5) ? x + r.int(-1, 0) : x;
            const normal = [];
            for (let k = 1; k <= L; k++) normal.push(`fill ${bx} ${F - 1} ${z + k} ${bx + bw - 1} ${F - 1} ${z + k} ${B(k % 2 ? 'light_blue_concrete' : 'blue_concrete')}`);
            const all = c => `fill ${bx} ${F - 1} ${z + 1} ${bx + bw - 1} ${F - 1} ${z + L} ${B(c)}`;
            o.blocks.push(...normal);
            floorRow(lo, z + L + 1, hi, z + L + 1);
            // how long it's there: about walking pace early on, nearer a sprint later; then 2 seconds gone
            const vis = Math.round(L * 20 / (4.0 + 1.4 * d)) + 24, yellow = Math.round(vis * 0.5), red = Math.round(vis * 0.8), P = vis + 40;
            const ph = r.int(0, P - 1), at = k => (k + ph) % P, m = `#m${P}`, mid = `${bx + bw / 2} ${F} ${z + L / 2}`;
            ctx.periods.add(P);
            o.fns.normal = normal;
            o.sim.push({ kind: 'bridge', L, vis, bw });
            o.tick.push(
                `execute if score ${m} wo_v matches ${at(0)} run function wipeout:${ctx.fnBase}/${id}_normal`,
                `execute if score ${m} wo_v matches ${at(0)} run playsound minecraft:block.note_block.chime master @a ${mid} 1 1.4`,
                `execute if score ${m} wo_v matches ${at(yellow)} run ${all('yellow_concrete')}`,
                `execute if score ${m} wo_v matches ${at(yellow)} run playsound minecraft:block.note_block.pling master @a ${mid} 1 1.2`,
                `execute if score ${m} wo_v matches ${at(red)} run ${all('red_concrete')}`,
                `execute if score ${m} wo_v matches ${at(red)} run playsound minecraft:block.note_block.pling master @a ${mid} 1 0.7`,
                `execute if score ${m} wo_v matches ${at(vis)} run ${all('air')}`,
                `execute if score ${m} wo_v matches ${at(vis)} run playsound minecraft:block.glass.break master @a ${mid} 1 0.8`,
            );
            // when the level's set up: the bridge as it should be right now
            const when = (k1, k2, cmd) => {                // for k in [k1, k2): the matching ${m} ranges
                const a1 = at(k1), a2 = at(k2 - 1);
                return a1 <= a2 ? [`execute if score ${m} wo_v matches ${a1}..${a2} run ${cmd}`]
                    : [`execute if score ${m} wo_v matches ${a1}..${P - 1} run ${cmd}`, `execute if score ${m} wo_v matches 0..${a2} run ${cmd}`];
            };
            o.spawn.push(...when(0, yellow, `function wipeout:${ctx.fnBase}/${id}_normal`), ...when(yellow, red, all('yellow_concrete')),
                ...when(red, vis, all('red_concrete')), ...when(vis, P, all('air')));
            o.len = L + 2; o.secs = 1 + L / 4.5 + 1;
            break;
        }
        // ---- stepping tiles that flash red, then drop away, then come back ----
        case 'blink': {
            const count = r.int(4, 6) + Math.round(d * 2), P = 60 - Math.round(d * 20);
            floorRow(lo, z, hi, z);
            let tz = z + 2;
            // each tile comes back a hop's time after the one before (a hop is about 12 ticks), so you can
            // follow them across
            const lag = r.int(13, 17);
            for (let i = 0; i < count; i++) {
                const tx = x - 1 + (i % 2 ? r.int(0, 1) : -r.int(0, 1)), tile = c => `fill ${tx} ${F - 1} ${tz} ${tx + 2} ${F - 1} ${tz + 1} ${B(c)}`;
                const on = Math.round(P * 0.55), warn = Math.round(P * 0.75), phase = (i * lag) % P;
                const at = k => (k + phase) % P;
                o.blocks.push(tile(i % 2 ? 'blue_concrete' : 'light_blue_concrete'));
                o.tick.push(
                    `execute if score #m${P} wo_v matches ${at(on)} run ${tile('red_concrete')}`,
                    `execute if score #m${P} wo_v matches ${at(warn)} run ${tile('air')}`,
                    `execute if score #m${P} wo_v matches ${at(0)} run ${tile(i % 2 ? 'blue_concrete' : 'light_blue_concrete')}`,
                );
                o.spawn.push(tile(i % 2 ? 'blue_concrete' : 'light_blue_concrete'));
                o.sim.push({ kind: 'tile', P, phase, warn, i });
                ctx.periods.add(P);
                tz += 3;
            }
            floorRow(lo, tz, hi, tz);
            o.len = tz - z + 1; o.secs = 1.5 + count * 0.55;
            break;
        }
        // ---- duck and jump: a round platform with two red arms going round, a low one to jump over and
        // a high one to duck under (crouch) ----
        case 'duck': {
            const R = r.int(4, 5), cz = z + R + 1;
            disc(o, x, cz, R + 1, ctx.style);
            o.blocks.push(`fill ${x} ${F} ${cz} ${x} ${F + 2} ${cz} ${B('red_concrete')}`);        // the post in the middle
            const deg = sp(3, 5) * (r.chance(0.5) ? 1 : -1), yaw = r.int(0, 89);
            o.spawn.push(display([id, `${id}l`, 'wo_arm'], x + 0.5, F, cz + 0.5, 'red_concrete', 0.6, 0.55, 2 * R, { tx: -0.3, ty: 0.05, tz: -R, yaw }),
                display([id, `${id}h`, 'wo_arm'], x + 0.5, F + 1.55, cz + 0.5, 'red_concrete', 0.6, 0.4, 2 * R, { tx: -0.3, ty: 0.05, tz: -R, yaw: yaw + 90 }));
            o.tick.push(`execute as @e[tag=${id}] at @s run tp @s ~ ~ ~ ~${deg} ~`);
            const back = deg > 0 ? -18 : 18;
            for (let k = -R + 0.4; k <= R - 0.4; k += 0.75) {
                // the low arm: at your feet (jump it)
                o.tick.push(`execute as @e[tag=${id}l] at @s rotated as @s positioned ^ ^ ^${k.toFixed(2)} positioned ~-0.5 ~-0.3 ~-0.5 if entity @a[tag=wo_in,dx=0,dy=0,dz=0] as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:zap`);
                // the high arm: from just above a crouching player's head (1.5) up
                o.tick.push(`execute as @e[tag=${id}h] at @s rotated as @s positioned ^ ^ ^${k.toFixed(2)} positioned ~-0.5 ~ ~-0.5 if entity @a[tag=wo_in,dx=0,dy=0,dz=0] as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:zap`);
            }
            o.len = 2 * R + 3; o.secs = 4.5;
            break;
        }
        // ---- laser gates: red walls of light across the course that switch on and off, one after another.
        // Go through each while it's off ----
        case 'lasers': {
            const count = Math.min(5, 2 + Math.floor(d * 3)), gap = 4, L = count * gap + 2;
            floorRow(lo, z, hi, z + L - 1);
            const P = 50 - Math.round(d * 12), on = Math.round(P * (0.4 + 0.15 * d)), m = `#m${P}`;
            ctx.periods.add(P);
            const when = (k1, k2) => {                    // the #m ranges for k in [k1, k2) after ph
                return ph => { const a1 = (k1 + ph) % P, a2 = (k2 - 1 + ph) % P; return a1 <= a2 ? [[a1, a2]] : [[a1, P - 1], [0, a2]]; };
            };
            for (let i = 0; i < count; i++) {
                const gz = z + 2 + i * gap, lid = `${id}g${i}`, ph = (i * Math.round(P / count) + r.int(0, 4)) % P;
                // the posts it shines between
                for (const px of [lo - 1, hi + 1]) o.blocks.push(`fill ${px} ${F} ${gz} ${px} ${F + 1} ${gz} ${B('blue_concrete')}`, `setblock ${px} ${F + 2} ${gz} ${B('redstone_lamp[lit=true]')}`);
                const glass = st => `data merge entity @e[tag=${lid},limit=1] {block_state:{Name:"minecraft:${st}"}}`;
                o.spawn.push(display([id, lid], lo, F + 0.1, gz + 0.4, 'red_stained_glass', w, 1.7, 0.2));
                // set as it should be right now, then on and off in time
                o.spawn.push(...when(on, P)(ph).map(([a, b]) => `execute if score ${m} wo_v matches ${a}..${b} run ${glass('air')}`));
                o.tick.push(`execute if score ${m} wo_v matches ${ph} run ${glass('red_stained_glass')}`,
                    `execute if score ${m} wo_v matches ${ph} run playsound minecraft:block.beacon.power_select master @a ${x} ${F + 1} ${gz} 0.4 2`,
                    `execute if score ${m} wo_v matches ${(ph + on) % P} run ${glass('air')}`,
                    ...when(0, on)(ph).map(([a, b]) => `execute if score ${m} wo_v matches ${a}..${b} positioned ${lo + 0.1} ${F} ${gz - 0.3} if entity @a[tag=wo_in,dx=${(w - 1.2).toFixed(2)},dy=0.8,dz=0] positioned ${x + 0.5} ${F + 1} ${gz + 0.5} as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:zap`));
                o.sim.push({ kind: 'gate', P, ph, on });
            }
            o.len = L; o.secs = 1.5 + count * 1.1;
            break;
        }
        // ---- rolling bars: low red bars rolling down the course at you, one after another: jump them ----
        case 'barrels': {
            const L = r.int(14, 18) + Math.round(d * 6);
            floorRow(lo, z, hi, z + L - 1);
            const travel = L - 1, t = Math.round(travel / sp(0.12, 0.2)), v = travel / t, pause = Math.round(26 - 12 * d);
            const steps = [{ d: [0, 0, -v], t }, { d: [0, 0, travel], t: 1 }, { d: [0, 0, 0], t: pause }];
            const bars = d < 0.5 ? 1 : 2, tot = t + 1 + pause;
            for (let j = 0; j < bars; j++) {
                const bid = `${id}b${j}`, off = Math.round(j * tot / bars + r.int(0, 8)) % tot;
                o.spawn.push(display([id, bid], ...posAt([lo, F, z + L - 1], steps, off), 'red_concrete', w, 0.6, 0.8), `scoreboard players set @e[tag=${bid}] wo_ph ${off}`);
                // (only up to 0.6 high: jump and you're over it)
                o.tick.push(...moveLines(bid, steps), `execute as @e[tag=${bid}] at @s positioned ~0.1 ~-0.4 ~-0.1 if entity @a[tag=wo_in,dx=${(w - 1.2).toFixed(2)},dy=0,dz=0] positioned ~${(w / 2).toFixed(2)} ~0.7 ~0.5 as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:zap`);
            }
            o.len = L; o.secs = 2 + L / 5;
            break;
        }
        // ---- big balls: giant red and white bouncy balls over the water: bounce from one to the next ----
        case 'balls': {
            const count = r.int(3, 4) + (d > 0.55 ? 1 : 0);
            floorRow(lo, z, hi, z);
            let zc = z + 1, cx = x;
            for (let i = 0; i < count; i++) {
                zc += r.int(1, 2) + (d > 0.6 ? 1 : 0);
                const cz = zc + 2, cy = F - 3;
                if (i) cx = Math.max(x - 3, Math.min(x + 3, cx + r.int(-2, 2)));
                for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
                    if (dx * dx + dy * dy + dz * dz > 5.5) continue;
                    o.blocks.push(`setblock ${cx + dx} ${cy + dy} ${cz + dz} ${B(dy === 0 ? 'white_wool' : 'red_wool')}`);
                }
                zc = cz + 3;
            }
            zc += 1;
            floorRow(lo, zc, hi, zc);
            o.len = zc - z + 1; o.secs = 1.2 + count * 1.0;
            break;
        }
        // ---- stepping stones: little floating blocks to jump across ----
        case 'stones': {
            const count = r.int(5, 7) + Math.round(d * 3), size = d < 0.4 ? 2 : d < 0.75 && r.chance(0.5) ? 2 : 1;
            floorRow(lo, z, hi, z);
            let tz = z + 1, px = x;
            for (let i = 0; i < count; i++) {
                tz += size === 2 ? r.int(1, 2) : r.int(1, d > 0.7 ? 2 : 1) + (i % 3 === 2 ? 0 : 0);
                px = Math.max(x - 3, Math.min(x + 3 - size + 1, px + r.int(-(size === 2 ? 2 : 1), size === 2 ? 2 : 1)));
                o.blocks.push(`fill ${px} ${F - 1} ${tz} ${px + size - 1} ${F - 1} ${tz + size - 1} ${B(i % 2 ? 'blue_concrete' : 'light_blue_concrete')}`);
                tz += size;
            }
            tz += r.int(1, 2);
            floorRow(lo, tz, hi, tz);
            o.len = tz - z + 1; o.secs = 1 + count * 0.6;
            break;
        }
    }
    return o;
}

// ---------- level 100: the tower ----------
// A black and yellow tower rising out of the sea: a column in the middle, round landings stacked up it
// and a spiral of steps on the outside from each landing to the next (three quarters of the way round,
// one block up a step). A red arm sweeps round every landing: jump it, then walk round to the next
// steps. The emerald on the very top wins the game.
const TOWER = { floors: 4, rise: 12, ring: 6.5, outer: 9.5, column: 2.5, a0: 315 };
function tower(ctx, z0) {
    const { n, x, r } = ctx, T = TOWER;
    const id = `o${n}_tower`, cx = x, cz = z0 + 18;
    const o = { id, type: 'tower', blocks: [], spawn: [], tick: [], reroll: [], fns: {}, len: 0, secs: 45 };
    const H = i => F - 1 + i * T.rise;                         // landing i's blocks (feet one above)
    const top = H(T.floors);
    const cells = [];
    for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) {
        const rr = Math.hypot(dx, dz), deg = ((Math.atan2(dz, dx) * 180 / Math.PI) + 360) % 360;
        cells.push({ x: cx + dx, z: cz + dz, rr, deg });
    }
    const col = (c, k) => B(k % 2 ? 'yellow_concrete' : 'black_concrete');
    // the bridge from the start pad
    o.blocks.push(...floorFill(x - 2, z0 + 6, x + 2, cz - 3, 'hazard'));
    // the column, from the sea to the top, black with yellow bands
    for (const c of cells.filter(c => c.rr < T.column)) {
        o.blocks.push(`fill ${c.x} ${SEA + 1} ${c.z} ${c.x} ${top} ${c.z} ${B('black_concrete')}`);
        for (let y = SEA + 3; y < top; y += 6) o.blocks.push(`fill ${c.x} ${y} ${c.z} ${c.x} ${y + 1} ${c.z} ${B('yellow_concrete')}`);
    }
    // the landings: yellow with a black rim (the top one is a whole disc with emerald in the middle)
    for (let i = 0; i <= T.floors; i++) for (const c of cells.filter(c => c.rr < T.ring && (i === T.floors || c.rr >= T.column))) {
        const b = i === T.floors && Math.abs(c.x - cx) <= 2 && Math.abs(c.z - cz) <= 2 ? 'emerald_block' : c.rr >= T.ring - 1 ? 'black_concrete' : (c.x + c.z) % 2 ? 'yellow_concrete' : 'black_concrete';
        o.blocks.push(`setblock ${c.x} ${H(i)} ${c.z} ${B(i === T.floors || c.rr >= T.ring - 1 ? b : 'yellow_concrete')}`);
    }
    // the steps: from landing i, three quarters round on the outside, up to landing i+1. Some of them
    // come and go: there, then red, then gone for a second, then back (wait for it, then jump on)
    const steps = T.rise - 1, per = 270 / steps, BP = 60, ctx2 = ctx;
    for (let i = 0; i < T.floors; i++) {
        const a = (T.a0 + 90 * i) % 360;
        const vanish = new Set([3, 7, ...(i >= 2 ? [5] : []), ...(i >= 3 ? [9] : [])]);
        const byStep = {};
        for (const c of cells.filter(c => c.rr >= T.ring && c.rr < T.outer)) {
            const rel = (c.deg - a + 360) % 360;
            if (rel >= 270) continue;
            const k = Math.floor(rel / per) + 1;
            o.blocks.push(`setblock ${c.x} ${H(i) + k} ${c.z} ${col(c, k)}`);
            (byStep[k] ??= []).push(c);
        }
        for (const k of vanish) {
            const at = (i * 23 + k * 11) % BP, cs = byStep[k], y = H(i) + k;
            const set = b => `function wipeout:${ctx.fnBase}/${id}_s${i}_${k}_${b}`;
            o.fns[`s${i}_${k}_red`] = cs.map(c => `setblock ${c.x} ${y} ${c.z} ${B('red_concrete')}`);
            o.fns[`s${i}_${k}_air`] = cs.map(c => `setblock ${c.x} ${y} ${c.z} ${B('air')}`);
            o.fns[`s${i}_${k}_back`] = cs.map(c => `setblock ${c.x} ${y} ${c.z} ${col(c, k)}`);
            o.tick.push(`execute if score #m${BP} wo_v matches ${at} run ${set('red')}`,
                `execute if score #m${BP} wo_v matches ${(at + 15) % BP} run ${set('air')}`,
                `execute if score #m${BP} wo_v matches ${(at + 37) % BP} run ${set('back')}`);
            o.spawn.push(set('back'));
        }
        ctx2.periods.add(BP);
    }
    // punching gloves shooting out of the column across landings 1 to 3 (where you walk round to the
    // next steps): they knock you off. Each sits inside the column, comes out on an arm and goes back
    for (let i = 1; i < T.floors; i++) {
        // the middle of the way round this landing, to the nearest straight direction
        const mid = (T.a0 + 90 * (i - 1) + (i % 2 ? 45 : -45) + 360) % 360, ang = Math.round(mid / 90) * 90 % 360;
        const ux = Math.round(Math.cos(ang * Math.PI / 180)), uz = Math.round(Math.sin(ang * Math.PI / 180));
        const gid = `${id}g${i}`, G = 1.4, rest = 1.0, reach = 4.6, y = H(i) + 1.2;
        const out = 5, back = Math.round(reach / 0.15), wait = 28 - i * 4 + r.int(0, 8);
        const st = [{ d: [0, 0, 0], t: wait }, { d: [ux * reach / out, 0, uz * reach / out], t: out }, { d: [0, 0, 0], t: 6 }, { d: [-ux * reach / back, 0, -uz * reach / back], t: back }];
        const off = r.int(0, wait + out + 6 + back - 1);
        // the glove's corner, resting with its middle a block out from the column's middle (inside it)
        const gc = [cx + 0.5 + ux * rest - G / 2, y, cz + 0.5 + uz * rest - G / 2];
        const armL = 3, armC = [cx + 0.5 + ux * (rest - G / 2 - armL / 2), y + 0.45, cz + 0.5 + uz * (rest - G / 2 - armL / 2)];
        const asx = ux ? armL : 0.5, asz = uz ? armL : 0.5;
        o.spawn.push(display([id, gid, 'wo_glove'], ...posAt(gc, st, off), 'red_wool', G, G, G),
            display([id, gid, 'wo_garm'], ...posAt([armC[0] - asx / 2, armC[1], armC[2] - asz / 2], st, off), 'iron_block', asx, 0.5, asz),
            `scoreboard players set @e[tag=${gid}] wo_ph ${off}`);
        o.tick.push(...moveLines(gid, st), hitBox(gid, G, G, G, `tag=${gid},tag=wo_glove`, 'hit {p:2}'), hitBox(gid, asx, 0.5, asz, `tag=${gid},tag=wo_garm`, 'hit {p:1}'));
    }
    // a red arm sweeping round each landing (faster going up; two on the last one)
    for (let i = 0; i < T.floors; i++) {
        const arms = i === T.floors - 1 ? 2 : 1, deg = (4 + i * 1.2) * (i % 2 ? -1 : 1), len = T.ring - T.column;
        for (let a = 0; a < arms; a++) {
            const aid = `${id}a${i}`;
            o.spawn.push(display([id, aid, 'wo_arm'], cx + 0.5, H(i) + 1, cz + 0.5, 'red_concrete', 0.6, 0.55, len, { tx: -0.3, ty: 0.05, tz: T.column, yaw: a * 180 + r.int(0, 89) }));
            if (a === 0) {
                o.tick.push(`execute as @e[tag=${aid}] at @s run tp @s ~ ~ ~ ~${deg} ~`);
                for (let k = T.column + 0.4; k <= T.ring - 0.4; k += 0.75)
                    o.tick.push(`execute as @e[tag=${aid}] at @s rotated as @s positioned ^ ^ ^${k.toFixed(2)} positioned ~-0.5 ~-0.3 ~-0.5 if entity @a[tag=wo_in,dx=0,dy=0,dz=0] as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:zap`);
            }
        }
    }
    o.blocks.push(`kill @e[type=minecraft:text_display,tag=wo_sign,x=${cx},y=${top + 5},z=${cz},distance=..3]`,
        `summon minecraft:text_display ${cx + 0.5} ${top + 5.2} ${cz + 0.5} {Tags:["wo_sign"],billboard:"vertical",scale:[3f,3f,3f],background:1711276032,text:{text:"FINISH",color:"gold",bold:true}}`);
    o.len = cz + 10 - z0;
    return { o, cx, cz, top };
}

// a slab of course at the floor, in this level's pattern
function floorFill(x1, z1, x2, z2, style) {
    const out = [`fill ${x1} ${F - 1} ${z1} ${x2} ${F - 1} ${z2} ${B('light_blue_concrete')}`];
    const blue = (a, b, c, e) => out.push(`fill ${a} ${F - 1} ${b} ${c} ${F - 1} ${e} ${B('blue_concrete')}`);
    if (style === 'lane') { blue(x1, z1, x2, z2); return out; }
    if (style === 'hazard') {                       // black and yellow stripes (level 100)
        out[0] = `fill ${x1} ${F - 1} ${z1} ${x2} ${F - 1} ${z2} ${B('black_concrete')}`;
        for (let zz = z1; zz <= z2; zz++) for (let xx = x1; xx <= x2; xx++) if ((((xx + zz) % 4) + 4) % 4 < 2) out.push(`setblock ${xx} ${F - 1} ${zz} ${B('yellow_concrete')}`);
        return out;
    }
    if (style === 'edges' || style === 'zigzag') { blue(x1, z1, x1, z2); blue(x2, z1, x2, z2); }
    if (style === 'center') { const m = Math.floor((x1 + x2) / 2); blue(m, z1, m, z2); }
    if (style === 'stripes') for (let zz = z1; zz <= z2; zz++) if (((zz % 4) + 4) % 4 === 0) blue(x1, zz, x2, zz);
    if (style === 'checker') for (let zz = z1; zz <= z2; zz++) for (let xx = x1; xx <= x2; xx++) if ((((xx + zz) % 2) + 2) % 2 === 0 && (zz % 2 === 0)) out.push(`setblock ${xx} ${F - 1} ${zz} ${B('blue_concrete')}`);
    if (style === 'zigzag') for (let zz = z1; zz <= z2; zz++) { const k = ((zz % 6) + 6) % 6, xx = x1 + Math.min(k, 6 - k); if (xx <= x2) out.push(`setblock ${xx} ${F - 1} ${zz} ${B('blue_concrete')}`); }
    return out;
}
// a round platform (radius R) with a blue rim
function disc(o, cx, cz, R, style) {
    for (let dz = -R; dz <= R; dz++) {
        const h = Math.floor(Math.sqrt(R * R - dz * dz + 0.5));
        o.blocks.push(`fill ${cx - h} ${F - 1} ${cz + dz} ${cx + h} ${F - 1} ${cz + dz} ${B(Math.abs(dz) % 3 === 0 && style !== 'center' ? 'light_blue_concrete' : 'light_blue_concrete')}`);
        o.blocks.push(`setblock ${cx - h} ${F - 1} ${cz + dz} ${B('blue_concrete')}`, `setblock ${cx + h} ${F - 1} ${cz + dz} ${B('blue_concrete')}`);
    }
    o.blocks.push(`fill ${cx - R} ${F - 1} ${cz} ${cx + R} ${F - 1} ${cz} ${B('blue_concrete')}`, `fill ${cx} ${F - 1} ${cz - R} ${cx} ${F - 1} ${cz + R} ${B('blue_concrete')}`);
}
// a boxing glove made of red and white wool, its top at the course's height (z: its back)
function glove(o, gx, gz) {
    o.blocks.push(
        `fill ${gx - 1} ${F - 2} ${gz} ${gx + 1} ${F - 1} ${gz + 3} ${B('red_wool')}`,          // the fist
        `fill ${gx - 1} ${F - 2} ${gz} ${gx + 1} ${F - 1} ${gz} ${B('white_wool')}`,            // the cuff
        `setblock ${gx + 2} ${F - 2} ${gz + 2} ${B('red_wool')}`,                                // the thumb
        `fill ${gx - 1} ${F - 3} ${gz + 1} ${gx + 1} ${F - 3} ${gz + 2} ${B('red_wool')}`,
    );
}
// a moving block: a block display (its corner at x y z), sized sx sy sz
function display(tags, x, y, z, block, sx, sy, sz, { tx = 0, ty = 0, tz = 0, yaw = 0 } = {}) {
    const f = v => `${+(+v).toFixed(3)}f`;
    // (always with a decimal point: Minecraft puts whole-number positions in the middle of the block)
    return `summon minecraft:block_display ${(+x).toFixed(3)} ${(+y).toFixed(3)} ${(+z).toFixed(3)} {Tags:${J(['wo_mv', 'wo_new', ...tags])},Rotation:[${yaw}f,0f],teleport_duration:1,block_state:{Name:"${B(block)}"},`
        + `transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[${f(tx)},${f(ty)},${f(tz)}],scale:[${f(sx)},${f(sy)},${f(sz)}]}}`;
}
// where a mover is after `phase` ticks of its steps
function posAt(p, steps, phase) {
    const q = [...p], tot = steps.reduce((a, s) => a + s.t, 0);
    let left = ((phase % tot) + tot) % tot;
    for (const s of steps) { const k = Math.min(left, s.t); for (let i = 0; i < 3; i++) q[i] += s.d[i] * k; left -= k; if (!left) break; }
    return q.map(v => +v.toFixed(3));
}
// the tick lines that move it: a count of ticks (wo_ph) and a move for each step
function moveLines(tag, steps) {
    const tot = steps.reduce((a, s) => a + s.t, 0), out = [`scoreboard players add @e[tag=${tag}] wo_ph 1`, `scoreboard players set @e[tag=${tag},scores={wo_ph=${tot}..}] wo_ph 0`];
    let a = 0;
    for (const s of steps) {
        const b = a + s.t - 1;
        if (s.d.some(v => v)) out.push(`execute as @e[tag=${tag},scores={wo_ph=${a}..${b}}] at @s run tp @s ~${+s.d[0].toFixed(4)} ~${+s.d[1].toFixed(4)} ~${+s.d[2].toFixed(4)}`);
        a = b + 1;
    }
    return out;
}
// touching a box (corner at the mover, sized sx sy sz): red kills you (zap); a punching glove knocks
// you away from its middle (hit)
function hitBox(tag, sx, sy, sz, sel = `tag=${tag}`, what = 'zap') {
    const e = 0.1;
    return `execute as @e[${sel}] at @s positioned ~${e} ~${e} ~${e} if entity @a[tag=wo_in,dx=${+(sx - 1 - 2 * e).toFixed(2)},dy=${+(sy - 1 - 2 * e).toFixed(2)},dz=${+(sz - 1 - 2 * e).toFixed(2)}] `
        + `positioned ~${+(sx / 2 - e).toFixed(2)} ~${+(sy / 2 - e).toFixed(2)} ~${+(sz / 2 - e).toFixed(2)} as @a[tag=wo_in,sort=nearest,limit=1] run function wipeout:${what}`;
}

// ---------- the levels ----------
const NAMES = ['Splash Zone', 'Spin Cycle', 'Glove Love', 'Cube Rush', 'Door Dash', 'Wall Street', 'Zip It', 'Knock Knock', 'Sky Sweep', 'Bounce House', 'Red Alert', 'Tight Rope',
    'Big Splash', 'Punch Line', 'Crush Hour', 'Blink Twice', 'Seaside Sprint', 'Wet and Wild', 'Sweeper Keeper', 'High Tide', 'Deep End', 'Belly Flop', 'Cannonball', 'Wave Rider',
    'Final Fling', 'No Way Through', 'Lucky Door', 'Slip and Slide', 'Over the Edge', 'Tidal Turn'];
const POOL = ['spinner', 'gloves', 'cubes', 'beam', 'doors', 'wall', 'zipline', 'punch', 'crusher', 'blink', 'spinfield', 'balls', 'stones', 'lasers', 'barrels', 'duck'];

let designs = null;
function design() {
    if (designs) return designs;
    const out = [];
    let z0 = ORIGIN_Z;
    for (let n = 1; n <= LEVELS; n++) {
        const r = rngFor(n * 7919 + 13), d = 0.15 + 0.85 * (n - 1) / (LEVELS - 1);   // (level 1 isn't the easiest it could be)
        const w = n <= 25 ? 5 : n <= 65 ? 4 : 3, x = ORIGIN_X;
        const count = n <= 80 ? 2 : 3;                          // obstacles in the level
        const style = FLOOR_STYLES[(n - 1) % FLOOR_STYLES.length], stand = STAND_STYLES[(n * 3) % STAND_STYLES.length];
        const ctx = { n, d, r, x, w, style, periods: new Set(), fnBase: `lvl/${n}` };
        const parts = [];
        if (n === LEVELS) {                                     // the tower
            const t = tower({ ...ctx, style: 'hazard' }, z0);
            out.push({ n, x, z0, w: 5, style: 'hazard', stand, parts: [{ ...t.o, z: z0 + 6 }], finish: null, tower: t, length: t.o.len + 1, secs: t.o.secs,
                name: 'The Tower', periods: [...ctx.periods], kinds: ['tower'] });
            break;
        }
        let z = z0 + 6, secs = 1.5;                         // the start pad
        const pool = POOL.filter(t => n >= FIRST[t]);
        const used = [];
        // the new obstacle of this level goes in for sure (where one starts), the rest from the pool
        const fresh = POOL.find(t => FIRST[t] === n);
        while (parts.length < count) {
            let t = (fresh && !used.includes(fresh)) ? fresh : r.pick(pool);
            if (used.includes(t)) t = r.pick(pool.filter(k => !used.includes(k)));
            const o = obstacle(t, { ...ctx, z });
            parts.push({ ...o, z }); used.push(t);
            z += o.len;
            secs += o.secs;
            if (parts.length < count) { z += 3; secs += 0.6; }      // a short run of course before the next
        }
        const finish = z;                                      // the emerald pad (2 long), then the next level
        const length = finish + 2 - z0;
        out.push({ n, x, z0, w, style, stand, parts, finish, length, secs: Math.round(secs), name: NAMES[(n * 7) % NAMES.length], periods: [...ctx.periods],
            kinds: used });
        z0 += length;
    }
    return designs = out;
}
export const wipeoutLevels = () => design();
export const wipeoutLevel = n => design()[n - 1];
const levelStart = L => [L.x, F, L.z0 + 2];

// ---------- building a level ----------
function levelCommands(L) {
    const { x, z0, w } = L, lo = x - Math.floor((w - 1) / 2), hi = lo + w - 1, end = L.z0 + L.length;
    const c = [];
    // the sea under it all, with a sandy floor (each level fills its stretch of the line;
    // the first and last go on a bit further)
    const [sx1, sx2, sz1, sz2] = seaArea(L);
    for (let zz = sz1; zz <= sz2; zz += 60) {
        const z2 = Math.min(sz2, zz + 59);
        // (sandstone under the sand: sand over nothing would fall)
        c.push(`fill ${sx1} ${SEA - 4} ${zz} ${sx2} ${SEA - 4} ${z2} ${B('sandstone')}`, `fill ${sx1} ${SEA - 3} ${zz} ${sx2} ${SEA - 3} ${z2} ${B('sand')}`, `fill ${sx1} ${SEA - 2} ${zz} ${sx2} ${SEA} ${z2} ${B('water')}`);
    }
    // the start pad, the course parts (a short run of course between them), the emerald pad at the end
    c.push(...floorFill(lo - 1, z0, hi + 1, z0 + 5, L.style));
    c.push(`fill ${lo - 1} ${F - 1} ${z0} ${hi + 1} ${F - 1} ${z0} ${B('blue_concrete')}`);
    L.parts.forEach((p, i) => { if (i) c.push(...floorFill(lo, p.z - 3, hi, p.z - 1, L.style)); c.push(...p.blocks); });
    if (L.tower) c.push(`fill ${lo - 1} ${F - 1} ${z0} ${hi + 1} ${F - 1} ${z0} ${B('yellow_concrete')}`);
    // (quartz under it all the way down to the sea floor)
    if (!L.tower) c.push(`fill ${lo - 2} ${SEA - 3} ${L.finish} ${hi + 2} ${F - 2} ${L.finish + 1} ${B('quartz_block')}`,
        `fill ${lo - 2} ${F - 1} ${L.finish} ${hi + 2} ${F - 1} ${L.finish + 1} ${B('emerald_block')}`,
    // the arch over the emerald pad
    `fill ${lo - 2} ${F} ${L.finish + 1} ${lo - 2} ${F + 4} ${L.finish + 1} ${B('light_blue_concrete')}`, `fill ${hi + 2} ${F} ${L.finish + 1} ${hi + 2} ${F + 4} ${L.finish + 1} ${B('light_blue_concrete')}`,
        `fill ${lo - 2} ${F + 5} ${L.finish + 1} ${hi + 2} ${F + 5} ${L.finish + 1} ${B('blue_concrete')}`);
    // the side walls: white and blue, from the sea floor to three blocks under the course. On top, the
    // crowd: colourful concrete people and birch planks, scattered, up to three high. Floodlights on
    // tall white poles every so often, and a line of sea lanterns in the water a little in from the walls
    // (it all runs the whole way along, at the same place for every level)
    const s1 = z0, s2 = end - 1, IN = L.tower ? TOWER_WALL_X : WALL_X, top = F - 3;
    const cr = rngFor(L.n * 131 + 5);
    const PEOPLE = ['red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink', 'white', 'black', 'gray', 'brown'];
    for (const side of [-1, 1]) {
        const face = x + side * IN, far = x + side * (IN + 5), xa = Math.min(face, far), xb = Math.max(face, far);
        c.push(`fill ${xa} ${SEA - 5} ${s1} ${xb} ${top} ${s2} ${B('white_concrete')}`);
        c.push(...standWall(face, SEA - 5, top, s1, s2, L.stand));                 // the design on the face
        c.push(`fill ${face} ${top} ${s1} ${face} ${top} ${s2} ${B('blue_concrete')}`);
        for (let zz = s1; zz <= s2; zz++) for (let k = 0; k < 6; k++) {
            const cx2 = face + side * k, roll = cr.next();
            if (roll < 0.2) {                                        // someone watching: one or two blocks
                const h = cr.chance(0.7) ? 2 : 1;
                c.push(`fill ${cx2} ${top + 1} ${zz} ${cx2} ${top + h} ${zz} ${B(`${cr.pick(PEOPLE)}_concrete`)}`);
            } else if (roll < 0.5) {                                 // birch planks, one to three high
                c.push(`fill ${cx2} ${top + 1} ${zz} ${cx2} ${top + cr.int(1, 3)} ${zz} ${B('birch_planks')}`);
            }
        }
        // sea lanterns set in the sea floor, 3x3x3 cubes in a line a little in from the wall
        for (let zz = s1 + (((ORIGIN_Z + 1 - s1) % 9) + 9) % 9; zz + 1 <= s2; zz += 9) if (zz - 1 >= s1) {
            const lx = x + side * (IN - 3);
            c.push(`fill ${lx - 1} ${SEA - 5} ${zz - 1} ${lx + 1} ${SEA - 3} ${zz + 1} ${B('sea_lantern')}`);
        }
        // floodlights: a white pole with a 3x3x3 cube of sea lanterns on top, twelve blocks up in all
        for (let zz = s1 + (((ORIGIN_Z + 20 - s1) % 48) + 48) % 48; zz <= s2; zz += 48) {
            const px = x + side * (IN + 4);
            c.push(`fill ${px} ${top + 1} ${zz} ${px} ${top + 9} ${zz} ${B('white_concrete')}`,
                `fill ${px - 1} ${top + 10} ${zz - 1} ${px + 1} ${top + 12} ${zz + 1} ${B('sea_lantern')}`);
        }
    }
    // the level's number over the start, and the finish sign
    c.push(`kill @e[type=minecraft:text_display,tag=wo_sign,x=${x},y=${F + 3},z=${z0 + 3},distance=..3]`,
        `summon minecraft:text_display ${x + 0.5} ${F + 3.2} ${z0 + 3.5} {Tags:["wo_sign"],billboard:"vertical",scale:[2f,2f,2f],background:1711276032,text:[{text:"LEVEL ${L.n}",color:"white",bold:true},{text:"\\n${L.name}",color:"aqua"}]}`,
    );
    return c.filter(Boolean);
}
// the stretch of sea (and stands) a level builds: x1 x2 z1 z2
function seaArea(L) {
    return [L.x - SEA_W, L.x + SEA_W - 1, L.n === 1 ? L.z0 - 30 : L.z0, L.n === LEVELS ? L.z0 + L.length + 30 : L.z0 + L.length - 1];
}
// the back wall: the concrete design all the way up
function standWall(x, y1, y2, z1, z2, st) {
    const out = [];
    for (let y = y1; y <= y2; y++) {
        const row = [];
        for (let zz = z1; zz <= z2; zz++) row.push([zz, st.cols[patternIndex(st.name, zz, y - y1) % 2]]);
        out.push(...runs(row, (a, b, col) => `fill ${x} ${y} ${a} ${x} ${y} ${b} ${B(col)}`));
    }
    return out;
}
function patternIndex(name, z, y) {
    const m = (v, k) => ((v % k) + k) % k;
    switch (name) {
        case 'waves': return m(Math.round(Math.sin(z / 3) * 1.5) + y, 3);
        case 'checker': return m(Math.floor(z / 2) + y, 2);
        case 'stripes': return m(y, 4);
        case 'diamonds': return Math.abs(m(z, 6) - 3) + Math.abs(m(y, 6) - 3) <= 2 ? 0 : m(y, 2) + 1;
        case 'bands': return m(Math.floor(z / 4), 3);
        case 'dots': return m(z, 3) === 0 && m(y, 2) === 0 ? 1 : 0;
        case 'arrows': return m(z - Math.abs(m(y, 6) - 3), 6) < 2 ? 0 : m(y, 2) ? 1 : 2;
        default: return 0;
    }
}
// one fill per run of the same block
function runs(cells, make) {
    const out = [];
    let a = null, prev = null, col = null;
    for (const [z, c] of cells) {
        if (c === col && z === prev + 1) { prev = z; continue; }
        if (col) out.push(make(a, prev, col));
        a = prev = z; col = c;
    }
    if (col) out.push(make(a, prev, col));
    return out;
}
function extraCommands() {
    const [jx, jy, jz] = JAIL, [wx, wy, wz] = WIN;
    return [
        `fill ${jx - 2} ${jy - 1} ${jz - 2} ${jx + 2} ${jy + 3} ${jz + 2} ${B('iron_bars')}`,
        `fill ${jx - 2} ${jy - 1} ${jz - 2} ${jx + 2} ${jy - 1} ${jz + 2} ${B('blue_concrete')}`,
        `fill ${jx - 2} ${jy + 3} ${jz - 2} ${jx + 2} ${jy + 3} ${jz + 2} ${B('blue_concrete')}`,
        `fill ${jx - 1} ${jy} ${jz - 1} ${jx + 1} ${jy + 2} ${jz + 1} ${B('air')}`,
        `fill ${wx - 6} ${wy - 1} ${wz - 6} ${wx + 6} ${wy - 1} ${wz + 6} ${B('emerald_block')}`,
        `fill ${wx - 2} ${wy - 1} ${wz - 2} ${wx + 2} ${wy - 1} ${wz + 2} ${B('emerald_block')}`,
        `fill ${wx - 6} ${wy} ${wz - 6} ${wx + 6} ${wy} ${wz + 6} ${B('white_concrete')} hollow`,
        `fill ${wx - 5} ${wy} ${wz - 5} ${wx + 5} ${wy} ${wz + 5} ${B('air')}`,
        `kill @e[type=minecraft:text_display,tag=wo_sign,x=${wx},y=${wy + 4},z=${wz},distance=..5]`,
        `summon minecraft:text_display ${wx + 0.5} ${wy + 4} ${wz + 0.5} {Tags:["wo_sign"],billboard:"center",scale:[3f,3f,3f],text:{text:"YOU BEAT ALL 100 LEVELS",color:"gold",bold:true},background:0}`,
    ];
}

// ---------- building the world (the same way as the Dropper) ----------
async function patient(mc, command) {
    try { return await mc(command); } catch (e) {
        if (!/timeout/i.test(e.message)) throw e;
        for (let i = 0; i < 60; i++) { try { await mc('list'); return ''; } catch (e2) { if (!/timeout/i.test(e2.message)) throw e2; } }
        throw e;
    }
}
function levelParts(L) {
    const parts = [[]]; let work = 0;
    for (const c of levelCommands(L)) {
        const m = /^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+)/.exec(c);
        const wk = m ? (Math.abs(m[4] - m[1]) + 1) * (Math.abs(m[5] - m[2]) + 1) * (Math.abs(m[6] - m[3]) + 1) : 1;
        if (parts[parts.length - 1].length && (work + wk > 300000 || parts[parts.length - 1].length >= 400)) { parts.push([]); work = 0; }
        parts[parts.length - 1].push(c); work += wk;
    }
    return parts;
}
const progressFile = world => path.join(SAVES_DIR, world, 'unbound-wipeout.json');
function saveProgress(n, world = WIPEOUT_WORLD) {
    try { fs.writeFileSync(progressFile(world), JSON.stringify({ build: WIPEOUT_BUILD, levels: LEVELS, done: n, saved: new Date().toISOString() }, null, 2)); } catch { }
}
export function wipeoutProgress(world = WIPEOUT_WORLD) {
    try { const p = JSON.parse(fs.readFileSync(progressFile(world), 'utf8')); return p.build === WIPEOUT_BUILD ? Math.min(LEVELS, p.done ?? 0) : 0; } catch { return 0; }
}
export function wipeoutBuilt(world = WIPEOUT_WORLD) {
    try { const p = JSON.parse(fs.readFileSync(progressFile(world), 'utf8')); return p.build === WIPEOUT_BUILD && !!p.built && (p.done ?? 0) >= LEVELS; } catch { return false; }
}
export function markWipeoutBuilt(world = WIPEOUT_WORLD) {
    fs.writeFileSync(progressFile(world), JSON.stringify({ build: WIPEOUT_BUILD, levels: LEVELS, done: LEVELS, built: new Date().toISOString() }, null, 2));
}
export async function buildWipeout(mc, { log = () => {}, progress = () => {}, from = 1, to = LEVELS } = {}) {
    const area = async (x1, z1, x2, z2, fns) => {
        await mc(`forceload add ${x1} ${z1} ${x2} ${z2}`);
        for (let i = 0; i < 300; i++) {
            if (/passed/i.test(await mc(`execute if loaded ${x1} 0 ${z1} if loaded ${x2} 0 ${z2} if loaded ${x1} 0 ${z2} if loaded ${x2} 0 ${z1}`))) break;
            await new Promise(r => setTimeout(r, 100));
        }
        for (const part of fns) {
            const res = await patient(mc, `function wipeout:${part}`);
            if (/Unknown|Incorrect|Expected|Invalid|not loaded|Too many|Can't find/i.test(res)) log(`Wipeout build (${part}): ${res.trim().slice(0, 200)}`);
        }
        await mc(`forceload remove ${x1} ${z1} ${x2} ${z2}`);
    };
    if (from === 1) await area(Math.min(JAIL[0], WIN[0]) - 8, Math.min(JAIL[2], WIN[2]) - 8, Math.max(JAIL[0], WIN[0]) + 8, Math.max(JAIL[2], WIN[2]) + 8, ['build/extra']);
    for (let n = from; n <= to; n++) {
        const L = wipeoutLevel(n);
        // the level in strips of the course's length (forceloading less at once)
        const [x1, x2, z1, z2] = seaArea(L);
        await area(x1, z1, x2, z2, Array.from({ length: levelParts(L).length }, (_, i) => `build/${n}_${i + 1}`));
        saveProgress(n);
        progress(n);
    }
    const [sx, sy, sz] = levelStart(wipeoutLevel(1));
    if (to >= LEVELS) await mc(`setworldspawn ${sx} ${sy} ${sz}`);
}
export function buildPackFiles(from, to) {
    const f = { 'pack.mcmeta': JSON.stringify({ pack: { description: 'Unbound Wipeout: building the levels', min_format: 94, max_format: 999 } }, null, 2) };
    if (from === 1) f['data/wipeout/function/build/extra.mcfunction'] = extraCommands().join('\n') + '\n';
    for (let n = from; n <= to; n++) levelParts(wipeoutLevel(n)).forEach((p, i) => { f[`data/wipeout/function/build/${n}_${i + 1}.mcfunction`] = p.join('\n') + '\n'; });
    return f;
}
const BUILD_PACK = 'unbound_wipeout_build';
export function installWipeoutBuildPack(world = WIPEOUT_WORLD, from = 1, to = LEVELS) {
    const root = path.join(SAVES_DIR, world, 'datapacks', BUILD_PACK);
    fs.rmSync(root, { recursive: true, force: true });
    for (const [rel, text] of Object.entries(buildPackFiles(from, to))) { const q = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(q), { recursive: true }); fs.writeFileSync(q, text); }
    return `file/${BUILD_PACK}`;
}
export function removeWipeoutBuildPack(world = WIPEOUT_WORLD) { fs.rmSync(path.join(SAVES_DIR, world, 'datapacks', BUILD_PACK), { recursive: true, force: true }); }

// ---------- the data pack: the game ----------
// Minecraft 26.2's overworld with its own clouds lower down, so they're in the sky above the course
// (about 35 blocks up instead of 50), and fainter, so there seem to be fewer
const CLOUDY_OVERWORLD = {
    ambient_light: 0.0,
    attributes: {
        'minecraft:audio/ambient_sounds': { mood: { block_search_extent: 8, offset: 2.0, sound: 'minecraft:ambient.cave', tick_delay: 6000 } },
        'minecraft:audio/background_music': { creative: { max_delay: 24000, min_delay: 12000, sound: 'minecraft:music.creative' }, default: { max_delay: 24000, min_delay: 12000, sound: 'minecraft:music.game' } },
        'minecraft:gameplay/bed_rule': { can_set_spawn: 'always', can_sleep: 'when_dark', error_message: { translate: 'block.minecraft.bed.no_sleep' } },
        'minecraft:gameplay/nether_portal_spawns_piglin': true,
        'minecraft:gameplay/respawn_anchor_works': false,
        'minecraft:visual/ambient_light_color': '#0a0a0a',
        'minecraft:visual/cloud_color': '#88ffffff',
        'minecraft:visual/cloud_height': 176.0,
        'minecraft:visual/fog_color': '#c0d8ff',
        'minecraft:visual/sky_color': '#78a7ff',
    },
    coordinate_scale: 1.0, default_clock: 'minecraft:overworld', has_ceiling: false, has_ender_dragon_fight: false, has_skylight: true,
    height: 384, infiniburn: '#minecraft:infiniburn_overworld', logical_height: 384, min_y: -64,
    monster_spawn_block_light_limit: 0, monster_spawn_light_level: { type: 'minecraft:uniform', max_inclusive: 7, min_inclusive: 0 },
    timelines: '#minecraft:in_overworld',
};
export function packFiles() {
    const levels = design();
    const f = {
        'pack.mcmeta': JSON.stringify({ pack: { description: 'Unbound Wipeout: 100 levels', min_format: 94, max_format: 999 } }, null, 2),
        'data/minecraft/tags/function/load.json': J({ values: ['wipeout:load'] }),
        'data/minecraft/tags/function/tick.json': J({ values: ['wipeout:tick'] }),
        'data/wipeout/tags/block/glove.json': J({ values: ['minecraft:red_wool', 'minecraft:white_wool'] }),
        'data/wipeout/predicate/on_ground.json': J({ condition: 'minecraft:entity_properties', entity: 'this', predicate: { flags: { is_on_ground: true } } }),
    };
    const fn = (name, lines) => { f[`data/wipeout/function/${name}.mcfunction`] = lines.join('\n') + '\n'; };
    const title = (who, text, sub, color = 'gold', subColor = 'white') => [
        `title ${who} times 3 30 8`, `title ${who} title ${J({ text, color, bold: true })}`, ...(sub ? [`title ${who} subtitle ${J({ text: sub, color: subColor })}`] : []),
    ];
    const periods = [...new Set(levels.flatMap(L => L.periods))];
    const knock = knockFiles('wipeout', 'wo_');
    Object.assign(f, knock.files);
    f['data/minecraft/dimension_type/overworld.json'] = JSON.stringify(CLOUDY_OVERWORLD, null, 2);

    fn('load', [
        ...['wo_level', 'wo_fails', 'wo_jail', 'wo_js', 'wo_v', 'wo_lf', 'wo_ph', 'wo_gen', 'wo_cd', 'wo_bn', 'wo_y', 'wo_cx', 'wo_cy', 'wo_cz', 'wo_cr', 'wo_nz', 'wo_px', ...knock.objectives].map(o => `scoreboard objectives add ${o} dummy`),
        'scoreboard players set #20 wo_v 20',
        ...periods.map(p => `scoreboard players set #P${p} wo_v ${p}`),
        'execute unless score #punch wo_v matches 0..1 run scoreboard players set #punch wo_v 1',
        'execute unless score #shield wo_v matches 0.. run scoreboard players set #shield wo_v 0',
        'execute unless score #reset wo_v matches 0.. run scoreboard players set #reset wo_v 0',
        'scoreboard players set #pend wo_v 0',
        'execute unless score #nxt wo_v matches -1.. run scoreboard players set #nxt wo_v -1',
        'execute unless data storage wipeout:s save run data modify storage wipeout:s save set value "Glowing Jellyfish"',
        `bossbar add wipeout:level ${J({ text: 'LEVEL 01 / 100', bold: true })}`, 'bossbar set wipeout:level color blue', 'bossbar set wipeout:level max 100', 'bossbar set wipeout:level visible false',
        `bossbar add wipeout:reset ${J({ text: 'Reset' })}`, 'bossbar set wipeout:reset color red', 'bossbar set wipeout:reset style notched_10',
        ...['immediate_respawn true', 'keep_inventory true', 'advance_time false', 'advance_weather false', 'spawn_mobs false', 'spawn_monsters false',
            'show_death_messages false', 'spawn_phantoms false', 'spawn_wandering_traders false', 'fall_damage false', 'mob_griefing false', 'drowning_damage false',
            'command_block_output false', 'respawn_radius 0', 'locator_bar false'].map(g => `gamerule ${g}`),
        'time set 6000', 'weather clear',
    ]);
    fn('tick', [
        'execute as @a[tag=!wo_in] run function wipeout:join',
        'scoreboard players add #t wo_v 1',
        ...periods.map(p => `scoreboard players operation #m${p} wo_v = #t wo_v`), ...periods.map(p => `scoreboard players operation #m${p} wo_v %= #P${p} wo_v`),
        // moving parts of levels you're not on (or about to be on): gone. (wo_gen: the level they're on)
        'execute as @e[tag=wo_mv] unless score @s wo_gen = #lvl wo_v unless score @s wo_gen = #nxt wo_v run function wipeout:gone',
        // this level's obstacles
        'execute if score #pend wo_v matches 1.. run function wipeout:pending',
        'execute if score #pend wo_v matches ..0 run function wipeout:level_tick',
        'scoreboard players remove @a[scores={wo_cd=1..}] wo_cd 1',
        // a glove: bounce
        'execute as @a[tag=wo_in,tag=!wo_ride] at @s if block ~ ~-0.2 ~ #wipeout:glove unless score @s wo_bn matches 1.. unless score @s wo_jail matches 1.. run function wipeout:bounce',
        'execute as @a[scores={wo_bn=1..}] run function wipeout:bounce_tick',
        // (the emerald pad at the end of the level you're on: in that level's tick)
        // in the sea, or landed on something below the course (the stands): a wipeout
        'execute as @a[tag=wo_in] at @s if block ~ ~ ~ minecraft:water unless score @s wo_jail matches 1.. run function wipeout:fail',
        'execute as @a[tag=wo_in] store result score @s wo_y run data get entity @s Pos[1] 10',
        `execute as @a[tag=wo_in,tag=!wo_ride] at @s if predicate wipeout:on_ground unless score @s wo_jail matches 1.. if score @s wo_y matches ..${F * 10 - 15} run function wipeout:fail`,
        `execute as @a[tag=wo_in] if score @s wo_y matches ..${(SEA - 8) * 10} run function wipeout:fail`,
        // knocked onto the stands (on top of the side walls): a wipeout too. That's anywhere past the walls'
        // face; and nothing on the course you can stand on is that high up (the glove wall's top)
        `execute if score #lvl wo_v matches 1..${LEVELS - 1} as @a[tag=wo_in,tag=!wo_ride] at @s if predicate wipeout:on_ground unless score @s wo_jail matches 1.. if score @s wo_y matches ${(F + 2.5) * 10}.. run function wipeout:fail`,
        'execute as @a[tag=wo_in] store result score @s wo_px run data get entity @s Pos[0] 10',
        `execute if score #lvl wo_v matches 1..${LEVELS - 1} as @a[tag=wo_in] unless score @s wo_jail matches 1.. unless score @s wo_px matches ${(ORIGIN_X - WALL_X + 0.3) * 10}..${(ORIGIN_X + WALL_X - 0.3) * 10} run function wipeout:fail`,
        `execute if score #lvl wo_v matches ${LEVELS} as @a[tag=wo_in] unless score @s wo_jail matches 1.. unless score @s wo_px matches ${(ORIGIN_X - TOWER_WALL_X + 0.3) * 10}..${(ORIGIN_X + TOWER_WALL_X - 0.3) * 10} run function wipeout:fail`,
        'execute as @a[scores={wo_jail=1..}] run function wipeout:jail/tick',
        'execute as @e[tag=wo_alert] run function wipeout:alert/tick',
        // gift punches (arrows or sword hits), one at a time
        ...knock.tick,
        'execute if score #reset wo_v matches 1.. run function wipeout:reset/tick',
        'scoreboard players add #hud wo_v 1',
        'execute if score #hud wo_v matches 10.. as @a[tag=wo_in] run function wipeout:hud',
        'execute if score #hud wo_v matches 10.. run scoreboard players set #hud wo_v 0',
        'execute if score #hud wo_v matches 0 run kill @e[type=minecraft:arrow,tag=!wo_keep,nbt={inGround:1b}]',
    ]);
    fn('gone', ['scoreboard players reset @s wo_ph', 'scoreboard players reset @s wo_gen', 'kill @s']);
    fn('join', [
        'tag @s add wo_in', 'gamemode adventure @s', 'clear @s',
        'execute unless score @s wo_level matches 1.. run scoreboard players set @s wo_level 1',
        'function wipeout:goto',
        ...title('@s', 'WIPEOUT', '100 levels in the sky. Red kills you. Gold is the next level.', 'aqua'),
    ]);
    fn('hud', [
        'effect give @s minecraft:night_vision infinite 0 true', 'effect give @s minecraft:saturation infinite 0 true', 'effect give @s minecraft:resistance infinite 4 true',
        // your level is on the info line at the bottom with the rest (the Unbound HUD mod reads that line)
        'execute store result storage wipeout:h level int 1 run scoreboard players get @s wo_level',
        'execute if score @s wo_level matches 101.. run data modify storage wipeout:h level set value "DONE"',
        'scoreboard players operation @s wo_js = @s wo_jail', 'scoreboard players add @s wo_js 19', 'scoreboard players operation @s wo_js /= #20 wo_v',
        `execute if score @s wo_jail matches 1.. run return run title @s actionbar ${J([{ text: 'IN JAIL  ', color: 'red', bold: true }, { score: { name: '@s', objective: 'wo_js' }, color: 'white', bold: true }, { text: 's', color: 'red', bold: true }])}`,
        'execute store result storage wipeout:h shield int 1 run scoreboard players get #shield wo_v',
        'execute store result storage wipeout:h fails int 1 run scoreboard players get @s wo_fails',
        'data modify storage wipeout:h punch set value "ON"', 'execute if score #punch wo_v matches 0 run data modify storage wipeout:h punch set value "OFF"',
        'data modify storage wipeout:h pc set value "red"', 'execute if score #punch wo_v matches 0 run data modify storage wipeout:h pc set value "green"',
        'execute if score #shield wo_v matches 1.. run return run function wipeout:hud_shield with storage wipeout:h',
        'function wipeout:hud_line with storage wipeout:h',
    ]);
    fn('hud_bar', [
        '$bossbar set wipeout:level name {"text":"LEVEL $(pad)$(level) / 100","color":"white","bold":true}',
        'execute store result bossbar wipeout:level value run scoreboard players get @s wo_level',
        'bossbar set wipeout:level players @a[tag=wo_in]',
    ]);
    fn('hud_line', [`$title @s actionbar [${J({ text: 'Level ', color: 'aqua' })},{"text":"$(level)","color":"white","bold":true},${J({ text: '     Wipeouts ', color: 'aqua' })},${J({ text: '$(fails)', color: 'white' })},${J({ text: '     Punches ', color: 'aqua' })},{"text":"$(punch)","color":"$(pc)","bold":true}]`]);
    fn('hud_shield', [`$title @s actionbar [${J({ text: 'Level ', color: 'aqua' })},{"text":"$(level)","color":"white","bold":true},${J({ text: '     Wipeouts ', color: 'aqua' })},${J({ text: '$(fails)', color: 'white' })},${J({ text: '     Punches ', color: 'aqua' })},{"text":"$(punch)","color":"$(pc)","bold":true},${J({ text: '     Shield x$(shield)', color: 'aqua', bold: true })}]`]);
    // a gift's alert in front of you (the same as the Dropper's)
    fn('alert', [
        'kill @e[tag=wo_alert]',
        '$execute at @s anchored eyes positioned ^ ^0.4 ^5 run summon minecraft:text_display ~ ~ ~ {Tags:["wo_alert","wo_alert_text","wo_anew"],billboard:"center",teleport_duration:2,shadow:1b,background:0,scale:[1.3f,1.3f,1.3f],text:[{text:"$(who)",color:"gold",bold:true},{text:"\\n$(what)",color:"$(color)"}]}',
        'scoreboard players set @e[tag=wo_anew] wo_lf 70', 'tag @e[tag=wo_anew] remove wo_anew',
    ]);
    fn('alert/tick', [
        'scoreboard players remove @s wo_lf 1',
        'execute if score @s wo_lf matches ..0 run return run kill @s',
        'execute at @p[tag=wo_in] anchored eyes positioned ^ ^0.4 ^5 run tp @s ~ ~ ~',
    ]);

    // ---- levels: going to one, its obstacles each tick, each try ----
    fn('goto', [
        'execute if score @s wo_jail matches 1.. run return run function wipeout:goto_jailed',
        'execute if score @s wo_level matches ..0 run scoreboard players set @s wo_level 1',
        'execute if score @s wo_level matches 101.. run return run function wipeout:win_tp',
        ...levels.map(L => `execute if score @s wo_level matches ${L.n} run return run function wipeout:lvl/${L.n}`),
    ]);
    // each tick: the obstacles of the level being played (split in tens, so it's a few checks a tick)
    // (the next level's obstacles are already going too, so they're moving before you get there)
    fn('level_tick', [
        ...Array.from({ length: 10 }, (_, k) => `execute if score #lvl wo_v matches ${k * 10 + 1}..${k * 10 + 10} run function wipeout:lt/${k}`),
        ...Array.from({ length: 10 }, (_, k) => `execute if score #nxt wo_v matches ${k * 10 + 1}..${k * 10 + 10} run function wipeout:ln/${k}`),
    ]);
    for (let k = 0; k < 10; k++) {
        fn(`lt/${k}`, levels.slice(k * 10, k * 10 + 10).map(L => `execute if score #lvl wo_v matches ${L.n} run return run function wipeout:lvl/${L.n}/tick`));
        fn(`ln/${k}`, levels.slice(k * 10, k * 10 + 10).map(L => `execute if score #nxt wo_v matches ${L.n} run return run function wipeout:lvl/${L.n}/tick`));
    }
    for (const L of levels) {
        const [x, y, z] = levelStart(L);
        const N2 = levels[L.n] || L;                             // the next level (its area's loaded too)
        const lo = L.x - 16, hi = L.x + 16, zEnd = N2.z0 + N2.length;
        fn(`lvl/${L.n}`, [
            'scoreboard players set @s wo_lf 0',
            `scoreboard players set #lvl wo_v ${L.n}`, `scoreboard players set #nxt wo_v ${L.n < LEVELS ? L.n + 1 : -1}`,
            // this level's area and the next one's stay loaded while you're on it (their moving parts are summoned once they are)
            'forceload remove all', `forceload add ${lo} ${L.z0} ${hi} ${zEnd}`,
            `scoreboard players set @s wo_cx ${x}`, `scoreboard players set @s wo_cy ${y}`, `scoreboard players set @s wo_cz ${z}`,
            // just finished the level before: walk straight on (it starts right there); otherwise you're taken there
            'execute unless entity @s[tag=wo_done] run function wipeout:respawn',
            'execute if entity @s[tag=wo_done] run function wipeout:respawn_on',
            `title @s times 3 30 8`, `title @s title ${J({ text: `Level ${L.n}`, color: 'aqua', bold: true })}`, `title @s subtitle ${J({ text: L.name, color: 'white' })}`,
            ...(L.n > 1 && (L.n - 1) % 10 === 0 ? [`title @s times 5 50 12`, `title @s title ${J({ text: `${L.n - 1} LEVELS DONE!`, color: 'gold', bold: true })}`, `title @s subtitle ${J({ text: `${LEVELS - L.n + 1} to go`, color: 'yellow', bold: true })}`].map(l => `execute if entity @s[tag=wo_done] run ${l}`) : []),
        ]);
        const glo = L.x - Math.floor((L.w - 1) / 2) - 1;
        fn(`lvl/${L.n}/tick`, [
            ...L.parts.flatMap(p => p.tick),
            // the emerald pad: on to the next level (on the tower: the emerald on top wins)
            L.tower ? `execute positioned ${L.tower.cx - 2} ${L.tower.top + 0.5} ${L.tower.cz - 2} as @a[tag=wo_in,dx=4,dy=2,dz=4] unless score @s wo_jail matches 1.. unless score @s wo_level matches 101.. run function wipeout:finish`
                : `execute positioned ${glo - 1} ${F - 0.5} ${L.finish} as @a[tag=wo_in,dx=${L.w + 3},dy=2,dz=1] unless score @s wo_jail matches 1.. unless score @s wo_level matches 101.. run function wipeout:finish`,
        ]);
        fn(`lvl/${L.n}/ready`, [`execute if loaded ${lo} 0 ${L.z0} if loaded ${hi} 0 ${zEnd} if loaded ${lo} 0 ${zEnd} if loaded ${hi} 0 ${L.z0} run function wipeout:lvl/${L.n}/spawn`]);
        // once it's all loaded: this level's moving parts (fresh after a wipeout or a gift; kept when you
        // walk on from the level before, where they were already going), and the next level's
        fn(`lvl/${L.n}/spawn`, [
            'scoreboard players set #pend wo_v 0',
            `execute if score #pmode wo_v matches 1 run function wipeout:lvl/${L.n}/make`,
            `execute if score #pmode wo_v matches 0 run function wipeout:lvl/${L.n}/ensure`,
            ...(L.n < LEVELS ? [`function wipeout:lvl/${L.n + 1}/ensure`] : []),
        ]);
        fn(`lvl/${L.n}/ensure`, [`execute unless entity @e[tag=wo_lm,scores={wo_gen=${L.n}}] run function wipeout:lvl/${L.n}/make`]);
        // the moving parts, summoned fresh (and the doors' right door picked again)
        fn(`lvl/${L.n}/make`, [
            `execute as @e[tag=wo_mv,scores={wo_gen=${L.n}}] run function wipeout:gone`,
            ...L.parts.flatMap(p => p.spawn),
            `summon minecraft:marker ${L.x} ${F} ${L.z0 + 1} {Tags:["wo_mv","wo_new","wo_lm"]}`,
            `scoreboard players set @e[tag=wo_new] wo_gen ${L.n}`, 'tag @e[tag=wo_new] remove wo_new',
            ...L.parts.flatMap(p => p.reroll),
        ]);
        for (const p of L.parts) for (const [name, lines] of Object.entries(p.fns)) fn(`lvl/${L.n}/${p.id}_${name}`, lines);
    }
    // to the level's start, everything set up fresh
    fn('respawn', [
        'ride @s dismount', 'tag @s remove wo_ride', 'effect clear @s minecraft:levitation', 'scoreboard players set @s wo_bn 0',
        'execute store result storage wipeout:c x int 1 run scoreboard players get @s wo_cx',
        'execute store result storage wipeout:c y int 1 run scoreboard players get @s wo_cy',
        'execute store result storage wipeout:c z int 1 run scoreboard players get @s wo_cz',
        'function wipeout:respawn_tp with storage wipeout:c',
        // the moving parts are summoned fresh (once the level's area is loaded)
        'scoreboard players set #pmode wo_v 1', 'scoreboard players operation #pend wo_v = #lvl wo_v',
    ]);
    fn('respawn_tp', ['$tp @s $(x).5 $(y) $(z).5 0 0', '$spawnpoint @s $(x) $(y) $(z) 0 0']);
    // on from the level before without being moved: the start is saved and the moving parts summoned
    fn('respawn_on', [
        'execute store result storage wipeout:c x int 1 run scoreboard players get @s wo_cx',
        'execute store result storage wipeout:c y int 1 run scoreboard players get @s wo_cy',
        'execute store result storage wipeout:c z int 1 run scoreboard players get @s wo_cz',
        'function wipeout:respawn_sp with storage wipeout:c',
        'scoreboard players set #pmode wo_v 0', 'scoreboard players operation #pend wo_v = #lvl wo_v',
    ]);
    fn('respawn_sp', ['$spawnpoint @s $(x) $(y) $(z) 0 0']);
    fn('pending', ['execute store result storage wipeout:c n int 1 run scoreboard players get #pend wo_v', 'function wipeout:pending_n with storage wipeout:c']);
    fn('pending_n', ['$function wipeout:lvl/$(n)/ready']);
    // the finish: on to the next level
    fn('finish', [
        'playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 0.8 1.3',
        'scoreboard players add @s wo_level 1', 'tag @s add wo_done', 'schedule function wipeout:done_clear 2t',
        'execute if score @s wo_level matches 101.. run return run function wipeout:win',
        'function wipeout:goto',
    ]);
    fn('done_clear', ['tag @a remove wo_done']);
    // a wipeout (in the sea): back to the start of the level
    const quips = ['WIPEOUT!', 'SPLASH!', 'OOF!', 'IN THE DRINK!', 'BELLY FLOP!', 'SWIM BACK!'];
    fn('fail', [
        'playsound minecraft:entity.generic.splash master @s ~ ~ ~ 1 0.9', 'playsound minecraft:entity.player.hurt master @s ~ ~ ~ 0.5 1',
        'execute store result score #q wo_v run random value 0..5',
        ...quips.map((q, i) => `execute if score #q wo_v matches ${i} run title @s actionbar ${J({ text: q, color: 'aqua', bold: true })}`),
        'function wipeout:again',
    ]);
    fn('again', ['scoreboard players add @s wo_fails 1', 'scoreboard players add @s wo_lf 1', 'function wipeout:respawn']);
    // touched something red: dead, back to the start of the level
    const deaths = ['ZAPPED!', 'ELIMINATED!', 'SQUASHED!', 'TOO SLOW!', 'RED MEANS DEAD!', 'BONK!'];
    fn('zap', [
        'execute if score @s wo_cd matches 1.. run return 0',
        'execute if score @s wo_jail matches 1.. run return 0',
        'scoreboard players set @s wo_cd 10',
        'particle minecraft:dust{color:[1.0,0.1,0.1],scale:2.0} ~ ~1 ~ 0.4 0.6 0.4 0 40 force',
        'particle minecraft:poof ~ ~1 ~ 0.3 0.5 0.3 0.02 12 force',
        'playsound minecraft:entity.player.death master @a ~ ~ ~ 1 1', 'playsound minecraft:entity.generic.explode master @s ~ ~ ~ 0.4 1.6',
        'execute store result score #q wo_v run random value 0..5',
        ...deaths.map((q, i) => `execute if score #q wo_v matches ${i} run title @s actionbar ${J({ text: q, color: 'red', bold: true })}`),
        'function wipeout:again',
    ]);
    // a punching glove: knocked away from it (an arrow with Punch from its side, no damage: you
    // have Resistance). $(p): how hard (1 or 2).
    fn('hit', [
        'execute if score @s wo_cd matches 1.. run return 0',
        'execute if score @s wo_jail matches 1.. run return 0',
        'scoreboard players set @s wo_cd 12',
        'ride @s dismount', 'tag @s remove wo_ride',
        'playsound minecraft:entity.player.attack.knockback master @a ~ ~ ~ 1 0.8',
        'playsound minecraft:block.wool.break master @a ~ ~ ~ 1 0.7',
        // which way: from here (what hit you) to you, flat
        'execute facing entity @s feet rotated ~ 0 positioned as @s positioned ^ ^ ^1 summon minecraft:marker run tag @s add wo_dir',
        'execute store result score #dx wo_v run data get entity @e[tag=wo_dir,limit=1] Pos[0] 1000',
        'execute store result score #dz wo_v run data get entity @e[tag=wo_dir,limit=1] Pos[2] 1000',
        'execute store result score #px wo_v run data get entity @s Pos[0] 1000', 'execute store result score #pz wo_v run data get entity @s Pos[2] 1000',
        'scoreboard players operation #dx wo_v -= #px wo_v', 'scoreboard players operation #dz wo_v -= #pz wo_v',
        'kill @e[tag=wo_dir]',
        '$execute facing entity @s feet rotated ~ 0 positioned as @s positioned ^ ^1.0 ^-1.05 run summon minecraft:arrow ~ ~ ~ {Tags:["wo_ar"],PierceLevel:1b,damage:1.0d,pickup:2b,weapon:{id:"minecraft:bow",count:1,components:{"minecraft:enchantments":{"minecraft:punch":$(p)}}}}',
        'execute store result entity @e[tag=wo_ar,limit=1] Motion[0] double 0.0018 run scoreboard players get #dx wo_v',
        'data modify entity @e[tag=wo_ar,limit=1] Motion[1] set value 0.05d',
        'execute store result entity @e[tag=wo_ar,limit=1] Motion[2] double 0.0018 run scoreboard players get #dz wo_v',
        'tag @e[tag=wo_ar] remove wo_ar',
    ]);
    // gloves: a short push up (about 4 blocks)
    fn('bounce', ['effect give @s minecraft:levitation 1 34 true', 'scoreboard players set @s wo_bn 4', 'playsound minecraft:entity.slime.jump master @a ~ ~ ~ 1 0.7', 'particle minecraft:cloud ~ ~ ~ 0.4 0.1 0.4 0.05 8']);
    fn('bounce_tick', ['scoreboard players remove @s wo_bn 1', 'execute if score @s wo_bn matches 0 run effect clear @s minecraft:levitation']);
    // the zipline's end: you're let go over the next platform
    fn('zip_end', ['execute on passengers run tag @s remove wo_ride', 'execute on passengers run ride @s dismount', 'execute at @s run kill @e[tag=wo_ziph,distance=..3]', 'kill @s']);
    const [wx, wy, wz] = WIN;
    fn('win_tp', ['forceload remove all', `tp @s ${wx + 0.5} ${wy} ${wz + 0.5}`, `spawnpoint @s ${wx} ${wy} ${wz}`, 'scoreboard players set #lvl wo_v 0', 'scoreboard players set #nxt wo_v -1', 'scoreboard players set #pend wo_v 0']);
    fn('win', [
        'scoreboard players set @s wo_level 101', 'function wipeout:win_tp',
        ...title('@s', 'YOU BEAT WIPEOUT', 'All 100 levels!'),
        'playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 1 1',
        ...[[3, 0, 16711680], [-3, 2, 65280], [0, -3, 3447003], [2, 3, 16766720]].map(([dx, dz, col]) =>
            `summon minecraft:firework_rocket ~${dx} ~1 ~${dz} {LifeTime:30,FireworksItem:{id:"minecraft:firework_rocket",count:1,components:{"minecraft:fireworks":{flight_duration:2,explosions:[{shape:"large_ball",colors:[I;${col}],has_trail:1b,has_twinkle:1b}]}}}}`),
    ]);

    // ---- gifts (the same as the Dropper's) ----
    // a level up / down is unmistakable: a big green LEVEL UP (or red LEVEL DOWN) across the screen, how
    // many and the level you're on now, its own sound and sparkles (after the new level's own title)
    fn('up', [
        `execute if score @s wo_level matches 100.. run return run title @s actionbar ${J({ text: 'Already on the last level', color: 'gold', bold: true })}`,
        '$scoreboard players add @s wo_level $(n)',
        'execute if score @s wo_level matches 101.. run scoreboard players set @s wo_level 100',
        'function wipeout:goto',
        'title @s times 4 60 14',
        `title @s title ${J({ text: '\u2B06 LEVEL UP \u2B06', color: 'green', bold: true })}`,
        '$title @s subtitle [{"text":"+$(n)   ","color":"green","bold":true},{"text":"now Level ","color":"white"},{"score":{"name":"@s","objective":"wo_level"},"color":"white","bold":true}]',
        'playsound minecraft:entity.player.levelup master @s ~ ~ ~ 1 1.2', 'playsound minecraft:block.beacon.activate master @s ~ ~ ~ 0.8 1.6',
        'execute at @s run particle minecraft:happy_villager ~ ~1 ~ 0.6 0.8 0.6 0 30 force @s',
        'execute at @s run particle minecraft:totem_of_undying ~ ~1 ~ 0.5 0.7 0.5 0.3 40 force @s',
    ]);
    fn('down', [
        '$scoreboard players remove @s wo_level $(n)',
        'execute if score @s wo_level matches ..0 run scoreboard players set @s wo_level 1',
        'function wipeout:goto',
        'title @s times 4 60 14',
        `title @s title ${J({ text: '\u2B07 LEVEL DOWN \u2B07', color: 'red', bold: true })}`,
        '$title @s subtitle [{"text":"-$(n)   ","color":"red","bold":true},{"text":"now Level ","color":"white"},{"score":{"name":"@s","objective":"wo_level"},"color":"white","bold":true}]',
        'playsound minecraft:entity.villager.no master @s ~ ~ ~ 1 0.8', 'playsound minecraft:block.beacon.deactivate master @s ~ ~ ~ 0.8 0.8',
        'execute at @s run particle minecraft:angry_villager ~ ~1.2 ~ 0.6 0.6 0.6 0 12 force @s',
        'execute at @s run particle minecraft:large_smoke ~ ~1 ~ 0.4 0.6 0.4 0.02 20 force @s',
    ]);
    fn('jail', [
        'execute unless score @s wo_jail matches 1.. run function wipeout:jail/enter',
        '$scoreboard players add @s wo_jail $(ticks)',
        'execute if score @s wo_jail matches 7200.. run scoreboard players set @s wo_jail 7200',
    ]);
    // jail: back to the start of your level (solid ground, wherever you were: in the air, on the
    // zipline...) and caged there. The cage's place is kept (a marker), so it's always taken away
    fn('jail/enter', [
        'function wipeout:jail/clear',
        'function wipeout:respawn',
        'execute at @s run function wipeout:jail/cage',
        'effect give @s minecraft:jump_boost 9999 250 true',
        'playsound minecraft:block.iron_door.close master @s ~ ~ ~ 1 0.8', ...title('@s', 'JAILED', '', 'red'),
    ]);
    fn('jail/tick', ['scoreboard players remove @s wo_jail 1', 'execute if score @s wo_jail matches ..0 run function wipeout:jail/free']);
    fn('jail/cage', [
        'kill @e[type=minecraft:marker,tag=wo_jailpos]',
        'execute align xyz run summon minecraft:marker ~ ~ ~ {Tags:["wo_jailpos"]}',
        'execute align xyz run fill ~-1 ~ ~-1 ~1 ~2 ~1 minecraft:iron_bars replace minecraft:air',
        'execute align xyz run fill ~ ~ ~ ~ ~1 ~ minecraft:air replace minecraft:iron_bars',
        'execute align xyz run fill ~-1 ~3 ~-1 ~1 ~3 ~1 minecraft:iron_bars replace minecraft:air',
    ]);
    // gifts still work while you're in jail (levels up and down, a reset): the cage comes with you to
    // the start of your new level, with the same time left
    fn('goto_jailed', [
        'function wipeout:jail/clear',
        'scoreboard players operation #jt wo_v = @s wo_jail', 'scoreboard players set @s wo_jail 0',
        'function wipeout:goto',
        'scoreboard players operation @s wo_jail = #jt wo_v',
        'execute at @s run function wipeout:jail/cage',
    ]);
    fn('jail/clear', ['execute at @e[type=minecraft:marker,tag=wo_jailpos] run fill ~-1 ~ ~-1 ~1 ~3 ~1 minecraft:air replace minecraft:iron_bars', 'kill @e[type=minecraft:marker,tag=wo_jailpos]']);
    fn('jail/free', ['scoreboard players set @s wo_jail 0', 'function wipeout:jail/clear', 'execute at @s run fill ~-1 ~ ~-1 ~1 ~3 ~1 minecraft:air replace minecraft:iron_bars', 'effect clear @s minecraft:jump_boost', 'playsound minecraft:block.iron_door.open master @s ~ ~ ~ 1 1', ...title('@s', 'FREE', '', 'green')]);
    // (gift punches: knock.js)
    fn('punch_toggle', [
        'execute store success score #was wo_v if score #punch wo_v matches 1',
        'execute if score #was wo_v matches 1 run scoreboard players set #punch wo_v 0',
        'execute if score #was wo_v matches 0 run scoreboard players set #punch wo_v 1',
        ...title('@a', 'PUNCHES ON', 'Arrows and swords can knock you around', 'red').map(l => `execute if score #punch wo_v matches 1 run ${l}`),
        ...title('@a', 'PUNCHES OFF', 'No more arrows or swords', 'green').map(l => `execute if score #punch wo_v matches 0 run ${l}`),
        'execute as @a at @s run playsound minecraft:block.lever.click master @s ~ ~ ~ 1 1',
    ]);
    // the reset countdown and the save (the same as the Dropper's)
    fn('reset/start', [
        '$data modify storage wipeout:s save set value "$(save)"',
        'execute if score #shield wo_v matches 1.. run return run function wipeout:reset/blocked',
        'execute if score #reset wo_v matches 1.. run return 0',
        '$scoreboard players set #reset wo_v $(ticks)',
        '$bossbar set wipeout:reset max $(secs)',
        'bossbar set wipeout:reset players @a', 'bossbar set wipeout:reset visible true',
        'function wipeout:reset/second',
        ...title('@a', 'RESET INCOMING', '').slice(0, 2),
        '$title @a subtitle {"text":"$(save) saves you","color":"aqua"}',
        'execute as @a at @s run playsound minecraft:block.bell.use master @s ~ ~ ~ 1 0.6',
    ]);
    fn('reset/blocked', ['scoreboard players remove #shield wo_v 1', ...title('@a', 'RESET BLOCKED', 'Your shield took it', 'aqua'), 'execute as @a at @s run playsound minecraft:item.shield.block master @s ~ ~ ~ 1 1']);
    fn('reset/tick', [
        'scoreboard players remove #reset wo_v 1',
        'scoreboard players operation #m wo_v = #reset wo_v', 'scoreboard players operation #m wo_v %= #20 wo_v',
        'execute if score #m wo_v matches 0 run function wipeout:reset/second',
        'execute if score #reset wo_v matches ..0 run function wipeout:reset/boom',
    ]);
    fn('reset/second', [
        'scoreboard players operation #secs wo_v = #reset wo_v', 'scoreboard players add #secs wo_v 19', 'scoreboard players operation #secs wo_v /= #20 wo_v',
        'execute store result bossbar wipeout:reset value run scoreboard players get #secs wo_v',
        'execute store result storage wipeout:s secs int 1 run scoreboard players get #secs wo_v',
        'function wipeout:reset/name with storage wipeout:s',
        'execute if score #secs wo_v matches 1..10 run function wipeout:reset/flash with storage wipeout:s',
    ]);
    fn('reset/name', [`$bossbar set wipeout:reset name [${J({ text: 'RESET IN $(secs)s', color: 'red', bold: true })},${J({ text: '   $(save) saves you', color: 'aqua' })}]`]);
    fn('reset/flash', ['title @a times 0 14 4', '$title @a title {"text":"$(secs)","color":"red","bold":true}', 'title @a subtitle ""', 'execute as @a at @s run playsound minecraft:block.note_block.pling master @s ~ ~ ~ 1 0.8']);
    fn('reset/boom', [
        'scoreboard players set #reset wo_v 0', 'bossbar set wipeout:reset visible false',
        'execute as @a[tag=wo_in] run scoreboard players set @s wo_level 1',
        'execute as @a[tag=wo_in] run function wipeout:goto',
        ...title('@a', 'RESET!', 'Back to level 1', 'red'),
        'execute as @a at @s run playsound minecraft:entity.wither.death master @s ~ ~ ~ 0.6 1',
    ]);
    fn('save', [
        'execute if score #reset wo_v matches 1.. run return run function wipeout:save/stop',
        'scoreboard players add #shield wo_v 1', 'execute if score #shield wo_v matches 4.. run scoreboard players set #shield wo_v 3',
        ...title('@a', 'SHIELD READY', 'The next reset gets blocked', 'aqua'),
        'execute as @a at @s run playsound minecraft:item.armor.equip_diamond master @s ~ ~ ~ 1 1',
    ]);
    fn('save/stop', [
        'scoreboard players set #reset wo_v 0', 'bossbar set wipeout:reset visible false',
        ...title('@a', 'SAVED!', 'The reset is stopped', 'green'),
        'execute as @a at @s run playsound minecraft:ui.toast.challenge_complete master @s ~ ~ ~ 1 1.2',
    ]);
    return f;
}

// Writes the pack into the Wipeout world (making its folder if the world isn't made yet).
export function installWipeoutPack(world = WIPEOUT_WORLD) {
    const root = path.join(SAVES_DIR, world, 'datapacks', 'unbound_wipeout');
    const files = packFiles();
    let changed = false;
    for (const [rel, text] of Object.entries(files)) {
        const p = path.join(root, ...rel.split('/'));
        if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text) continue;
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
        changed = true;
    }
    const prune = (dir, rel) => {
        for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
            const q = path.join(dir, e.name), r = `${rel}/${e.name}`;
            if (e.isDirectory()) { prune(q, r); if (!fs.readdirSync(q).length) fs.rmdirSync(q); }
            else if (!files[r]) { fs.rmSync(q); changed = true; }
        }
    };
    prune(path.join(root, 'data'), 'data');
    return changed;
}

// The commands for a gift action (run as you, at you): the same actions as the Dropper's
export const WIPEOUT_ACTIONS = new Set(['punch', 'punchToggle', 'levelUp', 'levelDown', 'resetTimer', 'saveReset', 'jail', 'levelWheel']);
export function wipeoutCommands(a, times, { saveGift = 'Glowing Jellyfish' } = {}) {
    const n = (v, lo, hi, def) => Math.max(lo, Math.min(hi, Number.isFinite(+v) && +v > 0 ? Math.round(+v) : def));
    switch (a.type) {
        case 'punch': return [knockCommand('wipeout', a, Math.min(n(a.amount, 1, 10, 1) * times, MAX_PUNCHES_PER_GIFT))];
        case 'punchToggle': return ['function wipeout:punch_toggle'];
        case 'levelUp': return [`function wipeout:up {n:${Math.min(99, n(a.amount, 1, 99, 1) * times)}}`];
        case 'levelDown': return [`function wipeout:down {n:${Math.min(99, n(a.amount, 1, 99, 1) * times)}}`];
        case 'resetTimer': { const s = n(a.seconds, 5, 600, 60); return [`function wipeout:reset/start {ticks:${s * 20},secs:${s},save:"${String(saveGift).replace(/[^\w ]/g, '').slice(0, 30) || 'a save gift'}"}`]; }
        case 'saveReset': return ['function wipeout:save'];
        case 'jail': return [`function wipeout:jail {ticks:${Math.min(7200, n(a.seconds, 1, 360, 5) * times * 20)}}`];
        default: return [];
    }
}

// Ready-made Minecraft gift actions: pick one from the list instead of typing a command.
// Each one runs plain commands over RCON, so no mods or datapacks are needed (Java 1.21.5 or newer).

import { craterLayers, discFills } from './singleplayer.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (n, lo, hi, def) => Math.max(lo, Math.min(hi, Number.isFinite(+n) && +n > 0 ? +n : def));
const text = (t, color, extra = '') => `{"text":${JSON.stringify(t)},"color":"${color}"${extra}}`;

// Every mob: front = blocks in front of you, up = blocks above, spread = random sideways,
// max = most at once from one gift (so a big streak can't freeze the server).
const MOB_DEFAULT = { front: 3, spread: 2, max: 20 };
const MOB_PLACES = {
    ender_dragon: { up: 25, front: 0, spread: 0, max: 3 }, wither: { up: 6, front: 6, spread: 0, max: 3 },
    warden: { front: 5, spread: 0, max: 5 }, elder_guardian: { front: 4, max: 3 }, giant: { front: 8, spread: 0, max: 3 },
    ravager: { front: 6, max: 5 }, ghast: { up: 10, spread: 6, max: 10 }, happy_ghast: { up: 6, spread: 4, max: 10 },
    iron_golem: { max: 10 }, sniffer: { front: 4, max: 10 }, hoglin: { front: 4, max: 10 }, zoglin: { front: 4, max: 10 },
    polar_bear: { front: 4, max: 10 }, camel: { front: 4, max: 10 }, camel_husk: { front: 4, max: 10 },
    phantom: { up: 8, spread: 4, max: 10 }, blaze: { front: 4, up: 2, max: 10 }, breeze: { front: 4, up: 1, max: 10 },
    bat: { up: 2, max: 30 }, bee: { up: 1, max: 30 }, parrot: { up: 1, max: 30 }, allay: { up: 1, max: 30 }, vex: { up: 2, max: 20 },
    chicken: { front: 2, max: 30 }, cod: { max: 30 }, creaking: { front: 4, max: 10 }, enderman: { front: 4, spread: 0, max: 10 },
    endermite: { max: 30 }, evoker: { front: 4, max: 10 }, guardian: { front: 4, max: 10 }, illusioner: { front: 4, max: 10 },
    pufferfish: { max: 30 }, rabbit: { max: 30 }, salmon: { max: 30 }, shulker: { front: 4, spread: 0, max: 10 },
    silverfish: { max: 30 }, tadpole: { max: 30 }, tropical_fish: { max: 30 }, wandering_trader: { max: 5 },
};
const OTHER_MOBS = 'armadillo axolotl bogged cat cave_spider copper_golem cow creeper dolphin donkey drowned fox frog glow_squid goat horse husk llama magma_cube mooshroom mule nautilus ocelot panda parched pig piglin piglin_brute pillager sheep skeleton skeleton_horse slime snow_golem spider squid stray strider sulfur_cube trader_llama turtle villager vindicator witch wither_skeleton wolf zombie zombie_horse zombie_nautilus zombie_villager zombified_piglin'.split(' ');
export const MOBS = Object.fromEntries([...Object.keys(MOB_PLACES), ...OTHER_MOBS]
    .map(id => [id, { ...MOB_DEFAULT, ...MOB_PLACES[id], name: id === 'giant' ? 'Giant (Zombie)' : id.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') }])
    .sort((a, b) => a[1].name.localeCompare(b[1].name)));

const ENCH = e => `[enchantments={${Object.entries(e).map(([k, v]) => `${k}:${v}`).join(',')}}]`;
const GOD_ARMOR = [
    ['armor.head', 'netherite_helmet' + ENCH({ protection: 4, unbreaking: 3, mending: 1, respiration: 3, aqua_affinity: 1 })],
    ['armor.chest', 'netherite_chestplate' + ENCH({ protection: 4, unbreaking: 3, mending: 1 })],
    ['armor.legs', 'netherite_leggings' + ENCH({ protection: 4, unbreaking: 3, mending: 1, swift_sneak: 3 })],
    ['armor.feet', 'netherite_boots' + ENCH({ protection: 4, unbreaking: 3, mending: 1, feather_falling: 4, depth_strider: 3 })],
];
const GOD_ITEMS = [
    'netherite_sword' + ENCH({ sharpness: 5, unbreaking: 3, mending: 1, looting: 3, fire_aspect: 2, sweeping_edge: 3 }) + ' 1',
    'netherite_pickaxe' + ENCH({ efficiency: 5, unbreaking: 3, mending: 1, fortune: 3 }) + ' 1',
    'netherite_axe' + ENCH({ efficiency: 5, unbreaking: 3, mending: 1, sharpness: 5 }) + ' 1',
    'bow' + ENCH({ power: 5, unbreaking: 3, infinity: 1, flame: 1, punch: 2 }) + ' 1',
    'arrow 1', 'ender_pearl 16', 'ender_eye 32', 'golden_apple 16', 'enchanted_golden_apple 2', 'cooked_beef 32',
];
const DIAMOND_ARMOR = [['armor.head', 'diamond_helmet'], ['armor.chest', 'diamond_chestplate'], ['armor.legs', 'diamond_leggings'], ['armor.feet', 'diamond_boots']];

export function makePresets({ mc, log }) {
    const sel = ctx => /^[\w]{1,16}$/.test(ctx.player) ? `@a[name=${ctx.player},limit=1]` : '@p';

    async function where(ctx) {
        const s = sel(ctx);
        const pos = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(await mc(`data get entity ${s} Pos`));
        if (!pos) throw new Error(`Couldn't find ${ctx.player} in the world`);
        const dim = /"([\w:./-]+)"/.exec(await mc(`data get entity ${s} Dimension`))?.[1] || 'minecraft:overworld';
        const [minY, maxY] = dim === 'minecraft:overworld' ? [-64, 319] : [0, 255];
        return { s, x: +pos[1], y: +pos[2], z: +pos[3], dim, minY, maxY };
    }
    // Fills slices of a column (fill is limited to 32768 blocks per command).
    async function fillColumn(p, x1, z1, x2, z2, top, bottom, block) {
        const area = (x2 - x1 + 1) * (z2 - z1 + 1);
        const step = Math.max(1, Math.floor(30000 / area));
        for (let y = top; y >= bottom; y -= step) {
            const reply = await mc(`execute in ${p.dim} run fill ${x1} ${Math.max(bottom, y - step + 1)} ${z1} ${x2} ${y} ${z2} ${block}`);
            if (!/filled|No blocks/i.test(reply)) log(`Fill: ${reply.trim()}`);
        }
    }

    async function chunk(ctx, block, label, color) {
        const p = await where(ctx);
        const cx = Math.floor(p.x / 16) * 16, cz = Math.floor(p.z / 16) * 16;
        // air clears the whole chunk top to bottom; cobwebs and lava go from just above you down to the void
        // (bedrock included: the bottom of the world is opened up)
        const top = block === 'minecraft:air' ? p.maxY : Math.min(p.maxY, Math.floor(p.y) + 4);
        await mc(`title ${p.s} actionbar ${text(label, color, ',"bold":true')}`);
        await fillColumn(p, cx, cz, cx + 15, cz + 15, top, p.minY, block);
    }

    async function giveArmor(s, armor) {
        for (const [slot, item] of armor) {
            await mc(`execute as ${s} if items entity @s ${slot} * run give @s ${item}`);
            await mc(`execute as ${s} unless items entity @s ${slot} * run item replace entity @s ${slot} with ${item}`);
        }
    }

    // Jails: one per player. A second jail gift while you're inside adds the time.
    const jails = new Map();
    async function jail(ctx, seconds) {
        const key = ctx.player;
        if (jails.has(key)) { jails.get(key).until += seconds * 1000; return; }
        const p = await where(ctx);
        const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
        const box = `${x - 2} ${y - 1} ${z - 2} ${x + 2} ${y + 3} ${z + 2}`;
        const jailRun = { until: Date.now() + seconds * 1000 };
        jails.set(key, jailRun);
        try {
            await mc(`execute in ${p.dim} run fill ${box} minecraft:bedrock hollow`);
            await mc(`execute in ${p.dim} run fill ${x - 2} ${y} ${z - 2} ${x + 2} ${y + 2} ${z + 2} minecraft:iron_bars outline`);
            await mc(`execute in ${p.dim} run tp ${p.s} ${x + 0.5} ${y} ${z + 0.5}`);
            await mc(`execute at ${p.s} run playsound minecraft:block.iron_door.close master @a ~ ~ ~ 1 0.6`);
            await mc(`title ${p.s} times 5 30 10`);
            await mc(`title ${p.s} title ${text('JAILED', 'red', ',"bold":true')}`);
            while (Date.now() < jailRun.until) {
                const left = Math.ceil((jailRun.until - Date.now()) / 1000);
                await mc(`effect give ${p.s} minecraft:mining_fatigue 3 255 true`);
                await mc(`title ${p.s} actionbar ${text(`Jail: ${left}s`, 'red', ',"bold":true')}`);
                await sleep(1000);
            }
            await mc(`execute in ${p.dim} run fill ${box} minecraft:air`);
            await mc(`effect clear ${p.s} minecraft:mining_fatigue`);
            await mc(`title ${p.s} actionbar ${text('Free!', 'green', ',"bold":true')}`);
        } finally {
            jails.delete(key);
        }
    }

    // The crater: same shape as in your own world (singleplayer.js): a flat floor at y=-20, a wide
    // gentle middle, then a wall as steep as you can still climb, and a low dome cleared above the
    // ground. Done with fill commands, one circle of air per layer, top first.
    async function carveCrater(dim, minY, maxY, cx, cy, cz, size) {
        for (const [y, r] of craterLayers(size, cy)) {
            if (y < minY + 1 || y > maxY) continue;
            for (const [x1, z1, x2, z2] of discFills(Math.round(r))) {
                await mc(`execute in ${dim} run fill ${cx + x1} ${y} ${cz + z1} ${cx + x2} ${y} ${cz + z2} minecraft:air`);
            }
        }
    }

    // A TNT bomb drops from the sky onto where you're standing, whistling down with a fire and
    // smoke trail, then blasts a massive crater with a flash and a mushroom cloud.
    async function nuke(ctx, size) {
        const s = sel(ctx);
        const p = await where(ctx);
        const tag = `gh_nuke_${Math.random().toString(36).slice(2, 8)}`;
        await mc(`title ${s} times 2 16 4`);
        await mc(`title ${s} title ${text('NUKE INCOMING', 'red', ',"bold":true')}`);
        await mc(`title ${s} subtitle ${text('RUN!', 'gold', ',"bold":true')}`);
        await mc(`execute at ${s} run playsound minecraft:entity.wither.spawn master @a ~ ~ ~ 3 0.6`);
        await mc(`execute at ${s} run summon minecraft:block_display ~ ~60 ~ {Tags:["${tag}"],teleport_duration:2,brightness:{sky:15,block:15},block_state:{Name:"minecraft:tnt"},transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[-2f,0f,-2f],scale:[4f,6f,4f]}}`);
        let landed = false;
        for (let i = 0; i < 100 && !landed; i++) {
            await mc(`execute as @e[tag=${tag}] at @s run tp @s ~ ~-1.5 ~`);
            await mc(`execute at @e[tag=${tag}] run particle minecraft:flame ~ ~6.5 ~ 0.5 0.5 0.5 0.02 20 force`);
            await mc(`execute at @e[tag=${tag}] run particle minecraft:large_smoke ~ ~7.5 ~ 0.5 1 0.5 0.01 14 force`);
            if (i % 3 === 0) await mc(`execute at @e[tag=${tag}] run playsound minecraft:block.note_block.flute master @a ~ ~ ~ 3 ${Math.max(0.5, 2 - i * 0.04).toFixed(2)}`);
            const hit = await mc(`execute at @e[tag=${tag}] unless block ~ ~-0.5 ~ minecraft:air unless block ~ ~-0.5 ~ minecraft:cave_air`);
            if (/passed/i.test(hit)) landed = true;
            await sleep(100);
        }
        const at = `execute at @e[tag=${tag},limit=1] run`;
        await mc(`${at} particle minecraft:flash{color:[1.0,1.0,1.0,1.0]} ~ ~1 ~ 0 0 0 0 3 force`);
        await mc(`${at} particle minecraft:explosion_emitter ~ ~1 ~ ${size / 3} 2 ${size / 3} 0 40 force`);
        await mc(`${at} playsound minecraft:entity.generic.explode master @a ~ ~ ~ 6 0.5`);
        await mc(`${at} playsound minecraft:entity.lightning_bolt.thunder master @a ~ ~ ~ 6 0.6`);
        // where it hit
        const hitPos = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(await mc(`data get entity @e[tag=${tag},limit=1] Pos`));
        // a real blast in the middle for the boom and the damage
        await mc(`${at} summon minecraft:creeper ~ ~ ~ {ExplosionRadius:8b,Fuse:0s,ignited:1b,Silent:1b}`);
        // the massive crater, dug while the mushroom cloud goes up
        const carving = hitPos
            ? carveCrater(p.dim, p.minY, p.maxY, Math.floor(+hitPos[1]), Math.floor(+hitPos[2]), Math.floor(+hitPos[3]), size)
            : Promise.resolve();
        // mushroom cloud: a smoke column with a wide cap, fire raining down
        const h0 = Math.round(size * 0.3);
        for (let h = 2; h <= size + h0; h += Math.max(3, Math.round(size / 8))) {
            await mc(`${at} particle minecraft:campfire_signal_smoke ~ ~${h} ~ ${(size / 12).toFixed(1)} 2 ${(size / 12).toFixed(1)} 0.01 120 force`);
            await mc(`${at} particle minecraft:flame ~ ~${h} ~ ${(size / 14).toFixed(1)} 2 ${(size / 14).toFixed(1)} 0.05 40 force`);
        }
        await mc(`${at} particle minecraft:campfire_signal_smoke ~ ~${size + h0 + 4} ~ ${(size / 1.5).toFixed(1)} 3 ${(size / 1.5).toFixed(1)} 0.02 1200 force`);
        await mc(`${at} particle minecraft:explosion_emitter ~ ~2 ~ ${(size / 1.5).toFixed(1)} 3 ${(size / 1.5).toFixed(1)} 0 60 force`);
        await mc(`${at} particle minecraft:lava ~ ~2 ~ ${(size / 2).toFixed(1)} 2 ${(size / 2).toFixed(1)} 0 200 force`);
        await mc(`${at} playsound minecraft:entity.generic.explode master @a ~ ~ ~ 8 0.4`);
        await mc(`kill @e[tag=${tag}]`);
        await carving;
    }

    async function endTp(ctx) {
        const s = sel(ctx);
        await mc(`effect give ${s} minecraft:slow_falling 12 0 true`);
        await mc(`effect give ${s} minecraft:resistance 8 4 true`);
        await mc(`execute in minecraft:the_end run tp ${s} 100.5 52 0.5`);
        await sleep(2500); // let the End load around you
        await mc(`execute in minecraft:the_end run fill 98 48 -2 102 48 2 minecraft:obsidian`);
        await mc(`execute in minecraft:the_end run fill 98 49 -2 102 51 2 minecraft:air`);
        await mc(`execute in minecraft:the_end run tp ${s} 100.5 49 0.5`);
        await mc(`title ${s} title ${text('Welcome to the End', 'light_purple', ',"bold":true')}`);
    }

    async function spawnMob(ctx, mob, n) {
        const m = MOBS[mob] || MOBS.zombie;
        const id = MOBS[mob] ? mob : 'zombie';
        for (let i = 0; i < Math.min(n, m.max); i++) {
            const sx = (m.spread * (Math.random() * 2 - 1)).toFixed(1), sz = (m.spread * (Math.random() * 2 - 1)).toFixed(1);
            await mc(`execute at ${sel(ctx)} rotated ~ 0 positioned ^ ^ ^${m.front || 0} run summon minecraft:${id} ~${sx} ~${m.up || 0} ~${sz}`);
        }
    }

    // type -> run(action, ctx, times). times = how many gifts (for streaks).
    return {
        nuke: async (a, ctx, times) => { for (let i = 0; i < Math.min(times, 3); i++) await nuke(ctx, clamp(a.size, 16, 64, 40)); },
        jail: (a, ctx, times) => jail(ctx, Math.min(3600, clamp(a.seconds, 1, 3600, 30) * times)),
        cobwebChunk: (a, ctx) => chunk(ctx, 'minecraft:cobweb', 'COBWEB CHUNK', 'white'),
        lavaChunk: (a, ctx) => chunk(ctx, 'minecraft:lava', 'LAVA CHUNK', 'gold'),
        airChunk: (a, ctx) => chunk(ctx, 'minecraft:air', 'AIR CHUNK', 'aqua'),
        clearInventory: async (a, ctx) => {
            await mc(`clear ${sel(ctx)}`);
            await mc(`title ${sel(ctx)} actionbar ${text('Inventory cleared!', 'red', ',"bold":true')}`);
        },
        endTp: (a, ctx) => endTp(ctx),
        godKit: async (a, ctx, times) => {
            const s = sel(ctx);
            for (let k = 0; k < Math.min(times, 5); k++) {
                await giveArmor(s, GOD_ARMOR.map(([slot, item]) => [slot, `minecraft:${item}`]));
                for (const item of GOD_ITEMS) await mc(`give ${s} minecraft:${item}`);
            }
            await mc(`execute at ${s} run playsound minecraft:item.armor.equip_netherite master @a ~ ~ ~ 1 1`);
            await mc(`title ${s} actionbar ${text('GOD KIT', 'light_purple', ',"bold":true')}`);
        },
        diamondKit: async (a, ctx, times) => {
            const s = sel(ctx);
            for (let k = 0; k < Math.min(times, 10); k++) {
                await giveArmor(s, DIAMOND_ARMOR.map(([slot, item]) => [slot, `minecraft:${item}`]));
                await mc(`give ${s} minecraft:diamond_sword`);
                await mc(`give ${s} minecraft:cooked_beef 16`);
            }
            await mc(`execute at ${s} run playsound minecraft:item.armor.equip_diamond master @a ~ ~ ~ 1 1`);
        },
        spawnMob: (a, ctx, times) => spawnMob(ctx, a.mob, clamp(a.amount, 1, 50, 1) * times),
        lightning: async (a, ctx, times) => {
            for (let i = 0; i < Math.min(clamp(a.amount, 1, 20, 1) * times, 20); i++) await mc(`execute at ${sel(ctx)} run summon minecraft:lightning_bolt ~ ~ ~`);
        },
    };
}

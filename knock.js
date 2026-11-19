// Gift punches for the level games (the Dropper and Wipeout): an arrow with Punch II, or a sword hit,
// from a random side. They queue up and come one at a time, and every one lands:
//  - an arrow is summoned a block away from you and flies through you (summoned any closer, it starts
//    inside your hitbox and Minecraft doesn't count it as a hit);
//  - arrows and sword hits ignore the moment after a hit when you can't be hurt again (a damage type
//    tag), so a second one straight after the first still knocks you;
//  - a sword hit is a /damage from that side (always lands), with a sword swinging at you.
// You never lose health: the games give you Resistance V.
//
// ns: the pack's namespace, p: its scoreboard prefix (e.g. 'wo_'). The game's own #punch <p>v score
// (1 on, 0 off) turns them on and off.
const J = o => JSON.stringify(o);

export function knockFiles(ns, p) {
    const f = {
        // every arrow and sword hit counts, even straight after another
        'data/minecraft/tags/damage_type/bypasses_cooldown.json': J({ values: ['minecraft:arrow', `${ns}:sword`] }),
        [`data/${ns}/damage_type/sword.json`]: J({ message_id: 'player', scaling: 'never', exhaustion: 0.0 }),
    };
    const fn = (name, lines) => { f[`data/${ns}/function/${name}.mcfunction`] = lines.join('\n') + '\n'; };
    const off = `title @s actionbar ${J({ text: 'Punches are OFF', color: 'green', bold: true })}`;

    // a gift: n more to come
    fn('knock/add_arrow', [`execute if score #punch ${p}v matches 0 run return run ${off}`, `$scoreboard players add @s ${p}pq $(n)`, `execute if score @s ${p}pq matches 11.. run scoreboard players set @s ${p}pq 10`]);
    fn('knock/add_sword', [`execute if score #punch ${p}v matches 0 run return run ${off}`, `$scoreboard players add @s ${p}sq $(n)`, `execute if score @s ${p}sq matches 11.. run scoreboard players set @s ${p}sq 10`]);
    // each tick, for anyone with some waiting: one every 7 ticks
    for (const [k, q, t] of [['arrow', 'pq', 'pt'], ['sword', 'sq', 'st']]) {
        fn(`knock/${k}_q`, [
            `execute if score #punch ${p}v matches 0 run return run scoreboard players set @s ${p}${q} 0`,
            `scoreboard players remove @s ${p}${t} 1`,
            `execute if score @s ${p}${t} matches 1.. run return 0`,
            `scoreboard players set @s ${p}${t} 7`,
            `scoreboard players remove @s ${p}${q} 1`,
            `function ${ns}:knock/${k}`,
        ]);
    }

    // ---- an arrow: from a random side (one with room for it), flying through you ----
    fn('knock/arrow', [
        `execute store result storage ${ns}:k vy double 0.001 run data get entity @s Motion[1] 1000`,
        `execute store result score #r ${p}v run random value 0..7`,
        ...Array.from({ length: 8 }, (_, i) => `execute if score #r ${p}v matches ${i} run return run function ${ns}:knock/arrow/d${i} with storage ${ns}:k`),
    ]);
    const arrow = (mx, mz, vy = '$(vy)d') => `summon minecraft:arrow ~ ~ ~ {Motion:[${mx.toFixed(3)}d,${vy},${mz.toFixed(3)}d],damage:2.0d,crit:1b,pickup:2b,weapon:{id:"minecraft:bow",count:1,components:{"minecraft:enchantments":{"minecraft:punch":2}}}}`;
    const R = 1.05, SPEED = 2.2;
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
        fn(`knock/arrow/d${i}`, [
            'playsound minecraft:entity.arrow.shoot master @a ~ ~1 ~ 1 1',
            `$execute positioned ~${(dx * R).toFixed(3)} ~1.1 ~${(dz * R).toFixed(3)} if block ~ ~ ~ #minecraft:replaceable run return run ${arrow(-dx * SPEED, -dz * SPEED)}`,
            `$execute positioned ~${(-dx * R).toFixed(3)} ~1.1 ~${(-dz * R).toFixed(3)} if block ~ ~ ~ #minecraft:replaceable run return run ${arrow(dx * SPEED, dz * SPEED)}`,
            // no room either side: straight down onto you
            `execute positioned ~ ~2.8 ~ run ${arrow(0, 0, '-2.2d')}`,
        ]);
    }

    // ---- a sword hit: a sword swings at you from a random side and knocks you away from it ----
    fn('knock/sword', [
        `execute store result score #r ${p}v run random value 0..7`,
        ...Array.from({ length: 8 }, (_, i) => `execute if score #r ${p}v matches ${i} run return run function ${ns}:knock/sword/d${i}`),
    ]);
    for (let i = 0; i < 8; i++) {
        const deg = i * 45, a = deg * Math.PI / 180, dx = Math.sin(a), dz = Math.cos(a);
        // the sword faces you: yaw of the line from it to you
        const yaw = ((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
        fn(`knock/sword/d${i}`, [
            `summon minecraft:item_display ~${(dx * 1.3).toFixed(3)} ~1.3 ~${(dz * 1.3).toFixed(3)} {Tags:["${p}sw"],Rotation:[${yaw.toFixed(1)}f,0f],teleport_duration:1,item:{id:"minecraft:iron_sword",count:1},`
                + 'transformation:{left_rotation:[0f,0f,0.6f,0.8f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[1.4f,1.4f,1.4f]}}',
            `scoreboard players set @e[tag=${p}sw,limit=1,sort=nearest] ${p}sl 8`,
            'playsound minecraft:entity.player.attack.sweep master @a ~ ~1 ~ 1 1',
            'playsound minecraft:entity.player.attack.knockback master @a ~ ~1 ~ 1 1',
            `particle minecraft:sweep_attack ~${(dx * 0.6).toFixed(3)} ~1.1 ~${(dz * 0.6).toFixed(3)} 0 0 0 0 1 force`,
            'particle minecraft:crit ~ ~1 ~ 0.3 0.4 0.3 0.2 10 force',
            // knocked away from the sword's side (a few times over: about as hard as Knockback II)
            ...Array(4).fill(`damage @s 0.01 ${ns}:sword at ~${(dx * 2).toFixed(3)} ~ ~${(dz * 2).toFixed(3)}`),
        ]);
    }
    // the sword: swings through, then it's gone
    fn('knock/sword_tick', [
        `scoreboard players remove @s ${p}sl 1`,
        `execute if score @s ${p}sl matches 7 run data merge entity @s {start_interpolation:0,interpolation_duration:4,transformation:{left_rotation:[0f,0f,-0.6f,0.8f],right_rotation:[0f,0f,0f,1f],translation:[0f,-0.2f,0f],scale:[1.4f,1.4f,1.4f]}}`,
        `execute if score @s ${p}sl matches ..0 run kill @s`,
    ]);

    return {
        files: f,
        objectives: [`${p}pq`, `${p}sq`, `${p}pt`, `${p}st`, `${p}sl`],
        tick: [
            `execute as @a[scores={${p}pq=1..}] at @s run function ${ns}:knock/arrow_q`,
            `execute as @a[scores={${p}sq=1..}] at @s run function ${ns}:knock/sword_q`,
            `execute as @e[type=minecraft:item_display,tag=${p}sw] run function ${ns}:knock/sword_tick`,
        ],
    };
}

// The commands for a punch gift (run as you): n arrows or sword hits, queued
export const knockCommand = (ns, a, n) => `function ${ns}:knock/add_${a.style === 'sword' ? 'sword' : 'arrow'} {n:${n}}`;

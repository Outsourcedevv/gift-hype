// Builds (or updates) the Unbound Discord server from content.mjs, using a bot you invite to it.
// Run: node discord/setup-server.mjs   (or double-click "Set up Discord server.bat")
//
// Safe to run again: it finds what it made before by name and updates it. The bot's old posts in
// its channels are replaced with the new ones. Nothing else in the server is touched, unless you
// say yes to removing Discord's starting #general and General voice channel.
//
// Needs Node 18+. No packages. The bot token is only sent to Discord.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { C, SERVER, ROLES, LAYOUT, WELCOME_SCREEN, ONBOARDING, AUTOMOD } from './content.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'assets');
const API = process.env.DISCORD_API || 'https://discord.com/api/v10';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => process.env.UNBOUND_DISCORD_YES ? Promise.resolve('y') : rl.question(q);
const say = (...a) => console.log(...a);
const step = t => say(`\n\x1b[35m■\x1b[0m ${t}`);
const ok = t => say(`  \x1b[32m✓\x1b[0m ${t}`);
const warn = t => say(`  \x1b[33m!\x1b[0m ${t}`);

// ---- Discord's permission bits ----
const P = {
    CreateInstantInvite: 0, KickMembers: 1, BanMembers: 2, Administrator: 3, ManageChannels: 4, ManageGuild: 5, AddReactions: 6,
    ViewAuditLog: 7, ViewChannel: 10, SendMessages: 11, ManageMessages: 13, EmbedLinks: 14, AttachFiles: 15, MentionEveryone: 17,
    Connect: 20, Speak: 21, MuteMembers: 22, DeafenMembers: 23, MoveMembers: 24, ManageNicknames: 27, ManageRoles: 28,
    ManageGuildExpressions: 30, ManageEvents: 33, ManageThreads: 34, CreatePublicThreads: 35, CreatePrivateThreads: 36,
    SendMessagesInThreads: 38, ModerateMembers: 40,
};
const bits = names => names.reduce((n, k) => n | (1n << BigInt(P[k])), 0n).toString();
const TYPE = { text: 0, voice: 2, category: 4, news: 5, forum: 15 };

let TOKEN = '';
async function api(method, route, body, files, { quiet } = {}) {
    for (let attempt = 0; ; attempt++) {
        const headers = { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'DiscordBot (https://discord.com, 1.0) UnboundServerSetup' };
        const init = { method, headers };
        if (files?.length) {
            const fd = new FormData();
            fd.append('payload_json', JSON.stringify({ ...body, attachments: files.map((f, id) => ({ id, filename: f })) }));
            files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([fs.readFileSync(path.join(ASSETS, f))]), f));
            init.body = fd;
        } else if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        let r;
        try { r = await fetch(API + route, init); } catch (e) {
            if (attempt < 4) { await sleep(1500 * (attempt + 1)); continue; }
            throw new Error(`Can't reach Discord (${e.message}). Check your internet and try again.`);
        }
        if (r.status === 429) {
            const j = await r.json().catch(() => ({}));
            const wait = Math.ceil((j.retry_after ?? 2) * 1000) + 250;
            if (!quiet && wait > 3000) say(`  … Discord asked to slow down, waiting ${Math.round(wait / 1000)}s`);
            await sleep(wait);
            continue;
        }
        if (r.status >= 500 && attempt < 4) { await sleep(1500 * (attempt + 1)); continue; }
        const text = await r.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!r.ok) {
            const detail = data?.errors ? ' ' + JSON.stringify(data.errors).slice(0, 400) : '';
            const e = new Error(`${data?.message || r.statusText} (${r.status})${detail}`);
            e.status = r.status; e.code = data?.code;
            throw e;
        }
        return data;
    }
}
const soft = async (what, fn) => { try { return await fn(); } catch (e) { warn(`${what}: ${e.message}`); return null; } };

// ---- picking the server ----
async function login() {
    TOKEN = (process.env.DISCORD_TOKEN || '').trim();
    if (!TOKEN) {
        say('Paste your bot token (Discord Developer Portal > your app > Bot > Reset Token), then press Enter.');
        say('\x1b[2mIt stays on this PC: it is only sent to Discord.\x1b[0m');
        TOKEN = (await rl.question('Bot token: ')).trim().replace(/^Bot\s+/i, '').replace(/^"|"$/g, '');
    }
    try { return await api('GET', '/users/@me'); } catch (e) {
        if (e.status === 401) throw new Error('Discord says that token is wrong. Press "Reset Token" on the Bot page and copy the new one.');
        throw e;
    }
}

async function pickGuild(me) {
    const invite = `https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot&permissions=8`;
    for (;;) {
        const guilds = await api('GET', '/users/@me/guilds');
        if (process.env.DISCORD_GUILD) {
            const g = guilds.find(x => x.id === process.env.DISCORD_GUILD);
            if (g) return g;
        }
        if (guilds.length === 1) return guilds[0];
        if (guilds.length > 1) {
            say('\nThe bot is in these servers:');
            guilds.forEach((g, i) => say(`  ${i + 1}. ${g.name}`));
            const n = parseInt(await rl.question('Which one should be set up? Type its number: '), 10);
            if (guilds[n - 1]) return guilds[n - 1];
            continue;
        }
        say('\nThe bot isn\'t in a server yet. Open this link, pick your new server, and press Authorize:');
        say(`\n  \x1b[36m${invite}\x1b[0m\n`);
        await rl.question('Then press Enter here… ');
    }
}

// ---- building ----
const norm = (name, type) => type === TYPE.voice || type === TYPE.category ? name : name.toLowerCase().replace(/\s+/g, '-');

async function main() {
    say('\x1b[1m\x1b[35mUnbound\x1b[0m\x1b[1m · Discord server setup\x1b[0m');
    const me = await login();
    ok(`Signed in as the bot ${me.username}`);
    const g0 = await pickGuild(me);
    const G = g0.id;
    const guild = await api('GET', `/guilds/${G}`);
    say(`\nThis sets up \x1b[1m${guild.name}\x1b[0m as the Unbound server: roles, ${LAYOUT.reduce((n, c) => n + c.channels.length, 0)} channels, posts, rules, onboarding and AutoMod.`);
    if (!/^y/i.test(await ask('Go ahead? (y/n) '))) { say('Nothing changed.'); return; }
    const botMember = await api('GET', `/guilds/${G}/members/${me.id}`);

    // 1. the server itself
    step('Server name, icon and safety settings');
    await soft('server settings', async () => {
        await api('PATCH', `/guilds/${G}`, {
            name: SERVER.name,
            icon: 'data:image/png;base64,' + fs.readFileSync(path.join(ASSETS, SERVER.icon)).toString('base64'),
            verification_level: Math.max(guild.verification_level, 1),   // a verified email to talk
            explicit_content_filter: 2,                                 // scan everyone's images
            default_message_notifications: 1,                           // only @mentions ping people
        });
        ok(`Named "${SERVER.name}", icon set, verified email needed to talk, images scanned`);
    });

    // 2. roles
    step('Roles');
    let roles = await api('GET', `/guilds/${G}/roles`);
    const everyone = roles.find(r => r.id === G);
    const R = {};
    for (const spec of ROLES) {
        const body = { name: spec.name, color: spec.color || 0, hoist: !!spec.hoist, mentionable: false, permissions: bits(spec.perms || []) };
        let r = roles.find(x => x.name === spec.name && !x.managed);
        if (r) r = await api('PATCH', `/guilds/${G}/roles/${r.id}`, body);
        else r = await api('POST', `/guilds/${G}/roles`, body);
        R[spec.key] = r;
    }
    // in order, under the bot's own role
    roles = await api('GET', `/guilds/${G}/roles`);
    const botTop = Math.max(...botMember.roles.map(id => roles.find(r => r.id === id)?.position ?? 0));
    const ours = ROLES.map(s => R[s.key].id);
    const others = roles.filter(r => r.id !== G && !ours.includes(r.id) && r.position < botTop).sort((a, b) => a.position - b.position);
    const order = [...others.map(r => r.id), ...ours.slice().reverse()];
    await soft('putting the roles in order', () => api('PATCH', `/guilds/${G}/roles`, order.map((id, i) => ({ id, position: i + 1 }))));
    ok(ROLES.map(s => s.name).join(', '));
    const owner = guild.owner_id;
    await soft('giving you the Unbound Team role', () => api('PUT', `/guilds/${G}/members/${owner}/roles/${R.team.id}`));
    ok('You (the server owner) have the Unbound Team role');

    // 3. Discord's starting channels
    let existing = await api('GET', `/guilds/${G}/channels`);
    const starters = existing.filter(c => (c.type === 0 && c.name === 'general') || (c.type === 2 && c.name === 'General') || (c.type === 4 && /^(Text|Voice) Channels$/.test(c.name)));
    if (starters.length && /^y/i.test(await ask('\nRemove Discord\'s starting channels (#general, General voice and their categories)? (y/n) '))) {
        for (const c of starters) await soft(`removing ${c.name}`, () => api('DELETE', `/channels/${c.id}`));
        existing = await api('GET', `/guilds/${G}/channels`);
        ok('Removed');
    }

    // 4. categories and channels
    step('Channels');
    const staff = ['team', 'mod'].map(k => R[k].id);
    const overwrites = (ch, cat) => {
        const o = [];
        if (cat.private) {
            o.push({ id: G, type: 0, allow: '0', deny: bits(['ViewChannel']) });
            staff.forEach(id => o.push({ id, type: 0, allow: bits(['ViewChannel', 'SendMessages']), deny: '0' }));
        } else if (ch?.readOnly) {
            o.push({ id: G, type: 0, allow: bits(['ViewChannel', 'AddReactions']), deny: bits(['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads']) });
            staff.forEach(id => o.push({ id, type: 0, allow: bits(['SendMessages', 'SendMessagesInThreads']), deny: '0' }));
        }
        o.push({ id: me.id, type: 1, allow: bits(['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ManageMessages']), deny: '0' });
        return o;
    };
    const find = (name, type, parent) => existing.find(c => c.name === norm(name, type) && (c.type === type || (type === TYPE.news && c.type === TYPE.text) || (type === TYPE.text && c.type === TYPE.news)) && (parent === undefined || c.parent_id === parent));
    const CH = {};
    let community = (guild.features || []).includes('COMMUNITY');
    const later = [];   // channels that need a Community server (announcements, forums)
    let defer = true;   // first time round they wait till Community is on; after that, without it they're text

    const makeChannel = async (spec, cat, catId) => {
        let type = TYPE[spec.type || 'text'];
        const wantsCommunity = type === TYPE.news || type === TYPE.forum;
        if (wantsCommunity && !community) {
            if (defer) { later.push([spec, cat, catId]); return; }
            type = TYPE.text;
        }
        const body = { name: spec.name, type, parent_id: catId, permission_overwrites: overwrites(spec, cat) };
        if (spec.topic && type !== TYPE.voice) body.topic = spec.topic.replace(/\{#(\w+)\}/g, (m, k) => CH[k] ? `<#${CH[k].id}>` : `#${k}`).slice(0, type === TYPE.forum ? 4096 : 1024);
        if (spec.slowmode) body.rate_limit_per_user = spec.slowmode;
        if (type === TYPE.forum) {
            body.available_tags = (spec.tags || []).map(([name, emoji, moderated]) => ({ name, emoji_name: emoji, moderated: !!moderated }));
            if (spec.reaction) body.default_reaction_emoji = { emoji_name: spec.reaction };
            body.default_forum_layout = 1;
        }
        let c = find(spec.name, type, catId) || find(spec.name, type);
        try {
            if (c) {
                const patch = { ...body };
                delete patch.type;
                if (type === TYPE.forum && c.available_tags?.length) {
                    // keep the tags (and their ids) that are already there
                    const have = new Map(c.available_tags.map(t => [t.name, t]));
                    patch.available_tags = body.available_tags.map(t => have.has(t.name) ? { ...t, id: have.get(t.name).id } : t);
                }
                if (type === TYPE.news && c.type === TYPE.text && community) patch.type = TYPE.news;
                c = await api('PATCH', `/channels/${c.id}`, patch);
            } else c = await api('POST', `/guilds/${G}/channels`, body);
        } catch (e) {
            if (!wantsCommunity) throw e;
            warn(`${spec.name} as ${spec.type}: ${e.message}. Making it a normal text channel instead.`);
            c = find(spec.name, TYPE.text) || await api('POST', `/guilds/${G}/channels`, { ...body, type: TYPE.text, available_tags: undefined, default_reaction_emoji: undefined, default_forum_layout: undefined });
        }
        CH[spec.key] = c;
    };

    const catIds = {};
    for (const cat of LAYOUT) {
        let c = find(cat.category, TYPE.category);
        const body = { name: cat.category, type: TYPE.category, permission_overwrites: overwrites(null, cat) };
        c = c ? await api('PATCH', `/channels/${c.id}`, { name: body.name, permission_overwrites: body.permission_overwrites }) : await api('POST', `/guilds/${G}/channels`, body);
        catIds[cat.category] = c.id;
        for (const spec of cat.channels) await makeChannel(spec, cat, c.id);
        ok(`${cat.category}: ${cat.channels.map(s => s.name).join('  ')}`);
    }

    // 5. Community server (announcements, forums, welcome screen, onboarding)
    step('Community features');
    if (!community) {
        const r = await soft('turning on Community', () => api('PATCH', `/guilds/${G}`, {
            features: [...new Set([...(guild.features || []), 'COMMUNITY'])],
            rules_channel_id: CH.rules.id,
            public_updates_channel_id: CH.discordupdates.id,
            verification_level: Math.max(guild.verification_level, 1),
            explicit_content_filter: 2,
            preferred_locale: 'en-US',
            description: SERVER.description,
        }));
        community = !!r && (r.features || []).includes('COMMUNITY');
        if (community) ok('Community is on (announcement channel, forums, welcome screen, onboarding)');
        else warn('Community couldn\'t be turned on, so announcements and forums are normal text channels. You can turn it on in Server Settings > Enable Community, then run this again.');
    } else {
        await soft('server description', () => api('PATCH', `/guilds/${G}`, { description: SERVER.description, rules_channel_id: CH.rules.id, public_updates_channel_id: CH.discordupdates.id }));
        ok('Community was already on');
    }
    existing = await api('GET', `/guilds/${G}/channels`);
    defer = false;
    for (const [spec, cat, catId] of later.splice(0)) await makeChannel(spec, cat, catId);
    // join messages go to #general
    await soft('join messages', () => api('PATCH', `/guilds/${G}`, { system_channel_id: CH.general.id, system_channel_flags: 4 }));

    // everything in the right order
    const positions = [];
    LAYOUT.forEach((cat, ci) => {
        positions.push({ id: catIds[cat.category], position: ci });
        cat.channels.forEach((s, i) => CH[s.key] && positions.push({ id: CH[s.key].id, position: i, parent_id: catIds[cat.category], lock_permissions: false }));
    });
    await soft('putting channels in order', () => api('PATCH', `/guilds/${G}/channels`, positions));
    ok('Channels in order');

    // 6. posts
    step('Posts');
    const fill = s => s
        .replace(/\{#(\w+)\}/g, (m, k) => CH[k] ? `<#${CH[k].id}>` : `#${k}`)
        .replace(/\{@(\w+)\}/g, (m, k) => R[k] ? `<@&${R[k].id}>` : `@${k}`);
    const deep = v => typeof v === 'string' ? fill(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v;
    for (const cat of LAYOUT) for (const spec of cat.channels) {
        if (!spec.posts || !CH[spec.key]) continue;
        const cid = CH[spec.key].id;
        // the bot's earlier posts here go: these replace them
        const old = await soft(`reading ${spec.name}`, () => api('GET', `/channels/${cid}/messages?limit=100`)) || [];
        for (const m of old.filter(m => m.author?.id === me.id).reverse()) await soft('removing an old post', () => api('DELETE', `/channels/${cid}/messages/${m.id}`, undefined, undefined, { quiet: true }));
        for (const post of spec.posts) {
            const files = [];
            const embeds = (post.embeds || []).map(e => {
                const out = deep({ ...e });
                for (const k of ['image', 'thumbnail']) if (typeof out[k] === 'string') { if (!files.includes(out[k])) files.push(out[k]); out[k] = { url: `attachment://${out[k]}` }; }
                if (typeof out.footer === 'string') out.footer = { text: out.footer };
                out.color ??= C.purple;
                return out;
            });
            const body = { content: post.content ? fill(post.content) : undefined, embeds, allowed_mentions: { parse: [] } };
            if (post.buttons) body.components = [{
                type: 1, components: post.buttons.map(b => ({
                    type: 2, style: 5, label: b.label, emoji: b.emoji ? { name: b.emoji } : undefined,
                    url: b.url || `https://discord.com/channels/${G}/${CH[b.channel]?.id}`,
                })),
            }];
            await api('POST', `/channels/${cid}/messages`, body, files);
        }
        ok(`${spec.name} (${spec.posts.length} post${spec.posts.length === 1 ? '' : 's'})`);
    }

    // 7. welcome screen, onboarding, AutoMod
    if (community) {
        step('Welcome screen and onboarding');
        await soft('welcome screen', async () => {
            await api('PATCH', `/guilds/${G}/welcome-screen`, {
                enabled: true, description: WELCOME_SCREEN.description,
                welcome_channels: WELCOME_SCREEN.channels.filter(([k]) => CH[k]).map(([k, description, emoji]) => ({ channel_id: CH[k].id, description, emoji_name: emoji })),
            });
            ok('Welcome screen: what new members see first');
        });
        await soft('onboarding (Channels & Roles)', async () => {
            let n = 0n;
            const id = () => (((BigInt(Date.now()) - 1420070400000n) << 22n) + (n++)).toString();
            await api('PUT', `/guilds/${G}/onboarding`, {
                enabled: true, mode: 0,
                default_channel_ids: ONBOARDING.defaults.filter(k => CH[k]).map(k => CH[k].id),
                prompts: ONBOARDING.prompts.map(p => ({
                    id: id(), type: 0, title: p.title, single_select: !!p.single, required: !!p.required, in_onboarding: true,
                    options: p.options.map(o => ({
                        id: id(), title: o.title, description: o.description || null, emoji_name: o.emoji,
                        role_ids: (o.roles || []).map(k => R[k].id), channel_ids: (o.channels || []).filter(k => CH[k]).map(k => CH[k].id),
                    })),
                })),
            });
            ok('Onboarding: new members pick their games and pings (Channels & Roles)');
        });
    }
    step('AutoMod');
    const rules = await soft('reading AutoMod', () => api('GET', `/guilds/${G}/auto-moderation/rules`)) || [];
    for (const a of AUTOMOD) {
        if (rules.some(r => r.trigger_type === a.trigger_type)) { ok(`${a.name} (already on)`); continue; }
        const actions = [{ type: 1, metadata: a.message ? { custom_message: a.message } : {} }, { type: 2, metadata: { channel_id: CH.modlog.id } }];
        const r = await soft(a.name, () => api('POST', `/guilds/${G}/auto-moderation/rules`, { name: a.name, event_type: 1, trigger_type: a.trigger_type, trigger_metadata: a.trigger_metadata, actions, enabled: true }));
        if (r) ok(a.name);
    }

    // 8. an invite that never runs out
    const inv = await soft('invite link', () => api('POST', `/channels/${CH.welcome.id}/invites`, { max_age: 0, max_uses: 0, unique: false }));
    say(`\n\x1b[32m\x1b[1mDone!\x1b[0m ${SERVER.name} is ready.`);
    if (inv) say(`Invite link (never runs out): \x1b[36mhttps://discord.gg/${inv.code}\x1b[0m`);
    say('Give yourself a look as a new member: Server Settings > Onboarding > Preview.');
    say('\x1b[2mThe bot isn\'t needed any more. You can kick it, or keep it to run this again after changing content.mjs.\x1b[0m');
}

main().catch(e => { say(`\n\x1b[31mStopped:\x1b[0m ${e.message}`); process.exitCode = 1; }).finally(() => rl.close());

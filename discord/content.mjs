// Everything the Unbound Discord server is made of: roles, channels and the posts in them.
// setup-server.mjs reads this. Change words here and run it again: it updates the server to match.
//
// In posts, {#key} becomes a link to that channel and {@key} a mention of that role.
// Images are files in ./assets.

export const DOWNLOAD_URL = 'https://github.com/Outsourcedevv/gift-hype/archive/refs/heads/main.zip';
export const VERSION = '2.26.3';

export const C = {
    purple: 0x8b6cff, blue: 0x5d8bff, cyan: 0x22d3ee, pink: 0xff3d7f, orange: 0xff7a3d,
    green: 0x22c55e, gold: 0xfacc15, red: 0xef4444, dark: 0x16142e,
};

export const SERVER = {
    name: 'Unbound',
    icon: 'icon.png',
    description: 'Unbound turns TikTok LIVE gifts into sounds, stream popups and chaos in your Minecraft games. Download, help, game guides and the community.',
};

// ---- roles (top to bottom) ----
const MANAGE = ['ManageChannels', 'ManageRoles', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'ManageEvents', 'ManageGuildExpressions',
    'KickMembers', 'BanMembers', 'ModerateMembers', 'ViewAuditLog', 'MentionEveryone', 'MuteMembers', 'MoveMembers', 'DeafenMembers'];
const MOD = ['ManageMessages', 'ManageThreads', 'ManageNicknames', 'KickMembers', 'ModerateMembers', 'ViewAuditLog', 'MuteMembers', 'MoveMembers'];
export const ROLES = [
    { key: 'team', name: 'Unbound Team', color: C.purple, hoist: true, perms: MANAGE, owner: true },
    { key: 'mod', name: 'Moderator', color: C.cyan, hoist: true, perms: MOD },
    { key: 'partner', name: 'Partner', color: C.gold, hoist: true },
    { key: 'streamer', name: 'Streamer', color: C.pink, hoist: true },
    { key: 'beta', name: 'Beta Tester', color: C.green, hoist: true },
    { key: 'viewer', name: 'Viewer', color: 0x9aa0c4 },
    { key: 'g_wipeout', name: 'Wipeout' },
    { key: 'g_dropper', name: 'Dropper' },
    { key: 'g_parkour', name: 'Parkour Paradise' },
    { key: 'g_chunkchat', name: 'Chunk Chat' },
    { key: 'g_teleport', name: 'Chat Teleport' },
    { key: 'g_blockdelete', name: 'Block Delete' },
    { key: 'p_updates', name: 'Update Pings' },
    { key: 'p_events', name: 'Event Pings' },
    { key: 'p_live', name: 'Going Live Pings' },
];

const dl = { label: 'Download Unbound', url: DOWNLOAD_URL, emoji: '⬇️' };
const chan = (label, key, emoji) => ({ label, channel: key, emoji });

// ---- the games ----
const game = (o) => ({
    color: o.color, title: o.title, description: o.description,
    fields: [
        ...(o.fields || []),
        { name: '🎁 Starting gifts', value: o.gifts.map(([g, w]) => `**${g}**: ${w}`).join('\n'), inline: false },
    ],
    image: o.image,
    footer: 'Every gift can be changed: pick any TikTok gift, any sound, any action.',
});

export const GAMES = [
    {
        key: 'wipeout', name: '🌊・wipeout', role: 'g_wipeout',
        topic: 'Wipeout: 100 levels of obstacles over the sea, and a tower to climb at the end.',
        posts: [{ embeds: [game({
            color: C.blue, title: '🌊 Wipeout', image: 'cover-wipeout.jpg',
            description: '**100 levels in one straight line** of blue and light blue concrete over warm sea water, between white and blue walls with a cheering crowd, floodlights and clouds. Each level is two obstacles (three after level 80) and ends on an emerald pad: that\'s the level up. No checkpoints. Fall in the sea or touch red and the level starts again.\n\nUnbound builds the whole world by itself (under a minute) when you press **Play Minecraft**.',
            fields: [
                { name: '🟥 Obstacles', value: 'Spinners • sliding cubes • **waves of walls** (duck into the holes) • crushers • punching gloves on iron arms • boxing gloves that bounce you • the zipline • pick the right door • the **vanishing bridge** • duck & jump • laser gates • rolling bars • giant balls • stepping stones • flashing tiles', inline: false },
                { name: '🗼 Level 100: The Tower', value: 'Black and yellow, rising out of the sea. Spiral up past sweeping red arms, punching gloves and steps that vanish. Reach the emerald on top to win.', inline: false },
                { name: '✅ Every level can be done', value: 'Each one is checked tick by tick before it\'s built.', inline: false },
            ],
            gifts: [['Finger Heart', 'punch (arrow or sword hit)'], ['Doughnut', 'punches on / off'], ['Rosa', 'jail for 5s'], ['Paper Crane / Corgi', 'up 1 / 5 levels'],
                ['Hat and Mustache / Boxing Gloves', 'down 1 / 5 levels'], ['Hand Hearts', 'level slot machine'], ['Galaxy', '60s reset countdown'], ['Glowing Jellyfish', 'saves you']],
        }), { color: C.blue, image: 'ingame-levelup.png', description: '**LEVEL UP** and **LEVEL DOWN** fill the screen so you and your chat never miss one.' }] }],
    },
    {
        key: 'dropper', name: '🪂・dropper', role: 'g_dropper',
        topic: 'The Dropper: 100 themed levels to fall through. Land in the water to go up.',
        posts: [{ embeds: [game({
            color: C.orange, title: '🪂 The Dropper', image: 'cover-dropper.jpg',
            description: '**100 dropper levels, each one a place:** Flower Meadow, Candy Land, Picnic Party, Desert Tomb, Coral Reef, Sky Temple, Bee Hive, Ice Spikes, Crystal Cave, Lava Forge, Nether Fortress, Haunted House, Night City, Neon Grid, Outer Space, Rainbow Road... up to the **Royal Palace** at level 100.\n\nEach is a huge shaft with a fall of **680 to 1,380 blocks**. Giant centrepieces fill it wall to wall (a pizza, a planet, a jack-o\'-lantern, a gear...), and the gaps never line up, so you steer the whole way down. Land in the water and you go straight to the next level.',
            fields: [
                { name: '👀 A secret', value: 'Some say there\'s something past level 100. Nobody has proof. Yet.', inline: false },
            ],
            gifts: [['Finger Heart', 'punch'], ['Doughnut', 'punches on / off'], ['Rosa', 'jail'], ['Paper Crane / Corgi', 'up 1 / 5 levels'],
                ['Hat and Mustache / Boxing Gloves', 'down 1 / 5 levels'], ['Hand Hearts', 'level slot machine'], ['Galaxy', 'reset countdown'], ['Glowing Jellyfish', 'saves you']],
        })] }],
    },
    {
        key: 'parkour', name: '🧗・parkour-paradise', role: 'g_parkour',
        topic: 'Parkour Paradise: gifts that help you or wreck your run.',
        posts: [{ embeds: [game({
            color: C.green, title: '🧗 Parkour Paradise', image: 'cover-parkour.jpg',
            description: 'Play any parkour map you like, and **chat decides how it goes**. Some gifts help (speed, super jumps), most of them don\'t: arrows raining on you, freezing in place mid-jump, the drunk walk, getting launched into the sky, or straight back to the start.',
            gifts: [['Finger Heart', 'arrow rain'], ['Rosa', 'frozen for 5s'], ['Hat and Mustache', 'drunk for 15s'], ['Paper Crane', 'speed boost'],
                ['Corgi', 'super jump'], ['Boxing Gloves', 'launched into the air'], ['Galaxy', 'back to the start']],
        })] }],
    },
    {
        key: 'chunkchat', name: '🟫・chunk-chat', role: 'g_chunkchat',
        topic: 'Chunk Chat: chat types a block, and the chunk you\'re in turns into it.',
        posts: [{ embeds: [game({
            color: C.gold, title: '🟫 Chunk Chat', image: 'cover-chunkchat.jpg',
            description: 'Viewers type blocks in your LIVE chat (**every block in Minecraft**, typos and all: "diamnd blok", "obsidain", "logs"). Every 30 seconds **the whole chunk you\'re in turns into the block chat picked**, from the bottom of the world to the top.\n\nPick whether the block typed **most** wins or the **last** one typed. A timer box shows in Minecraft, and on stream the new block drops in, shatters and shows who picked it.',
            fields: [{ name: '🛡️ Never unfair', value: 'Blocks you\'d fall through, blocks that set themselves off and anything you add to the "can\'t pick" list are skipped.', inline: false }],
            gifts: [['Galaxy', 'NUKE'], ['Rosa', 'jail'], ['Doughnut / Hat and Mustache / Whale Diving', 'cobweb / lava / air chunk'], ['Corgi', 'teleport to the End'], ['Finger Heart / Money Gun', 'diamond kit / god kit'], ['Rose', 'spawns a zombie']],
        })] }],
    },
    {
        key: 'teleport', name: '🧭・chat-teleport', role: 'g_teleport',
        topic: 'Chat Teleport: chat types a block, structure or biome and you get sent to the nearest one.',
        posts: [{ embeds: [game({
            color: C.purple, title: '🧭 Chat Teleport', image: 'cover-chatteleport.jpg',
            description: 'Viewers type **anything in Minecraft**: a block (chest, diamonds, spawner), a structure (village, trial chamber, ancient city, end ship...) or a biome (cherry grove, deep dark, mushroom island). On a timer, **you\'re teleported to the nearest one**, up to 50,000 blocks away.\n\nTypos are fine ("vilage", "trail chamber", "strong hold"). Everyday chat and gift names are ignored. You never get sent to another dimension, and you always land somewhere you can breathe.',
            fields: [{ name: '📦 On screen', value: 'A box in Minecraft says **TELEPORT IN** and the seconds left, then what you went to and how far it was. Every colour, word and timing can be changed.', inline: false }],
            gifts: [['Galaxy', 'NUKE'], ['Rosa', 'jail'], ['Doughnut / Hat and Mustache / Whale Diving', 'cobweb / lava / air chunk'], ['Corgi', 'teleport to the End'], ['Finger Heart / Money Gun', 'diamond kit / god kit']],
        })] }],
    },
    {
        key: 'blockdelete', name: '💣・block-delete', role: 'g_blockdelete',
        topic: 'Block Delete Survival: chat deletes blocks, gifts drop nukes.',
        posts: [{ embeds: [game({
            color: C.red, title: '💣 Block Delete Survival', image: 'cover-blockdelete.jpg',
            description: 'Survive in your own world while chat takes it apart. Viewers **type a block** ("stone", "oak log", "logs") and after a countdown **every block of that kind around you is gone**, top of the world to the bottom.\n\nThen the gifts: a **nuke** that falls from the sky, goes up in a mushroom cloud and leaves a crater 290 blocks across. Jail. Lava chunks. Clearing your inventory. A trip to the End.',
            gifts: [['Galaxy', 'NUKE ☢️'], ['Rose', 'spawns a zombie'], ['Finger Heart', 'diamond kit'], ['Rosa', 'jail for 30s'], ['Perfume', 'clears your inventory'],
                ['Doughnut / Hat and Mustache / Whale Diving', 'cobweb / lava / air chunk'], ['Corgi', 'teleport to the End'], ['Money Gun', 'god kit']],
        })] }],
    },
];

// ---- forums ----
const helpGuide = `**Before you post**
• Check {#faq}, it answers most questions.
• Make sure Unbound is up to date (Look & settings > Updates).

**In your post**
• What you were doing and what happened
• Which game and type (e.g. Minecraft > Wipeout)
• A screenshot of Unbound, and of the error if there is one

When it's fixed, add the ✅ Solved tag.`;

// ---- the whole server, top to bottom ----
// type: text | news | forum | voice. readOnly: only staff can write. private: only staff can see.
export const LAYOUT = [
    {
        category: '✦ START HERE', channels: [
            {
                key: 'welcome', name: '👋・welcome', readOnly: true, topic: 'Welcome to Unbound!', posts: [
                    {
                        embeds: [{
                            color: C.purple, image: 'banner.png', title: 'Welcome to Unbound',
                            description: '**Unbound turns your TikTok LIVE gifts into sounds, stream popups and real chaos in your games.**\n\nA viewer sends a Galaxy: a countdown hits your stream and you\'ve got 60 seconds before you\'re sent back to level 1. Unless someone sends a Glowing Jellyfish to save you.\n\nSix Minecraft games, 1,800+ gifts, 110 sounds, a stream overlay and your overlay inside Minecraft too. One button sets up the whole game for you.',
                        }],
                        buttons: [dl, chan('How it works', 'howitworks', '✨'), chan('The games', 'allgames', '🎮')],
                    },
                    {
                        embeds: [{
                            color: C.dark, title: '🧭 Find your way',
                            fields: [
                                { name: '⬇️ Get it', value: '{#download}: set up on your PC in a few minutes\n{#faq}: quick answers', inline: true },
                                { name: '✨ Learn it', value: '{#howitworks}\n{#gifts}\n{#overlay}\n{#ingame}\n{#sounds}', inline: true },
                                { name: '🎮 The games', value: '{#allgames}: all six, with what every gift does', inline: false },
                                { name: '💬 Hang out', value: '{#general} • {#goinglive} • {#clips} • {#setups}', inline: false },
                                { name: '🆘 Stuck?', value: '{#help}: ask anything\n{#bugs}: something broke\n{#ideas}: what should Unbound do next?', inline: false },
                                { name: '🎭 Your roles', value: 'Open **Channels & Roles** at the top of the channel list to pick your games and pings.', inline: false },
                            ],
                            footer: 'Please read the rules before you post.',
                        }],
                    },
                ],
            },
            {
                key: 'rules', name: '📜・rules', readOnly: true, topic: 'The rules. Breaking them: a warning, then a timeout, then a ban.', posts: [{
                    embeds: [{
                        color: C.purple, title: '📜 Server rules',
                        description: [
                            '**1. Be kind.** No harassment, hate, slurs or personal attacks. Disagree with ideas, not people.',
                            '**2. Keep it safe for everyone.** No NSFW, gore or shock content, anywhere (names and pictures too).',
                            '**3. No spam.** No mass pings, walls of emojis, or the same message in many channels.',
                            '**4. Promote in the right place.** Your LIVEs and clips go in {#goinglive} and {#clips}. No ads for other servers or products, and no DM advertising.',
                            '**5. Right channel, right post.** Questions in {#help}, bugs in {#bugs}, ideas in {#ideas}.',
                            '**6. No cheating or harmful files.** No cracked software, token grabbers, "free coins" or anything that breaks TikTok\'s or Minecraft\'s rules.',
                            '**7. Keep private things private.** Don\'t share anyone\'s personal info, and never share your TikTok or Discord passwords. Staff will never ask for them.',
                            '**8. Listen to the staff.** If a {@mod} or the {@team} asks you to stop, stop. Problem with a decision? DM the team calmly.',
                            '**9. Follow Discord\'s rules.** [Terms of Service](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines).',
                        ].join('\n\n'),
                        footer: 'Breaking a rule: a warning, then a timeout, then a ban. Serious ones go straight to a ban.',
                    }],
                }],
            },
            {
                key: 'download', name: '⬇️・download', readOnly: true, topic: 'Get Unbound on your PC.', posts: [{
                    embeds: [{
                        color: C.green, title: `⬇️ Download Unbound (v${VERSION})`,
                        description: 'Works on **Windows**. You need a TikTok account that can go LIVE, and Minecraft: Java Edition for the Minecraft games.',
                        fields: [
                            { name: '1️⃣ Download', value: `Press **Download Unbound** below (a zip).`, inline: false },
                            { name: '2️⃣ Extract it', value: 'Right-click the zip > **Extract All**, and put the folder somewhere to keep (like Documents).', inline: false },
                            { name: '3️⃣ Run Setup.bat', value: 'In that folder. It installs what\'s needed and puts an **Unbound** icon on your desktop.', inline: false },
                            { name: '4️⃣ Connect', value: 'Open Unbound, type your TikTok name at the top and press **Connect**. That\'s it.', inline: false },
                            { name: '🔄 Updates', value: 'You only download it once. When there\'s a new version, Unbound shows a bar at the top: press **Update now**. Your gifts, sounds, settings and worlds are kept.', inline: false },
                        ],
                        image: 'app-home.png',
                    }],
                    buttons: [dl, chan('Need help?', 'help', '🆘')],
                }],
            },
            {
                key: 'faq', name: '❓・faq', readOnly: true, topic: 'Quick answers to common questions.', posts: [{
                    embeds: [{
                        color: C.cyan, title: '❓ Frequently asked questions',
                        fields: [
                            { name: 'Does it work on Mac or phone?', value: 'Unbound runs on a **Windows PC**. Your stream can be from TikTok LIVE Studio or OBS on that PC.', inline: false },
                            { name: 'Java or Bedrock?', value: '**Minecraft: Java Edition.** Press **Play Minecraft** in Unbound and it downloads the right Java, Minecraft\'s files and the world by itself, then opens the launcher ready to go.', inline: false },
                            { name: 'Do I need a server?', value: 'No. Wipeout and the Dropper come with their own worlds. For the other games pick **Singleplayer world** and Unbound opens your own world for you. You can also use your own server.', inline: false },
                            { name: 'How do I get the popups on my stream?', value: 'Stream overlay tab > **Set up in TikTok LIVE Studio** (or copy the link into OBS as a Browser source). See {#overlay}.', inline: false },
                            { name: 'Can I see the overlay inside Minecraft?', value: 'Yes, with the Unbound HUD mod (Minecraft 26.2). Play Minecraft sets it up for you. See {#ingame}.', inline: false },
                            { name: 'A gift doesn\'t do anything', value: 'Check the game\'s cover says **LIVE** and the right type is picked. Press **Test** on the gift to try it without going live.', inline: false },
                            { name: 'Can I change what gifts do?', value: 'All of it: any TikTok gift (or a follow), any sound, a popup, and as many actions as you want.', inline: false },
                            { name: 'Is it made by TikTok?', value: 'No. Unbound uses an unofficial connection to TikTok LIVE. It only reads your LIVE\'s gifts and chat, and never needs your password.', inline: false },
                        ],
                        footer: 'Still stuck? Post in #help.',
                    }],
                }],
            },
        ],
    },
    {
        category: '✦ UNBOUND', channels: [
            {
                key: 'announcements', name: '📢・announcements', type: 'news', readOnly: true, topic: 'News about Unbound. Get pinged: pick Update Pings in Channels & Roles.', posts: [{
                    embeds: [{
                        color: C.purple, title: '🎉 The Unbound Discord is open!',
                        description: `Welcome! This is the home of Unbound: downloads, guides for every game, help, and a place to show off your streams.\n\n**Latest version: ${VERSION}.** Your overlay now works inside Minecraft. Move, resize or hide any piece from Esc > Unbound. See {#updates} for everything new.\n\nWant a ping when there's news? Pick **Update Pings** in Channels & Roles.`,
                    }],
                    buttons: [dl],
                }],
            },
            {
                key: 'updates', name: '🆕・updates', readOnly: true, topic: 'What\'s new in each version.', posts: [{
                    embeds: [{
                        color: C.green, title: '🆕 What\'s new',
                        description: 'Unbound updates itself: press **Update now** when the bar shows at the top of the app.',
                        fields: [
                            { name: '2.26.1', value: 'Hide any piece of the in-game overlay with its ✕, or from the **Show / hide** list.', inline: false },
                            { name: '2.26.0', value: '**Your stream overlay in Minecraft:** gift popups, gift list, reset countdown, slot machine, timers. Drag them anywhere and resize by the corner.', inline: false },
                            { name: '2.25.1', value: 'Level up and level down you can\'t miss: a huge green ⬆ LEVEL UP or red ⬇ LEVEL DOWN.', inline: false },
                            { name: '2.25.0', value: 'Getting started steps, clearer words everywhere.', inline: false },
                            { name: '2.24.0', value: 'Swap any gift from the gallery, plus loads of quality of life.', inline: false },
                            { name: '2.23.x', value: 'The Unbound HUD mod (Esc > Unbound), new covers, gifts work while you\'re in jail.', inline: false },
                            { name: '2.22.0', value: 'Reset the map button, and the time left under the floating save gift.', inline: false },
                            { name: '2.21.x', value: 'The newest TikTok gifts, a save gift that floats round your stream, punches that keep coming, jails that never get stuck.', inline: false },
                            { name: '2.20.0', value: 'Wipeout: five new obstacles.', inline: false },
                            { name: '2.13 – 2.19', value: 'Wipeout\'s new look (crowd, floodlights, clouds), the tower at level 100, waves with holes, the vanishing bridge, sword hits, the Follow trigger.', inline: false },
                        ],
                    }],
                }],
            },
            {
                key: 'howitworks', name: '✨・how-it-works', readOnly: true, topic: 'How Unbound works, and going live in 4 steps.', posts: [
                    { embeds: [{ color: C.purple, image: 'how.png', title: '✨ How it works', description: 'Unbound runs on your PC next to your game. When a viewer sends a gift on your TikTok LIVE, Unbound plays its sound, pops it up on your stream and makes it happen in your game, all in about a second.' }] },
                    {
                        embeds: [{
                            color: C.blue, title: '🔴 Go live in 4 steps', image: 'app-games.png',
                            fields: [
                                { name: '1. Connect your TikTok', value: 'Type your TikTok name at the top and press **Connect**. It waits for your LIVE to start, and connects by itself next time.', inline: false },
                                { name: '2. Pick your game', value: 'Click **Minecraft** and pick a type: Wipeout, Dropper, Parkour Paradise, Chunk Chat, Chat Teleport or Block Delete. The one marked **LIVE** is where gifts go.', inline: false },
                                { name: '3. Press Play Minecraft', value: 'Unbound downloads and sets up everything the game needs, then opens the launcher. Press Play.', inline: false },
                                { name: '4. Add the overlay', value: 'One link in TikTok LIVE Studio or OBS (see {#overlay}). Done: go live!', inline: false },
                            ],
                            footer: 'The app ticks each step off for you on its Getting started list.',
                        }],
                    },
                ],
            },
            {
                key: 'gifts', name: '🎁・gifts-and-actions', readOnly: true, topic: 'Every TikTok gift, any sound, any action.', posts: [{
                    embeds: [{
                        color: C.pink, title: '🎁 Gifts & what they do', image: 'app-gifts.png',
                        description: 'Every game type has its own list of gifts, ready to go. Change anything:',
                        fields: [
                            { name: '🖼️ Any gift', value: 'All **1,840+ TikTok gifts** with their pictures and prices. New campaign gifts are added by themselves. Plus **Follow** and **Any other gift**.', inline: false },
                            { name: '🔊 A sound', value: 'From the sound board, a random one, or your own file. Volume and cut per gift.', inline: true },
                            { name: '✨ A popup', value: 'The gift pops up on your stream with who sent it.', inline: true },
                            { name: '⛏️ Minecraft actions', value: 'Level up / down • level slot machine • punches (arrow or sword hit) • jail • reset countdown & save • nuke • cobweb / lava / air chunk • clear inventory • teleport to the End • god kit • diamond kit • spawn any mob • lightning • or your own command', inline: false },
                            { name: '🔁 Streaks', value: 'A streak of 5 Roses can do it 5 times.', inline: true },
                            { name: '🧪 Test', value: 'Every gift has a **Test** button. Try it without going live.', inline: true },
                        ],
                    }],
                }],
            },
            {
                key: 'overlay', name: '📺・stream-overlay', readOnly: true, topic: 'Gift popups, gift list, countdowns and more on your stream.', posts: [{
                    embeds: [{
                        color: C.cyan, title: '📺 The stream overlay', image: 'overlay.jpg',
                        description: 'Gift popups on spinning sun rays, a **Send a gift** list that shows viewers what every gift does, the **reset countdown** with the save gift floating round the screen, the level slot machine, chunk reveals and timers.',
                        fields: [
                            { name: 'Add it to your stream', value: '**TikTok LIVE Studio:** Stream overlay tab > **Set up in TikTok LIVE Studio** and follow the steps.\n**OBS:** add a **Browser** source with the overlay link from that tab, full screen.', inline: false },
                            { name: 'Make it yours', value: 'Drag and resize every box. 5 popup styles, 6 ways to come in, your own colours and words, and a minimum gift price.', inline: false },
                        ],
                    }, { color: C.cyan, image: 'app-overlay.png', description: 'Move and resize each box right in the app.' }],
                }],
            },
            {
                key: 'ingame', name: '🧩・in-game-overlay', readOnly: true, topic: 'Your overlay inside Minecraft, with the Unbound HUD mod.', posts: [{
                    embeds: [{
                        color: C.purple, title: '🧩 Your overlay, inside Minecraft', image: 'ingame-overlay.png',
                        description: 'See your gifts without looking away from the game. The **Unbound HUD** mod shows everything your stream overlay shows, right in Minecraft: gift popups, the gift list, the reset countdown, the slot machine, timers, plus your level, wipeouts and punches.\n\n**Play Minecraft** sets it up for you (Minecraft 26.2, with Fabric).',
                    }, {
                        color: C.purple, title: 'Esc > Unbound', image: 'ingame-editor.png',
                        description: '• **Drag** a piece to move it\n• **Drag its corner** to make it bigger or smaller\n• **Right-click** for a background\n• Click the red **✕** to hide it (the green **+** brings it back), or use **Show / hide**',
                    }],
                }],
            },
            {
                key: 'sounds', name: '🔊・sound-board', readOnly: true, topic: '110 sounds to start, and any sound you can find.', posts: [{
                    embeds: [{
                        color: C.orange, title: '🔊 The sound board', image: 'app-sounds.png',
                        description: '**110 real clips** to start: edit audios, brainrot (tung tung tung sahur, tralalero, 6 7...), memes, endings & drama, game sounds and more. Search, favourite and rename them.\n\n**Find any sound** searches thousands more inside the app, and you can add your own .mp3 / .wav files.',
                    }],
                }],
            },
        ],
    },
    {
        category: '✦ THE GAMES', channels: [
            {
                key: 'allgames', name: '🎮・all-games', readOnly: true, topic: 'Every game Unbound plays.', posts: [{
                    embeds: [{
                        color: C.purple, title: '🎮 The games', image: 'app-games.png',
                        description: 'Unbound works with **Minecraft: Java Edition**, with six ways to play. Each has its own gifts, ready to go:',
                        fields: [
                            { name: '🌊 Wipeout', value: '100 levels of obstacles over the sea. {#wipeout}', inline: true },
                            { name: '🪂 The Dropper', value: '100 themed levels to fall through. {#dropper}', inline: true },
                            { name: '🧗 Parkour Paradise', value: 'Chat helps or wrecks your run. {#parkour}', inline: true },
                            { name: '🟫 Chunk Chat', value: 'Chat turns your chunk into a block. {#chunkchat}', inline: true },
                            { name: '🧭 Chat Teleport', value: 'Chat sends you anywhere. {#teleport}', inline: true },
                            { name: '💣 Block Delete', value: 'Chat deletes blocks. Gifts nuke. {#blockdelete}', inline: true },
                        ],
                        footer: 'Also: Key presses (gifts press keys in any game) and Sounds only.',
                    }],
                }],
            },
            ...GAMES.map(g => ({ key: g.key, name: g.name, readOnly: true, topic: g.topic, posts: g.posts })),
            { key: 'gametalk', name: '💬・game-talk', topic: 'Talk about the games: best runs, hardest levels, gift combos.' },
        ],
    },
    {
        category: '✦ COMMUNITY', channels: [
            { key: 'general', name: '💬・general', topic: 'Chat about anything. Be nice!' },
            { key: 'goinglive', name: '🔴・going-live', topic: 'Going live with Unbound? Drop your TikTok link here.', slowmode: 300 },
            { key: 'clips', name: '🎬・clips', topic: 'Your best Unbound moments: wipeouts, nukes, saves at 0:01.' },
            {
                key: 'setups', name: '🧪・gift-setups', type: 'forum', topic: 'Share your gift setups and copy other streamers\' ideas.\n\nOne post per setup: which game, and what each gift does.',
                tags: [['Wipeout', '🌊'], ['Dropper', '🪂'], ['Parkour', '🧗'], ['Chunk Chat', '🟫'], ['Chat Teleport', '🧭'], ['Block Delete', '💣'], ['Other', '🎮']],
                reaction: '🔥',
            },
            { key: 'memes', name: '😂・memes', topic: 'Memes. Keep them clean.' },
        ],
    },
    {
        category: '✦ HELP', channels: [
            { key: 'help', name: '🆘・help', type: 'forum', topic: helpGuide, tags: [['Setup', '⚙️'], ['TikTok', '🎵'], ['Minecraft', '⛏️'], ['Overlay', '📺'], ['Gifts & sounds', '🎁'], ['Solved', '✅', true]] },
            {
                key: 'bugs', name: '🐛・bug-reports', type: 'forum',
                topic: '**Found a bug?** One post per bug:\n• What you did\n• What you expected\n• What happened instead\n• Your Unbound version (Look & settings > Updates) and a screenshot',
                tags: [['Bug', '🐛'], ['Confirmed', '📌', true], ['Fixed', '✅', true], ['Can\'t reproduce', '❔', true]],
            },
            {
                key: 'ideas', name: '💡・suggestions', type: 'forum', reaction: '👍',
                topic: '**What should Unbound do next?** A new game, a new obstacle, a new gift action...\nOne idea per post. Vote with 👍 on the ones you want.',
                tags: [['Idea', '💡'], ['New game', '🎮'], ['Planned', '🗓️', true], ['Added', '✅', true], ['Not planned', '🚫', true]],
            },
        ],
    },
    {
        category: '✦ VOICE', channels: [
            { key: 'v_lounge', name: '🎙️ Lounge', type: 'voice' },
            { key: 'v_gaming', name: '🎮 Gaming', type: 'voice' },
            { key: 'v_stream', name: '📺 Stream Together', type: 'voice' },
            { key: 'v_test', name: '🧪 Gift Testing', type: 'voice' },
        ],
    },
    {
        category: '✦ STAFF', private: true, channels: [
            { key: 'staff', name: '🛡️・staff-chat', topic: 'Staff only.' },
            { key: 'modlog', name: '📋・mod-log', topic: 'AutoMod alerts land here.' },
            { key: 'discordupdates', name: '🔔・discord-updates', topic: 'Messages from Discord about the server.' },
        ],
    },
];

// ---- Discord's own features (need the server to be a Community server) ----
export const WELCOME_SCREEN = {
    description: 'TikTok LIVE gifts → sounds, stream popups and chaos in your Minecraft games.',
    channels: [['download', 'Get Unbound on your PC', '⬇️'], ['howitworks', 'How it works', '✨'], ['allgames', 'The six games', '🎮'], ['help', 'Ask for help', '🆘'], ['general', 'Say hi', '👋']],
};

export const ONBOARDING = {
    defaults: ['welcome', 'rules', 'download', 'faq', 'announcements', 'howitworks', 'allgames', 'general', 'gametalk', 'goinglive', 'clips', 'memes', 'help', 'ideas'],
    prompts: [
        {
            title: 'What brings you here?', single: true, required: true, options: [
                { title: 'I stream with Unbound', description: 'Or I want to', emoji: '🎥', roles: ['streamer'], channels: ['setups', 'bugs'] },
                { title: 'I watch Unbound streams', description: 'Here for the chaos', emoji: '👀', roles: ['viewer'] },
            ],
        },
        {
            title: 'Which games are you into?', options: GAMES.map(g => ({ title: g.name.replace(/^.*・/, '').replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()), emoji: g.name.split('・')[0], roles: [g.role], channels: [g.key] })),
        },
        {
            title: 'Get pinged for...', options: [
                { title: 'New updates', description: 'A new version of Unbound', emoji: '📢', roles: ['p_updates'] },
                { title: 'Events', description: 'Community streams and challenges', emoji: '🎉', roles: ['p_events'] },
                { title: 'Streamers going live', emoji: '🔴', roles: ['p_live'] },
            ],
        },
    ],
};

export const AUTOMOD = [
    { name: 'Block bad words', trigger_type: 4, trigger_metadata: { presets: [1, 2, 3] }, message: 'Please keep it friendly.' },
    { name: 'Block mass mentions', trigger_type: 5, trigger_metadata: { mention_total_limit: 6, mention_raid_protection_enabled: true }, message: 'Too many mentions in one message.' },
    { name: 'Block spam', trigger_type: 3, trigger_metadata: {} },
];

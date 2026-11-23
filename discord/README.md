# The Unbound Discord server

A ready-made Discord server that shows off Unbound: what it is, how it works, every game and what each gift
does, plus download steps, help forums, roles and moderation. `setup-server.mjs` builds all of it in an empty
server in about two minutes.

## What you get

- **✦ START HERE**: welcome (banner, a map of the server and buttons), rules, download steps, FAQ
- **✦ UNBOUND**: announcements, updates (what's new), how it works, gifts & actions, stream overlay,
  in-game overlay, sound board. Each has screenshots from the app.
- **✦ THE GAMES**: all six, each with its cover, what happens and its starting gifts: Wipeout, the Dropper,
  Parkour Paradise, Chunk Chat, Chat Teleport, Block Delete. Plus a game-talk chat.
- **✦ COMMUNITY**: general, going-live (slow mode), clips, gift-setups (forum), memes
- **✦ HELP**: help, bug-reports and suggestions forums, with tags (Solved, Fixed, Planned...)
- **✦ VOICE**: Lounge, Gaming, Stream Together, Gift Testing
- **✦ STAFF** (only the team sees it): staff-chat, mod-log (AutoMod alerts), discord-updates
- **Roles**: Unbound Team, Moderator, Partner, Streamer, Beta Tester, Viewer, one per game, and ping roles
- **Onboarding**: new members pick streamer or viewer, their games and their pings, and get the roles and channels
- **Welcome screen**, **AutoMod** (bad words, mass mentions, spam), safety settings, server icon and name

Info channels are read-only: only the team posts there.

## Set it up (Windows, once)

1. **Make an empty server.** In Discord: **+** (Add a Server) > **Create My Own** > **For me and my friends**,
   any name (it gets renamed to Unbound).
2. **Make a bot to build it.** Go to [discord.com/developers/applications](https://discord.com/developers/applications)
   > **New Application** (call it "Unbound Setup") > **Bot** > **Reset Token** > **Copy**.
3. **Run it.** Double-click **Set up Discord server.bat** in this folder and paste the token.
   It shows a link to add the bot to your server: open it, pick the server, **Authorize**, then press Enter.
4. Say **y** to go ahead (and **y** to remove Discord's starting #general). When it's done it shows an invite
   link that never runs out.

Then you can kick the bot. Server Settings > Onboarding > **Preview** shows what new members see.

The token is only sent to Discord. If it ever gets out, press **Reset Token** again.

## Changing it

Everything (words, channels, roles, which pictures) is in `content.mjs`, and the pictures are in `assets/`.
Change it and run the setup again: it updates what it made before, and replaces its old posts with the new
ones. Channels and roles you make yourself are left alone.

Without the .bat: `node discord/setup-server.mjs` (Node 18 or newer). `DISCORD_TOKEN` and `DISCORD_GUILD`
can be set instead of typing them.

If Discord won't turn on Community for your server, announcements and the forums are made as normal text
channels. Turn on Community in Server Settings, then run the setup again.

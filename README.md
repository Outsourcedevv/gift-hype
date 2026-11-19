# Unbound

_(Formerly Gift Hype.)_

TikTok LIVE gifts play sounds, pop up on your stream, and make things happen in your games.

- **Games**: every game with a TikTok LIVE mod. It starts with **Minecraft**, which has six types (Block Delete Survival, Chunk Chat, Chat Teleport, Parkour Paradise, the Dropper and Wipeout):
  - **Wipeout**: 100 levels in one straight line in the sky over warm sea water, with birch stands on both sides. Each level is two obstacles (three after level 80) ending at a gold level-up pad, with no checkpoints. Level 100 is a black and yellow tower: climb the spiral to the top to win. Touch red and you're dead (spinners, sliding cubes, waves of walls you dodge by ducking into holes, crushers, the zipline's sweepers); bridges keep going yellow, red, then vanishing; punching gloves shoot out of a wall and knock you into the sea, boxing gloves bounce you up, pick the right door. The same gifts as the Dropper. Every level is checked to make sure it can be done.
  - **Parkour Paradise**: arrows, freezing, drunk, speed, jumps, back to the start.
  - **Block Delete Survival**: a nuke that falls from the sky and blows a crater, jail, cobweb / lava / air chunks, clear inventory, teleport to the End, god kit, diamond kit, mobs. Viewers can also type a block in the LIVE chat ("stone", "oak log", "logs"): after a countdown on the overlay and in the game, every block of that kind around you is deleted.
  - **Chunk Chat**: viewers type blocks in the LIVE chat (every block in Minecraft, typos and all), and every 30 seconds the whole chunk you're in turns into the block typed most (or the last one typed); if that one can't fill a chunk, the next one typed is used. A timer box in Minecraft, a chunk reveal animation on the stream overlay and an overlay timer, each on or off. Same gifts as Block Delete. Blocks you'd fall through and blocks the gifts do (lava, air, cobwebs) can't fill a chunk.
  - **Chat Teleport**: viewers type any block, structure or biome in the LIVE chat (chest, village, trial chamber, cherry grove...), and on a timer you're teleported to the nearest one in your dimension. A bar in Minecraft shows where and when.

  The games screen shows each game's cover (Minecraft's official one is loaded from the Microsoft Store; other games can use any picture). Click a cover, pick its type, and gifts do what that type says. Each type has its own gift list, and you can add more types or games. Minecraft commands go over RCON. Servers on your PC are found automatically, with no password to type.
- **Play Minecraft**: one button gets everything ready and opens the Minecraft launcher. The first time it downloads what's needed by itself: the right Java for that Minecraft version, Minecraft's official server and the game's files. Works for the Dropper, Wipeout and any type on a Singleplayer world (Parkour Paradise, Block Delete...).
- **Gifts**: pick from about 1,760 TikTok gifts with their pictures and prices. Each gift gets a sound, a stream popup and any number of actions. There's a Test button for every gift.
- **Sounds**: 110 real clips to start, in groups: edit audios (the *Where have you been* edit, *Can you feel my heart*, *After dark*, *Sahara*...), brainrot (chicken jockey, tung tung tung sahur, tralalero, 6 7...), memes, endings & drama, game sounds, Minecraft and phone pings. Unbound downloads them from [MyInstants](https://www.myinstants.com) the first time it opens, so they aren't stored in this repo. The Sounds tab is a sound board with search, groups, favourites (Quick sounds) and your own names. A gift can play one sound or a random one (from all, your favourites or one group). **Find any sound** searches MyInstants inside the app, and you can add your own .mp3 / .wav files.
- **Easy to find your way**: tabs for Games & gifts, Sounds, Stream overlay and Look & settings, plus **Find anything** (Ctrl + K) for any game, sound or setting.
- **Opening animation**: a short cinematic intro (warp, the logo breaking out of its ring, the name) with its own sound, while the app loads. Skip with a click; turn it off in Look & settings.
- **Make it yours**: 7 colour themes or your own colours, text size, corners, compact layout. Gift popups: 5 styles, 6 ways to come in, seconds, how many at once, a minimum price, your own colours and words.
- **Overlay**: `http://gifthype.localtest.me:4747/overlay` as a Link source in TikTok LIVE Studio or a Browser source in OBS (localtest.me points back to this PC; LIVE Studio won't take "localhost").

## Setup on a new PC (Windows, once)

1. Download Unbound: **[gift-hype-main.zip](https://github.com/Outsourcedevv/gift-hype/archive/refs/heads/main.zip)**.
2. Right-click the zip, **Extract All**, and put the folder somewhere to keep (e.g. Documents).
3. Run `Setup.bat` in that folder. It installs Node.js if needed, downloads the parts the app uses, and puts an **Unbound** icon on your desktop.
4. Open **Unbound** from the desktop, type your TikTok name and press **Connect**.

## Updates

You only download it once. When there's a new version, Unbound shows a bar at the top when it opens: press **Update now** and it downloads the new version, installs it and restarts by itself. Your settings, gifts, sounds and Minecraft world are kept. You can also check any time in **Look & settings → Updates**.

See [HOW TO USE.txt](HOW%20TO%20USE.txt) for everything else.

TikTok connections use [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector), which is unofficial and not made by TikTok.

# Gift Hype

TikTok LIVE gifts play sounds, pop up on your stream, and make things happen in your games.

- **Games**: every game with a TikTok LIVE mod. It starts with **Minecraft**, which has four types (Block Delete Survival, Chunk Chat, Parkour Paradise and the Dropper):
  - **Parkour Paradise**: arrows, freezing, drunk, speed, jumps, back to the start.
  - **Block Delete Survival**: a nuke that falls from the sky and blows a crater, jail, cobweb / lava / air chunks, clear inventory, teleport to the End, god kit, diamond kit, mobs. Viewers can also type a block in the LIVE chat ("stone", "oak log", "logs"): after a countdown on the overlay and in the game, every block of that kind around you is deleted.
  - **Chunk Chat**: viewers type blocks in the LIVE chat, and every 30 seconds the whole chunk you're in turns into the block typed most (or the last one typed). Same gifts as Block Delete. Blocks you'd fall through and blocks the gifts do (lava, air, cobwebs) can't be picked.

  The games screen shows each game's cover (Minecraft's official one is loaded from the Microsoft Store; other games can use any picture). Click a cover, pick its type, and gifts do what that type says. Each type has its own gift list, and you can add more types or games. Minecraft commands go over RCON. Servers on your PC are found automatically, with no password to type.
- **Gifts**: pick from about 1,760 TikTok gifts with their pictures and prices. Each gift gets a sound, a stream popup and any number of actions. There's a Test button for every gift.
- **Sounds**: 30 real meme clips to start (fahh, vine boom, bruh, MLG airhorn, metal pipe, taco bell bong...). Gift Hype downloads them from [MyInstants](https://www.myinstants.com) the first time it opens, so they aren't stored in this repo. **Find any sound** searches MyInstants inside the app, and you can add your own .mp3 / .wav files.
- **Overlay**: `http://gifthype.localtest.me:4747/overlay` as a Link source in TikTok LIVE Studio or a Browser source in OBS (localtest.me points back to this PC; LIVE Studio won't take "localhost").

## Setup on a new PC (Windows, once)

1. Download Gift Hype: **[gift-hype-main.zip](https://github.com/Outsourcedevv/gift-hype/archive/refs/heads/main.zip)**.
2. Right-click the zip, **Extract All**, and put the folder somewhere to keep (e.g. Documents).
3. Run `Setup.bat` in that folder. It installs Node.js if needed, downloads the parts the app uses, and puts a **Gift Hype** icon on your desktop.
4. Open **Gift Hype** from the desktop, type your TikTok name and press **Connect**.

## Updates

You only download it once. When there's a new version, Gift Hype shows a bar at the top when it opens: press **Update now** and it downloads the new version, installs it and restarts by itself. Your settings, gifts, sounds and Minecraft world are kept. You can also check any time in **Settings → Updates**.

See [HOW TO USE.txt](HOW%20TO%20USE.txt) for everything else.

TikTok connections use [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector), which is unofficial and not made by TikTok.

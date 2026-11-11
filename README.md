# Gift Hype

TikTok LIVE gifts play sounds, pop up on your stream, and make things happen in your games.

- **Games**: add as many as you like, each with its own gift list. Gifts reach a game through:
  - **Minecraft**: commands over RCON. Servers on your PC are found automatically, with no password to type.
  - **Your own game**: it connects to `ws://127.0.0.1:8765` and gets a JSON message per gift.
  - **Key presses**: presses keys in whatever window is in front.
  - **Sounds only**.
- **Gifts**: pick from about 1,760 TikTok gifts with their pictures and prices. Each gift gets a sound, a stream popup and any number of actions. There's a Test button for every gift.
- **Sounds**: 20 starter sounds, all made for this app (synthesized effects and Windows text-to-speech voices). You can add your own .mp3 / .wav files.
- **Overlay**: `http://localhost:4747/overlay` as a Browser source in OBS or TikTok LIVE Studio.

## Setup (Windows)

1. Download or clone this folder.
2. Run `Setup.bat`. It installs Node.js if needed, downloads the parts the app uses, and puts a **Gift Hype** icon on your desktop.
3. Open **Gift Hype** from the desktop, type your TikTok name and press **Connect**.

See [HOW TO USE.txt](HOW%20TO%20USE.txt) for everything else.

TikTok connections use [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector), which is unofficial and not made by TikTok.

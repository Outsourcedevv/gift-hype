# Unbound HUD (Minecraft mod)

A small client mod: your Unbound stream overlay, and the Dropper's / Wipeout's info, in Minecraft. Unbound sets it up by itself when you press
**Play Minecraft** (Fabric, Fabric API and this mod, in `.minecraft/unbound`), so you never install it by hand.

In the game: press **Esc**, then **Unbound** (bottom left). Every piece (gift popups, the gift list, the
reset countdown, the level slot machine, Chunk Chat / Chat Teleport's timer and reveal, the block delete
list, your level, wipeouts / fails, punches and shield) can be **dragged** anywhere, resized by dragging
its **corner** (or scrolling), and **right-clicked** for a background or not (or use the buttons).
The red **x** on a piece hides it in the game (the green **+** shows it again); **Show / hide** lists every
piece to switch on or off (Show all / Hide all). **Reset all** puts them all back. Saved in `config/unbound-hud.json`.

The overlay pieces come from Unbound on this PC: the mod listens to it like the stream overlay does
(`/api/overlay-state`, then the `/api/events` stream), on the port in `config/unbound-link.json`.

It reads the info line the game sends at the bottom of the screen ("Level 5  Wipeouts 3  Punches ON")
and draws it its own way instead. Without the mod you still see that line as it is.

## Building

`unbound-hud.jar` here is the built mod (what Unbound installs). To build it again you need Java 25:

```
./gradlew build
cp build/libs/unbound-hud-1.0.0.jar unbound-hud.jar
```

`./gradlew runClient -Pjoin=localhost:25566` starts Minecraft with the mod and joins that server.

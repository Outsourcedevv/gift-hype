# Unbound HUD (Minecraft mod)

A small client mod for the Dropper and Wipeout. Unbound sets it up by itself when you press
**Play Minecraft** (Fabric, Fabric API and this mod, in `.minecraft/unbound`), so you never install it by hand.

In the game: press **Esc**, then **Unbound** (bottom left). Your level, wipeouts / fails, punches and shield
are pieces you can **drag** anywhere, **scroll** to resize, and **right-click** to give a background or not
(or use the buttons). **Hide** takes one off the screen; **Reset all** puts them back above the hotbar.
Saved in `config/unbound-hud.json`.

It reads the info line the game sends at the bottom of the screen ("Level 5  Wipeouts 3  Punches ON")
and draws it its own way instead. Without the mod you still see that line as it is.

## Building

`unbound-hud.jar` here is the built mod (what Unbound installs). To build it again you need Java 25:

```
./gradlew build
cp build/libs/unbound-hud-1.0.0.jar unbound-hud.jar
```

`./gradlew runClient -Pjoin=localhost:25566` starts Minecraft with the mod and joins that server.

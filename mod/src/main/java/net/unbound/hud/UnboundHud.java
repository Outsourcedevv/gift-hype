package net.unbound.hud;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;

/**
 * Unbound HUD: the Dropper's and Wipeout's info (level, wipeouts / fails, punches, shield) as pieces you
 * can put anywhere, any size, with or without a background. Esc > Unbound opens the editor.
 * It reads the info line the game sends (the bottom of the screen) and draws it its own way instead.
 */
public class UnboundHud implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		HudElementRegistry.addLast(Identifier.fromNamespaceAndPath("unbound_hud", "pieces"), (g, delta) -> {
			Minecraft mc = Minecraft.getInstance();
			if (!HudState.active() || mc.gui.hud.isHidden()) return;
			if (mc.gui.screen() instanceof HudEditorScreen) return;          // the editor draws them itself
			for (String id : HudConfig.IDS) if (HudConfig.get().element(id).shown) HudDraw.draw(g, id, false);
		});
		ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
			if (screen instanceof PauseScreen ps && ps.showsPauseMenu()) {
				Screens.getWidgets(screen).add(Button.builder(Component.literal("Unbound"), b -> client.setScreenAndShow(new HudEditorScreen(screen)))
					.bounds(8, h - 28, 80, 20).build());
			}
		});
	}
}

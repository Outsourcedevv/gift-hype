package net.unbound.hud;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Esc > Unbound > Show / hide: every piece in a list, click one to show or hide it. */
public class HudPiecesScreen extends Screen {
	private final Screen parent;
	private final Button[] toggles = new Button[HudEditorScreen.NAMES.length];

	public HudPiecesScreen(Screen parent) {
		super(Minecraft.getInstance(), Minecraft.getInstance().font, Component.literal("Show / hide"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		int n = HudEditorScreen.NAMES.length, cols = 2, perCol = (n + cols - 1) / cols, gap = 4;
		int w = Math.min(170, (this.width - 16 - gap) / cols), h = 20;
		int rowH = Math.max(21, Math.min(24, (this.height - 100) / perCol));
		int left = this.width / 2 - (cols * w + gap) / 2, top = 40;
		for (int i = 0; i < n; i++) {
			String id = HudEditorScreen.NAMES[i][0];
			int col = i / perCol, row = i % perCol;
			toggles[i] = addRenderableWidget(Button.builder(Component.empty(), b -> {
				HudConfig.Element e = HudConfig.get().element(id);
				e.shown = !e.shown;
				HudConfig.get().save();
			}).bounds(left + col * (w + gap), top + row * rowH, w, h).build());
		}
		int bw = Math.min(100, (this.width - 16 - 2 * gap) / 3), by = this.height - 28, bl = this.width / 2 - (3 * bw + 2 * gap) / 2;
		addRenderableWidget(Button.builder(Component.literal("Show all"), b -> setAll(true)).bounds(bl, by, bw, 20).build());
		addRenderableWidget(Button.builder(Component.literal("Hide all"), b -> setAll(false)).bounds(bl + bw + gap, by, bw, 20).build());
		addRenderableWidget(Button.builder(Component.literal("Back"), b -> onClose()).bounds(bl + 2 * (bw + gap), by, bw, 20).build());
	}

	private void setAll(boolean on) {
		for (String id : HudConfig.IDS) HudConfig.get().element(id).shown = on;
		HudConfig.get().save();
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		g.fill(0, 0, this.width, this.height, 0xA0000000);
		g.centeredText(this.font, Component.literal("Show / hide").withStyle(ChatFormatting.YELLOW, ChatFormatting.BOLD), this.width / 2, 14, 0xFFFFFFFF);
		g.centeredText(this.font, Component.literal("Click one to show it in the game or hide it").withStyle(ChatFormatting.GRAY), this.width / 2, 26, 0xFFFFFFFF);
		for (int i = 0; i < toggles.length; i++) {
			boolean on = HudConfig.get().element(HudEditorScreen.NAMES[i][0]).shown;
			toggles[i].setMessage(Component.literal(HudEditorScreen.NAMES[i][1] + ": ")
				.append(Component.literal(on ? "SHOWN" : "HIDDEN").withStyle(on ? ChatFormatting.GREEN : ChatFormatting.RED)));
		}
		super.extractRenderState(g, mouseX, mouseY, delta);
	}

	@Override
	public void onClose() {
		HudConfig.get().save();
		this.minecraft.setScreenAndShow(parent);
	}
}

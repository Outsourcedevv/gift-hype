package net.unbound.hud;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/** Draws the pieces (in the game, and in the editor with example values). */
public final class HudDraw {
	public static final int PAD = 4;

	private HudDraw() { }

	/** The text of a piece, or null when there's nothing to show (e.g. no shield). */
	public static Component text(String id, boolean example) {
		switch (id) {
			case "level": {
				String v = HudState.level != null ? HudState.level : example ? "1" : null;
				if (v == null) return null;
				return label("Level ").append(Component.literal(v).withStyle(ChatFormatting.WHITE, ChatFormatting.BOLD));
			}
			case "count":
				return label(HudState.countLabel + " ").append(Component.literal(String.valueOf(HudState.count)).withStyle(ChatFormatting.WHITE, ChatFormatting.BOLD));
			case "punches":
				return label("Punches ").append(Component.literal(HudState.punchesOn ? "ON" : "OFF")
					.withStyle(HudState.punchesOn ? ChatFormatting.RED : ChatFormatting.GREEN, ChatFormatting.BOLD));
			case "shield": {
				int s = HudState.shield > 0 ? HudState.shield : example ? 1 : 0;
				if (s <= 0) return null;
				return Component.literal("Shield x" + s).withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD);
			}
			default: return null;
		}
	}

	private static MutableComponent label(String s) {
		return Component.literal(s).withStyle(ChatFormatting.AQUA);
	}

	/** Width and height of a piece on screen (scaled, with its padding). */
	public static int[] size(Font font, Component text, double scale) {
		int w = font.width(text) + PAD * 2, h = font.lineHeight + PAD * 2 - 1;
		return new int[] { (int) Math.round(w * scale), (int) Math.round(h * scale) };
	}

	/** Where a piece goes (its top-left, in screen pixels): its saved place, or a row above the hotbar. */
	public static int[] place(String id, Font font, int sw, int sh, boolean example) {
		HudConfig.Element e = HudConfig.get().element(id);
		Component t = text(id, true);
		int[] sz = size(font, t == null ? Component.literal("?") : t, e.scale);
		if (e.x >= 0 && e.y >= 0) {
			int x = (int) Math.round(e.x * sw), y = (int) Math.round(e.y * sh);
			return new int[] { clamp(x, 0, Math.max(0, sw - sz[0])), clamp(y, 0, Math.max(0, sh - sz[1])) };
		}
		// starting places: level, wipeouts, punches in a row just above the hotbar, shield above them
		int gap = 6, total = 0;
		String[] row = { "level", "count", "punches" };
		int[] widths = new int[row.length];
		for (int i = 0; i < row.length; i++) {
			Component rt = text(row[i], true);
			widths[i] = size(font, rt, HudConfig.get().element(row[i]).scale)[0];
			total += widths[i] + (i > 0 ? gap : 0);
		}
		int x = sw / 2 - total / 2, y = sh - 72;
		for (int i = 0; i < row.length; i++) {
			if (row[i].equals(id)) return new int[] { x, y };
			x += widths[i] + gap;
		}
		return new int[] { sw / 2 - sz[0] / 2, y - sz[1] - 4 };      // the shield
	}

	private static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }

	/** Draws one piece; returns its box {x, y, w, h}, or null if there's nothing to draw. */
	public static int[] draw(GuiGraphicsExtractor g, String id, boolean example) {
		Minecraft mc = Minecraft.getInstance();
		HudConfig.Element e = HudConfig.get().element(id);
		Component t = text(id, example);
		if (t == null) return null;
		Font font = mc.font;
		int[] p = place(id, font, g.guiWidth(), g.guiHeight(), example), sz = size(font, t, e.scale);
		g.pose().pushMatrix();
		g.pose().translate(p[0], p[1]);
		g.pose().scale((float) e.scale, (float) e.scale);
		int w = font.width(t) + PAD * 2, h = font.lineHeight + PAD * 2 - 1;
		if (e.background) {
			g.fill(0, 0, w, h, 0xA0101018);
			g.fill(0, 0, w, 1, 0x60FFFFFF);
		}
		g.text(font, t, PAD, PAD, 0xFFFFFFFF, true);
		g.pose().popMatrix();
		return new int[] { p[0], p[1], sz[0], sz[1] };
	}
}

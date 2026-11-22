package net.unbound.hud;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

import java.util.ArrayList;
import java.util.List;

/**
 * Draws the pieces (in the game, and in the editor with example values): the game's info (level,
 * wipeouts / fails, punches, shield) and everything on Unbound's stream overlay (gift popups, the gift
 * list, the reset countdown, the level slot machine, Chunk Chat / Chat Teleport's timer and reveal, the
 * block delete list).
 */
public final class HudDraw {
	public static final int PAD = 4;
	private static final int LH = 10;

	private HudDraw() { }

	// ---------- one piece: how big it is, and drawing it at 0,0 (before its size is applied) ----------
	private interface Piece { int[] size(Font f, boolean ex); void render(GuiGraphicsExtractor g, Font f, boolean ex, boolean bg); }

	/** A single line of text (level, wipeouts, punches, shield). */
	private record Line(Component text) implements Piece {
		public int[] size(Font f, boolean ex) { return new int[] { f.width(text) + PAD * 2, f.lineHeight + PAD * 2 - 1 }; }
		public void render(GuiGraphicsExtractor g, Font f, boolean ex, boolean bg) {
			int[] s = size(f, ex);
			if (bg) { g.fill(0, 0, s[0], s[1], 0xA0101018); g.fill(0, 0, s[0], 1, 0x60FFFFFF); }
			g.text(f, text, PAD, PAD, 0xFFFFFFFF, true);
		}
	}

	/** Lines of text (each with its own size) in a panel, laid out top to bottom. */
	private static final class Block implements Piece {
		record Row(Component text, float scale, int bar, int barColor, int gapAfter) { }   // bar: 0-1000 (-1 none)
		final List<Row> rows = new ArrayList<>();
		final int accent;
		final int minW;
		Block(int accent, int minW) { this.accent = accent; this.minW = minW; }
		Block text(Component c) { rows.add(new Row(c, 1f, -1, 0, 1)); return this; }
		Block big(Component c, float s) { rows.add(new Row(c, s, -1, 0, 2)); return this; }
		Block bar(int perMille, int color) { rows.add(new Row(null, 1f, Math.max(0, Math.min(1000, perMille)), color, 2)); return this; }
		Block gap(int px) { rows.add(new Row(null, 1f, -2, px, 0)); return this; }
		public int[] size(Font f, boolean ex) {
			int w = minW, h = PAD * 2;
			for (Row r : rows) {
				if (r.bar == -2) { h += r.barColor; continue; }
				if (r.text == null) { h += 3 + r.gapAfter; continue; }
				w = Math.max(w, Math.round(f.width(r.text) * r.scale) + PAD * 2);
				h += Math.round(f.lineHeight * r.scale) + r.gapAfter;
			}
			return new int[] { w, h };
		}
		public void render(GuiGraphicsExtractor g, Font f, boolean ex, boolean bg) {
			int[] s = size(f, ex);
			if (bg) { g.fill(0, 0, s[0], s[1], 0xC0101018); g.fill(0, 0, s[0], 2, accent); }
			int y = PAD;
			for (Row r : rows) {
				if (r.bar == -2) { y += r.barColor; continue; }
				if (r.text == null) {
					g.fill(PAD, y, s[0] - PAD, y + 3, 0x40FFFFFF);
					g.fill(PAD, y, PAD + (s[0] - PAD * 2) * r.bar / 1000, y + 3, r.barColor);
					y += 3 + r.gapAfter; continue;
				}
				g.pose().pushMatrix();
				g.pose().translate(PAD, y);
				g.pose().scale(r.scale, r.scale);
				g.text(f, r.text, 0, 0, 0xFFFFFFFF, true);
				g.pose().popMatrix();
				y += Math.round(f.lineHeight * r.scale) + r.gapAfter;
			}
		}
	}

	/** Several panels stacked (gift popups, block delete countdowns). */
	private record Stack(List<Block> blocks) implements Piece {
		public int[] size(Font f, boolean ex) {
			int w = 0, h = 0;
			for (Block b : blocks) { int[] s = b.size(f, ex); w = Math.max(w, s[0]); h += s[1] + 3; }
			return new int[] { w, Math.max(0, h - 3) };
		}
		public void render(GuiGraphicsExtractor g, Font f, boolean ex, boolean bg) {
			int y = 0;
			for (Block b : blocks) {
				g.pose().pushMatrix(); g.pose().translate(0, y); b.render(g, f, ex, bg); g.pose().popMatrix();
				y += b.size(f, ex)[1] + 3;
			}
		}
	}

	private static MutableComponent t(String s, ChatFormatting... st) { return Component.literal(s == null ? "" : s).withStyle(st); }
	private static ChatFormatting colour(String c) {
		if (c == null) return ChatFormatting.AQUA;
		return switch (c) { case "green" -> ChatFormatting.GREEN; case "red" -> ChatFormatting.RED; case "yellow" -> ChatFormatting.YELLOW; case "aqua" -> ChatFormatting.AQUA; case "white" -> ChatFormatting.WHITE; default -> ChatFormatting.AQUA; };
	}
	private static String fit(Font f, String s, int max) {
		if (s == null) return "";
		if (f.width(s) <= max) return s;
		while (s.length() > 1 && f.width(s + "…") > max) s = s.substring(0, s.length() - 1);
		return s + "…";
	}
	private static String secs(int n) { return n >= 60 ? (n / 60) + ":" + String.format("%02d", n % 60) : n + "s"; }

	/** The piece with that id as it is now (or with example values), or null when there's nothing to show. */
	private static Piece piece(String id, boolean ex, Font f) {
		long now = System.currentTimeMillis();
		switch (id) {
			// ---- the game's info line (the Dropper and Wipeout) ----
			case "level": {
				String v = HudState.level != null ? HudState.level : ex ? "1" : null;
				if (v == null || (!ex && !HudState.active())) return null;
				return new Line(t("Level ", ChatFormatting.AQUA).append(t(v, ChatFormatting.WHITE, ChatFormatting.BOLD)));
			}
			case "count":
				if (!ex && !HudState.active()) return null;
				return new Line(t(HudState.countLabel + " ", ChatFormatting.AQUA).append(t(String.valueOf(HudState.count), ChatFormatting.WHITE, ChatFormatting.BOLD)));
			case "punches":
				if (!ex && !HudState.active()) return null;
				return new Line(t("Punches ", ChatFormatting.AQUA).append(t(HudState.punchesOn ? "ON" : "OFF", HudState.punchesOn ? ChatFormatting.RED : ChatFormatting.GREEN, ChatFormatting.BOLD)));
			case "shield": {
				int s = HudState.shield > 0 && (ex || HudState.active()) ? HudState.shield : ex ? 1 : 0;
				return s <= 0 ? null : new Line(t("Shield x" + s, ChatFormatting.AQUA, ChatFormatting.BOLD));
			}
			// ---- the stream overlay ----
			case "popups": {
				List<OverlayState.Popup> list;
				synchronized (OverlayState.popups) { OverlayState.popups.removeIf(p -> p.until() < now); list = new ArrayList<>(OverlayState.popups); }
				if (list.isEmpty() && ex) list = List.of(new OverlayState.Popup("a viewer", "Rose", 3, "Spawns a zombie", null, 0), new OverlayState.Popup("someone", "Galaxy", 1, "⬆ LEVEL UP +5", "green", 0));
				if (list.isEmpty()) return null;
				List<Block> blocks = new ArrayList<>();
				for (OverlayState.Popup p : list) {
					MutableComponent who = t(p.from(), ChatFormatting.GOLD, ChatFormatting.BOLD);
					if (p.gift() == null) who.append(t(" followed!", ChatFormatting.WHITE));
					else who.append(t(" sent ", ChatFormatting.WHITE)).append(t((p.count() > 1 ? p.count() + "× " : "") + p.gift(), ChatFormatting.WHITE, ChatFormatting.BOLD));
					Block b = new Block(0xFFFE2C55, 110).text(who);
					if (!p.what().isEmpty()) b.text(t(fit(f, p.what(), 220), colour(p.color())));
					blocks.add(b);
				}
				return new Stack(blocks);
			}
			case "giftlist": {
				List<OverlayState.MenuItem> m = OverlayState.menu;
				if (m.isEmpty() && ex) m = List.of(new OverlayState.MenuItem("Rose", 1, "Spawns a zombie"), new OverlayState.MenuItem("Finger Heart", 5, "Diamond kit"), new OverlayState.MenuItem("Doughnut", 30, "Lightning"));
				if (m.isEmpty()) return null;
				int per = 8, pages = (m.size() + per - 1) / per, page = (int) ((now / 6000) % pages);
				Block b = new Block(0xFFFFD84A, 120).big(t("SEND A GIFT", ChatFormatting.YELLOW, ChatFormatting.BOLD), 1f);
				for (OverlayState.MenuItem it : m.subList(page * per, Math.min(m.size(), page * per + per))) {
					MutableComponent row = t(fit(f, it.name(), 80), ChatFormatting.WHITE, ChatFormatting.BOLD);
					if (it.coins() != null) row.append(t("  " + String.format("%,d", it.coins()), ChatFormatting.GOLD));
					if (it.does() != null && !it.does().isEmpty()) row.append(t("  " + fit(f, it.does(), 100), ChatFormatting.AQUA));
					b.text(row);
				}
				if (pages > 1) b.text(t((page + 1) + " / " + pages, ChatFormatting.GRAY));
				return b;
			}
			case "reset": {
				if (now < OverlayState.resultUntil && OverlayState.resultText != null) {
					Block b = new Block(OverlayState.resultBad ? 0xFFFE2C55 : 0xFF25F4EE, 110).big(t(OverlayState.resultText, OverlayState.resultBad ? ChatFormatting.RED : ChatFormatting.AQUA, ChatFormatting.BOLD), 2f);
					if (OverlayState.resultWho != null) b.text(t(OverlayState.resultWho, ChatFormatting.WHITE));
					return b;
				}
				boolean on = OverlayState.resetOn || ex;
				if (!on) return null;
				int left = OverlayState.resetOn ? OverlayState.resetLeft : 42, total = OverlayState.resetOn ? OverlayState.resetTotal : 60;
				String save = OverlayState.resetOn ? OverlayState.resetSave : "Glowing Jellyfish";
				Block b = new Block(0xFFFE2C55, 130).big(t("RESET IN ", ChatFormatting.RED, ChatFormatting.BOLD).append(t(secs(left), left <= 10 ? ChatFormatting.RED : ChatFormatting.WHITE, ChatFormatting.BOLD)), 1.5f)
					.bar(total > 0 ? 1000 * left / total : 0, 0xFFFE2C55);
				if (save != null) b.text(t("Send ", ChatFormatting.WHITE).append(t(save, ChatFormatting.AQUA, ChatFormatting.BOLD)).append(t(" to SAVE!", ChatFormatting.WHITE)));
				return b;
			}
			case "wheel": {
				int[] am = OverlayState.wheelAmounts;
				long t0 = OverlayState.wheelStart, spin = OverlayState.wheelSpin;
				boolean live = am != null && now < t0 + spin + 3200;
				if (!live && !ex) return null;
				int shown; boolean done;
				if (live) {
					double p = Math.min(1, (now - t0) / (double) spin), eased = 1 - Math.pow(1 - p, 4);
					done = p >= 1;
					shown = done ? OverlayState.wheelResult : am[(int) (eased * 34) % am.length];
				} else { shown = 5; done = true; }
				String num = (shown > 0 ? "+" : "") + shown;
				Block b = new Block(0xFFFFD84A, 110).text(t("LEVEL SLOTS", ChatFormatting.YELLOW, ChatFormatting.BOLD).append(t("  " + (live ? OverlayState.wheelFrom : "a viewer"), ChatFormatting.GRAY)))
					.big(t(done ? num + " LEVEL" + (Math.abs(shown) == 1 ? "" : "S") + "!" : num, shown > 0 ? ChatFormatting.GREEN : ChatFormatting.RED, ChatFormatting.BOLD), 2f);
				return b;
			}
			case "timer": {
				if (now < OverlayState.timerDoneUntil && OverlayState.timerDone != null) {
					Block b = new Block(0xFF55FF55, 120);
					if (OverlayState.timerDoneTag != null) b.text(t(OverlayState.timerDoneTag, ChatFormatting.GOLD, ChatFormatting.BOLD));
					b.big(t(OverlayState.timerDone, ChatFormatting.GREEN, ChatFormatting.BOLD), 1.5f);
					if (OverlayState.timerDoneBy != null) b.text(t(OverlayState.timerDoneBy, ChatFormatting.GRAY));
					return b;
				}
				boolean on = OverlayState.timerOn || ex;
				if (!on) return null;
				boolean live = OverlayState.timerOn;
				int left = live ? OverlayState.timerLeft : 21, total = live ? OverlayState.timerTotal : 30;
				String leader = live ? OverlayState.timerLeader : "Diamond Ore", by = live ? OverlayState.timerBy : "3 votes";
				Block b = new Block(0xFF55FF55, 130).text(t((live ? OverlayState.timerTag : "NEXT CHUNK") + "   ", ChatFormatting.GOLD, ChatFormatting.BOLD).append(t(secs(left), left <= 5 ? ChatFormatting.RED : ChatFormatting.WHITE, ChatFormatting.BOLD)))
					.big(leader != null ? t(leader, ChatFormatting.GREEN, ChatFormatting.BOLD) : t("Type a block in chat!", ChatFormatting.GRAY), leader != null ? 1.5f : 1f);
				if (by != null) b.text(t(by, ChatFormatting.GRAY));
				b.bar(total > 0 ? 1000 * Math.max(0, left - 1) / total : 0, 0xFF55FF55);
				List<String[]> top = live ? OverlayState.timerTop : List.of(new String[] { "Stone", "2" }, new String[] { "Lava", "1" });
				for (String[] r : top) b.text(t(r[0] + "  ", ChatFormatting.WHITE).append(t(r[1], ChatFormatting.GRAY)));
				return b;
			}
			case "chatdel": {
				List<OverlayState.ChatDel> items = OverlayState.chatDel;
				if (items.isEmpty() && ex) items = List.of(new OverlayState.ChatDel("Diamond Ore", "a viewer", 12, 30));
				List<Block> blocks = new ArrayList<>();
				if (now < OverlayState.chatDelDoneUntil && OverlayState.chatDelDone != null)
					blocks.add(new Block(0xFF55FF55, 110).text(t(OverlayState.chatDelDone, ChatFormatting.GREEN, ChatFormatting.BOLD)).text(t(OverlayState.chatDelDoneSub, ChatFormatting.GRAY)));
				for (OverlayState.ChatDel d : items)
					blocks.add(new Block(0xFFFE2C55, 120).text(t(d.label() + "   ", ChatFormatting.RED, ChatFormatting.BOLD).append(t(d.left() + "s", d.left() <= 5 ? ChatFormatting.RED : ChatFormatting.WHITE, ChatFormatting.BOLD)))
						.text(t("picked by " + d.by(), ChatFormatting.GRAY)).bar(d.total() > 0 ? 1000 * Math.max(0, d.left() - 1) / d.total() : 0, 0xFFFE2C55));
				return blocks.isEmpty() ? null : new Stack(blocks);
			}
			case "reveal": {
				boolean live = now < OverlayState.revealUntil && OverlayState.revealLabel != null;
				if (!live && !ex) return null;
				Block b = new Block(0xFFFFD84A, 120).text(t("THE CHUNK IS NOW", ChatFormatting.GOLD, ChatFormatting.BOLD))
					.big(t(live ? OverlayState.revealLabel : "GRASS BLOCK", ChatFormatting.GREEN, ChatFormatting.BOLD), 2f);
				String sub = live ? OverlayState.revealSub : "picked by a viewer  •  23,104 blocks";
				if (sub != null && !sub.isEmpty()) b.text(t(sub, ChatFormatting.GRAY));
				return b;
			}
			default: return null;
		}
	}

	/** True if that piece has something to show (or always, with example values). */
	public static boolean present(String id, boolean ex) { return piece(id, ex, Minecraft.getInstance().font) != null; }

	/** Its size on screen (scaled), or null. */
	public static int[] size(String id, boolean ex) {
		Font f = Minecraft.getInstance().font;
		Piece p = piece(id, ex, f);
		if (p == null) return null;
		int[] s = p.size(f, ex);
		double sc = HudConfig.get().element(id).scale;
		return new int[] { (int) Math.round(s[0] * sc), (int) Math.round(s[1] * sc) };
	}

	// where each overlay piece starts (share of the screen; x is its middle when centred)
	private static double[] startOf(String id) {
		return switch (id) {
			// left: the reset countdown and the gift list; right: the timer, gift popups, block delete list;
			// the middle: the slot machine and the chunk reveal
			case "reset" -> new double[] { 0.01, 0.02, 0 };
			case "giftlist" -> new double[] { 0.01, 0.24, 0 };
			case "timer" -> new double[] { 0.99, 0.02, 2 };
			case "popups" -> new double[] { 0.99, 0.30, 2 };
			case "chatdel" -> new double[] { 0.99, 0.62, 2 };
			case "wheel" -> new double[] { 0.5, 0.06, 1 };
			case "reveal" -> new double[] { 0.5, 0.36, 1 };
			default -> null;
		};
	}

	/** Where a piece goes (its top-left, in screen pixels): its saved place, or where it starts. */
	public static int[] place(String id, int sw, int sh, boolean ex) {
		HudConfig.Element e = HudConfig.get().element(id);
		int[] sz = size(id, true);
		if (sz == null) sz = new int[] { 20, 10 };
		if (e.x >= 0 && e.y >= 0) {
			int x = (int) Math.round(e.x * sw), y = (int) Math.round(e.y * sh);
			return new int[] { clamp(x, 0, Math.max(0, sw - sz[0])), clamp(y, 0, Math.max(0, sh - sz[1])) };
		}
		double[] st = startOf(id);
		if (st != null) {
			int x = (int) Math.round(st[0] * sw) - (st[2] == 1 ? sz[0] / 2 : st[2] == 2 ? sz[0] : 0);
			return new int[] { clamp(x, 0, Math.max(0, sw - sz[0])), (int) Math.round(st[1] * sh) };
		}
		// the game's info: level, wipeouts, punches in a row just above the hotbar, shield above them
		int gap = 6, total = 0;
		String[] row = { "level", "count", "punches" };
		int[] widths = new int[row.length];
		for (int i = 0; i < row.length; i++) { int[] s = size(row[i], true); widths[i] = s == null ? 0 : s[0]; total += widths[i] + (i > 0 ? gap : 0); }
		int x = sw / 2 - total / 2, y = sh - 72;
		for (int i = 0; i < row.length; i++) { if (row[i].equals(id)) return new int[] { x, y }; x += widths[i] + gap; }
		return new int[] { sw / 2 - sz[0] / 2, y - sz[1] - 4 };
	}

	private static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }

	/** Draws one piece; returns its box {x, y, w, h}, or null if there's nothing to draw. */
	public static int[] draw(GuiGraphicsExtractor g, String id, boolean ex) {
		Font f = Minecraft.getInstance().font;
		Piece p = piece(id, ex, f);
		if (p == null) return null;
		HudConfig.Element e = HudConfig.get().element(id);
		int[] pl = place(id, g.guiWidth(), g.guiHeight(), ex), s = p.size(f, ex);
		g.pose().pushMatrix();
		g.pose().translate(pl[0], pl[1]);
		g.pose().scale((float) e.scale, (float) e.scale);
		p.render(g, f, ex, e.background);
		g.pose().popMatrix();
		return new int[] { pl[0], pl[1], (int) Math.round(s[0] * e.scale), (int) Math.round(s[1] * e.scale) };
	}
}

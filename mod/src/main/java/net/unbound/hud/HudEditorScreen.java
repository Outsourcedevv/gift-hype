package net.unbound.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/**
 * Esc > Unbound: every piece (the game's info and everything on the stream overlay) with example values.
 * Drag a piece to move it; drag its corner handle right / down to make it bigger, left / up to make it
 * smaller (or scroll); right-click for a background or not. The x on a piece takes it off the
 * screen; Show / hide lists every piece to switch on or off.
 */
public class HudEditorScreen extends Screen {
	static final String[][] NAMES = {
		{ "level", "Level" }, { "count", "Wipeouts / fails" }, { "punches", "Punches" }, { "shield", "Shield" },
		{ "popups", "Gift popups" }, { "giftlist", "Gift list" }, { "reset", "Reset countdown" }, { "wheel", "Level slot machine" },
		{ "timer", "Chunk Chat timer" }, { "chatdel", "Block delete list" }, { "reveal", "Chunk reveal" },
	};
	private static final int HANDLE = 7;
	private final Screen parent;
	private String selected = "level", dragging = null, sizing = null;
	private double grabX, grabY, startScale;
	private int startW, startH;
	private Button bgButton;
	private int rows = 1;

	public HudEditorScreen(Screen parent) {
		super(Minecraft.getInstance(), Minecraft.getInstance().font, Component.literal("Unbound HUD"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		// six buttons along the bottom: one row if they fit, otherwise two rows of three
		int gap = 4, n = 6, w = Math.min(92, (this.width - 16 - (n - 1) * gap) / n);
		rows = w < 64 ? 2 : 1;
		int perRow = rows == 2 ? 3 : 6;
		if (rows == 2) w = Math.min(110, (this.width - 16 - (perRow - 1) * gap) / perRow);
		String[] labels = { "", "Smaller", "Bigger", "Show / hide", "Reset all", "Done" };
		Button.OnPress[] acts = {
			b -> { cfg().background = !cfg().background; save(); },
			b -> resize(-0.1),
			b -> resize(0.1),
			b -> { save(); this.minecraft.setScreenAndShow(new HudPiecesScreen(this)); },
			b -> HudConfig.get().resetAll(),
			b -> onClose(),
		};
		Button[] made = new Button[n];
		int left = this.width / 2 - (perRow * w + (perRow - 1) * gap) / 2;
		for (int i = 0; i < n; i++) {
			int col = i % perRow, row = i / perRow;
			made[i] = addRenderableWidget(Button.builder(Component.literal(labels[i]), acts[i]).bounds(left + col * (w + gap), this.height - 28 - (rows - 1 - row) * 24, w, 20).build());
		}
		bgButton = made[0];
	}

	private HudConfig.Element cfg() { return HudConfig.get().element(selected); }
	private void save() { HudConfig.get().save(); }

	private void resize(double by) {
		HudConfig.Element e = cfg();
		e.scale = Math.max(0.3, Math.min(5.0, Math.round((e.scale + by) * 10) / 10.0));
		save();
	}

	private static String nameOf(String id) {
		for (String[] n : NAMES) if (n[0].equals(id)) return n[1];
		return id;
	}

	private int[] box(String id) {
		int[] s = HudDraw.size(id, true);
		if (s == null) return null;
		int[] p = HudDraw.place(id, this.width, this.height, true);
		return new int[] { p[0], p[1], s[0], s[1] };
	}

	/** The piece whose x (top right corner: hide / show it) is under the mouse, or null. */
	private String atX(double mx, double my) {
		String hit = null;
		for (String id : HudConfig.IDS) {
			int[] b = box(id);
			if (b == null) continue;
			if (mx >= b[0] + b[2] - HANDLE + 1 && mx <= b[0] + b[2] + 2 && my >= b[1] - 2 && my <= b[1] + HANDLE - 1) hit = id;
		}
		return hit;
	}

	/** The piece under the mouse (the last drawn wins), or null; handle: on its corner handle. */
	private String at(double mx, double my, boolean handle) {
		String hit = null;
		for (String id : HudConfig.IDS) {
			int[] b = box(id);
			if (b == null) continue;
			boolean onHandle = mx >= b[0] + b[2] - HANDLE + 1 && mx <= b[0] + b[2] + 2 && my >= b[1] + b[3] - HANDLE + 1 && my <= b[1] + b[3] + 2;
			boolean in = mx >= b[0] && mx < b[0] + b[2] && my >= b[1] && my < b[1] + b[3];
			if (handle ? onHandle : in || onHandle) hit = id;
		}
		return hit;
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		g.fill(0, 0, this.width, this.height, 0x60000000);
		bgButton.setMessage(Component.literal((bgButton.getWidth() < 90 ? "Bg: " : "Background: ") + (cfg().background ? "ON" : "OFF")));
		String hoverHandle = at(mouseX, mouseY, true), hoverX = atX(mouseX, mouseY);
		for (String id : HudConfig.IDS) {
			boolean hidden = !HudConfig.get().element(id).shown;
			// a hidden piece: just its box (so you can still find it, move it and show it again)
			int[] b = hidden ? box(id) : HudDraw.draw(g, id, true);
			if (b == null) continue;
			boolean sel = id.equals(selected);
			int c = sel ? 0xFFFFD84A : hidden ? 0x80FF5555 : 0x80FFFFFF;
			g.fill(b[0] - 1, b[1] - 1, b[0] + b[2] + 1, b[1], c);
			g.fill(b[0] - 1, b[1] + b[3], b[0] + b[2] + 1, b[1] + b[3] + 1, c);
			g.fill(b[0] - 1, b[1], b[0], b[1] + b[3], c);
			g.fill(b[0] + b[2], b[1], b[0] + b[2] + 1, b[1] + b[3], c);
			// the corner handle: drag it to change the size
			int hc = id.equals(hoverHandle) || id.equals(sizing) ? 0xFFFFD84A : sel ? 0xFFFFFFFF : 0xB0FFFFFF;
			g.fill(b[0] + b[2] - HANDLE + 1, b[1] + b[3] - HANDLE + 1, b[0] + b[2] + 2, b[1] + b[3] + 2, 0xFF000000);
			g.fill(b[0] + b[2] - HANDLE + 2, b[1] + b[3] - HANDLE + 2, b[0] + b[2] + 1, b[1] + b[3] + 1, hc);
			// the x: click it to hide the piece (a + on a hidden one shows it again)
			int xl = b[0] + b[2] - HANDLE + 1, xt = b[1] - 2;
			boolean xh = id.equals(hoverX);
			g.fill(xl, xt, xl + HANDLE + 1, xt + HANDLE + 1, 0xFF000000);
			g.fill(xl + 1, xt + 1, xl + HANDLE, xt + HANDLE, hidden ? (xh ? 0xFF55FF55 : 0xFF2E8B2E) : (xh ? 0xFFFF5555 : 0xFFA02828));
			if (hidden) {
				g.fill(xl + 2, xt + 3, xl + HANDLE - 1, xt + 4, 0xFFFFFFFF);
				g.fill(xl + 3, xt + 2, xl + 4, xt + HANDLE - 1, 0xFFFFFFFF);
			} else for (int k = 0; k < HANDLE - 3; k++) {
				g.fill(xl + 2 + k, xt + 2 + k, xl + 3 + k, xt + 3 + k, 0xFFFFFFFF);
				g.fill(xl + HANDLE - 2 - k, xt + 2 + k, xl + HANDLE - 1 - k, xt + 3 + k, 0xFFFFFFFF);
			}
			if (hidden) {
				// dimmed, with HIDDEN on it: it won't show in the game
				g.fill(b[0], b[1], b[0] + b[2], b[1] + b[3], 0xC0101010);
				String hd = this.font.width("HIDDEN") + 4 <= b[2] ? "HIDDEN" : "X";
				g.text(this.font, hd, b[0] + b[2] / 2 - this.font.width(hd) / 2, b[1] + b[3] / 2 - 4, 0xFFFF5555, true);
			}
			if (xh) g.text(this.font, hidden ? "click: show" : "click: hide", xl + HANDLE + 3, xt, 0xFFFFFFFF, true);
			if (sel || id.equals(at(mouseX, mouseY, false))) g.text(this.font, nameOf(id), b[0], b[1] - 10, sel ? 0xFFFFD84A : 0xFFDDDDDD, true);
		}

		// what's picked, and how to use it (one line just above the buttons)
		// (shorter help when the screen is narrow)
		String[] helps = { "   drag to move \u2022 drag the corner to resize \u2022 x: hide \u2022 right-click: background", "   drag to move \u2022 drag the corner to resize \u2022 x: hide", "   drag: move \u2022 corner: size \u2022 x: hide", "   corner: size", "" };
		Component line = null;
		for (String h : helps) {
			line = Component.literal(nameOf(selected) + " " + Math.round(cfg().scale * 100) + "%").withStyle(net.minecraft.ChatFormatting.YELLOW)
				.append(Component.literal(h).withStyle(net.minecraft.ChatFormatting.GRAY));
			if (this.font.width(line) + 16 <= this.width) break;
		}
		int lw = this.font.width(line) + 10, ly = this.height - 42 - (rows - 1) * 24;
		g.fill(this.width / 2 - lw / 2, ly - 3, this.width / 2 + lw / 2, ly + 10, 0xC0000000);
		g.centeredText(this.font, line, this.width / 2, ly, 0xFFFFFFFF);
		if (!OverlayState.linked) g.centeredText(this.font, Component.literal("Unbound isn't connected: open the Unbound app to see your gifts here"), this.width / 2, 32, 0xFFFF9955);
		super.extractRenderState(g, mouseX, mouseY, delta);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		if (super.mouseClicked(e, doubleClick)) return true;
		String xId = e.button() == 0 ? atX(e.x(), e.y()) : null;
		if (xId != null) {
			selected = xId;
			cfg().shown = !cfg().shown;
			save();
			return true;
		}
		String handle = e.button() == 0 ? at(e.x(), e.y(), true) : null;
		if (handle != null) {
			selected = sizing = handle;
			int[] b = box(handle);
			startW = Math.max(1, b[2]); startH = Math.max(1, b[3]); startScale = cfg().scale;
			grabX = e.x(); grabY = e.y();
			return true;
		}
		String id = at(e.x(), e.y(), false);
		if (id == null) return false;
		selected = id;
		if (e.button() == 1) { cfg().background = !cfg().background; save(); return true; }
		int[] p = HudDraw.place(id, this.width, this.height, true);
		dragging = id;
		grabX = e.x() - p[0];
		grabY = e.y() - p[1];
		return true;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		if (sizing != null) {
			// right / down: bigger; left / up: smaller (both ways count)
			double fx = (startW + (e.x() - grabX)) / startW, fy = (startH + (e.y() - grabY)) / startH;
			HudConfig.Element el = HudConfig.get().element(sizing);
			el.scale = Math.max(0.3, Math.min(5.0, Math.round(startScale * (fx + fy) / 2 * 20) / 20.0));
			return true;
		}
		if (dragging == null) return super.mouseDragged(e, dx, dy);
		HudConfig.Element el = HudConfig.get().element(dragging);
		el.x = Math.max(0, Math.min(1, (e.x() - grabX) / this.width));
		el.y = Math.max(0, Math.min(1, (e.y() - grabY) / this.height));
		return true;
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent e) {
		if (dragging != null || sizing != null) { dragging = null; sizing = null; save(); return true; }
		return super.mouseReleased(e);
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double h, double v) {
		String id = at(mx, my, false);
		if (id != null) selected = id;
		resize(v > 0 ? 0.1 : v < 0 ? -0.1 : 0);
		return true;
	}

	@Override
	public void onClose() {
		save();
		this.minecraft.setScreenAndShow(parent);
	}
}

package net.unbound.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** Esc > Unbound: drag the pieces where you want them, scroll to resize, right-click for a background. */
public class HudEditorScreen extends Screen {
	private static final String[] NAMES = { "Level", "Wipeouts", "Punches", "Shield" };
	private final Screen parent;
	private String selected = "level", dragging = null;
	private double grabX, grabY;
	private Button bgButton, showButton;

	public HudEditorScreen(Screen parent) {
		super(Minecraft.getInstance(), Minecraft.getInstance().font, Component.literal("Unbound HUD"));
		this.parent = parent;
	}

	private int rows = 1;

	@Override
	protected void init() {
		// six buttons along the bottom: one row if they fit, otherwise two rows of three
		int gap = 4, n = 6, w = Math.min(92, (this.width - 16 - (n - 1) * gap) / n);
		rows = w < 64 ? 2 : 1;
		int perRow = rows == 2 ? 3 : 6;
		if (rows == 2) w = Math.min(110, (this.width - 16 - (perRow - 1) * gap) / perRow);
		Button[] made = new Button[n];
		String[] labels = { "", "Smaller", "Bigger", "", "Reset all", "Done" };
		Button.OnPress[] acts = {
			b -> { cfg().background = !cfg().background; save(); },
			b -> resize(-0.1),
			b -> resize(0.1),
			b -> { cfg().shown = !cfg().shown; save(); },
			b -> HudConfig.get().resetAll(),
			b -> onClose(),
		};
		int left = this.width / 2 - (perRow * w + (perRow - 1) * gap) / 2;
		for (int i = 0; i < n; i++) {
			int col = i % perRow, row = i / perRow;
			int x = left + col * (w + gap), y = this.height - 28 - (rows - 1 - row) * 24;
			made[i] = addRenderableWidget(Button.builder(Component.literal(labels[i]), acts[i]).bounds(x, y, w, 20).build());
		}
		bgButton = made[0];
		showButton = made[3];
	}

	private HudConfig.Element cfg() { return HudConfig.get().element(selected); }
	private void save() { HudConfig.get().save(); }

	private void resize(double by) {
		HudConfig.Element e = cfg();
		e.scale = Math.max(0.5, Math.min(4.0, Math.round((e.scale + by) * 10) / 10.0));
		save();
	}

	private static String nameOf(String id) {
		for (int i = 0; i < HudConfig.IDS.length; i++) if (HudConfig.IDS[i].equals(id)) return NAMES[i];
		return id;
	}

	/** The piece under the mouse (the last drawn wins), or null. */
	private String at(double mx, double my) {
		String hit = null;
		for (String id : HudConfig.IDS) {
			Component t = HudDraw.text(id, true);
			if (t == null) continue;
			int[] p = HudDraw.place(id, this.font, this.width, this.height, true), sz = HudDraw.size(this.font, t, HudConfig.get().element(id).scale);
			if (mx >= p[0] && mx < p[0] + sz[0] && my >= p[1] && my < p[1] + sz[1]) hit = id;
		}
		return hit;
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		g.fill(0, 0, this.width, this.height, 0x60000000);
		bgButton.setMessage(Component.literal((bgButton.getWidth() < 90 ? "Bg: " : "Background: ") + (cfg().background ? "ON" : "OFF")));
		showButton.setMessage(Component.literal(cfg().shown ? "Hide" : "Show"));
		for (String id : HudConfig.IDS) {
			int[] box = HudDraw.draw(g, id, true);
			if (box == null) continue;
			boolean sel = id.equals(selected), hidden = !HudConfig.get().element(id).shown;
			int c = sel ? 0xFFFFD84A : hidden ? 0x80FF5555 : 0x80FFFFFF;
			g.fill(box[0] - 1, box[1] - 1, box[0] + box[2] + 1, box[1], c);
			g.fill(box[0] - 1, box[1] + box[3], box[0] + box[2] + 1, box[1] + box[3] + 1, c);
			g.fill(box[0] - 1, box[1], box[0], box[1] + box[3], c);
			g.fill(box[0] + box[2], box[1], box[0] + box[2] + 1, box[1] + box[3], c);
			if (hidden) g.text(this.font, "hidden", box[0], box[1] + box[3] + 2, 0xFFFF7777, true);
		}
		g.centeredText(this.font, Component.literal("Unbound HUD"), this.width / 2, 12, 0xFFFFFFFF);
		g.centeredText(this.font, Component.literal("Drag to move  •  Scroll to resize  •  Right-click: background on/off"), this.width / 2, 26, 0xFFBBBBBB);
		g.centeredText(this.font, Component.literal("Selected: " + nameOf(selected) + "  (" + Math.round(cfg().scale * 100) + "%)"), this.width / 2, this.height - 42 - (rows - 1) * 24, 0xFFFFD84A);
		super.extractRenderState(g, mouseX, mouseY, delta);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
		if (super.mouseClicked(e, doubleClick)) return true;
		String id = at(e.x(), e.y());
		if (id == null) return false;
		selected = id;
		if (e.button() == 1) { cfg().background = !cfg().background; save(); return true; }
		int[] p = HudDraw.place(id, this.font, this.width, this.height, true);
		dragging = id;
		grabX = e.x() - p[0];
		grabY = e.y() - p[1];
		return true;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
		if (dragging == null) return super.mouseDragged(e, dx, dy);
		HudConfig.Element el = HudConfig.get().element(dragging);
		el.x = Math.max(0, Math.min(1, (e.x() - grabX) / this.width));
		el.y = Math.max(0, Math.min(1, (e.y() - grabY) / this.height));
		return true;
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent e) {
		if (dragging != null) { dragging = null; save(); return true; }
		return super.mouseReleased(e);
	}

	@Override
	public boolean mouseScrolled(double mx, double my, double h, double v) {
		String id = at(mx, my);
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

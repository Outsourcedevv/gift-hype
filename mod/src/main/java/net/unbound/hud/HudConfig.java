package net.unbound.hud;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.minecraft.client.Minecraft;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;

/** Where each piece goes, how big, and whether it has a background. Saved in config/unbound-hud.json. */
public final class HudConfig {
	public static final class Element {
		public double x = -1, y = -1;     // top-left as a share of the screen (0 to 1); -1 = the starting place
		public double scale = 1.0;
		public boolean background = true;
		public boolean shown = true;
	}

	public Map<String, Element> elements = new LinkedHashMap<>();

	public static final String[] IDS = { "level", "count", "punches", "shield", "popups", "giftlist", "reset", "wheel", "timer", "chatdel", "reveal" };
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static HudConfig instance;

	public static HudConfig get() {
		if (instance == null) instance = load();
		return instance;
	}

	// the stream overlay's pieces start smaller (there's not much room on a Minecraft screen)
	private static final java.util.Set<String> OVERLAY = java.util.Set.of("popups", "giftlist", "reset", "wheel", "timer", "chatdel", "reveal");

	public Element element(String id) {
		return elements.computeIfAbsent(id, k -> { Element e = new Element(); if (OVERLAY.contains(k)) e.scale = 0.7; return e; });
	}

	private static File file() {
		return new File(new File(Minecraft.getInstance().gameDirectory, "config"), "unbound-hud.json");
	}

	private static HudConfig load() {
		HudConfig c = null;
		try {
			File f = file();
			if (f.exists()) c = GSON.fromJson(Files.readString(f.toPath(), StandardCharsets.UTF_8), HudConfig.class);
		} catch (Exception ignored) { }
		if (c == null || c.elements == null) { c = new HudConfig(); }
		for (String id : IDS) c.element(id);
		return c;
	}

	public void save() {
		try {
			File f = file();
			f.getParentFile().mkdirs();
			Files.writeString(f.toPath(), GSON.toJson(this), StandardCharsets.UTF_8);
		} catch (Exception ignored) { }
	}

	public void resetAll() {
		elements.clear();
		for (String id : IDS) element(id);
		save();
	}
}

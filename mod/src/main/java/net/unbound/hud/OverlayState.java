package net.unbound.hud;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.List;

/** What Unbound's stream overlay is showing right now (it's sent the same events), for the game to draw. */
public final class OverlayState {
	public record Popup(String from, String gift, int count, String what, String color, long until) { }
	public record MenuItem(String name, Integer coins, String does) { }
	public record ChatDel(String label, String by, int left, int total) { }

	public static volatile boolean linked = false;          // connected to Unbound
	// gift popups
	public static final List<Popup> popups = new ArrayList<>();
	public static double popSeconds = 4.5;
	public static int popMax = 4;
	// the gift list
	public static volatile List<MenuItem> menu = List.of();
	// the reset countdown
	public static volatile boolean resetOn = false;
	public static volatile int resetLeft = 0, resetTotal = 0;
	public static volatile String resetSave = null, resultText = null, resultWho = null;
	public static volatile long resultUntil = 0;
	public static volatile boolean resultBad = false;
	// the level slot machine
	public static volatile int[] wheelAmounts = null;
	public static volatile int wheelResult = 0;
	public static volatile String wheelFrom = "";
	public static volatile long wheelStart = 0, wheelSpin = 4500;
	// Chunk Chat / Chat Teleport timer
	public static volatile boolean timerOn = false;
	public static volatile String timerTag = "NEXT CHUNK", timerLeader = null, timerBy = null, timerDoneTag = null, timerDone = null, timerDoneBy = null;
	public static volatile int timerLeft = 0, timerTotal = 0;
	public static volatile List<String[]> timerTop = List.of();
	public static volatile long timerDoneUntil = 0;
	// chat block delete
	public static volatile List<ChatDel> chatDel = List.of();
	public static volatile String chatDelDone = null, chatDelDoneSub = null;
	public static volatile long chatDelDoneUntil = 0;
	// Chunk Chat's reveal
	public static volatile String revealLabel = null, revealSub = null;
	public static volatile long revealUntil = 0;

	private OverlayState() { }

	private static String str(JsonObject o, String k) { JsonElement e = o.get(k); return e == null || e.isJsonNull() ? null : e.getAsString(); }
	private static int num(JsonObject o, String k, int def) { try { JsonElement e = o.get(k); return e == null || e.isJsonNull() ? def : e.getAsInt(); } catch (Exception x) { return def; } }

	public static void clear() {
		synchronized (popups) { popups.clear(); }
		menu = List.of(); resetOn = false; resultUntil = 0; wheelAmounts = null; timerOn = false; timerDoneUntil = 0;
		chatDel = List.of(); chatDelDoneUntil = 0; revealUntil = 0;
	}

	/** One of the overlay's events (the same name and data as the overlay gets). */
	public static void on(String event, JsonElement data) {
		long now = System.currentTimeMillis();
		switch (event) {
			case "settings" -> settings(data.getAsJsonObject());
			case "state" -> { JsonObject o = data.getAsJsonObject(); if (o.has("settings")) settings(o.getAsJsonObject("settings")); }
			case "menu" -> {
				List<MenuItem> list = new ArrayList<>();
				for (JsonElement e : data.getAsJsonArray()) {
					JsonObject o = e.getAsJsonObject();
					list.add(new MenuItem(str(o, "name"), o.has("coins") && !o.get("coins").isJsonNull() ? o.get("coins").getAsInt() : null, str(o, "does")));
				}
				menu = list;
			}
			case "alert" -> {
				JsonObject o = data.getAsJsonObject();
				String what = str(o, "action"); if (what == null || what.isEmpty()) what = str(o, "label");
				String from = str(o, "from"), gift = str(o, "gift");
				if ("follow".equals(str(o, "event"))) gift = null;
				synchronized (popups) {
					popups.add(new Popup(from == null ? "someone" : from, gift, num(o, "count", 1), what == null ? "" : what, str(o, "actionColor"), now + (long) (popSeconds * 1000)));
					while (popups.size() > Math.max(1, popMax)) popups.remove(0);
				}
			}
			case "reset" -> {
				JsonObject o = data.getAsJsonObject();
				boolean active = o.has("active") && o.get("active").getAsBoolean();
				resetOn = active;
				if (active) {
					resetLeft = num(o, "secondsLeft", 0); resetTotal = num(o, "total", 0);
					JsonElement s = o.get("saveGift");
					resetSave = s != null && s.isJsonObject() ? str(s.getAsJsonObject(), "name") : null;
				} else {
					String ev = str(o, "event"), by = str(o, "by");
					if ("saved".equals(ev) || "done".equals(ev) || "blocked".equals(ev)) {
						resultText = "saved".equals(ev) ? "SAVED!" : "done".equals(ev) ? "RESET!" : "BLOCKED!";
						resultWho = "saved".equals(ev) ? "by " + by : "blocked".equals(ev) ? by + "'s reset hit a shield" : by != null ? "thanks to " + by : null;
						resultBad = "done".equals(ev);
						resultUntil = now + 4000;
					}
				}
			}
			case "wheel" -> {
				JsonObject o = data.getAsJsonObject();
				JsonArray a = o.getAsJsonArray("amounts");
				int[] am = new int[a.size()];
				for (int i = 0; i < am.length; i++) am[i] = a.get(i).getAsInt();
				wheelAmounts = am; wheelResult = num(o, "result", 0); wheelFrom = str(o, "from"); wheelSpin = num(o, "spinMs", 4500); wheelStart = now;
			}
			case "chunkchat" -> {
				if (data == null || !data.isJsonObject()) { timerOn = false; return; }
				JsonObject o = data.getAsJsonObject();
				timerOn = o.has("on") && o.get("on").getAsBoolean();
				if (!timerOn) return;
				if (o.has("done") && o.get("done").isJsonObject()) {
					JsonObject d = o.getAsJsonObject("done");
					boolean none = d.has("none") && d.get("none").getAsBoolean();
					timerDoneTag = none ? null : (str(o, "doneTag") != null ? str(o, "doneTag") : "YOUR CHUNK IS NOW");
					timerDone = none ? "Nobody picked a block" : str(d, "label");
					timerDoneBy = none ? "type a block in chat!" : d.has("failed") && d.get("failed").getAsBoolean() ? "it didn't work this time" : str(d, "by") != null ? "picked by " + str(d, "by") : null;
					timerDoneUntil = now + 4000;
					return;
				}
				timerTag = str(o, "tag") != null ? str(o, "tag") : "NEXT CHUNK";
				timerLeft = num(o, "left", 0); timerTotal = num(o, "total", 0);
				JsonElement l = o.get("leader");
				if (l != null && l.isJsonObject()) {
					JsonObject lo = l.getAsJsonObject();
					timerLeader = str(lo, "label");
					timerBy = str(lo, "by") != null ? "picked by " + str(lo, "by") : num(lo, "votes", 0) > 0 ? num(lo, "votes", 0) + " vote" + (num(lo, "votes", 0) > 1 ? "s" : "") : null;
				} else { timerLeader = null; timerBy = null; }
				List<String[]> top = new ArrayList<>();
				JsonElement t = o.get("top");
				if (t != null && t.isJsonArray()) {
					int i = 0;
					for (JsonElement e : t.getAsJsonArray()) { if (i++ == 0) continue; if (i > 4) break; JsonObject to = e.getAsJsonObject(); top.add(new String[] { str(to, "label"), String.valueOf(num(to, "votes", 0)) }); }
				}
				timerTop = top;
			}
			case "chatdel" -> {
				JsonObject o = data.getAsJsonObject();
				List<ChatDel> items = new ArrayList<>();
				JsonElement it = o.get("items");
				if (it != null && it.isJsonArray()) for (JsonElement e : it.getAsJsonArray()) {
					JsonObject io = e.getAsJsonObject();
					items.add(new ChatDel(str(io, "label"), str(io, "by"), num(io, "left", 0), num(io, "total", 0)));
				}
				chatDel = items;
				if (o.has("done") && o.get("done").isJsonObject()) {
					JsonObject d = o.getAsJsonObject("done");
					chatDelDone = str(d, "label") + " DELETED";
					chatDelDoneSub = d.has("failed") && d.get("failed").getAsBoolean() ? "nobody in the world" : String.format("%,d blocks gone", num(d, "count", 0));
					chatDelDoneUntil = now + 4000;
				}
			}
			case "chunkreveal" -> {
				JsonObject o = data.getAsJsonObject();
				revealLabel = str(o, "label");
				String by = str(o, "by"); int votes = num(o, "votes", 0), count = num(o, "count", 0);
				List<String> sub = new ArrayList<>();
				if (by != null) sub.add("picked by " + by); else if (votes > 0) sub.add(votes + " vote" + (votes > 1 ? "s" : ""));
				if (count > 0) sub.add(String.format("%,d blocks", count));
				revealSub = String.join("  •  ", sub);
				revealUntil = now + 4600;
			}
			default -> { }
		}
	}

	private static void settings(JsonObject s) {
		JsonElement ov = s.get("overlay");
		JsonObject o = ov != null && ov.isJsonObject() ? ov.getAsJsonObject() : s;
		if (o.has("popSeconds")) popSeconds = o.get("popSeconds").getAsDouble();
		if (o.has("popMax")) popMax = o.get("popMax").getAsInt();
	}
}

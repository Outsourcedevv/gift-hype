package net.unbound.hud;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.Minecraft;

import java.io.File;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
import java.util.Iterator;

/**
 * Listens to Unbound (running on this PC) like the stream overlay does, so the game can show the same
 * things. Tries again every few seconds while Unbound isn't open. Its port is in config/unbound-link.json
 * (Unbound writes it there), 4747 if not.
 */
public final class UnboundLink {
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

	private UnboundLink() { }

	private static int port() {
		try {
			File f = new File(new File(Minecraft.getInstance().gameDirectory, "config"), "unbound-link.json");
			if (f.exists()) return JsonParser.parseString(Files.readString(f.toPath(), StandardCharsets.UTF_8)).getAsJsonObject().get("port").getAsInt();
		} catch (Exception ignored) { }
		return 4747;
	}

	public static void start() {
		Thread t = new Thread(UnboundLink::run, "Unbound link");
		t.setDaemon(true);
		t.start();
	}

	private static void run() {
		while (true) {
			try {
				String base = "http://127.0.0.1:" + port();
				// what's on the overlay now
				HttpResponse<String> st = HTTP.send(HttpRequest.newBuilder(URI.create(base + "/api/overlay-state")).timeout(Duration.ofSeconds(5)).GET().build(), HttpResponse.BodyHandlers.ofString());
				if (st.statusCode() == 200) {
					JsonObject o = JsonParser.parseString(st.body()).getAsJsonObject();
					if (o.has("settings")) OverlayState.on("settings", o.get("settings"));
					if (o.has("menu")) OverlayState.on("menu", o.get("menu"));
					if (o.has("reset")) OverlayState.on("reset", o.get("reset"));
					if (o.has("chatdel") && o.get("chatdel").isJsonArray()) { JsonObject d = new JsonObject(); d.add("items", o.get("chatdel")); OverlayState.on("chatdel", d); }
					if (o.has("chunkchat")) OverlayState.on("chunkchat", o.get("chunkchat"));
				}
				// then everything as it happens
				HttpResponse<java.util.stream.Stream<String>> r = HTTP.send(HttpRequest.newBuilder(URI.create(base + "/api/events")).GET().build(), HttpResponse.BodyHandlers.ofLines());
				if (r.statusCode() != 200) throw new Exception("status " + r.statusCode());
				OverlayState.linked = true;
				String event = "message";
				StringBuilder data = new StringBuilder();
				Iterator<String> it = r.body().iterator();
				while (it.hasNext()) {
					String line = it.next();
					if (line.isEmpty()) {
						if (data.length() > 0) {
							try { OverlayState.on(event, JsonParser.parseString(data.toString())); } catch (Exception ignored) { }
						}
						event = "message"; data.setLength(0);
					} else if (line.startsWith("event:")) event = line.substring(6).trim();
					else if (line.startsWith("data:")) data.append(line.substring(5).trim());
				}
			} catch (Exception ignored) { }
			OverlayState.linked = false;
			OverlayState.clear();
			try { Thread.sleep(4000); } catch (InterruptedException e) { return; }
		}
	}
}

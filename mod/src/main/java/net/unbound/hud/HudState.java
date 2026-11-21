package net.unbound.hud;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** What Unbound's game (the Dropper or Wipeout) last said in its info line at the bottom of the screen. */
public final class HudState {
	// e.g. "Level 5     Wipeouts 3     Punches ON     Shield x1" (the Dropper says Fails)
	private static final Pattern LINE = Pattern.compile(
		"^\\s*(?:Level\\s+(\\S+)\\s+)?(Wipeouts|Fails)\\s+(\\d+)\\s+Punches\\s+(ON|OFF)(?:\\s+Shield\\s+x(\\d+))?\\s*$");

	public static String level = null;     // "5", "DONE" or null (not sent)
	public static String countLabel = "Wipeouts";
	public static int count = 0;
	public static boolean punchesOn = true;
	public static int shield = 0;
	private static long lastSeen = 0;

	private HudState() { }

	/** True (and remembered) if the text is Unbound's info line. */
	public static boolean accept(String text) {
		Matcher m = LINE.matcher(text);
		if (!m.matches()) return false;
		level = m.group(1);
		countLabel = m.group(2);
		count = Integer.parseInt(m.group(3));
		punchesOn = "ON".equals(m.group(4));
		shield = m.group(5) == null ? 0 : Integer.parseInt(m.group(5));
		lastSeen = System.currentTimeMillis();
		return true;
	}

	/** Shown while the game keeps sending it (twice a second); gone a few seconds after it stops. */
	public static boolean active() {
		return System.currentTimeMillis() - lastSeen < 3000;
	}
}

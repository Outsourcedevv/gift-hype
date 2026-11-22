package net.unbound.hud.mixin;

import net.minecraft.client.gui.Hud;
import net.minecraft.network.chat.Component;
import net.unbound.hud.HudState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Unbound's info line isn't shown the normal way: the mod draws it as movable pieces instead. */
@Mixin(Hud.class)
public class HudMixin {
	@Inject(method = "setOverlayMessage", at = @At("HEAD"), cancellable = true)
	private void unbound$takeInfoLine(Component message, boolean animate, CallbackInfo ci) {
		if (message != null && HudState.accept(message.getString())) ci.cancel();
	}
}

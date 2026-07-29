import { logGuiCacheSizes } from "../gui/cacheTelemetry";
import { flushGuiDebug } from "../gui/lib/debugLog";

export function commandCaches(args: string[]): void {
    if (args.length > 0) {
        ChatLib.chat("&c[caches] Usage: /htsw debug caches");
        return;
    }
    logGuiCacheSizes();
    flushGuiDebug();
    ChatLib.chat("&a[caches] wrote cache sizes to gui-debug.log");
}

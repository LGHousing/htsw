import { getWatchMode } from "../settings";
import { setWatchModeEnabled } from "../gui/watchMode";

export function commandWatch(args: string[]): void {
    const action = (args[0] ?? "").toLowerCase();
    if (action === "on") {
        setWatchModeEnabled(true);
        return;
    }
    if (action === "off") {
        setWatchModeEnabled(false);
        return;
    }
    ChatLib.chat(
        `&7[htsw] Watch mode is ${getWatchMode() ? "&aon" : "&coff"}&7.`
    );
    ChatLib.chat("&7[htsw] Usage: /htsw watch <on|off>");
}
